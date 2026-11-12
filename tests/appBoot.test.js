const test = require('node:test');
const assert = require('node:assert/strict');

test('backend application loads all registered route modules', () => {
  const app = require('../app');
  assert.equal(typeof app, 'function');
  assert.ok(app.router);
  assert.ok(Array.isArray(app.router.stack));
  const mounted = (path) => app.router.stack.some((layer) =>
    typeof layer.match === 'function' && layer.match(path)
  );
  assert.ok(mounted('/api/mailbox'), 'Sylva Mail routes must be mounted');
  assert.ok(mounted('/api/support-inbox'), 'Support inbox routes must be mounted');
  assert.ok(mounted('/api/aliexpress'), 'AliExpress routes must be mounted');
});
