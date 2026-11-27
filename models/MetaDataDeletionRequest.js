const mongoose = require('mongoose');

const metaDataDeletionRequestSchema = new mongoose.Schema({
  confirmationCode: { type: String, required: true, unique: true, index: true },
  metaUserIdHash: { type: String, required: true, maxlength: 64 },
  status: { type: String, enum: ['completed'], default: 'completed' },
  completedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('MetaDataDeletionRequest', metaDataDeletionRequestSchema);
