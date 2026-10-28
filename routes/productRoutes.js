const express = require('express');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const User = require('../models/User');

const {
  protect,
  adminOnly,
  approvedSellerOnly,
} = require('../middleware/authMiddleware');

const sellerUpload = require('../middleware/sellerUpload');
const uploadProductImage = require('../utils/uploadProductImage');
const { sendSalesNotificationEmail } = require('../services/emailService');

const router = express.Router();

/*
 * Maximum number of product images allowed.
 */
const MAX_PRODUCT_IMAGES = 4;

/*
 * Build a clean URL-friendly slug.
 */
const escapeEmailHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

/*
 * Convert a value into a safe number.
 */
const toNumber = (value, fallback = 0) => {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
};

/*
 * Normalize booleans from JSON and admin form payloads.
 * Boolean("false") is true in JavaScript, so avoid Boolean(value).
 */
const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  return fallback;
};

/*
 * Calculate discount percentage.
 */
const calculateDiscount = (oldPrice, price) => {
  const oldValue = toNumber(oldPrice);
  const currentValue = toNumber(price);

  if (
    oldValue <= 0 ||
    currentValue < 0 ||
    currentValue >= oldValue
  ) {
    return 0;
  }

  return Math.round(
    ((oldValue - currentValue) / oldValue) * 100
  );
};

/*
 * Parse specifications sent as JSON
 * from multipart/form-data.
 */
const parseSpecifications = (value) => {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
};

/*
 * Parse a list of features.
 */
const parseList = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  return String(value)
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
};

/*
 * Find a category by:
 * - MongoDB ObjectId
 * - category name
 * - category slug
 */
const findCategory = async (category) => {
  if (!category) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(category)) {
    return Category.findById(category).select('_id');
  }

  const categorySlug = buildSlug(category);

  return Category.findOne({
    $or: [
      { name: category },
      { slug: categorySlug },
    ],
  }).select('_id');
};

/*
 * Upload product images to Cloudinary.
 */
const uploadProductImages = async (files = []) => {
  if (!files.length) {
    return [];
  }

  if (files.length > MAX_PRODUCT_IMAGES) {
    throw new Error(
      `You can upload a maximum of ${MAX_PRODUCT_IMAGES} product images.`
    );
  }

  const uploadedImages = [];

  for (const file of files) {
    const result =
      await uploadProductImage(file.buffer);

    if (result?.secure_url) {
      uploadedImages.push(result.secure_url);
    }
  }

  return uploadedImages;
};

/* =========================================================
   PUBLIC PRODUCT ROUTES
   ========================================================= */

/*
 * GET /api/products/filters
 * Public filter options for the live catalogue. Includes categories and brands
 * already used by approved products, even when older product brands predate the brand catalogue.
 */
router.get('/filters', async (req, res) => {
  try {
    const [categories, activeBrands, productBrands] = await Promise.all([
      Category.find({ isActive: true }).select('_id name slug parentCategory').sort({ name: 1 }).lean(),
      Brand.find({ isActive: true }).select('_id name slug').sort({ name: 1 }).lean(),
      Product.distinct('brand', { isActive: mongoose.trusted({ $ne: false }), approvalStatus: 'approved' }),
    ]);
    const brandMap = new Map();
    for (const item of activeBrands) {
      if (item?.name) brandMap.set(item.name.trim().toLowerCase(), { ...item, name: item.name.trim() });
    }
    for (const value of productBrands) {
      const name = String(value || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!brandMap.has(key)) brandMap.set(key, { _id: 'product-brand-' + key.replace(/[^a-z0-9]+/g, '-'), name, slug: buildSlug(name), fromExistingProduct: true });
    }
    return res.json({ categories, brands: [...brandMap.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    console.error('Unable to load product filters:', error);
    return res.status(500).json({ message: 'Unable to load catalogue filters.' });
  }
});

/*
 * GET /api/products
 *
 * Public product catalogue.
 */
router.get('/', async (req, res) => {
  try {
    const {
      category,
      brand,
      search,
      featured,
      isNew,
      flashSale,
      offer,
      inStock,
      condition,
      sort,
      page = 1,
      limit = 12,
    } = req.query;

    const safePage = Math.max(
      1,
      Number(page) || 1
    );

    const safeLimit = Math.min(
      100,
      Math.max(1, Number(limit) || 12)
    );

    // Run promotion expiry maintenance only for featured catalogue requests,
    // not every ordinary product search. This avoids an unnecessary DB write
    // on the most common mobile browsing path.
    if (featured === 'true') {
      await Product.updateMany(
        {
          seller: mongoose.trusted({ $ne: null }),
          featured: true,
          featuredExpiresAt: mongoose.trusted({ $lte: new Date() }),
        },
        { $set: { featured: false, isNew: false, sponsorshipStatus: 'expired' } },
      );
    }

    /*
     * Public catalogue only shows:
     * - active products
     * - approved products
     */
    const filter = {
      // Treat legacy approved records with no isActive field as active.
      // Explicitly inactive, pending, and rejected products remain hidden.
      isActive: mongoose.trusted({ $ne: false }),
      approvalStatus: 'approved',
    };

    /*
     * Category filter.
     */
    if (category) {
      const categoryRecord =
        await findCategory(category);

      if (!categoryRecord) {
        return res.json({
          products: [],
          page: safePage,
          totalPages: 0,
          totalProducts: 0,
        });
      }

      // Selecting a top-level category includes products in its subcategories.
      const childCategories = await Category.find({ parentCategory: categoryRecord._id, isActive: true }).select('_id').lean();
      const categoryIds = [categoryRecord._id, ...childCategories.map(item => item._id)];
      filter.category = categoryIds.length > 1
        ? mongoose.trusted({ $in: categoryIds })
        : categoryRecord._id;
    }

    /*
     * Brand filter.
     */
    if (brand) {
      filter.brand = brand;
    }

    /*
     * Featured products.
     */
    if (featured === 'true') {
      filter.featured = true;
      // Platform-managed featured items may have no expiry. Seller-sponsored
      // items must have a future paid-through date.
      filter.$and = [
        ...(filter.$and || []),
        { $or: [
          { seller: null },
          { seller: mongoose.trusted({ $exists: false }) },
          { featuredExpiresAt: mongoose.trusted({ $gt: new Date() }) },
        ] },
      ];
    }

    /*
     * New arrival products.
     */
    if (isNew === 'true') {
      filter.isNew = true;
    }

    /*
     * Flash sale products.
     */
    if (flashSale === 'true') {
      filter.flashSale = true;
    }

    /*
     * Offer products.
     */
    if (offer === 'true') {
      filter.offer = true;
    }

    /*
     * Product condition (new, refurbished or used).
     */
    if (['New', 'Refurbished', 'Used'].includes(condition)) {
      filter.condition = condition;
    }

    /*
     * In-stock products.
     */
    if (inStock === 'true') {
      filter.stock = mongoose.trusted({ $gt: 0 });
    }

    /*
     * Search by name, brand or SKU.
     */
    if (search) {
      if (typeof search !== 'string') {
        return res.status(400).json({
          products: [],
          page: safePage,
          totalPages: 0,
          totalProducts: 0,
        });
      }
      filter.$or = [
        {
          name: {
            $regex: search,
            $options: 'i',
          },
        },
        {
          brand: {
            $regex: search,
            $options: 'i',
          },
        },
        {
          sku: {
            $regex: search,
            $options: 'i',
          },
        },
      ];
    }

    /*
     * Sorting.
     */
    let sortOption = {
      createdAt: -1,
    };

    switch (sort) {
      case 'price-asc':
        sortOption = {
          price: 1,
        };
        break;

      case 'price-desc':
        sortOption = {
          price: -1,
        };
        break;

      case 'discount':
        sortOption = {
          discount: -1,
        };
        break;

      default:
        break;
    }

    /*
     * Use database pagination for the normal catalogue. Previously the route
     * loaded every matching product into Node, populated every seller/category,
     * then sliced the result; this becomes slow as the catalogue grows and is
     * particularly costly on mobile connections.
     */
    const needsDateWindowFiltering = flashSale === 'true' || offer === 'true';
    if (!needsDateWindowFiltering) {
      const [pageProducts, totalProducts] = await Promise.all([
        Product.find(filter)
          .populate('category', 'name slug')
          .populate('seller', 'name email sellerProfile.storeName')
          .sort(sortOption)
          .skip((safePage - 1) * safeLimit)
          .limit(safeLimit)
          .lean(),
        Product.countDocuments(filter),
      ]);

      return res.json({
        products: pageProducts,
        page: safePage,
        totalPages: Math.ceil(totalProducts / safeLimit),
        totalProducts,
      });
    }

    // Offers and flash sales retain their existing date-window checks.
    let products = await Product.find(filter)
      .populate('category', 'name slug')
      .populate('seller', 'name email sellerProfile.storeName')
      .sort(sortOption);

    const now = new Date();
    products = products.filter((product) => {
      const start = product.offerStartDate ? new Date(product.offerStartDate) : null;
      const end = product.offerEndDate ? new Date(product.offerEndDate) : null;
      return (!start || start.getTime() <= now.getTime()) &&
        (!end || end.getTime() > now.getTime());
    });

    const totalProducts = products.length;
    const totalPages = Math.ceil(totalProducts / safeLimit);
    const startIndex = (safePage - 1) * safeLimit;
    return res.json({
      products: products.slice(startIndex, startIndex + safeLimit),
      page: safePage,
      totalPages,
      totalProducts,
    });
  } catch (error) {
    console.error(
      'Load products error:',
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        'Unable to load products.',
    });
  }
});

/*
 * GET /api/products/slug/:slug
 */
router.get(
  '/slug/:slug',
  async (req, res) => {
    try {
      const product =
        await Product.findOne({
          slug: req.params.slug,
          // Keep legacy approved products (missing isActive) consistent with the catalogue.
          isActive: mongoose.trusted({ $ne: false }),
          approvalStatus: 'approved',
        })
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found.',
        });
      }

      res.json(product);
    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to fetch product.',
      });
    }
  }
);

