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


test('allows only Sylva production and project-scoped Vercel preview origins', async (t) => {
  const app = require('../app');
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  const preview = await fetch(baseUrl + '/api/health', {
    headers: { Origin: 'https://sylva-technologies-frontend-8svhsngly.vercel.app' },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('access-control-allow-origin'), 'https://sylva-technologies-frontend-8svhsngly.vercel.app');

  const unrelated = await fetch(baseUrl + '/api/health', {
    headers: { Origin: 'https://unrelated-project.vercel.app' },
  });
  assert.equal(unrelated.status, 403);
});
