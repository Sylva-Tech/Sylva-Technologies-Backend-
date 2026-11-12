const express = require('express');
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressConnection = require('../models/AliExpressConnection');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { callDropshipApi, decryptSecret, encryptSecret, refreshAccessToken } = require('../services/aliexpressService');
const { isTechProduct, isTechCategory } = require('../utils/aliexpressTechCatalog');

const router = express.Router();
router.use(protect, adminOnly);

const walk = (value, visit, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 9) return undefined;
  const found = visit(value);
  if (found !== undefined && found !== null) return found;
  for (const child of Object.values(value)) {
    const nested = walk(child, visit, depth + 1);
    if (nested !== undefined && nested !== null) return nested;
  }
  return undefined;
};

const findNode = (value, keys) => {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return walk(value, (node) => {
    for (const [key, item] of Object.entries(node)) {
      if (wanted.has(key.toLowerCase()) && item !== undefined && item !== null) return item;
    }
    return undefined;
  });
};

const findValue = (value, keys) => {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  return walk(value, (node) => {
    for (const [key, item] of Object.entries(node)) {
      if (wanted.has(key.toLowerCase()) && item !== undefined && item !== null && typeof item !== 'object' && String(item).trim()) return item;
    }
    return undefined;
  });
};

const findProductArray = (payload) => walk(payload, (node) => {
  for (const key of ['selection_search_product', 'products', 'product_list']) {
    if (Array.isArray(node[key])) return node[key];
  }
  return undefined;
});

const cleanText = (value, max = 20000) => String(value || '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const normalizeSearchItem = (item) => {
  const productId = String(item.itemId || item.product_id || item.productId || '').trim();
  const title = cleanText(item.title || item.product_title || item.subject, 400);
  const image = item.itemMainPic || item.product_main_image_url || item.productMainImageUrl || '';
  const supplierPrice = Number(item.targetSalePrice || item.target_sale_price || item.sale_price || item.target_price || 0);
  const originalPrice = Number(item.targetOriginalPrice || item.target_original_price || item.original_price || 0);
  const url = item.itemUrl || item.product_detail_url || item.productUrl || '';
  return {
    productId,
    title,
    imageUrl: String(image).startsWith('//') ? `https:${image}` : String(image),
    supplierPrice: Number.isFinite(supplierPrice) ? supplierPrice : 0,
    originalPrice: Number.isFinite(originalPrice) ? originalPrice : 0,
    currency: item.targetOriginalPriceCurrency || item.target_sale_price_currency || 'USD',
    rating: item.score || item.evaluate_rate || '',
    orders: item.orders || item.lastest_volume || '',
    productUrl: String(url).startsWith('//') ? `https:${url}` : String(url),
  };
};

const getConnection = async () => {
  const connection = await AliExpressConnection.findOne({ provider: 'aliexpress' })
    .select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
    const error = new Error('Connect and authorize the approved Sylva Technologies AliExpress Dropshipping account first.');
    error.status = 409;
    throw error;
  }
  let accessToken = decryptSecret(connection.accessTokenEncrypted);
  if (!accessToken) {
    const error = new Error('AliExpress authorization has expired. Re-authorize the account.');
    error.status = 409;
    throw error;
  }
  if (connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() < Date.now() + 90000) {
    if (!connection.refreshTokenEncrypted) {
      const error = new Error('AliExpress access token expired. Re-authorize the account.');
      error.status = 409;
      throw error;
    }
    const oldRefreshToken = decryptSecret(connection.refreshTokenEncrypted);
    const refreshed = await refreshAccessToken(oldRefreshToken);
    accessToken = refreshed.access_token;
    connection.accessTokenEncrypted = encryptSecret(accessToken);
    connection.refreshTokenEncrypted = encryptSecret(refreshed.refresh_token || oldRefreshToken);
    connection.accessTokenExpiresAt = refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000) : null;
    connection.refreshTokenExpiresAt = refreshed.refresh_expires_in ? new Date(Date.now() + Number(refreshed.refresh_expires_in) * 1000) : connection.refreshTokenExpiresAt;
    await connection.save();
  }
  return accessToken;
};

