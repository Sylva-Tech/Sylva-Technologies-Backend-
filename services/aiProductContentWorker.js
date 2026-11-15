const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const { generateAliExpressProductContent } = require('./aiProductContentService');

let timer = null;
let running = false;

const processOnePendingProduct = async () => {
  if (!process.env.OPENAI_API_KEY || running) return false;
  running = true;
  try {
    const now = new Date();
    const claimed = await AliExpressCatalogProduct.findOneAndUpdate(
      {
        status: { $in: ['pending', 'approved'] },
        'aiContentDraft.status': { $in: ['pending', 'processing'] },
        $or: [
          { 'aiContentDraft.status': 'pending', 'aiContentDraft.nextAttemptAt': null },
          { 'aiContentDraft.status': 'pending', 'aiContentDraft.nextAttemptAt': { $lte: now } },
          { 'aiContentDraft.status': 'processing', 'aiContentDraft.processingAt': { $lte: new Date(now.getTime() - 10 * 60 * 1000) } },
        ],
      },
      {
        $set: { 'aiContentDraft.status': 'processing', 'aiContentDraft.lastError': '', 'aiContentDraft.processingAt': now },
        $inc: { 'aiContentDraft.attempts': 1 },
      },
      { new: true, sort: { syncedAt: 1 } }
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
      console.error('[AI product enrichment] worker cycle failed:', error.code || error.name || 'WORKER_ERROR');
    });
  }, 5000);
  timer.unref?.();
};

module.exports = { startAIProductContentWorker, processOnePendingProduct };
