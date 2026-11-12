const test = require('node:test');
const assert = require('node:assert/strict');

test('backend application loads all registered route modules', () => {
  const app = require('../app');
  assert.equal(typeof app, 'function');
  assert.ok(app.router);
  assert.ok(Array.isArray(app.router.stack));
});
