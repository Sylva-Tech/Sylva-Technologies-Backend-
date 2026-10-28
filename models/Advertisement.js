const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    image: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    mobileImageUrl: { type: String, default: '' },
    seoTitle: { type: String, trim: true, default: '', maxlength: 70 },
    seoDescription: { type: String, trim: true, default: '', maxlength: 160 },
    seoKeywords: { type: [String], default: [] },
    imageAlt: { type: String, trim: true, default: '', maxlength: 180 },
    link: { type: String, default: '/shop' },
    buttonText: { type: String, default: 'Shop Now' },
    buttonLink: { type: String, default: '/shop' },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    priority: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Advertisement', advertisementSchema);
