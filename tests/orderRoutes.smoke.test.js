const test = require('node:test');
const assert = require('node:assert/strict');

test('order routes load and expose authenticated PayPal capture and cancellation endpoints', () => {
  const router = require('../routes/orderRoutes');
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);

  assert.ok(paths.includes('/paypal/capture'));
  assert.ok(paths.includes('/paypal/cancel'));
  assert.ok(paths.includes('/mpesa/callback'));
});
