const mongoose = require('mongoose');

/**
 * Repairs the legacy products.code_1 unique index.
 *
 * Older Product documents often have no code. A normal unique index treats
 * missing/null values as one indexed value, so the second such product fails
 * with E11000. We preserve uniqueness for real string codes only.
 *
 * This migration checks for duplicate non-empty codes before changing indexes.
 * It never edits or deletes product documents.
 */
const migrateProductCodeIndex = async () => {
  const collection = mongoose.connection.collection('products');
  const duplicates = await collection.aggregate([
    { $match: { code: { $type: 'string', $ne: '' } } },
    { $group: { _id: '$code', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 10 },
  ]).toArray();

  if (duplicates.length) {
    const values = duplicates.map((item) => String(item._id)).join(', ');
    throw new Error(
      'Cannot repair products.code index: duplicate product codes exist (' +
      values +
      '). Resolve these real code duplicates before retrying.'
    );
  }

  const indexes = await collection.indexes();
  const legacyIndex = indexes.find((index) =>
    index.name === 'code_1' &&
    index.key &&
    index.key.code === 1 &&
    index.unique === true
  );

  if (legacyIndex) {
    await collection.dropIndex('code_1');
    console.log('[MongoDB migration] Dropped legacy unique products.code_1 index.');
  }

  const currentIndexes = await collection.indexes();
  const partialIndexExists = currentIndexes.some((index) =>
    index.name === 'code_unique_strings' &&
    index.key &&
    index.key.code === 1 &&
    index.unique === true &&
    index.partialFilterExpression?.code?.$type === 'string'
  );

  if (!partialIndexExists) {
    await collection.createIndex(
      { code: 1 },
      {
        name: 'code_unique_strings',
        unique: true,
        partialFilterExpression: { code: { $type: 'string' } },
      }
    );
  }

  console.log('[MongoDB migration] Product code uniqueness now applies only to string codes.');
};

module.exports = migrateProductCodeIndex;
