const Product = require('../models/Product');
const ProductCodeSequence = require('../models/ProductCodeSequence');

const ALLOWED_PREFIXES = new Set(['SELL', 'ALI']);

/**
 * Allocate a globally unique, sequential code for non-Sylva-owned products.
 * MongoDB's atomic $inc makes allocation safe across concurrent API requests
 * and multiple backend instances. Existing codes are checked so a fresh
 * counter can safely continue after older records have been backfilled.
 */
async function generateUniqueProductCode(prefix) {
  const normalizedPrefix = String(prefix || '').trim().toUpperCase();
  if (!ALLOWED_PREFIXES.has(normalizedPrefix)) {
    throw new Error('Unsupported product code prefix.');
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const counter = await ProductCodeSequence.findOneAndUpdate(
      { _id: normalizedPrefix },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const code = normalizedPrefix + '-' + String(counter.sequence).padStart(6, '0');
    const existing = await Product.exists({ code });
    if (!existing) return code;
  }

  throw new Error('Unable to allocate a unique product code. Please retry.');
}

module.exports = { generateUniqueProductCode };