/* =========================================================
   SELLER PRODUCT ROUTES
   ========================================================= */

/*
 * GET /api/products/store/:sellerId
 * Public storefront: only active, approved listings from an approved seller.
 */
router.get('/store/:sellerId/products', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.sellerId)) {
      return res.status(400).json({ success: false, message: 'Invalid store ID.' });
    }
    const seller = await User.findOne({
      _id: req.params.sellerId,
      sellerStatus: 'approved',
      accountStatus: mongoose.trusted({ $nin: ['suspended', 'banned'] }),
    }).select('name email createdAt sellerProfile.storeName sellerProfile.storeProfile sellerProfile.storeLocation sellerProfile.storeLogo');
    if (!seller) {
      return res.status(404).json({ success: false, message: 'Store not found or unavailable.' });
    }
    const products = await Product.find({
      seller: seller._id,
      isActive: mongoose.trusted({ $ne: false }),
      approvalStatus: 'approved',
    }).populate('category', 'name slug').sort({ featured: -1, createdAt: -1 });
    return res.json({
      success: true,
      seller: {
        _id: seller._id,
        name: seller.name,
        email: seller.email,
        createdAt: seller.createdAt,
        storeName: seller.sellerProfile?.storeName || 'Seller Store',
        storeProfile: seller.sellerProfile?.storeProfile || '',
        storeLocation: seller.sellerProfile?.storeLocation || '',
        storeLogo: seller.sellerProfile?.storeLogo || '',
      },
      data: products,
    });
  } catch (error) {
    console.error('Public seller store catalogue error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load this store.' });
  }
});

/*
 * SELLER STORE PROFILE
 * Store details are always scoped to the authenticated seller.
 */
router.get('/seller/store', protect, approvedSellerOnly, async (req, res) => {
  try {
    const seller = await User.findById(req.user._id).select('sellerProfile');
    if (!seller || !seller.sellerProfile) {
      return res.status(404).json({ success: false, message: 'Seller profile not found.' });
    }
    const profile = seller.sellerProfile;
    return res.json({
      success: true,
      data: {
        storeName: profile.storeName || '',
        storeProfile: profile.storeProfile || '',
        storeLocation: profile.storeLocation || '',
        storeLogo: profile.storeLogo || '',
      },
    });
  } catch (error) {
    console.error('Load seller store profile error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load store information.' });
  }
});

router.put('/seller/store', protect, approvedSellerOnly, async (req, res) => {
  try {
    const storeName = String(req.body?.storeName || '').trim();
    const storeProfile = String(req.body?.storeProfile || '').trim();
    const storeLocation = String(req.body?.storeLocation || '').trim();
    const storeLogo = String(req.body?.storeLogo || '').trim();

    if (storeName.length < 2 || storeName.length > 150) {
      return res.status(400).json({ success: false, message: 'Store name must be between 2 and 150 characters.' });
    }
    if (storeProfile.length > 1000) {
      return res.status(400).json({ success: false, message: 'Store description cannot exceed 1000 characters.' });
    }
    if (storeLocation.length > 250) {
      return res.status(400).json({ success: false, message: 'Store location cannot exceed 250 characters.' });
    }
    if (storeLogo && (!/^https?:\/\//i.test(storeLogo) || storeLogo.length > 500)) {
      return res.status(400).json({ success: false, message: 'Store logo must be a valid HTTPS or HTTP image URL.' });
    }

    const seller = await User.findById(req.user._id);
    if (!seller || !seller.sellerProfile) {
      return res.status(404).json({ success: false, message: 'Seller profile not found.' });
    }

    seller.sellerProfile.storeName = storeName;
    seller.sellerProfile.storeProfile = storeProfile;
    seller.sellerProfile.storeLocation = storeLocation;
    seller.sellerProfile.storeLogo = storeLogo;
    await seller.save();

    return res.json({
      success: true,
      message: 'Store information saved successfully.',
      data: {
        storeName,
        storeProfile,
        storeLocation,
        storeLogo,
      },
    });
  } catch (error) {
    console.error('Update seller store profile error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to save store information.' });
  }
});

