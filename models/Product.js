const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    /*
     * Basic product information.
     */
    name: {
      type: String,
      required: [
        true,
        'Product name is required',
      ],
      trim: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    sku: {
      type: String,
      required: [
        true,
        'SKU is required',
      ],
      unique: true,
      trim: true,
    },

    // Optional legacy/business product code. The database index is partial so
    // products without a code do not collide on null or missing values.
    code: {
      type: String,
      default: undefined,
      trim: true,
      uppercase: true,
    },

    /*
     * Track product ownership for safe spreadsheet reconciliation.
     * Existing records remain unmarked until a successful sheet sync
     * identifies them; seller/manual products are never pruned by sync.
     */
    source: {
      type: String,
      enum: ['manual', 'google_sheet', 'seller', 'aliexpress'],
      default: 'manual',
      index: true,
    },

    // Canonical business ownership/origin, independent of the ingestion channel above.
    origin: {
      type: String,
      enum: ['sylva_owned', 'seller_store', 'aliexpress'],
      default: 'sylva_owned',
      index: true,
    },

    brand: {
      type: String,
      required: [
        true,
        'Brand is required',
      ],
      trim: true,
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },

    subcategory: {
      type: String,
      default: '',
      trim: true,
    },

    description: {
      type: String,
      required: [
        true,
        'Description is required',
      ],
    },

    shortDescription: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * Pricing.
     */
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    oldPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    discount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
     * Product images.
     *
     * Maximum 4 images.
     */
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (images) {
          return images.length <= 4;
        },
        message:
          'A product can have a maximum of 4 images.',
      },
    },

    /*
     * Inventory.
     */
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    condition: {
      type: String,
      enum: [
        'New',
        'Refurbished',
        'Used',
      ],
      default: 'New',
    },

    /*
     * Warranty.
     */
    warranty: {
      type: String,
      default: '',
      trim: true,
    },

    warrantyDuration: {
      type: String,
      default: '',
      trim: true,
    },

    warrantyTerms: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * Delivery information.
     */
    deliveryDuration: {
      type: String,
      default: '',
      trim: true,
    },

    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryTerms: {
      type: String,
      default: '',
      trim: true,
    },

    deliveryLocations: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * Returns.
     */
    returnPeriod: {
      type: String,
      default: '',
      trim: true,
    },

    returnPolicy: {
      type: String,
      default: '',
      trim: true,
    },

    returnConditions: {
      type: String,
      default: '',
      trim: true,
    },

    /*
     * Product page information.
     */
    whatsIncluded: {
      type: String,
      default: '',
      trim: true,
    },

    keyFeatures: {
      type: [String],
      default: [],
    },

    contentGeneration: {
      provider: { type: String, enum: ['google_gemini'], default: undefined },
      model: { type: String, default: '', maxlength: 80 },
      sourceHash: { type: String, default: '', maxlength: 64 },
      generatedAt: { type: Date, default: null },
      generatedFields: { type: [String], default: [] },
      warnings: { type: [String], default: [] },
      researchSources: { type: [{ title: { type: String, maxlength: 240 }, url: { type: String, maxlength: 2000 } }], default: [] },
    },

    seoTitle: { type: String, default: '', trim: true, maxlength: 60 },
    seoMetaDescription: { type: String, default: '', trim: true, maxlength: 155 },
    marketingTags: { type: [String], default: [] },
    socialPromoCaption: { type: String, default: '', trim: true, maxlength: 1000 },

    sellerNotes: {
      type: String,
      default: '',
      trim: true,
    },

    // Optional seller-provided spreadsheet reference, shown only in the seller workspace.
    sourceSpreadsheetUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },

    /*
     * Technical specifications.
     */
    specifications: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /*
     * Platform merchandising.
     */
    featured: {
      type: Boolean,
      default: false,
    },

    // Seller-sponsored homepage placement is time-limited and only activated
    // after a verified wallet debit or successful Safaricom STK confirmation.
    featuredExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    sponsorshipStatus: {
      type: String,
      enum: ['none', 'pending', 'active', 'expired', 'failed'],
      default: 'none',
      index: true,
    },

    isNew: {
      type: Boolean,
      default: false,
    },

    flashSale: {
      type: Boolean,
      default: false,
    },

    offer: {
      type: Boolean,
      default: false,
    },

    offerMessage: {
      type: String,
      default: '',
      trim: true,
    },

    offerStartDate: {
      type: Date,
      default: null,
    },

    offerEndDate: {
      type: Date,
      default: null,
    },

    /*
     * Product visibility.
     */
    isActive: {
      type: Boolean,
      default: true,
    },

    /*
     * Seller ownership.
     */
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /*
     * Seller product approval workflow.
     */
    approvalStatus: {
      type: String,
      enum: [
        'pending',
        'approved',
        'rejected',
      ],
      default: 'approved',
      index: true,
    },

    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    suppressReservedKeysWarning: true,
  }
);

/*
 * Indexes.
 */
productSchema.index({
  category: 1,
  brand: 1,
});

productSchema.index({
  name: 'text',
  brand: 'text',
  sku: 'text',
});

productSchema.index({
  approvalStatus: 1,
  isActive: 1,
  createdAt: -1,
});

module.exports =
  mongoose.model(
    'Product',
    productSchema
  );