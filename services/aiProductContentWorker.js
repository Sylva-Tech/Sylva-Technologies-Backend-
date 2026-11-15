const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const { generateAliExpressProductContent } = require('./aiProductContentService');

let timer = null;
let running = false;

const processOnePendingProduct = async () => {
  if (!process.env.OPENAI_API_KEY || running) return false;
  running = true;
  try {
    const now = new Date();
    const retryDue = {
      $expr: {
        $or: [
          { $eq: [{ $ifNull: ['$aiContentDraft.nextAttemptAt', null] }, null] },
          { $lte: ['$aiContentDraft.nextAttemptAt', now] },
        ],
      },
    };
    const staleProcessing = {
      $expr: {
        $and: [
          { $ne: [{ $ifNull: ['$aiContentDraft.processingAt', null] }, null] },
          { $lte: ['$aiContentDraft.processingAt', new Date(now.getTime() - 10 * 60 * 1000)] },
        ],
      },
    };

    // Use $expr for nested date comparisons. Mongoose otherwise incorrectly
    // casts the operator object as the value of these nested schema paths.
    const claimed = await AliExpressCatalogProduct.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', 'aiContentDraft.status': 'pending', ...retryDue },
          { status: 'approved', 'aiContentDraft.status': 'pending', ...retryDue },
          { status: 'pending', 'aiContentDraft.status': 'processing', ...staleProcessing },
          { status: 'approved', 'aiContentDraft.status': 'processing', ...staleProcessing },
        ],
      },
      {
        $set: { 'aiContentDraft.status': 'processing', 'aiContentDraft.lastError': '', 'aiContentDraft.processingAt': now },
        $inc: { 'aiContentDraft.attempts': 1 },
      },
      {
        new: true,
        sort: { syncedAt: 1 },
        // This filter is built only from fixed worker states and server timestamps.
        // Allow MongoDB aggregation expressions here without disabling sanitization globally.
        sanitizeFilter: false,
      }
    );
    if (!claimed) return false;

    try {
      const generated = await generateAliExpressProductContent({
        title: claimed.title,
        supplierBrand: claimed.supplierBrand,
        categoryName: claimed.categoryName,
        productAttributes: claimed.productAttributes,
      });
      claimed.aiContentDraft = {
        ...generated,
        attempts: claimed.aiContentDraft.attempts,
        lastError: '',
        nextAttemptAt: null,
        processingAt: null,
      };
      await claimed.save();
    } catch (error) {
      const attempts = Number(claimed.aiContentDraft?.attempts || 1);
      const retry = attempts < 3 && error.code !== 'AI_CONTENT_NOT_CONFIGURED' && error.code !== 'AI_CONTENT_REFUSED';
      claimed.aiContentDraft.status = retry ? 'pending' : 'failed';
      claimed.aiContentDraft.lastError = String(error.code || 'AI_CONTENT_FAILED').slice(0, 240);
      claimed.aiContentDraft.nextAttemptAt = retry ? new Date(Date.now() + attempts * 60000) : null;
      claimed.aiContentDraft.processingAt = null;
      await claimed.save();
      console.warn('[AI product enrichment] job did not complete:', error.code || 'AI_CONTENT_FAILED');
    }
    return true;
  } finally {
    running = false;
  }
};

const startAIProductContentWorker = () => {
  if (timer) return;
  timer = setInterval(() => {
    processOnePendingProduct().catch((error) => {
      console.error('[AI product enrichment] worker cycle failed:', JSON.stringify({ code: error.code || error.name || 'WORKER_ERROR', message: String(error.message || '').slice(0, 500), path: error.path || '', valueType: error.valueType || typeof error.value || '', kind: error.kind || '' }));
    });
  }, 5000);
  timer.unref?.();
};

module.exports = { startAIProductContentWorker, processOnePendingProduct };