/*
 * GET /api/products/seller/product/:id
 * Read one product belonging to the authenticated seller, including products
 * that are pending or rejected and therefore are not publicly visible.
 */
router.get('/seller/product/:id', protect, approvedSellerOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    const product = await Product.findOne({ _id: req.params.id, seller: req.user._id })
      .populate('category')
      .populate('seller', 'name email sellerProfile.storeName');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found in your store.' });
    }
    return res.json({ success: true, product });
  } catch (error) {
    console.error('Load seller product error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load this product.' });
  }
});

/*
 * GET /api/products/seller/me
 */
router.get(
  '/seller/me',
  protect,
  approvedSellerOnly,
  async (req, res) => {
    try {
      const {
        search,
        category,
        status,
        page = 1,
        limit = 20,
      } = req.query;

      const safePage = Math.max(
        1,
        Number(page) || 1
      );

      const safeLimit = Math.min(
        100,
        Math.max(1, Number(limit) || 20)
      );

      const filter = {
        seller: req.user._id,
      };

      if (search) {
        filter.$or = [
          {
            name: {
              $regex: search,
              $options: 'i',
            },
          },
          {
            sku: {
              $regex: search,
              $options: 'i',
            },
          },
          {
            brand: {
              $regex: search,
              $options: 'i',
            },
          },
        ];
      }

      if (category) {
        const categoryRecord =
          await findCategory(category);

        if (!categoryRecord) {
          return res.json({
            success: true,
            products: [],
            page: safePage,
            totalPages: 0,
            totalProducts: 0,
          });
        }

        filter.category =
          categoryRecord._id;
      }

      if (status === 'active') {
        filter.isActive = true;
      }

      if (status === 'inactive') {
        filter.isActive = false;
      }

      const total =
        await Product.countDocuments(filter);

      const products =
        await Product.find(filter)
          .populate('category')
          .sort({
            createdAt: -1,
          })
          .skip(
            (safePage - 1) * safeLimit
          )
          .limit(safeLimit);

      res.json({
        success: true,
        products,
        page: safePage,
        totalPages: Math.ceil(
          total / safeLimit
        ),
        totalProducts: total,
      });
    } catch (error) {
      console.error(
        'Seller products error:',
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to load your products.',
      });
    }
  }
);

/*
 * GET /api/products/seller/sheet-csv
 * Safely proxy a public Google Sheets CSV export to avoid browser CORS issues.
 * Only Google Sheets spreadsheet URLs are accepted; arbitrary URLs are rejected.
 */
router.get('/seller/sheet-csv', protect, approvedSellerOnly, async (req, res) => {
  try {
    const input = String(req.query.url || '').trim();
    if (!input || input.length > 1500) {
      return res.status(400).json({ success: false, message: 'Provide a valid Google Sheets URL.' });
    }
    const sheetUrl = new URL(input);
    if (sheetUrl.hostname !== 'docs.google.com' || !sheetUrl.pathname.includes('/spreadsheets/d/')) {
      return res.status(400).json({ success: false, message: 'Only Google Sheets spreadsheet links are supported.' });
    }
    const match = sheetUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      return res.status(400).json({ success: false, message: 'That Google Sheets link is not valid.' });
    }
    const gid = sheetUrl.searchParams.get('gid') || '0';
    if (!/^\d+$/.test(gid)) {
      return res.status(400).json({ success: false, message: 'The Google Sheets tab ID is invalid.' });
    }
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + match[1] + '/export?format=csv&gid=' + gid;
    const response = await fetch(exportUrl, { headers: { Accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' } });
    if (!response.ok) {
      return res.status(400).json({ success: false, message: 'Could not download the sheet. Share it as “Anyone with the link can view” or publish it to the web.' });
    }
    const csv = await response.text();
    if (/<html[\s>]/i.test(csv.slice(0, 500))) {
      return res.status(400).json({ success: false, message: 'Google returned a web page instead of CSV. Make the sheet viewable by anyone with the link.' });
    }
    res.set('Cache-Control', 'no-store');
    return res.type('text/csv; charset=utf-8').send(csv);
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ success: false, message: 'Enter a valid Google Sheets URL.' });
    }
    console.error('Seller Google Sheets CSV load error:', error);
    return res.status(502).json({ success: false, message: 'Unable to load this Google Sheet. Download it as CSV and upload it instead.' });
  }
});

/*
 * POST /api/products/seller/import
 * Bulk seller catalogue import from CSV / Google Sheets.
 * Listings are always pending admin approval and scoped to the authenticated seller.
 */
