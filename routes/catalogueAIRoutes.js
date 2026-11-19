const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const Product = require('../models/Product');
const { generateCatalogueDraft, validateDraft } = require('../services/catalogueAIEngine');

const router = express.Router();
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many AI catalogue requests. Please try again later.' },
});

router.get('/status', protect, adminOnly, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      preferredProvider: 'ollama',
      preferredModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
      ollamaConfigured: Boolean(process.env.OLLAMA_BASE_URL),
      geminiFallbackConfigured: Boolean(process.env.GEMINI_API_KEY),
      modes: ['CREATE', 'SYNC_CLEANUP', 'REFINE_EDIT'],
      savesRequireAdminConfirmation: true,
    },
  });
});

router.get('/products', protect, adminOnly, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const filter = search ? { $or: [{ name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { sku: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] } : {};
    const products = await Product.find(filter)
      .select('_id name sku brand description shortDescription keyFeatures specifications warrantyTerms deliveryTerms returnPolicy seoTitle seoMetaDescription marketingTags socialPromoCaption approvalStatus isActive')
      .sort({ updatedAt: -1 }).limit(30).lean();
    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to load catalogue products.' });
  }
});

router.post('/generate', protect, adminOnly, generateLimiter, async (req, res) => {
  try {
    const draft = await generateCatalogueDraft({ mode: req.body?.mode, product: req.body?.product || {} });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, draft });
  } catch (error) {
    const status = error.code === 'CATALOGUE_AI_MISSING_TITLE' || error.code === 'CATALOGUE_AI_INVALID_MODE' ? 400
      : error.code === 'CATALOGUE_AI_QUALITY_FAILED' || error.code === 'CATALOGUE_AI_PRIVATE_CONTENT' ? 422
        : error.code === 'AI_CONTENT_QUOTA_EXHAUSTED' ? 503 : 502;
    res.status(status).json({
      success: false,
      code: error.code || 'CATALOGUE_AI_FAILED',
      message: error.message || 'Unable to generate catalogue content.',
      retryAt: error.retryAt || null,
    });
  }
});

router.post('/products/:id/apply', protect, adminOnly, async (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ success: false, message: 'Confirm that you reviewed this AI draft before applying it.' });
  }
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    const draft = validateDraft(req.body?.draft);
    // Only customer-facing descriptive fields are writable here. Pricing, stock,
    // identifiers, category, images, ownership, approval and visibility are untouched.
    product.description = draft.longDescription;
    product.shortDescription = draft.shortDescription;
    product.keyFeatures = draft.keyFeatures;
    product.specifications = {
      ...(product.specifications && typeof product.specifications === 'object' ? product.specifications : {}),
      ...draft.specifications,
    };
    product.seoTitle = draft.seo_meta.meta_title;
    product.seoMetaDescription = draft.seo_meta.meta_description;
    product.marketingTags = draft.seo_meta.tags;
    product.contentGeneration = {
      provider: req.body?.draft?.generation?.provider === 'ollama' ? 'ollama' : 'google_gemini',
      model: String(req.body?.draft?.generation?.model || '').slice(0, 80),
      sourceHash: '',
      generatedAt: new Date(),
      generatedFields: ['description', 'shortDescription', 'keyFeatures', 'specifications', 'seoTitle', 'seoMetaDescription', 'marketingTags'],
      warnings: [],
      researchSources: Array.isArray(req.body?.draft?.generation?.researchSources) ? req.body.draft.generation.researchSources.slice(0, 10) : [],
    };
    await product.save();
    res.json({ success: true, message: 'Reviewed AI content applied. Product approval and visibility were not changed.', productId: String(product._id) });
  } catch (error) {
    res.status(422).json({ success: false, code: error.code || 'CATALOGUE_AI_APPLY_FAILED', message: error.message || 'Unable to apply the reviewed draft.' });
  }
});

module.exports = router;
