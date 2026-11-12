const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderItem: { type: mongoose.Schema.Types.ObjectId, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  catalogProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'AliExpressCatalogProduct', required: true },
  providerProductId: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
  customerPriceKes: { type: Number, required: true, min: 0 },
  supplierUnitPrice: { type: Number, min: 0, default: null },
  supplierCurrency: { type: String, default: 'USD', uppercase: true, trim: true, maxlength: 3 },
  supplierOrderId: { type: String, default: '', trim: true, maxlength: 120 },
  trackingNumber: { type: String, default: '', trim: true, maxlength: 120 },
  carrier: { type: String, default: '', trim: true, maxlength: 120 },
  status: {
    type: String,
    enum: ['awaiting_supplier_authorization', 'ready_for_submission', 'submitted', 'shipped', 'delivered', 'failed', 'cancelled', 'refund_review'],
    default: 'awaiting_supplier_authorization',
    index: true,
  },
  blockedReason: { type: String, default: 'Dropshipper API authorization has not been verified.', maxlength: 500 },
  lastError: { type: String, default: '', maxlength: 1000 },
  submittedAt: { type: Date, default: null },
  shippedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ status: 1, createdAt: -1 });
schema.index({ order: 1, orderItem: 1 }, { unique: true });

module.exports = mongoose.models.AliExpressFulfillment || mongoose.model('AliExpressFulfillment', schema);
