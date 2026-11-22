const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildDueCampaignFilter } = require('../services/marketingCampaignScheduler');

test('due campaign date comparison survives Mongoose filter sanitization', () => {
  const now = new Date('2026-11-22T07:00:00.000Z');
  const filter = buildDueCampaignFilter(now);
  const sanitized = mongoose.sanitizeFilter(filter);

  assert.equal(sanitized.status, 'scheduled');
  assert.deepEqual(sanitized.scheduledAt, { $lte: now });
});

test('due campaign filter uses the supplied timestamp', () => {
  const now = new Date('2026-11-22T08:30:00.000Z');
  assert.equal(buildDueCampaignFilter(now).scheduledAt.$lte, now);
});
