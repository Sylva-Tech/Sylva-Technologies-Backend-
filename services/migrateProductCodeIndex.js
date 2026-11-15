const mongoose = require('mongoose');

/**
 * Repairs the legacy products.code_1 unique index.
 *
 * Older Product documents often have no code. A normal unique index treats
 * missing/null values as one indexed value, so the second such product fails
 * with E11000. We preserve uniqueness for real, non-empty string codes only.
 *
 * This migration checks for duplicate non-empty codes before changing indexes.
 * It never edits or deletes product documents.
 */
const migrateProductCodeIndex = async () => {
  const collectionExists = await mongoose.connection.db
    .listCollections({ name: 'products' }, { nameOnly: true })
    .hasNext();
  if (!collectionExists) {
    await mongoose.connection.createCollection('products');
  }
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

  let indexes = await collection.indexes();
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

  // A previous deployment may have created this same index name with the
  // weaker { code: { $type: 'string' } } filter. MongoDB rejects creating an
  // index with the same name but a different partial filter, so replace only
  // that conflicting index before ensuring the intended definition exists.
  indexes = await collection.indexes();
  const namedIndex = indexes.find((index) => index.name === 'code_unique_strings');
  const partialIndexIsCorrect = Boolean(
    namedIndex &&
    namedIndex.unique === true &&
    namedIndex.key &&
    namedIndex.key.code === 1 &&
    namedIndex.partialFilterExpression?.code?.$type === 'string' &&
    namedIndex.partialFilterExpression?.code?.$gt === ''
  );

  if (namedIndex && !partialIndexIsCorrect) {
    await collection.dropIndex('code_unique_strings');
    console.log('[MongoDB migration] Replacing incompatible code_unique_strings index.');
  }

  if (!partialIndexIsCorrect) {
    await collection.createIndex(
      { code: 1 },
      {
        name: 'code_unique_strings',
        unique: true,
        partialFilterExpression: { code: { $type: 'string', $gt: '' } },
      }
    );
  }

  console.log('[MongoDB migration] Product code uniqueness now applies only to non-empty string codes.');
};

module.exports = migrateProductCodeIndex;
