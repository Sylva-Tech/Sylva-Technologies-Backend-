const mongoose = require('mongoose');

const shippingRateSchema = new mongoose.Schema({
  country: { type: String, default: 'Kenya', trim: true, required: true },
  county: { type: String, trim: true, required: true, unique: true, index: true },
  fee: { type: Number, min: 0, required: true, default: 500 },
  deliveryMinDays: { type: Number, min: 1, required: true, default: 2 },
  deliveryMaxDays: { type: Number, min: 1, required: true, default: 4 },
  active: { type: Boolean, default: true },
  regionalRates: [{
    subCounty: { type: String, trim: true, required: true },
    ward: { type: String, trim: true, default: '' },
    fee: { type: Number, min: 0, required: true },
    deliveryMinDays: { type: Number, min: 1, required: true, default: 1 },
    deliveryMaxDays: { type: Number, min: 1, required: true, default: 3 },
    active: { type: Boolean, default: true },
  }],
}, { timestamps: true });

shippingRateSchema.index({ country: 1, county: 1 }, { unique: true });
module.exports = mongoose.model('ShippingRate', shippingRateSchema);