const getProductDetailNode = (payload) => {
  const node = walk(payload, (value) => {
    for (const key of ['ae_item_base_info_dto', 'product_info', 'productInfo', 'product_detail']) {
      if (value[key] && typeof value[key] === 'object') return value[key];
    }
    return undefined;
  });
  return node || payload;
};

router.get('/search', async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim().replace(/\s+/g, ' ');
    const pageIndex = Math.max(1, Math.min(100, Number(req.query.page) || 1));
    const pageSize = Math.max(1, Math.min(30, Number(req.query.limit) || 20));
    if (keyword.length < 2 || keyword.length > 80 || !isTechProduct(keyword)) {
      return res.status(400).json({
        success: false,
        message: 'Search is restricted to technology products. Try laptops, smartphones, routers, SSDs, monitors or computer accessories.',
      });
    }
    const accessToken = await getConnection();
    const payload = await callDropshipApi('aliexpress.ds.text.search', {
      keyword,
      countryCode: 'KE',
      currency: 'USD',
      local: 'en_US',
      page_size: String(pageSize),
      page_index: String(pageIndex),
      sort: 'salesDesc',
    }, accessToken);
    const rawItems = findProductArray(payload) || [];
    const products = rawItems.map(normalizeSearchItem)
      .filter((item) => item.productId && item.title && isTechProduct(item.title))
      .slice(0, pageSize);
    const total = Number(findValue(payload, ['totalCount', 'total_count', 'total']) || products.length);
    return res.json({
      success: true,
      data: { keyword, page: pageIndex, pageSize, total, products },
      message: products.length ? 'Technology products retrieved from AliExpress.' : 'No eligible technology products were returned for this search.',
    });
  } catch (error) {
    console.error('AliExpress technology search failed:', { code: error.code, message: error.message });
    return res.status(error.status || 502).json({
      success: false,
      message: error.message || 'AliExpress technology catalogue search failed.',
      code: error.code || 'ALIEXPRESS_SEARCH_FAILED',
    });
  }
});