router.post('/seller/import', protect, approvedSellerOnly, async (req, res) => {
  try {
    const rows = req.body?.products;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide at least one product to import.' });
    }
    if (rows.length > 100) {
      return res.status(400).json({ success: false, message: 'Import a maximum of 100 products per batch.' });
    }

    const importedProducts = [];
    const errors = [];
    const sellerId = String(req.user._id);

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const rowNumber = Number(row.rowNumber) || index + 2;
      try {
        const name = String(row.name || '').trim();
        const brand = String(row.brand || '').trim();
        const category = String(row.category || '').trim();
        const price = Number(row.price);
        const oldPrice = row.oldPrice === '' || row.oldPrice == null ? 0 : Number(row.oldPrice);
        const stock = row.stock === '' || row.stock == null ? 0 : Number(row.stock);
        const deliveryFee = row.deliveryFee === '' || row.deliveryFee == null ? 0 : Number(row.deliveryFee);

        if (!name || !brand || !category || !String(row.description || row.shortDescription || '').trim()) {
          throw new Error('Name, brand, category and description are required.');
        }
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(oldPrice) || oldPrice < 0 ||
            !Number.isFinite(stock) || stock < 0 || !Number.isFinite(deliveryFee) || deliveryFee < 0) {
          throw new Error('Price, old price, stock and delivery fee must be valid non-negative numbers.');
        }

        const slug = buildSlug(name);
        if (!slug) throw new Error('Product name must contain valid characters.');
        const normalizedSku = String(row.sku || row.code || ('SL-' + sellerId.slice(-6) + '-' + Date.now().toString(36) + '-' + rowNumber))
          .trim().toUpperCase();
        if (!normalizedSku) throw new Error('SKU / code is required.');

        const duplicate = await Product.findOne({
          $or: [{ slug }, { sku: normalizedSku }, { code: normalizedSku }],
        }).select('_id name sku');
        if (duplicate) throw new Error('A product with this name/slug or SKU already exists. Change the product name or SKU.');

        const categoryRecord = await findCategory(category);
        if (!categoryRecord) throw new Error('Category "' + category + '" was not found. Use an existing Sylva category.');

        const images = Array.isArray(row.images)
          ? row.images.map((image) => String(image || '').trim()).filter((image) => /^https?:\/\/\S+$/i.test(image)).slice(0, MAX_PRODUCT_IMAGES)
          : [];
        const sourceSpreadsheetUrl = String(row.sourceSpreadsheetUrl || '').trim();
        if (sourceSpreadsheetUrl && (!(sourceSpreadsheetUrl.startsWith('https://') || sourceSpreadsheetUrl.startsWith('http://')) || sourceSpreadsheetUrl.length > 1000)) {
          throw new Error('Spreadsheet link must be a valid HTTP or HTTPS URL no longer than 1000 characters.');
        }

        const product = await Product.create({
          name,
          slug,
          code: normalizedSku,
          sku: normalizedSku,
          brand,
          category: categoryRecord._id,
          subcategory: String(row.subcategory || '').trim(),
          description: String(row.description || row.shortDescription || '').trim(),
          shortDescription: String(row.shortDescription || '').trim(),
          seller: req.user._id,
          price,
          oldPrice,
          discount: calculateDiscount(oldPrice, price),
          images,
          stock,
          condition: String(row.condition || 'New').trim(),
          warranty: String(row.warranty || '').trim(),
          warrantyDuration: String(row.warrantyDuration || '').trim(),
          warrantyTerms: String(row.warrantyTerms || '').trim(),
          deliveryDuration: String(row.deliveryDuration || '').trim(),
          deliveryFee,
          deliveryTerms: String(row.deliveryTerms || '').trim(),
          deliveryLocations: String(row.deliveryLocations || '').trim(),
          returnPeriod: String(row.returnPeriod || '').trim(),
          returnPolicy: String(row.returnPolicy || '').trim(),
          returnConditions: String(row.returnConditions || '').trim(),
          whatsIncluded: String(row.whatsIncluded || '').trim(),
          keyFeatures: Array.isArray(row.keyFeatures) ? row.keyFeatures.map((item) => String(item).trim()).filter(Boolean) : parseList(row.keyFeatures),
          sellerNotes: '',
          sourceSpreadsheetUrl,
          specifications: parseSpecifications(row.specifications),
          isNew: parseBoolean(row.isNew, false),
          isActive: false,
          approvalStatus: 'pending',
          rejectionReason: '',
          approvedAt: null,
          approvedBy: null,
          featured: false,
          flashSale: false,
          offer: false,
          offerMessage: '',
          offerStartDate: null,
          offerEndDate: null,
        });
        importedProducts.push({ rowNumber, id: product._id, name: product.name, sku: product.sku });
      } catch (error) {
        errors.push({ rowNumber, message: error.message || 'Could not import this product.' });
      }
    }

    if (importedProducts.length > 0) {
      const safeSellerName = escapeEmailHtml(req.user.name || 'Sylva seller');
      const safeSellerEmail = escapeEmailHtml(req.user.email || 'Not provided');
      const productRows = importedProducts.map((item) =>
        '<li>' + escapeEmailHtml(item.name) + ' — SKU: ' + escapeEmailHtml(item.sku) + '</li>'
      ).join('');
      const notification = await sendSalesNotificationEmail({
        subject: importedProducts.length + ' seller product(s) submitted for approval',
        html: '<div style="font-family:Arial,sans-serif;color:#17211b;max-width:680px;margin:auto;padding:24px">' +
          '<h2 style="color:#166534">Seller product import submitted</h2><p>' + safeSellerName + ' (' + safeSellerEmail + ') submitted ' +
          importedProducts.length + ' product(s) for admin review.</p><ul>' + productRows + '</ul>' +
          '<p>Review pending products in the Sylva Technologies admin dashboard.</p></div>',
        text: 'Seller product import submitted by ' + (req.user.name || 'Sylva seller') + ' (' + (req.user.email || 'Not provided') + '). Products: ' +
          importedProducts.map((item) => item.name + ' [SKU: ' + item.sku + ']').join('; ') +
          '. These products are pending admin approval.',
      });
      if (!notification?.success) console.error('[Sales email] seller product import notification failed:', notification?.message || 'Unknown email error');
    }

    return res.status(200).json({
      success: errors.length === 0,
      message: importedProducts.length + ' product(s) submitted for admin approval.',
      data: { imported: importedProducts.length, products: importedProducts, errors },
    });
  } catch (error) {
    console.error('Seller bulk product import error:', error);
    return res.status(500).json({ success: false, message: 'Unable to import seller products right now.' });
  }
});

/*
 * POST /api/products/seller
 */
