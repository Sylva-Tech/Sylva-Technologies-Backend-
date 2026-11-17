const mongoose = require('mongoose');

const productCodeSequenceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, default: 0, min: 0 },
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model('ProductCodeSequence', productCodeSequenceSchema);
