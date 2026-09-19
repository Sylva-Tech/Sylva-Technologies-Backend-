const mongoose = require('mongoose');

const advertisementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    image: { type: String, default: '' },
    link: { type: String, default: '/shop' },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Advertisement', advertisementSchema);
