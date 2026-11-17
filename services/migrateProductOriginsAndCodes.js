const Product = require('../models/Product');
const { generateUniqueProductCode } = require('./productIdentityService');

/**
 * Idempotently classify existing products and backfill codes for legacy
 * seller/AliExpress products. Google Sheet codes (SYLT-###) are never changed.
 * The Product.source field remains the ingestion channel; Product.origin is
 * the canonical business ownership classification.
 */
async function migrateProductOriginsAndCodes() {
  let updated = 0;
  let codesAssigned = 0;

  const cursor = Product.find({})
    .select('_id source origin seller code')
    .sort({ _id: 1 })
    .cursor();

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

    if (isSeller && product.source === 'manual') {
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
      const result = await Product.updateOne(
        { _id: product._id },
        { $set: changes }
      );
      if (result.modifiedCount || result.nModified) updated += 1;
    }
  }

  console.log('[MongoDB migration] Product origins classified; ' +
    updated + ' record(s) updated and ' + codesAssigned +
    ' legacy seller/AliExpress code(s) assigned. Existing SYLT codes preserved.');
  return { updated, codesAssigned };
}

module.exports = migrateProductOriginsAndCodes;
