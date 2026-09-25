const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
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
      required: [true, 'SKU is required'],
      unique: true,
      trim: true,
    },
    brand: {
      type: String,
      required: [true, 'Brand is required'],
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
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
    },
    shortDescription: {
      type: String,
      default: '',
    },
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
    images: {
      type: [String],
      default: [],
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    condition: {
      type: String,
      enum: ['New', 'Refurbished', 'Used'],
      default: 'New',
    },
    warranty: {
      type: String,
      default: '',
      trim: true,
    },
    specifications: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
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
   isActive: {
  type: Boolean,
  default: true,
},

/*
 * Marketplace seller approval workflow.
 *
 * Admin-created products are approved automatically.
 * Seller-created products start as pending.
 */
approvalStatus: {
  type: String,
  enum: ['pending', 'approved', 'rejected'],
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

productSchema.index({ slug: 1, sku: 1 });
productSchema.index({ category: 1, brand: 1 });
productSchema.index({ name: 'text', brand: 'text', sku: 'text' });

productSchema.index({
  approvalStatus: 1,
  isActive: 1,
  createdAt: -1,
});

module.exports = mongoose.model('Product', productSchema);
