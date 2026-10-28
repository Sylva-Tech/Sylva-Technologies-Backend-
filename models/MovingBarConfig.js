const mongoose = require('mongoose');

const movingBarItemSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 240 },
  href: { type: String, trim: true, default: '/shop', maxlength: 500 },
  active: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },
}, { _id: true });

const schema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'homepage', immutable: true },
  items: { type: [movingBarItemSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.MovingBarConfig || mongoose.model('MovingBarConfig', schema);