router.post(
  '/seller',
  protect,
  approvedSellerOnly,
  sellerUpload.array(
    'images',
    MAX_PRODUCT_IMAGES
  ),
  async (req, res) => {
    try {
      console.info('[Seller product upload] request received', {
        contentType: req.headers['content-type'] || '',
        filesReceived: Array.isArray(req.files) ? req.files.length : 0,
        files: (req.files || []).map((file) => ({
          fieldname: file.fieldname,
          mimetype: file.mimetype,
          size: file.size,
        })),
        bodyFields: Object.keys(req.body || {}),
      });

      const {
        name,
        brand,
        category,
        subcategory,
        sku,
        price,
        oldPrice,
        stock,
        description,
        shortDescription,
        condition,
        warranty,
        warrantyDuration,
        warrantyTerms,
        deliveryDuration,
        deliveryFee,
        deliveryTerms,
        deliveryLocations,
        returnPeriod,
        returnPolicy,
        returnConditions,
        whatsIncluded,
        keyFeatures,
        sellerNotes,
        sourceSpreadsheetUrl,
        specifications,
        isNew,
      } = req.body;

      if (
        !name ||
        !brand ||
        !category ||
        !sku ||
        price === undefined ||
        price === ''
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Name, brand, category, SKU and price are required.',
        });
      }

      if (
        req.files &&
        req.files.length >
          MAX_PRODUCT_IMAGES
      ) {
        return res.status(400).json({
          success: false,
          message:
            `A maximum of ${MAX_PRODUCT_IMAGES} product images is allowed.`,
        });
      }

      const numericPrice =
        toNumber(price, -1);

      const numericOldPrice =
        toNumber(oldPrice, 0);

      const numericStock =
        toNumber(stock, 0);

      const numericDeliveryFee =
        toNumber(deliveryFee, 0);

      if (numericPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Product price must be a valid amount.',
        });
      }

      if (numericOldPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Old price must be a valid amount.',
        });
      }

      if (numericStock < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Stock cannot be negative.',
        });
      }

      if (numericDeliveryFee < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Delivery fee cannot be negative.',
        });
      }

      const normalizedSku =
        String(sku)
          .trim()
          .toUpperCase();

      const productSlug =
        buildSlug(name);

      if (!productSlug) {
        return res.status(400).json({
          success: false,
          message:
            'Product name must contain valid characters.',
        });
      }

      const duplicate =
        await Product.findOne({
          $or: [
            {
              slug: productSlug,
            },
            {
              sku: normalizedSku,
            },
          ],
        });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message:
            'A product with the same name/slug or SKU already exists.',
        });
      }

      const categoryRecord =
        await findCategory(category);

      if (!categoryRecord) {
        return res.status(400).json({
          success: false,
          message:
            'The selected category does not exist.',
        });
      }

      const spreadsheetUrl = String(sourceSpreadsheetUrl || '').trim();
      if (spreadsheetUrl && (!(spreadsheetUrl.toLowerCase().startsWith('https://') || spreadsheetUrl.toLowerCase().startsWith('http://')) || spreadsheetUrl.length > 1000)) {
        return res.status(400).json({ success: false, message: 'Spreadsheet link must be a valid HTTP or HTTPS URL no longer than 1000 characters.' });
      }

      let suppliedImageUrls = [];
      if (req.body.imageUrls !== undefined && req.body.imageUrls !== '') {
        try {
          suppliedImageUrls = Array.isArray(req.body.imageUrls)
            ? req.body.imageUrls
            : JSON.parse(req.body.imageUrls);
        } catch (error) {
          return res.status(400).json({ success: false, message: 'Image links must be submitted as a valid list.' });
        }
      }
      if (!Array.isArray(suppliedImageUrls)) {
        return res.status(400).json({ success: false, message: 'Image links must be a list of URLs.' });
      }
      suppliedImageUrls = suppliedImageUrls.map((value) => String(value || '').trim()).filter(Boolean);
      if (suppliedImageUrls.some((url) => !/^https?:\/\//i.test(url) || url.length > 2000)) {
        return res.status(400).json({ success: false, message: 'Each image link must be a valid HTTP or HTTPS URL no longer than 2000 characters.' });
      }
      if ((req.files || []).length + suppliedImageUrls.length > MAX_PRODUCT_IMAGES) {
        return res.status(400).json({ success: false, message: `A maximum of ${MAX_PRODUCT_IMAGES} product images is allowed across uploads and image links.` });
      }

      if (!(req.files || []).length && !suppliedImageUrls.length) {
        console.warn('[Seller product upload] rejected: no image files or image URLs received');
        return res.status(400).json({
          success: false,
          message: 'No product images reached the server. Please choose at least one JPG, PNG or WEBP image and try again.',
        });
      }

      const uploadedImageUrls = await uploadProductImages(req.files || []);
      const imageUrls = [...uploadedImageUrls, ...suppliedImageUrls];

      if (
        !imageUrls.length ||
        uploadedImageUrls.length !== (req.files || []).length ||
        imageUrls.some((url) => typeof url !== 'string' || !/^https?:\/\//i.test(url))
      ) {
        throw new Error('One or more product images could not be uploaded. Please retry with JPG, PNG or WEBP images up to 5 MB each.');
      }

      console.info('[Seller product upload] images uploaded successfully', {
        uploadedFiles: (req.files || []).length,
        hostedImageCount: imageUrls.length,
      });

      const product =
        await Product.create({
          name: name.trim(),

          slug: productSlug,

          code: normalizedSku,

          sku: normalizedSku,

          brand: brand.trim(),

          category:
            categoryRecord._id,

          subcategory:
            subcategory || '',

          description:
            description || '',

          shortDescription:
            shortDescription || '',

          seller:
            req.user._id,

          price:
            numericPrice,

          oldPrice:
            numericOldPrice,

          discount:
            calculateDiscount(
              numericOldPrice,
              numericPrice
            ),

          images:
            imageUrls,

          stock:
            numericStock,

          condition:
            condition || 'New',

          warranty:
            warranty || '',

          warrantyDuration:
            warrantyDuration || '',

          warrantyTerms:
            warrantyTerms || '',

          deliveryDuration:
            deliveryDuration || '',

          deliveryFee:
            numericDeliveryFee,

          deliveryTerms:
            deliveryTerms || '',

          deliveryLocations:
            deliveryLocations || '',

          returnPeriod:
            returnPeriod || '',

          returnPolicy:
            returnPolicy || '',

          returnConditions:
            returnConditions || '',

          whatsIncluded:
            whatsIncluded || '',

          keyFeatures:
            parseList(keyFeatures),

          sellerNotes:
            sellerNotes || '',

          sourceSpreadsheetUrl: spreadsheetUrl,

          specifications:
            parseSpecifications(
              specifications
            ),

          isNew:
            String(isNew) === 'true',

          isActive: false,

          approvalStatus: 'pending',

          rejectionReason: '',

          approvedAt: null,

          approvedBy: null,

          featured: false,

          flashSale: false,

          offer: false,

          offerMessage: '',

          offerStartDate: null,

          offerEndDate: null,
        });

      const sellerName = populatedProduct.seller?.name || req.user.name || 'Sylva seller';
      const sellerEmail = populatedProduct.seller?.email || req.user.email || 'Not provided';
      const categoryName = populatedProduct.category?.name || categoryRecord.name || 'Uncategorised';
      const productAdminUrl = 'https://www.sylvatechnologies.co.ke/admin';
      const safeProductName = escapeEmailHtml(populatedProduct.name);
      const safeSellerName = escapeEmailHtml(sellerName);
      const safeSellerEmail = escapeEmailHtml(sellerEmail);
      const safeSku = escapeEmailHtml(populatedProduct.sku || normalizedSku);
      const safeCategory = escapeEmailHtml(categoryName);
      const safePrice = escapeEmailHtml(Number(populatedProduct.price || 0).toLocaleString('en-KE', { style: 'currency', currency: 'KES' }));
      const imageList = (populatedProduct.images || []).map((url, index) =>
        '<li><a href="' + escapeEmailHtml(url) + '">Product image ' + (index + 1) + '</a></li>'
      ).join('');
      const notification = await sendSalesNotificationEmail({
        subject: 'Seller product submitted for approval: ' + populatedProduct.name,
        html: '<div style="font-family:Arial,sans-serif;color:#17211b;max-width:680px;margin:auto;padding:24px">' +
          '<h2 style="color:#166534">New seller product submitted</h2>' +
          '<p>A seller has submitted a product that is waiting for admin review on Sylva Technologies.</p>' +
          '<table style="border-collapse:collapse;width:100%">' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Product</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeProductName + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>SKU</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeSku + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Category</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeCategory + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Price</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safePrice + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Seller</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeSellerName + ' (' + safeSellerEmail + ')</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Approval status</b></td><td style="padding:8px;border-bottom:1px solid #ddd">Pending review</td></tr>' +
          '</table><p><b>Submitted images:</b></p><ul>' + (imageList || '<li>No image links available</li>') + '</ul>' +
          '<p><a href="' + productAdminUrl + '" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Open admin dashboard</a></p>' +
          '<p style="color:#647067;font-size:12px">Automated Sylva Technologies sales notification.</p></div>',
        text: 'New seller product submitted for admin approval. Product: ' + populatedProduct.name +
          '; SKU: ' + (populatedProduct.sku || normalizedSku) + '; category: ' + categoryName +
          '; price: KSh ' + populatedProduct.price + '; seller: ' + sellerName + ' (' + sellerEmail +
          '); status: pending review. Admin dashboard: ' + productAdminUrl,
      });
      if (!notification?.success) {
        console.error('[Sales email] seller product submission notification failed:', notification?.message || 'Unknown email error', { productId: String(populatedProduct._id) });
      } else {
        console.info('[Sales email] seller product submission notification sent', { productId: String(populatedProduct._id), messageId: notification.messageId });
      }

      res.status(201).json({
        success: true,
        message:
          'Product submitted successfully. It is now awaiting admin approval.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Seller product creation error:',
        error?.message || error,
        error?.stack || ''
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to create product.',
      });
    }
  }
);

/*
 * PUT /api/products/seller/:id
 */
