const mongoose = require('mongoose');

const flipAdvertisementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    imageUrl: { type: String, trim: true, default: '' },
    badge: { type: String, trim: true, default: 'HOT DEAL' },
    price: { type: String, trim: true, default: '' },
    oldPrice: { type: String, trim: true, default: '' },
    buttonText: { type: String, trim: true, default: 'Shop Now' },
    buttonLink: { type: String, trim: true, default: '/shop' },
    theme: {
      type: String,
      enum: ['mint', 'sand', 'sky', 'blush'],
      default: 'mint',
    },
    active: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FlipAdvertisement', flipAdvertisementSchema);
