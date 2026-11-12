const test = require('node:test');
const assert = require('node:assert/strict');
const { isTechProduct, isTechCategory } = require('../utils/aliexpressTechCatalog');

test('accepts Sylva technology sourcing terms', () => {
  for (const value of [
    'Business laptop Core i7',
    'Laptops',
    'Smartphones',
    'Phones',
    'Routers',
    'Monitors',
    'Printers',
    'Keyboards and mice',
    'Android smartphone 5G',
    'Wi-Fi 6 router',
    '1TB NVMe SSD',
    '27 inch computer monitor',
    'USB-C docking station',
    'CCTV security camera',
    'Wireless earphones',
    'Mac mini desktop computer',
    'UPS power protection',
  ]) assert.equal(isTechProduct(value), true, value);
});

test('rejects unrelated marketplace product titles', () => {
  for (const value of [
    'Women summer dress',
    'Fashion jewellery necklace',
    'Kitchen cookware set',
    'Living room sofa',
    'Pet food for dogs',
  ]) assert.equal(isTechProduct(value), false, value);
});

test('recognises technology catalogue categories', () => {
  for (const value of ['Computers', 'Computer Accessories', 'Networking', 'Electronics', 'Power & Protection', 'Printers & Scanners']) {
    assert.equal(isTechCategory(value), true, value);
  }
  assert.equal(isTechCategory('Fashion & Clothing'), false);
});