router.put(
  '/seller/:id',
  protect,
  approvedSellerOnly,
  sellerUpload.array(
    'images',
    MAX_PRODUCT_IMAGES
  ),
  async (req, res) => {
    try {
      const product =
        await Product.findOne({
          _id: req.params.id,
          seller: req.user._id,
        });

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found or you do not have permission to edit it.',
        });
      }

      if (
        req.files &&
        req.files.length >
          MAX_PRODUCT_IMAGES
      ) {
        return res.status(400).json({
          success: false,
          message:
            `A maximum of ${MAX_PRODUCT_IMAGES} product images is allowed.`,
        });
      }

      if (req.body.name) {
        const newName =
          req.body.name.trim();

        if (newName !== product.name) {
          const newSlug =
            buildSlug(newName);

          const slugExists =
            await Product.findOne({
              slug: newSlug,
              _id: {
                $ne: product._id,
              },
            });

          if (slugExists) {
            return res.status(400).json({
              success: false,
              message:
                'Another product already uses this name.',
            });
          }

          product.name =
            newName;

          product.slug =
            newSlug;
        }
      }

      if (
        req.body.brand !==
        undefined
      ) {
        product.brand =
          String(
            req.body.brand
          ).trim();
      }

      if (
        req.body.sku !==
        undefined
      ) {
        const newSku =
          String(req.body.sku)
            .trim()
            .toUpperCase();

        const skuExists =
          await Product.findOne({
            sku: newSku,
              _id: mongoose.trusted({ $ne: product._id }),
          });

        if (skuExists) {
          return res.status(400).json({
            success: false,
            message:
              'Another product already uses this SKU.',
          });
        }

        product.sku =
          newSku;
      }

      if (req.body.category) {
        const categoryRecord =
          await findCategory(
            req.body.category
          );

        if (!categoryRecord) {
          return res.status(400).json({
            success: false,
            message:
              'The selected category does not exist.',
          });
        }

        product.category =
          categoryRecord._id;
      }

      if (
        req.body.subcategory !==
        undefined
      ) {
        product.subcategory =
          req.body.subcategory;
      }

      if (
        req.body.description !==
        undefined
      ) {
        product.description =
          req.body.description;
      }

      if (
        req.body.shortDescription !==
        undefined
      ) {
        product.shortDescription =
          req.body.shortDescription;
      }

      if (
        req.body.price !==
        undefined
      ) {
        const numericPrice =
          toNumber(
            req.body.price,
            -1
          );

        if (numericPrice < 0) {
          return res.status(400).json({
            success: false,
            message:
              'Price must be a valid amount.',
          });
        }

        product.price =
          numericPrice;
      }

      if (
        req.body.oldPrice !==
        undefined
      ) {
        const numericOldPrice =
          toNumber(
            req.body.oldPrice,
            0
          );

        if (numericOldPrice < 0) {
          return res.status(400).json({
            success: false,
            message:
              'Old price must be a valid amount.',
          });
        }

        product.oldPrice =
          numericOldPrice;
      }

      product.discount =
        calculateDiscount(
          product.oldPrice,
          product.price
        );

      if (
        req.body.stock !==
        undefined
      ) {
        const numericStock =
          toNumber(
            req.body.stock,
            -1
          );

        if (numericStock < 0) {
          return res.status(400).json({
            success: false,
            message:
              'Stock cannot be negative.',
          });
        }

        product.stock =
          numericStock;
      }

      if (req.body.condition) {
        product.condition =
          req.body.condition;
      }

      if (
        req.body.warranty !==
        undefined
      ) {
        product.warranty =
          req.body.warranty;
      }

      if (
        req.body.warrantyDuration !==
        undefined
      ) {
        product.warrantyDuration =
          req.body.warrantyDuration;
      }

      if (
        req.body.warrantyTerms !==
        undefined
      ) {
        product.warrantyTerms =
          req.body.warrantyTerms;
      }

      if (
        req.body.deliveryDuration !==
        undefined
      ) {
        product.deliveryDuration =
          req.body.deliveryDuration;
      }

      if (
        req.body.deliveryFee !==
        undefined
      ) {
        const numericDeliveryFee =
          toNumber(
            req.body.deliveryFee,
            -1
          );

        if (numericDeliveryFee < 0) {
          return res.status(400).json({
            success: false,
            message:
              'Delivery fee cannot be negative.',
          });
        }

        product.deliveryFee =
          numericDeliveryFee;
      }

      if (
        req.body.deliveryTerms !==
        undefined
      ) {
        product.deliveryTerms =
          req.body.deliveryTerms;
      }

      if (
        req.body.deliveryLocations !==
        undefined
      ) {
        product.deliveryLocations =
          req.body.deliveryLocations;
      }

      if (
        req.body.returnPeriod !==
        undefined
      ) {
        product.returnPeriod =
          req.body.returnPeriod;
      }

      if (
        req.body.returnPolicy !==
        undefined
      ) {
        product.returnPolicy =
          req.body.returnPolicy;
      }

      if (
        req.body.returnConditions !==
        undefined
      ) {
        product.returnConditions =
          req.body.returnConditions;
      }

      if (
        req.body.whatsIncluded !==
        undefined
      ) {
        product.whatsIncluded =
          req.body.whatsIncluded;
      }

      if (
        req.body.keyFeatures !==
        undefined
      ) {
        product.keyFeatures =
          parseList(
            req.body.keyFeatures
          );
      }

      if (
        req.body.sellerNotes !==
        undefined
      ) {
        product.sellerNotes =
          req.body.sellerNotes;
      }

      if (req.body.sourceSpreadsheetUrl !== undefined) {
        const spreadsheetUrl = String(req.body.sourceSpreadsheetUrl || '').trim();
      if (spreadsheetUrl && (!(spreadsheetUrl.toLowerCase().startsWith('https://') || spreadsheetUrl.toLowerCase().startsWith('http://')) || spreadsheetUrl.length > 1000)) {
          return res.status(400).json({ success: false, message: 'Spreadsheet link must be a valid HTTP or HTTPS URL no longer than 1000 characters.' });
        }
        product.sourceSpreadsheetUrl = spreadsheetUrl;
      }

      if (
        req.body.specifications !==
        undefined
      ) {
        product.specifications =
          parseSpecifications(
            req.body.specifications
          );
      }

      if (
        req.body.isNew !==
        undefined
      ) {
        product.isNew =
          String(
            req.body.isNew
          ) === 'true';
      }

      if (
        req.files &&
        req.files.length > 0
      ) {
        const imageUrls =
          await uploadProductImages(
            req.files
          );

        product.images =
          imageUrls;
      }

      product.approvalStatus =
        'pending';

      product.isActive =
        false;

      product.rejectionReason =
        '';

      product.approvedAt =
        null;

      product.approvedBy =
        null;

      product.seller =
        req.user._id;

      product.featured =
        false;

      product.flashSale =
        false;

      product.offer =
        false;

      product.offerMessage =
        '';

      product.offerStartDate =
        null;

      product.offerEndDate =
        null;

      const updatedProduct =
        await product.save();

      const populatedProduct =
        await Product.findById(
          updatedProduct._id
        )
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      res.json({
        success: true,
        message:
          'Product updated and resubmitted for admin approval.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Seller product update error:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to update product.',
      });
    }
  }
);

