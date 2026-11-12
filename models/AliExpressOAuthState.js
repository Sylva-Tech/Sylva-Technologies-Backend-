const mongoose = require('mongoose');

const AliExpressOAuthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });

module.exports = mongoose.models.AliExpressOAuthState || mongoose.model('AliExpressOAuthState', AliExpressOAuthStateSchema);
