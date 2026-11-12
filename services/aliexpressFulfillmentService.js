const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AliExpressCatalogProduct = require('../models/AliExpressCatalogProduct');
const AliExpressFulfillment = require('../models/AliExpressFulfillment');

const buildFulfillmentIdempotencyKey = (orderId, itemId) => {
  if (!orderId || !itemId) throw new Error('Order and order item identifiers are required.');
  return String(orderId) + ':' + String(itemId);
};

const reconcilePaidAliExpressOrders = async ({ limit = 100, orderId = null } = {}) => {
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
  const orderFilter = {
    paymentStatus: 'Paid',
    status: mongoose.trusted({ $ne: 'Cancelled' }),
  };
  if (orderId && mongoose.Types.ObjectId.isValid(String(orderId))) orderFilter._id = orderId;
  const orders = await Order.find(orderFilter)
    .sort({ paidAt: 1, _id: 1 })
    .limit(safeLimit)
    .select('_id orderNumber items paymentStatus status')
    .lean();

  const productIds = [...new Set(orders.flatMap((order) =>
    (order.items || []).map((item) => String(item.product || '')).filter(Boolean)
  ))];
  if (!productIds.length) return { scannedOrders: orders.length, queued: 0, existing: 0 };

  const products = await Product.find({ _id: mongoose.trusted({ $in: productIds }) })
    .select('_id source seller')
    .lean();
  const eligibleProductIds = products
    .filter((product) => !product.seller && product.source === 'aliexpress')
    .map((product) => product._id);

  if (!eligibleProductIds.length) return { scannedOrders: orders.length, queued: 0, existing: 0 };

  const catalog = await AliExpressCatalogProduct.find({ importedProduct: mongoose.trusted({ $in: eligibleProductIds }) })
    .select('_id importedProduct providerProductId supplierPrice supplierCurrency')
    .lean();
  const catalogByProduct = new Map(catalog.map((item) => [String(item.importedProduct), item]));

  let queued = 0;
  let existing = 0;
  for (const order of orders) {
    for (const item of order.items || []) {
      const productId = String(item.product || '');
      const supplier = catalogByProduct.get(productId);
      if (!supplier) continue;
      const idempotencyKey = buildFulfillmentIdempotencyKey(order._id, item._id);
      try {
        await AliExpressFulfillment.create({
          idempotencyKey,
          order: order._id,
          orderItem: item._id,
          product: item.product,
          catalogProduct: supplier._id,
          providerProductId: supplier.providerProductId,
          quantity: item.quantity,
          customerPriceKes: Number(item.subtotal || 0),
          supplierUnitPrice: supplier.supplierPrice,
          supplierCurrency: supplier.supplierCurrency || 'USD',
          status: 'awaiting_supplier_authorization',
          blockedReason: 'Paid order queued. Live supplier ordering remains locked until Dropshipper API permissions and supplier payment are verified.',
        });
        queued += 1;
      } catch (error) {
        if (error.code === 11000) {
          existing += 1;
          continue;
        }
        throw error;
      }
    }
  }
  return { scannedOrders: orders.length, queued, existing };
};

module.exports = { buildFulfillmentIdempotencyKey, reconcilePaidAliExpressOrders };
