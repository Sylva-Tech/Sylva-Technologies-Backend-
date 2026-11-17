const mongoose = require('mongoose');
const STATE_ID = 'google-gemini-product-content';
const DEFAULT_COOLDOWN_MINUTES = 1440;

const isQuotaExhaustion = (error = {}) => {
  if (Number(error.providerStatus || error.status) !== 429) return false;
  const message = String(error.providerMessage || error.message || '').toLowerCase();
  // Provider quota errors often include a documentation URL containing `rate-limits`.
  // Match actual throttling messages, not that URL, before classifying quota exhaustion.
  if (/requests?\s+per\s+(?:minute|second)|tokens?\s+per\s+minute|too many requests|temporarily rate.?limited|rate limit exceeded for (?:requests|tokens)/.test(message)) return false;
  return /quota|billing|payment required|daily limit|spending limit|exceeded.*current quota|current quota.*exceeded/.test(message);
};
const getCooldownMinutes = () => {
  const value = Number.parseInt(process.env.GEMINI_QUOTA_COOLDOWN_MINUTES, 10);
  return Number.isFinite(value) ? Math.max(15, Math.min(1440, value)) : DEFAULT_COOLDOWN_MINUTES;
};
const getCollection = () => mongoose.connection.readyState === 1 && mongoose.connection.db
  ? mongoose.connection.collection('aiproviderstates') : null;

const readGeminiProviderState = async () => {
  const collection = getCollection();
  if (!collection) return { available: true, paused: false, persistenceAvailable: false, cooldownMinutes: getCooldownMinutes() };
  const state = await collection.findOne({ _id: STATE_ID });
  const pauseUntil = state?.pauseUntil ? new Date(state.pauseUntil) : null;
  const paused = Boolean(state?.status === 'paused' && pauseUntil && pauseUntil.getTime() > Date.now());
  if (state?.status === 'paused' && !paused) {
    await collection.updateOne({ _id: STATE_ID, status: 'paused' }, {
      $set: { status: 'available', updatedAt: new Date() },
      $unset: { pauseUntil: '', pauseReason: '' },
    });
  }
  return {
    available: !paused, paused, persistenceAvailable: true,
    status: paused ? 'paused' : 'available',
    pauseReason: paused ? String(state.pauseReason || 'quota_exhausted') : '',
    pauseUntil: paused ? pauseUntil : null,
    pausedAt: paused ? state.pausedAt || null : null,
    lastErrorCode: state?.lastErrorCode || '',
    cooldownMinutes: getCooldownMinutes(),
  };
};

const pauseGeminiForQuota = async (error = {}) => {
  const collection = getCollection();
  const now = new Date();
  const pauseUntil = new Date(now.getTime() + getCooldownMinutes() * 60000);
  if (collection) await collection.updateOne({ _id: STATE_ID }, {
    $set: {
      status: 'paused', pauseReason: 'quota_exhausted', pausedAt: now, pauseUntil,
      lastErrorCode: String(error.providerCode || 'RESOURCE_EXHAUSTED').slice(0, 100),
      updatedAt: now,
    },
  }, { upsert: true });
  return { paused: true, pauseUntil, persistenceAvailable: Boolean(collection) };
};

const resumeGeminiProvider = async () => {
  const collection = getCollection();
  if (!collection) throw new Error('MongoDB is not available to resume the Gemini provider.');
  await collection.updateOne({ _id: STATE_ID }, {
    $set: { status: 'available', updatedAt: new Date() },
    $unset: { pauseUntil: '', pauseReason: '', pausedAt: '' },
  }, { upsert: true });
  return { resumed: true };
};

const assertGeminiAvailable = async () => {
  const state = await readGeminiProviderState();
  if (!state.paused) return state;
  const error = new Error('Gemini product enrichment is paused because the provider quota or billing limit was reached.');
  error.code = 'AI_CONTENT_PROVIDER_PAUSED';
  error.status = 503;
  error.retryAt = state.pauseUntil;
  throw error;
};

module.exports = { isQuotaExhaustion, getCooldownMinutes, readGeminiProviderState, pauseGeminiForQuota, resumeGeminiProvider, assertGeminiAvailable };
