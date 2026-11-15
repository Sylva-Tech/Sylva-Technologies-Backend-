const mongoose = require('mongoose');

const exchangeRateSchema = new mongoose.Schema({
  currency: { type: String, required: true, uppercase: true, trim: true, maxlength: 3 },
  kesPerUnit: { type: Number, required: true, min: 0.000001 },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const schema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },
  exchangeRates: { type: [exchangeRateSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.AliExpressCatalogSettings || mongoose.model('AliExpressCatalogSettings', schema);
