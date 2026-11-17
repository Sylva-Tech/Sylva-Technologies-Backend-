const Product = require('../models/Product');
const { generateUniqueProductCode } = require('./productIdentityService');

/**
 * Idempotently classify existing products and backfill codes for legacy
 * seller/AliExpress products. Google Sheet codes (SYLT-###) are never changed.
 * Product.source remains the ingestion channel; Product.origin is the
 * canonical business ownership classification.
 */
async function migrateProductOriginsAndCodes() {
  let updated = 0;
  let codesAssigned = 0;

  // Use the native collection cursor so Mongoose schema defaults do not mask
  // legacy documents that are missing the origin field in MongoDB.
  const cursor = Product.collection.find({})
    .project({ _id: 1, source: 1, origin: 1, seller: 1, code: 1 })
    .sort({ _id: 1 });

  for await (const product of cursor) {
    const isAliExpress = product.source === 'aliexpress';
    const isSeller = !isAliExpress && (Boolean(product.seller) || product.source === 'seller');
    const origin = isAliExpress
      ? 'aliexpress'
      : isSeller
        ? 'seller_store'
        : 'sylva_owned';

    const changes = {};
    if (product.origin !== origin) changes.origin = origin;

    // Older seller listings created before source tracking may have source=manual.
    if (isSeller && (!product.source || product.source === 'manual')) {
      changes.source = 'seller';
    }

    if (isSeller && !String(product.code || '').trim()) {
      changes.code = await generateUniqueProductCode('SELL');
      codesAssigned += 1;
    } else if (isAliExpress && !String(product.code || '').trim()) {
      changes.code = await generateUniqueProductCode('ALI');
      codesAssigned += 1;
    }

    if (Object.keys(changes).length) {
      const result = await Product.collection.updateOne(
        { _id: product._id },
        { $set: changes }
      );
      if (result.modifiedCount) updated += 1;
    }
  }

  console.log('[MongoDB migration] Product origins classified; ' +
    updated + ' record(s) updated and ' + codesAssigned +
    ' legacy seller/AliExpress code(s) assigned. Existing SYLT codes preserved.');
  return { updated, codesAssigned };
}

module.exports = migrateProductOriginsAndCodes;