/*
 * DELETE /api/products/seller/:id
 */
router.delete(
  '/seller/:id',
  protect,
  approvedSellerOnly,
  async (req, res) => {
    try {
      const product =
        await Product.findOne({
          _id: req.params.id,
          seller: req.user._id,
        });

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found or you do not have permission to delete it.',
        });
      }

      await product.deleteOne();

      res.json({
        success: true,
        message:
          'Product deleted successfully.',
      });
    } catch (error) {
      console.error(
        'Seller product deletion error:',
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to delete product.',
      });
    }
  }
);

/*
 * GET /api/products/admin/product-approvals
 */
router.get(
  '/admin/product-approvals',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const products = await Product.find({
        approvalStatus: 'pending',
      })
        .populate(
          'category',
          'name'
        )
        .populate(
          'seller',
          'name email sellerProfile.storeName sellerStatus accountStatus storeStatus'
        )
        .sort({
          createdAt: -1,
        });

      const sellerProducts = products.filter(
        (product) => product.seller
      );

      res.json({
        success: true,
        products: sellerProducts,
      });
    } catch (error) {
      console.error(
        'Admin product approvals loading error:',
        error
      );

      res.status(500).json({
        success: false,
        message: 'Failed to load product approvals',
        error: error.message,
      });
    }
  }
);

/*
 * PUT /api/products/admin/product-approvals/:id/approve
 */
router.put(
  '/admin/product-approvals/:id/approve',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const product =
        await Product.findById(
          req.params.id
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found.',
        });
      }

      if (!product.seller) {
        return res.status(400).json({
          success: false,
          message:
            'This product does not belong to a seller.',
        });
      }

      product.approvalStatus =
        'approved';

      product.isActive = true;

      product.rejectionReason = '';

      product.approvedAt =
        new Date();

      product.approvedBy =
        req.user._id;

      const updatedProduct =
        await product.save();

      const populatedProduct =
        await Product.findById(
          updatedProduct._id
        )
          .populate(
            'category',
            'name'
          )
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      res.json({
        success: true,
        message:
          'Product approved successfully.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Admin product approval error:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to approve product.',
      });
    }
  }
);

/*
 * PUT /api/products/admin/product-approvals/:id/reject
 */
router.put(
  '/admin/product-approvals/:id/reject',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const product =
        await Product.findById(
          req.params.id
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found.',
        });
      }

      product.approvalStatus =
        'rejected';

      product.isActive = false;

      const rejectionReason = String(req.body?.rejectionReason || '').trim();
      if (!rejectionReason) {
        return res.status(400).json({
          success: false,
          message: 'A clear rejection reason is required so the seller knows what to fix.',
        });
      }

      product.rejectionReason = rejectionReason;

      product.approvedAt = null;
      product.approvedBy = null;

      const updatedProduct =
        await product.save();

      const populatedProduct =
        await Product.findById(
          updatedProduct._id
        )
          .populate(
            'category',
            'name'
          )
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      res.json({
        success: true,
        message:
          'Product rejected successfully.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Admin product rejection error:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to reject product.',
      });
    }
  }
);

/* =========================================================
   PUBLIC PRODUCT BY ID
   ========================================================= */

router.get(
  '/:id',
  async (req, res) => {
    try {
      const product =
        await Product.findById(
          req.params.id
        )
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found.',
        });
      }

      res.json(product);
    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to fetch product.',
      });
    }
  }
);

/* =========================================================
   ADMIN PRODUCT MANAGEMENT
   ========================================================= */

/*
 * POST /api/products
 *
 * Admin product creation.
 */
router.post(
  '/',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const {
        name,
        brand,
        category,
        sku,
        price,
        oldPrice,
        stock,
        description,
        shortDescription,
        specifications,
        featured,
        flashSale,
        offer,
        offerMessage,
        offerStartDate,
        offerEndDate,
        isNew,
        isActive,
        condition,
        warranty,
        warrantyDuration,
        warrantyTerms,
        deliveryDuration,
        deliveryFee,
        deliveryTerms,
        deliveryLocations,
        returnPeriod,
        returnPolicy,
        returnConditions,
        whatsIncluded,
        keyFeatures,
        sellerNotes,
        images,
        seller,
      } = req.body;

      if (
        !name ||
        !brand ||
        !category ||
        !sku ||
        price === undefined ||
        price === ''
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Required product fields are missing.',
        });
      }

      if (
        Array.isArray(images) &&
        images.length > MAX_PRODUCT_IMAGES
      ) {
        return res.status(400).json({
          success: false,
          message:
            `A maximum of ${MAX_PRODUCT_IMAGES} product images is allowed.`,
        });
      }

      const numericPrice =
        toNumber(price, -1);

      const numericOldPrice =
        toNumber(oldPrice, 0);

      const numericStock =
        toNumber(stock, 0);

      const numericDeliveryFee =
        toNumber(deliveryFee, 0);

      if (numericPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Product price must be valid.',
        });
      }

      if (numericOldPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Old price must be valid.',
        });
      }

      if (numericStock < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Stock cannot be negative.',
        });
      }

      if (numericDeliveryFee < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Delivery fee cannot be negative.',
        });
      }

      const productSlug =
        buildSlug(name);

      const normalizedSku =
        String(sku)
          .trim()
          .toUpperCase();

      const duplicate =
        await Product.findOne({
          $or: [
            {
              slug: productSlug,
            },
            {
              sku: normalizedSku,
            },
          ],
        });

      if (duplicate) {
        return res.status(400).json({
          success: false,
          message:
            'Product with the same slug or SKU already exists.',
        });
      }

      const categoryRecord =
        await findCategory(category);

      if (!categoryRecord) {
        return res.status(400).json({
          success: false,
          message:
            'The selected category does not exist.',
        });
      }

      let sellerId = null;

      if (seller) {
        if (
          !mongoose.Types.ObjectId.isValid(
            seller
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid seller ID.',
          });
        }

        sellerId = seller;
      }

      const product =
        await Product.create({
          name,

          slug:
            productSlug,

          sku:
            normalizedSku,

          brand,

          category:
            categoryRecord._id,

          description:
            description || '',

          shortDescription:
            shortDescription || '',

          subcategory:
            req.body.subcategory || '',

          price:
            numericPrice,

          oldPrice:
            numericOldPrice,

          discount:
            calculateDiscount(
              numericOldPrice,
              numericPrice
            ),

          stock:
            numericStock,

          specifications:
            parseSpecifications(
              specifications
            ),

          featured:
            parseBoolean(featured),

          flashSale:
            parseBoolean(flashSale),

          offer:
            parseBoolean(offer),

          offerMessage:
            offerMessage || '',

          offerStartDate:
            offerStartDate || null,

          offerEndDate:
            offerEndDate || null,

          isNew:
            parseBoolean(isNew),

          isActive:
            parseBoolean(isActive, true),

          condition:
            condition || 'New',

          warranty:
            warranty || '',

          warrantyDuration:
            warrantyDuration || '',

          warrantyTerms:
            warrantyTerms || '',

          deliveryDuration:
            deliveryDuration || '',

          deliveryFee:
            numericDeliveryFee,

          deliveryTerms:
            deliveryTerms || '',

          deliveryLocations:
            deliveryLocations || '',

          returnPeriod:
            returnPeriod || '',

          returnPolicy:
            returnPolicy || '',

          returnConditions:
            returnConditions || '',

          whatsIncluded:
            whatsIncluded || '',

          keyFeatures:
            parseList(keyFeatures),

          sellerNotes:
            sellerNotes || '',

          images:
            Array.isArray(images)
              ? images.slice(
                  0,
                  MAX_PRODUCT_IMAGES
                )
              : [],

          seller:
            sellerId,

          approvalStatus:
            'approved',

          rejectionReason:
            '',

          approvedAt:
            new Date(),

          approvedBy:
            req.user._id,
        });

      const populatedProduct =
        await Product.findById(
          product._id
        )
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      res.status(201).json({
        success: true,
        message:
          'Product created successfully.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Admin product creation error:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to create product.',
      });
    }
  }
);

