const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { getGoogleSheetRows } = require('../services/googleSheetProductSync');

test('Google Sheets sync authenticates with service-account JWT and reads the configured sheet without googleapis', async (t) => {
  const previous = {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME,
    fetch: global.fetch,
  };
  t.after(() => {
    for (const [key, value] of Object.entries({
      GOOGLE_SERVICE_ACCOUNT_EMAIL: previous.email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: previous.privateKey,
      GOOGLE_SHEETS_SPREADSHEET_ID: previous.spreadsheetId,
      GOOGLE_SHEETS_SHEET_NAME: previous.sheetName,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = previous.fetch;
  });

  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sylva-sheets@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'spreadsheet-id';
  process.env.GOOGLE_SHEETS_SHEET_NAME = 'Sylva Auto';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /jwt-bearer/);
      return new Response(JSON.stringify({ access_token: 'unit-test-access-token' }), { status: 200 });
    }
    assert.match(String(url), /sheets\.googleapis\.com\/v4\/spreadsheets\/spreadsheet-id\/values\/Sylva%20Auto%21A%3AAL$/);
    assert.equal(options.headers.Authorization, 'Bearer unit-test-access-token');
    return new Response(JSON.stringify({
      values: [
        ['Code', 'Name', 'Brand', 'Category'],
        ['SYLT-001', 'Business Laptop', 'HP', 'Laptops'],
      ],
    }), { status: 200 });
  };

  const rows = await getGoogleSheetRows();
  assert.equal(calls.length, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'SYLT-001');
  assert.equal(rows[0].name, 'Business Laptop');
  assert.equal(rows[0].brand, 'HP');
});
