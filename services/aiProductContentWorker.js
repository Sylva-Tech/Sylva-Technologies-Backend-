const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const { generateAliExpressProductContent } = require('./aiProductContentService');

let timer = null;
let running = false;

const processOnePendingProduct = async () => {
  if (!process.env.GEMINI_API_KEY || running) return false;
  running = true;
  try {
    const now = new Date();
    const retryCutoff = now;
    const staleProcessingCutoff = new Date(now.getTime() - 10 * 60 * 1000);

    // Use the native collection for this narrowly scoped claim query. MongoDB
    // evaluates the nested Date operators directly, without Mongoose trying
    // to cast operator objects as Date values or sanitize the trusted filter.
    // Every filter value is a fixed worker state or a server-generated date.
    const claimFilter = {
      $or: [
        {
          status: { $in: ['pending', 'approved'] },
          'aiContentDraft.status': { $in: ['pending', 'not_generated'] },
          'aiContentDraft.attempts': { $lt: 5 },
          $or: [
            { 'aiContentDraft.nextAttemptAt': null },
            { 'aiContentDraft.nextAttemptAt': { $lte: retryCutoff } },
          ],
        },
        {
          status: { $in: ['pending', 'approved'] },
          'aiContentDraft.status': 'failed',
          'aiContentDraft.attempts': { $lt: 5 },
          $or: [
            { 'aiContentDraft.nextAttemptAt': null },
            { 'aiContentDraft.nextAttemptAt': { $lte: retryCutoff } },
          ],
        },
        {
          status: { $in: ['pending', 'approved'] },
          'aiContentDraft.status': 'processing',
          'aiContentDraft.processingAt': { $lte: staleProcessingCutoff },
        },
      ],
    };
    const claimResult = await AliExpressCatalogProduct.collection.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          'aiContentDraft.status': 'processing',
          'aiContentDraft.lastError': '',
          'aiContentDraft.processingAt': now,
        },
        $inc: { 'aiContentDraft.attempts': 1 },
      },
      { returnDocument: 'after', sort: { syncedAt: 1 } }
    );
    const claimedRaw = claimResult?.value || claimResult;
    const claimed = claimedRaw ? AliExpressCatalogProduct.hydrate(claimedRaw) : null;
    if (!claimed) return false;

    try {
      const generated = await generateAliExpressProductContent({
        title: claimed.title,
        supplierBrand: claimed.supplierBrand,
        categoryName: claimed.categoryName,
        productAttributes: claimed.productAttributes,
        rawDescription: claimed.sourcePayload?.rawDescription || '',
        productUrl: claimed.productUrl || '',
      });
      claimed.aiContentDraft = {
        ...generated,
        attempts: claimed.aiContentDraft.attempts,
        lastError: '',
        nextAttemptAt: null,
        processingAt: null,
      };
      await claimed.save();
      console.info('[AI product enrichment] draft generated:', JSON.stringify({ productId: String(claimed._id), sourceHash: generated.sourceHash, researchStatus: generated.researchStatus, sources: generated.researchSources?.length || 0, specifications: generated.specifications?.length || 0 }));
    } catch (error) {
      const attempts = Number(claimed.aiContentDraft?.attempts || 1);
      const retry = attempts < 5 && error.code !== 'AI_CONTENT_NOT_CONFIGURED' && error.code !== 'AI_CONTENT_REFUSED';
      claimed.aiContentDraft.status = retry ? 'pending' : 'failed';
      claimed.aiContentDraft.lastError = String(error.code || 'AI_CONTENT_FAILED').slice(0, 240);
      claimed.aiContentDraft.nextAttemptAt = retry ? new Date(Date.now() + Math.min(15, 2 ** attempts) * 60000) : null;
      claimed.aiContentDraft.processingAt = null;
      await claimed.save();
      console.warn('[AI product enrichment] job did not complete:', JSON.stringify({
        code: error.code || 'AI_CONTENT_FAILED',
        providerStatus: error.providerStatus || null,
        providerCode: error.providerCode || '',
        providerType: error.providerType || '',
        providerParam: error.providerParam || '',
        providerMessage: error.providerMessage || '',
      }));
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
