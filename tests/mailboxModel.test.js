const test = require('node:test');
const assert = require('node:assert/strict');
const MailboxMessage = require('../models/MailboxMessage');
const SupportMessage = require('../models/SupportMessage');

test('Sylva Mail message schema supports the Spam folder', () => {
  assert.ok(MailboxMessage.schema.path('folder').enumValues.includes('spam'));
});

test('Website enquiry schema supports the Spam folder', () => {
  assert.ok(SupportMessage.schema.path('folder').enumValues.includes('spam'));
});
