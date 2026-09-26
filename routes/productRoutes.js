const express = require('express');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const Category = require('../models/Category');

const {
  protect,
  adminOnly,
  approvedSellerOnly,
} = require('../middleware/authMiddleware');

const sellerUpload = require('../middleware/sellerUpload');
const uploadProductImage = require('../utils/uploadProductImage');

const router = express.Router();

/*
 * Maximum number of product images allowed.
 */
const MAX_PRODUCT_IMAGES = 4;

/*
 * Build a clean URL-friendly slug.
 */
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
      flashSale,
      offer,
      inStock,
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

    const filter = {
      isActive: true,
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

      filter.category =
        categoryRecord._id;
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
     * Check offer dates.
     */
    if (
      flashSale === 'true' ||
      offer === 'true'
    ) {
      const now = new Date();

      filter.$and = [
        {
          $or: [
            { offerStartDate: null },
            {
              offerStartDate: {
                $lte: now,
              },
            },
          ],
        },
        {
          $or: [
            { offerEndDate: null },
            {
              offerEndDate: {
                $gt: now,
              },
            },
          ],
        },
      ];
    }

    /*
     * In-stock products.
     */
    if (inStock === 'true') {
      filter.stock = {
        $gt: 0,
      };
    }

    /*
     * Search.
     */
    if (search) {
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

    const total =
      await Product.countDocuments(filter);

    const products =
      await Product.find(filter)
        .populate('category')
        .populate(
          'seller',
          'name email sellerProfile.storeName'
        )
        .sort(sortOption)
        .skip(
          (safePage - 1) * safeLimit
        )
        .limit(safeLimit);

    res.json({
      products,
      page: safePage,
      totalPages: Math.ceil(
        total / safeLimit
      ),
      totalProducts: total,
    });
  } catch (error) {
    console.error(
      'Load products error:',
      error.message
    );

    res.status(500).json({
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
 * POST /api/products/seller
 *
 * Seller creates a product.
 *
 * Maximum 4 images.
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
        specifications,
        isNew,
      } = req.body;

      /*
       * Required fields.
       */
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

      /*
       * Maximum image check.
       */
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

      /*
       * Normalize SKU.
       */
      const normalizedSku =
        String(sku)
          .trim()
          .toUpperCase();

      /*
       * Generate slug.
       */
      const productSlug =
        buildSlug(name);

      if (!productSlug) {
        return res.status(400).json({
          success: false,
          message:
            'Product name must contain valid characters.',
        });
      }

      /*
       * Check duplicate SKU or slug.
       */
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

      /*
       * Validate category.
       */
      const categoryRecord =
        await findCategory(category);

      if (!categoryRecord) {
        return res.status(400).json({
          success: false,
          message:
            'The selected category does not exist.',
        });
      }

      /*
       * Upload product images.
       */
      const imageUrls =
        await uploadProductImages(
          req.files || []
        );

      /*
       * Create seller product.
       *
       * Seller products:
       * - belong to the logged-in seller
       * - are inactive
       * - are pending admin approval
       * - cannot control featured/offer fields
       */
      const product =
        await Product.create({
          name: name.trim(),

          slug: productSlug,

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

          specifications:
            parseSpecifications(
              specifications
            ),

          isNew:
            String(isNew) === 'true',

          /*
           * Seller products must be approved
           * before appearing publicly.
           */
          isActive: false,

          approvalStatus: 'pending',

          rejectionReason: '',

          approvedAt: null,

          approvedBy: null,

          /*
           * Platform-controlled fields.
           */
          featured: false,

          flashSale: false,

          offer: false,

          offerMessage: '',

          offerStartDate: null,

          offerEndDate: null,
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
          'Product submitted successfully. It is now awaiting admin approval.',
        product:
          populatedProduct,
      });
    } catch (error) {
      console.error(
        'Seller product creation error:',
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
 * PUT /api/products/seller/:id
 *
 * Seller updates own product.
 *
 * Maximum 4 replacement images.
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

      /*
       * Product name and slug.
       */
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

      /*
       * Brand.
       */
      if (
        req.body.brand !==
        undefined
      ) {
        product.brand =
          String(
            req.body.brand
          ).trim();
      }

      /*
       * SKU.
       */
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
            _id: {
              $ne: product._id,
            },
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

      /*
       * Category.
       */
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

      /*
       * Basic product details.
       */
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

      /*
       * Price.
       */
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

      /*
       * Old price.
       */
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

      /*
       * Recalculate discount.
       */
      product.discount =
        calculateDiscount(
          product.oldPrice,
          product.price
        );

      /*
       * Stock.
       */
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

      /*
       * Condition.
       */
      if (req.body.condition) {
        product.condition =
          req.body.condition;
      }

      /*
       * Warranty.
       */
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

      /*
       * Delivery.
       */
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

      /*
       * Returns.
       */
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

      /*
       * Product contents/features.
       */
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

      /*
       * Specifications.
       */
      if (
        req.body.specifications !==
        undefined
      ) {
        product.specifications =
          parseSpecifications(
            req.body.specifications
          );
      }

      /*
       * isNew.
       */
      if (
        req.body.isNew !==
        undefined
      ) {
        product.isNew =
          String(
            req.body.isNew
          ) === 'true';
      }

      /*
       * Replace images if new images
       * were supplied.
       */
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

      /*
       * IMPORTANT:
       * Any seller edit requires another
       * admin review.
       */
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

      /*
       * Seller ownership cannot be changed.
       */
      product.seller =
        req.user._id;

      /*
       * Platform-controlled fields.
       */
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

/*
 * Seller resubmission after rejection.
 */
if (
  product.approvalStatus === 'rejected'
) {
  product.approvalStatus = 'pending';
  product.isActive = false;
  product.rejectionReason = '';
  product.approvedAt = null;
  product.approvedBy = null;
}

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

/* =========================================================
   ADMIN PRODUCT APPROVALS
   ========================================================= */

/*
 * GET /api/products/admin/product-approvals
 *
 * Get all seller products waiting for approval.
 */
router.get(
  '/admin/product-approvals',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const products = await Product.find({
        seller: {
          $ne: null,
        },
        approvalStatus: 'pending',
      })
        .populate(
          'category',
          'name'
        )
        .populate(
          'seller',
          'name email sellerProfile.storeName'
        )
        .sort({
          createdAt: -1,
        });

      res.json({
        success: true,
        products,
      });
    } catch (error) {
      console.error(
        'Admin product approvals loading error:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to load product approval requests.',
      });
    }
  }
);

/*
 * PUT /api/products/admin/product-approvals/:id/approve
 *
 * Approve a seller product.
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

      product.approvedAt = new Date();

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
 *
 * Reject a seller product.
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

      product.rejectionReason =
        String(
          req.body?.rejectionReason ||
            'Product did not meet the approval requirements.'
        ).trim();

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
            Boolean(featured),

          flashSale:
            Boolean(flashSale),

          offer:
            Boolean(offer),

          offerMessage:
            offerMessage || '',

          offerStartDate:
            offerStartDate || null,

          offerEndDate:
            offerEndDate || null,

          isNew:
            Boolean(isNew),

          isActive:
            isActive !== false,

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
            seller &&
            mongoose.Types.ObjectId.isValid(
              seller
            )
              ? seller
              : null,

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
            _id: {
              $ne: product._id,
            },
          });

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
      if (
        req.body.category &&
        !mongoose.Types.ObjectId.isValid(
          req.body.category
        )
      ) {
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
            _id: {
              $ne: product._id,
            },
          });

        if (duplicateSku) {
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
      console.error(
        'Admin product update error:',
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