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
 * Calculate discount percentage from old price and current price.
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
 * Parse specifications sent as JSON from multipart/form-data.
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

  const uploadedImages = [];

  for (const file of files) {
    const result = await uploadProductImage(file.buffer);

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
    };

    /*
     * Category filter.
     */
    if (category) {
      const categoryRecord = await findCategory(category);

      if (!categoryRecord) {
        return res.json({
          products: [],
          page: safePage,
          totalPages: 0,
          totalProducts: 0,
        });
      }

      filter.category = categoryRecord._id;
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
            { offerStartDate: { $lte: now } },
          ],
        },
        {
          $or: [
            { offerEndDate: null },
            { offerEndDate: { $gt: now } },
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

    const total = await Product.countDocuments(
      filter
    );

    const products = await Product.find(filter)
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
 *
 * Public product by slug.
 */
router.get('/slug/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({
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
});

/* =========================================================
   SELLER PRODUCT ROUTES
   IMPORTANT:
   These routes must appear BEFORE /:id.
   ========================================================= */

/*
 * GET /api/products/seller/me
 *
 * Return products owned by the currently
 * authenticated approved seller.
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

      /*
       * Seller product search.
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

      /*
       * Category filter.
       */
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

      /*
       * Active/inactive filter.
       */
      if (status === 'active') {
        filter.isActive = true;
      }

      if (status === 'inactive') {
        filter.isActive = false;
      }

      const total =
        await Product.countDocuments(filter);

      const products = await Product.find(filter)
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
 * Create a product as an approved seller.
 *
 * Images:
 * - multipart/form-data
 * - field name: images
 * - maximum 8 images
 */
router.post(
  '/seller',
  protect,
  approvedSellerOnly,
  sellerUpload.array('images', 8),
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
        subcategory,
        specifications,
        condition,
        warranty,
        isNew,
      } = req.body;

      /*
       * Validate required fields.
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

      const numericPrice =
        toNumber(price, -1);

      const numericOldPrice =
        toNumber(oldPrice, 0);

      const numericStock =
        toNumber(stock, 0);

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
       * Upload images.
       */
      const imageUrls =
        await uploadProductImages(
          req.files || []
        );

      /*
       * Create product.
       *
       * Seller does NOT control:
       * - seller ownership
       * - featured
       * - flashSale
       * - offer
       *
       * These remain controlled by the platform.
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

          seller: req.user._id,

          price: numericPrice,

          oldPrice:
            numericOldPrice,

          discount:
            calculateDiscount(
              numericOldPrice,
              numericPrice
            ),

          images: imageUrls,

          stock:
            numericStock,

          condition:
            condition || 'New',

          warranty:
            warranty || '',

          specifications:
            parseSpecifications(
              specifications
            ),

          isNew:
            String(isNew) === 'true',

          /*
           * Seller products are active by default.
           */
          /*
 * Seller products must be reviewed by an admin
 * before they become visible in the public store.
 */
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
 * Update a product owned by the seller.
 */
router.put(
  '/seller/:id',
  protect,
  approvedSellerOnly,
  sellerUpload.array('images', 8),
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

      /*
       * Update basic fields only.
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

      if (req.body.brand !== undefined) {
        product.brand =
          String(req.body.brand).trim();
      }

      if (req.body.sku !== undefined) {
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

        product.sku = newSku;
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
       * Price and stock.
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

      /*
       * Condition and warranty.
       */
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
       * isNew can be controlled by the seller.
       */
      if (
        req.body.isNew !==
        undefined
      ) {
        product.isNew =
          String(req.body.isNew) ===
          'true';
      }

      /*
       * Upload replacement/additional images.
       *
       * If images are supplied, they replace the
       * current image list.
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
       * Seller cannot modify ownership
       * or platform-controlled fields.
       */
      product.seller =
        req.user._id;

      product.featured =
        product.featured || false;

      product.flashSale =
        product.flashSale || false;

      product.offer =
        product.offer || false;

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
 *
 * Delete only the seller's own product.
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
   PUBLIC PRODUCT BY ID
   ========================================================= */

/*
 * GET /api/products/:id
 *
 * IMPORTANT:
 * This comes AFTER /seller/me and /seller/:id.
 */
router.get('/:id', async (req, res) => {
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
});

/* =========================================================
   ADMIN PRODUCT MANAGEMENT
   ========================================================= */

/*
 * POST /api/products
 *
 * Existing admin product creation.
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

      const numericPrice =
        toNumber(price, -1);

      const numericOldPrice =
        toNumber(oldPrice, 0);

      const numericStock =
        toNumber(stock, 0);

      if (numericPrice < 0) {
        return res.status(400).json({
          success: false,
          message:
            'Product price must be valid.',
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
          slug: productSlug,
          sku: normalizedSku,
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
            specifications || {},

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

          images:
            Array.isArray(images)
              ? images
              : [],

          /*
           * Admin may optionally assign a product
           * to a seller.
           */
          seller:
            seller &&
            mongoose.Types.ObjectId.isValid(
              seller
            )
              ? seller
              : null,
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
 * Existing admin product update.
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
          message: 'Product not found.',
        });
      }

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
       * Prevent accidental modification of
       * protected ownership fields through Object.assign.
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
       * Validate category if changed.
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
          message: 'Product not found.',
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
