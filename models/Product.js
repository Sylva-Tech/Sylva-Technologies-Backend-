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

    sellerNotes: {
      type: String,
      default: '',
      trim: true,
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