/*
 * PUT /api/products/:id
 *
 * Admin product update.
 */
router.put(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      /*
       * TEMPORARY DEBUGGING
       *
       * These logs will help us identify exactly
       * what ID and body are being received when
       * the admin updates a product.
       */
      console.log('====================================');
      console.log('ADMIN PRODUCT UPDATE DEBUG');
      console.log('req.params.id:', req.params.id);
      console.log('req.body._id:', req.body?._id);
      console.log('req.body.id:', req.body?.id);
      console.log('req.body:', req.body);
      console.log('====================================');

      const product =
        await Product.findById(
          req.params.id
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found.',
        });
      }

      /*
       * Regenerate slug when name changes.
       */
      if (
        req.body.name &&
        req.body.name !== product.name
      ) {
        const newSlug =
          buildSlug(req.body.name);

       const duplicate =
  await Product.findOne({
    slug: newSlug, 
  });

if (
  duplicate &&
  duplicate._id.toString() !== product._id.toString()
) {
  return res.status(400).json({
    success: false,
    message:
      'Another product already uses this name.',
  });
}

        if (duplicate) {
          return res.status(400).json({
            success: false,
            message:
              'Another product already uses this name.',
          });
        }

        product.slug =
          newSlug;
      }

      /*
       * Maximum 4 images.
       */
      if (
        Array.isArray(req.body.images) &&
        req.body.images.length >
          MAX_PRODUCT_IMAGES
      ) {
        return res.status(400).json({
          success: false,
          message:
            `A maximum of ${MAX_PRODUCT_IMAGES} product images is allowed.`,
        });
      }

      /*
       * Allowed fields.
       */
      const allowedFields = [
        'name',
        'brand',
        'category',
        'subcategory',
        'sku',
        'price',
        'oldPrice',
        'stock',
        'description',
        'shortDescription',
        'specifications',
        'featured',
        'flashSale',
        'offer',
        'offerMessage',
        'offerStartDate',
        'offerEndDate',
        'isNew',
        'isActive',
        'condition',
        'warranty',
        'warrantyDuration',
        'warrantyTerms',
        'deliveryDuration',
        'deliveryFee',
        'deliveryTerms',
        'deliveryLocations',
        'returnPeriod',
        'returnPolicy',
        'returnConditions',
        'whatsIncluded',
        'keyFeatures',
        'sellerNotes',
        'images',
        'seller',
      ];

      for (const field of allowedFields) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            field
          )
        ) {
          product[field] =
            req.body[field];
        }
      }

      // Admin forms may submit boolean flags as strings.
      for (const field of ['featured', 'isNew', 'flashSale', 'offer', 'isActive']) {
        if (Object.prototype.hasOwnProperty.call(req.body, field)) {
          product[field] = parseBoolean(req.body[field], product[field]);
        }
      }

      /*
       * Normalize list fields.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          'keyFeatures'
        )
      ) {
        product.keyFeatures =
          parseList(
            req.body.keyFeatures
          );
      }

      /*
       * Normalize specifications.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          'specifications'
        )
      ) {
        product.specifications =
          parseSpecifications(
            req.body.specifications
          );
      }

      /*
       * Normalize delivery fee.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          'deliveryFee'
        )
      ) {
        const deliveryFee =
          toNumber(
            req.body.deliveryFee,
            -1
          );

        if (deliveryFee < 0) {
          return res.status(400).json({
            success: false,
            message:
              'Delivery fee cannot be negative.',
          });
        }

        product.deliveryFee =
          deliveryFee;
      }

      /*
       * Validate category.
       */
      if (req.body.category) {
        if (
          mongoose.Types.ObjectId.isValid(
            req.body.category
          )
        ) {
          const categoryRecord =
            await Category.findById(
              req.body.category
            ).select('_id');

          if (!categoryRecord) {
            return res.status(400).json({
              success: false,
              message:
                'The selected category does not exist.',
            });
          }

          product.category =
            categoryRecord._id;
        } else {
          const categoryRecord =
            await findCategory(
              req.body.category
            );

          if (!categoryRecord) {
            return res.status(400).json({
              success: false,
              message:
                'The selected category does not exist.',
            });
          }

          product.category =
            categoryRecord._id;
        }
      }

      /*
       * Normalize SKU.
       */
      if (req.body.sku) {
        const normalizedSku =
          String(req.body.sku)
            .trim()
            .toUpperCase();
const duplicateSku =
  await Product.findOne({
    sku: normalizedSku,
  });

if (
  duplicateSku &&
  duplicateSku._id.toString() !== product._id.toString()
) {
  return res.status(400).json({
    success: false,
    message:
      'Another product already uses this SKU.',
  });
}
        product.sku =
          normalizedSku;
      }

      /*
       * Recalculate discount.
       */
      product.discount =
        calculateDiscount(
          product.oldPrice,
          product.price
        );

      const updatedProduct =
        await product.save();

      const populatedProduct =
        await Product.findById(
          updatedProduct._id
        )
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          );

      res.json({
        success: true,
        message:
          'Product updated successfully.',
        product:
          populatedProduct,
      });
    } catch (error) {
      /*
       * TEMPORARY DEBUGGING
       *
       * We need the full stack trace from Render
       * to identify the exact line causing the
       * ObjectId / $ne error.
       */
      console.error('====================================');
      console.error('ADMIN PRODUCT UPDATE ERROR');
      console.error('Message:', error.message);
      console.error('Name:', error.name);
      console.error('Stack:', error.stack);
      console.error('====================================');

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to update product.',
      });
    }
  }
);

/*
 * DELETE /api/products/:id
 *
 * Admin can delete any product.
 */
router.delete(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const product =
        await Product.findById(
          req.params.id
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'Product not found.',
        });
      }

      await product.deleteOne();

      res.json({
        success: true,
        message:
          'Product deleted successfully.',
      });
    } catch (error) {
      console.error(
        'Admin product deletion error:',
        error.message
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to delete product.',
      });
    }
  }
);

module.exports = router;
