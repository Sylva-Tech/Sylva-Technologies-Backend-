const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  providerProductId: { type: String, required: true, trim: true, unique: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 500 },
  productUrl: { type: String, default: '', trim: true, maxlength: 2000 },
  imageUrl: { type: String, default: '', trim: true, maxlength: 2000 },
  imageUrls: { type: [String], default: [] },
  supplierPrice: { type: Number, default: null, min: 0 },
  supplierOriginalPrice: { type: Number, default: null, min: 0 },
  minimumProfitPercent: { type: Number, default: 8, min: 8, max: 500 },
  supplierCurrency: { type: String, default: 'USD', uppercase: true, trim: true, maxlength: 3 },
  targetSalePrice: { type: Number, default: null, min: 0 },
  targetCurrency: { type: String, default: 'USD', uppercase: true, trim: true, maxlength: 3 },
  originalPrice: { type: Number, default: null, min: 0 },
  discount: { type: String, default: '', trim: true, maxlength: 40 },
  categoryId: { type: String, default: '', trim: true, maxlength: 80 },
  sylvaCategoryId: { type: String, default: '', trim: true, maxlength: 80 },
  categoryMatchStatus: { type: String, enum: ['matched', 'needs_review'], default: 'needs_review' },
  categoryName: { type: String, default: '', trim: true, maxlength: 200 },
  sellerId: { type: String, default: '', trim: true, maxlength: 100 },
  latestVolume: { type: Number, default: null, min: 0 },
  shippingDays: { type: Number, default: null, min: 0 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'imported', 'ignored'], default: 'pending', index: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, default: '', trim: true, maxlength: 1000 },
  importedProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  syncedAt: { type: Date, default: Date.now, index: true },
  sourcePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

schema.index({ status: 1, syncedAt: -1 });

module.exports = mongoose.models.AliExpressCatalogProduct || mongoose.model('AliExpressCatalogProduct', schema);