router.post('/import', async (req, res) => {
  try {
    const productId = String(req.body.productId || '').trim();
    const categoryId = String(req.body.categoryId || '').trim();
    const markupPercent = Number(req.body.markupPercent ?? 20);
    if (!/^\d{6,24}$/.test(productId)) return res.status(400).json({ success: false, message: 'A valid AliExpress product ID is required.' });
    if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ success: false, message: 'Choose a valid Sylva technology category.' });
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 200) return res.status(400).json({ success: false, message: 'Markup must be between 0 and 200 percent.' });

    const existing = await Product.findOne({ source: 'aliexpress', aliexpressProductId: productId }).select('_id name isActive');
    if (existing) return res.status(409).json({ success: false, message: 'This AliExpress product has already been imported into Sylva.', data: { productId: existing._id, name: existing.name, isActive: existing.isActive } });

    const category = await Category.findOne({ _id: categoryId, isActive: mongoose.trusted({ $ne: false }) }).lean();
    if (!category || !isTechCategory(category.name)) {
      return res.status(400).json({ success: false, message: 'AliExpress imports can only be assigned to an active technology category in Sylva.' });
    }

    const accessToken = await getConnection();
    const payload = await callDropshipApi('aliexpress.ds.product.get', {
      product_id: productId,
      ship_to_country: 'KE',
      target_currency: 'USD',
      target_language: 'EN',
    }, accessToken);
    const detail = getProductDetailNode(payload);
    const title = cleanText(findValue(detail, ['subject', 'product_title', 'title', 'item_title', 'name']), 400);
    if (!title || !isTechProduct(title)) {
      return res.status(422).json({ success: false, message: 'AliExpress product details do not identify an eligible technology product. It was not imported.' });
    }
    const supplierPrice = Number(findValue(payload, ['target_sale_price', 'targetSalePrice', 'app_sale_price', 'appSalePrice', 'sku_price', 'skuPrice', 'sale_price', 'min_price', 'price']) || req.body.supplierPrice || 0);
    if (!Number.isFinite(supplierPrice) || supplierPrice <= 0) {
      return res.status(422).json({ success: false, message: 'AliExpress did not return a usable supplier price. Product was not imported.' });
    }
    const currency = String(findValue(payload, ['target_sale_price_currency', 'currency', 'target_currency']) || 'USD').toUpperCase();
    if (currency !== 'USD') return res.status(422).json({ success: false, message: 'AliExpress returned an unexpected supplier currency. Product was not imported.' });

    const imageValue = findValue(payload, ['product_main_image_url', 'itemMainPic', 'main_image_url', 'image_url']);
    const imageList = findNode(payload, ['image_urls', 'product_images', 'product_images_list']);
    const images = [];
    if (typeof imageValue === 'string') images.push(imageValue.startsWith('//') ? `https:${imageValue}` : imageValue);
    if (Array.isArray(imageList)) {
      for (const value of imageList) {
        const url = typeof value === 'string' ? value : value?.url;
        if (url && /^https?:\/\//i.test(url) && !images.includes(url)) images.push(url);
      }
    }
    const description = cleanText(findValue(payload, ['detail', 'description', 'product_description', 'mobile_detail']), 20000) || title;
    const brand = cleanText(findValue(payload, ['brand_name', 'brandName', 'brand']), 120) || 'Unbranded';
    const exchangeRate = Number(process.env.ALIEXPRESS_KES_PER_USD || 0);
    const suggestedKes = exchangeRate > 0 ? Math.round(supplierPrice * exchangeRate * (1 + markupPercent / 100)) : 0;

    const product = await Product.create({
      name: title,
      slug: `aliexpress-${productId}`,
      sku: `AE-${productId}`,
      source: 'aliexpress',
      aliexpressProductId: productId,
      aliexpressProductUrl: `https://www.aliexpress.com/item/${productId}.html`,
      aliexpressSupplierPrice: supplierPrice,
      aliexpressSupplierCurrency: currency,
      aliexpressSyncedAt: new Date(),
      brand,
      category: category._id,
      description,
      shortDescription: title.slice(0, 180),
      price: suggestedKes,
      oldPrice: 0,
      images: images.filter((url) => /^https?:\/\//i.test(url)).slice(0, 4),
      stock: 0,
      isActive: false,
      approvalStatus: 'approved',
      seller: null,
      condition: 'New',
      specifications: { supplier: 'AliExpress', supplierProductId: productId, supplierPrice, supplierCurrency: currency, markupPercent, exchangeRateKesPerUsd: exchangeRate },
    });
    return res.status(201).json({
      success: true,
      message: 'Technology product saved as an inactive Sylva catalogue draft. Review its price, shipping and stock before publishing.',
      data: { productId: product._id, name: product.name, price: product.price, active: product.isActive },
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This AliExpress product or SKU is already present in Sylva.' });
    console.error('AliExpress product import failed:', { code: error.code, message: error.message });
    return res.status(error.status || 502).json({ success: false, message: error.message || 'Unable to import this AliExpress product.' });
  }
});

router.get('/drafts', async (req, res) => {
  try {
    const drafts = await Product.find({ source: 'aliexpress', isActive: false, seller: null })
      .select('_id name sku brand category price stock images aliexpressProductId aliexpressProductUrl aliexpressSupplierPrice aliexpressSupplierCurrency aliexpressSyncedAt createdAt')
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ success: true, data: drafts });
  } catch (error) {
    console.error('AliExpress draft catalogue load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress catalogue drafts.' });
  }
});

module.exports = router;
