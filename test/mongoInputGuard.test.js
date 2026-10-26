'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findUnsafeKey, rejectMongoOperatorInjection } = require('../middleware/mongoInputGuard');

test('allows ordinary nested request data', () => {
  assert.equal(findUnsafeKey({ name: 'Laptop', specs: { ram: '8GB' }, tags: ['office'] }), null);
});

test('rejects MongoDB operators at any nesting level', () => {
  assert.equal(findUnsafeKey({ email: { $ne: null } }), '$ne');
  assert.equal(findUnsafeKey({ items: [{ '$where': 'true' }] }), '$where');
});

test('rejects dotted paths and prototype-pollution keys', () => {
  assert.equal(findUnsafeKey({ 'profile.role': 'admin' }), 'profile.role');
  assert.equal(findUnsafeKey(JSON.parse('{"__proto__":{"admin":true}}')), '__proto__');
  assert.equal(findUnsafeKey({ constructor: { prototype: { admin: true } } }), 'constructor');
});

test('rejects excessively deep or large request structures', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 33; i += 1) cursor = cursor.child = {};
  assert.equal(findUnsafeKey(deep), '[request structure limit]');
});

test('middleware returns 400 without reaching route handlers for operator injection', () => {
  let statusCode = 200;
  let payload;
  let calledNext = false;
  const req = { body: { filter: { $gt: 1 } }, query: {}, params: {} };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  rejectMongoOperatorInjection(req, res, () => { calledNext = true; });
  assert.equal(statusCode, 400);
  assert.equal(payload.success, false);
  assert.equal(calledNext, false);
});
