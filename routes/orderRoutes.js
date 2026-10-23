const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');

const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const AdminWallet = require('../models/AdminWallet');
const { getQuote: getShippingQuote } = require('./shippingRoutes');

const {
  initializeTransaction,
  verifyTransaction,
  refundTransaction,
} = require('../services/paystackService');

const {

  protect,
  adminOnly,
  requireVerified,
} = require('../middleware/authMiddleware');

const {
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendOrderStatusUpdateEmail,
  sendSalesNotificationEmail,
  sendMail,
} = require('../services/emailService');

const router = express.Router();

// Fail closed: never send a request to Production because MPESA_ENV is missing
// or misspelled. Sandbox remains the safe default until Go Live is approved.
const getMpesaEnvironment = () => {
  const environment = String(process.env.MPESA_ENV || 'sandbox').trim().toLowerCase();
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('Invalid M-Pesa environment. Set MPESA_ENV to sandbox or production.');
  }
  return environment;
};

const getMpesaHost = () => getMpesaEnvironment() === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';


const ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'Processing',
  'Ready for Delivery',
  'Shipped',
  'Delivered',
  'Cancelled',
];

const PAYMENT_STATUSES = [
  'Pending',
  'Paid',
  'Failed',
  'Refunded',
  'Refund Pending',
  'Refund Processing',
  'Refund Failed',
];

const roundMoney = (value) => {
  const normalized = Number(value || 0);

  if (!Number.isFinite(normalized)) {
    return 0;
  }

  return Number(normalized.toFixed(2));
};

/*
|--------------------------------------------------------------------------
| APPLY SELLER SETTLEMENT
|--------------------------------------------------------------------------
*/

const applySellerSettlement = async (order) => {
  if (!order || !Array.isArray(order.items)) {
    return {
      settled: false,
      count: 0,
    };
  }

  const configuredCommission = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.04);
  const commissionRate = Number.isFinite(configuredCommission)
    ? Math.min(1, Math.max(0, configuredCommission > 1 ? configuredCommission / 100 : configuredCommission))
    : 0.04;

  const groupedSettlements = new Map();

  for (const item of order.items) {
    if (!item || !item.product) {
      continue;
    }

    const product = await Product.findById(item.product).select(
      'seller price name'
    );

    if (!product || !product.seller) {
      continue;
    }

    const sellerId = product.seller.toString();

    const grossAmount = roundMoney(
      Number(item.subtotal || 0)
    );

    const commission = roundMoney(
      grossAmount * commissionRate
    );

    const netAmount = roundMoney(
      grossAmount - commission
    );

    if (!groupedSettlements.has(sellerId)) {
      groupedSettlements.set(sellerId, {
        sellerId,
        grossAmount: 0,
        commission: 0,
        netAmount: 0,
        products: [],
      });
    }

    const current = groupedSettlements.get(sellerId);

    current.grossAmount = roundMoney(
      current.grossAmount + grossAmount
    );

    current.commission = roundMoney(
      current.commission + commission
    );

    current.netAmount = roundMoney(
      current.netAmount + netAmount
    );

    current.products.push({
      productId: product._id,
      productName: product.name,
      amount: grossAmount,
      netAmount,
      orderItemId: item._id || item.product,
    });
  }

  let settledCount = 0;

  for (const settlement of groupedSettlements.values()) {
    const seller = await User.findById(
      settlement.sellerId
    );

    if (!seller) {
      continue;
    }

    const settlementReference = `order:${order.orderNumber}`;
    const sellerCountry = String(seller.sellerProfile?.country || 'KE').toUpperCase();
    if ((seller.wallet?.transactions || []).some((tx) => tx.reference === settlementReference)) {
      settledCount += 1;
      continue;
    }
    const orderCurrency = String(order.currency || 'KES').toUpperCase();
    const now = new Date();

    if (sellerCountry !== 'KE') {
      // Current checkout accepts KES payments. Never silently mix KES into a USD wallet:
      // an explicit finance-configured KES-per-USD rate is required for international sellers.
      const kesPerUsd = Number(process.env.WALLET_KES_PER_USD);
      if (orderCurrency === 'KES' && (!Number.isFinite(kesPerUsd) || kesPerUsd <= 0)) {
        console.error(`International seller settlement deferred for order ${order.orderNumber}: set WALLET_KES_PER_USD before settling KES proceeds to USD.`);
        continue;
      }
      const settlementCurrency = orderCurrency === 'USD' ? 'USD' : 'USD';
      const settlementAmount = orderCurrency === 'USD'
        ? roundMoney(settlement.netAmount)
        : roundMoney(settlement.netAmount / kesPerUsd);
      const usdWallet = seller.usdWallet || {
        currency: 'USD', availableBalance: 0, pendingBalance: 0, transactions: [],
      };
      usdWallet.currency = 'USD';
      usdWallet.transactions = Array.isArray(usdWallet.transactions) ? usdWallet.transactions : [];
      if (usdWallet.transactions.some((tx) => tx.reference === settlementReference)) {
        settledCount += 1;
        continue;
      }
      usdWallet.availableBalance = roundMoney(Number(usdWallet.availableBalance || 0) + settlementAmount);
      usdWallet.lastUpdatedAt = now;
      usdWallet.transactions.unshift({
        _id: new mongoose.Types.ObjectId(),
        type: 'credit',
        amount: settlementAmount,
        currency: settlementCurrency,
        category: 'order_settlement',
        status: 'completed',
        description: `USD seller settlement for order ${order.orderNumber}.`,
        reference: settlementReference,
        createdAt: now,
        updatedAt: now,
        processedAt: now,
        metadata: {
          sourceCurrency: orderCurrency,
          grossAmount: roundMoney(settlement.grossAmount),
          grossCurrency: orderCurrency,
          commission: roundMoney(settlement.commission),
          commissionCurrency: orderCurrency,
          netAmountBeforeConversion: roundMoney(settlement.netAmount),
          exchangeRateKesPerUsd: orderCurrency === 'KES' ? kesPerUsd : null,
          settlementCurrency: 'USD',
          products: settlement.products,
        },
      });
      seller.usdWallet = usdWallet;
    } else {
      const wallet = seller.wallet || {
        currency: 'KES', availableBalance: 0, pendingBalance: 0, transactions: [],
      };
      wallet.currency = wallet.currency || 'KES';
      wallet.transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
      if (wallet.transactions.some((tx) => tx.reference === settlementReference)) {
        settledCount += 1;
        continue;
      }
      wallet.availableBalance = roundMoney(Number(wallet.availableBalance || 0) + Number(settlement.netAmount || 0));
      wallet.lastUpdatedAt = now;
      wallet.transactions.unshift({
        _id: new mongoose.Types.ObjectId(),
        type: 'credit',
        amount: roundMoney(settlement.netAmount),
        category: 'order_settlement',
        status: 'completed',
        description: `Order settlement for ${order.orderNumber}.`,
        reference: settlementReference,
        relatedOrder: order._id,
        metadata: {
          commission: roundMoney(settlement.commission),
          commissionCurrency: orderCurrency,
          grossAmount: roundMoney(settlement.grossAmount),
          grossCurrency: orderCurrency,
          settlementCurrency: 'KES',
          products: settlement.products,
        },
        createdAt: now,
        updatedAt: now,
      });
      seller.wallet = wallet;
    }

    await seller.save();

    settledCount += 1;
  }

  return {
    settled: groupedSettlements.size > 0 && settledCount === groupedSettlements.size,
    count: settledCount,
    expected: groupedSettlements.size,
  };
};


// Track seller-owned M-Pesa proceeds as held platform funds until the customer confirms delivery.
// This is an internal ledger hold; the actual M-Pesa collection remains in the configured business Till.
const getSellerOrderGrossAmounts = async (order) => {
  const productIds = [...new Set((order?.items || []).map((item) => item?.product ? String(item.product._id || item.product) : '').filter(Boolean))];
  if (!productIds.length) return [];
  const products = await Product.find({ _id: { $in: productIds } }).select('_id seller name').populate('seller', '_id name sellerProfile.storeName').lean();
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const sellers = new Map();
  for (const item of order.items || []) {
    const productId = item?.product ? String(item.product._id || item.product) : '';
    const product = productById.get(productId);
    const seller = product?.seller;
    if (!seller?._id) continue; // Sylva-owned products are not seller escrow.
    const sellerId = String(seller._id);
    const subtotal = roundMoney(Number(item.subtotal || 0));
    if (subtotal <= 0) continue;
    if (!sellers.has(sellerId)) {
      sellers.set(sellerId, {
        sellerId,
        storeName: String(seller.sellerProfile?.storeName || seller.name || 'Marketplace Seller').trim(),
        grossAmount: 0,
      });
    }
    const group = sellers.get(sellerId);
    group.grossAmount = roundMoney(group.grossAmount + subtotal);
  }
  return [...sellers.values()].filter((seller) => seller.grossAmount > 0);
};

const sellerEscrowReference = (order, sellerId) => 'seller-escrow:order:' + String(order.orderNumber) + ':' + String(sellerId);
const sellerEscrowReleaseReference = (order, sellerId) => 'seller-escrow-release:order:' + String(order.orderNumber) + ':' + String(sellerId);

const holdSellerProceedsInPlatformWallet = async (order) => {
  if (!order || order.paymentMethod !== 'M-Pesa' || order.paymentStatus !== 'Paid') {
    return { held: 0, expected: 0, skipped: true };
  }
  const sellerAmounts = await getSellerOrderGrossAmounts(order);
  if (!sellerAmounts.length) return { held: 0, expected: 0, skipped: false };
  let platform = await AdminWallet.findOne({ key: 'platform' });
  if (!platform) {
    try {
      platform = await AdminWallet.create({ key: 'platform', currency: 'KES' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      platform = await AdminWallet.findOne({ key: 'platform' });
    }
  }
  let held = 0;
  for (const seller of sellerAmounts) {
    const reference = sellerEscrowReference(order, seller.sellerId);
    if ((platform.transactions || []).some((tx) => tx.reference === reference)) {
      held += 1;
      continue;
    }
    const now = new Date();
    const updated = await AdminWallet.findOneAndUpdate(
      {
        key: 'platform',
        transactions: mongoose.trusted({ $not: { $elemMatch: { reference } } }),
      },
      {
        $inc: { pendingBalance: seller.grossAmount },
        $set: { lastUpdatedAt: now },
        $push: {
          transactions: {
            type: 'credit',
            amount: seller.grossAmount,
            category: 'seller_order_escrow',
            status: 'pending',
            description: 'Seller order proceeds held until customer delivery confirmation for order ' + order.orderNumber + '.',
            reference,
            relatedUser: seller.sellerId,
            metadata: {
              orderId: String(order._id),
              orderNumber: order.orderNumber,
              sellerId: seller.sellerId,
              storeName: seller.storeName,
              grossAmount: seller.grossAmount,
              commissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.04),
              releaseCondition: 'Customer confirms delivery',
              paymentMethod: 'M-Pesa',
            },
            createdAt: now,
            updatedAt: now,
          },
        },
      },
      { new: true, runValidators: true }
    );
    if (updated) {
      platform = updated;
      held += 1;
    } else {
      // A concurrent callback may have inserted this seller's hold after our read.
      platform = await AdminWallet.findOne({ key: 'platform' });
      if ((platform?.transactions || []).some((tx) => tx.reference === reference)) {
        held += 1;
        continue;
      }
      throw new Error('Unable to reserve M-Pesa proceeds for seller ' + seller.sellerId + ' on order ' + order.orderNumber + '.');
    }
  }
  return { held, expected: sellerAmounts.length, complete: held === sellerAmounts.length };
};

const releaseSellerProceedsFromPlatformWallet = async (order) => {
  if (!order || order.paymentMethod !== 'M-Pesa') return { released: 0, expected: 0, skipped: true };
  const sellerAmounts = await getSellerOrderGrossAmounts(order);
  if (!sellerAmounts.length) return { released: 0, expected: 0, complete: true };
  let platform = await AdminWallet.findOne({ key: 'platform' });
  if (!platform) throw new Error('Platform wallet is missing while releasing seller proceeds.');
  let released = 0;
  for (const seller of sellerAmounts) {
    const holdReference = sellerEscrowReference(order, seller.sellerId);
    const releaseReference = sellerEscrowReleaseReference(order, seller.sellerId);
    if ((platform.transactions || []).some((tx) => tx.reference === releaseReference)) {
      released += 1;
      continue;
    }
    const hold = (platform.transactions || []).find((tx) => tx.reference === holdReference);
    if (!hold || hold.status !== 'pending') {
      throw new Error('Pending seller proceeds hold is missing for order ' + order.orderNumber + ', seller ' + seller.sellerId + '.');
    }
    const now = new Date();
    const updated = await AdminWallet.findOneAndUpdate(
      {
        key: 'platform',
        pendingBalance: mongoose.trusted({ $gte: seller.grossAmount }),
        transactions: mongoose.trusted({ $elemMatch: { reference: holdReference, status: 'pending' } }),
        $and: [
          { transactions: mongoose.trusted({ $not: { $elemMatch: { reference: releaseReference } } }) },
        ],
      },
      {
        $inc: { pendingBalance: -seller.grossAmount },
        $set: {
          lastUpdatedAt: now,
          'transactions.$.status': 'completed',
          'transactions.$.processedAt': now,
          'transactions.$.updatedAt': now,
          'transactions.$.description': 'Seller proceeds released from escrow after customer delivery confirmation for order ' + order.orderNumber + '.',
        },
        $push: {
          transactions: {
            type: 'debit',
            amount: seller.grossAmount,
            category: 'seller_order_escrow',
            status: 'completed',
            description: 'Release held seller proceeds after confirmed delivery for order ' + order.orderNumber + '.',
            reference: releaseReference,
            relatedUser: seller.sellerId,
            metadata: { orderId: String(order._id), orderNumber: order.orderNumber, sellerId: seller.sellerId, storeName: seller.storeName, grossAmount: seller.grossAmount, paymentMethod: 'M-Pesa' },
            createdAt: now,
            updatedAt: now,
            processedAt: now,
          },
        },
      },
      { new: true, runValidators: true }
    );
    if (updated) {
      platform = updated;
      released += 1;
    } else {
      platform = await AdminWallet.findOne({ key: 'platform' });
      if ((platform?.transactions || []).some((tx) => tx.reference === releaseReference)) {
        released += 1;
        continue;
      }
      throw new Error('Unable to release held M-Pesa proceeds for order ' + order.orderNumber + ', seller ' + seller.sellerId + '.');
    }
  }
  return { released, expected: sellerAmounts.length, complete: released === sellerAmounts.length };
};

const hashDeliveryToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const createDeliveryConfirmationToken = async (order) => {
  const token = crypto.randomBytes(32).toString('hex');
  order.deliveryConfirmationTokenHash = hashDeliveryToken(token);
  order.deliveryConfirmationExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await order.save();
  const baseUrl = String(process.env.FRONTEND_URL || process.env.SITE_URL || 'https://www.sylvatechnologies.co.ke').replace(/\/$/, '');
  return baseUrl + '/confirm-delivery?token=' + encodeURIComponent(token);
};

// The seller wallet settlement record is the source of truth for the
// commission amount. Credit the platform wallet only after the seller settlement
// exists, and use a unique reference so a repeated confirmation cannot double-credit.
const recordPlatformCommissionForSettlements = async (order) => {
  const productIds = [...new Set((order.items || []).map((item) => item?.product ? String(item.product._id || item.product) : '').filter(Boolean))];
  if (!productIds.length) return { recorded: 0 };
  const products = await Product.find(mongoose.trusted({ _id: mongoose.trusted({ $in: productIds }) })).select('_id seller').lean();
  const sellerIds = [...new Set(products.map((product) => product.seller ? String(product.seller) : '').filter(Boolean))];
  let platform = await AdminWallet.findOne({ key: 'platform' });
  if (!platform) platform = new AdminWallet({ key: 'platform', currency: 'KES' });
  let recorded = 0;
  for (const sellerId of sellerIds) {
    const seller = await User.findById(sellerId).select('wallet.transactions usdWallet.transactions').lean();
    const settlementReference = 'order:' + String(order.orderNumber || '');
    const settlement = [...(seller?.wallet?.transactions || []), ...(seller?.usdWallet?.transactions || [])]
      .find((tx) => tx?.reference === settlementReference && tx?.category === 'order_settlement');
    if (!settlement) continue;
    const commission = roundMoney(Number(settlement.metadata?.commission || 0));
    if (commission <= 0) continue;
    const reference = 'commission:order:' + String(order.orderNumber || '') + ':' + sellerId;
    if ((platform.transactions || []).some((tx) => tx.reference === reference)) continue;
    platform.availableBalance = roundMoney(Number(platform.availableBalance || 0) + commission);
    platform.transactions.push({
      type: 'credit',
      amount: commission,
      category: 'seller_commission',
      status: 'completed',
      description: 'Marketplace commission from order ' + order.orderNumber,
      reference,
      relatedUser: sellerId,
      metadata: { orderId: String(order._id), orderNumber: order.orderNumber, sellerId, currency: 'KES' },
      createdAt: new Date(),
      processedAt: new Date(),
      updatedAt: new Date(),
    });
    recorded += 1;
  }
  if (recorded) {
    platform.lastUpdatedAt = new Date();
    await platform.save();
  }
  return { recorded };
};

/*
|--------------------------------------------------------------------------
| PAYMENT CONFIRMATION HELPERS
|--------------------------------------------------------------------------
*/

const sendPaidOrderEmails = async (order) => {
  try {
    const populatedOrder = await Order.findById(order._id)
      .populate('customer', 'name email phone')
      .populate('items.product', 'name slug price images stock');

    if (!populatedOrder) return;

    const email = populatedOrder.customerEmail || populatedOrder.customerDetails?.email || populatedOrder.customer?.email;
    if (email) {
      const emailResult = await sendOrderConfirmationEmail({
        to: email,
        customerName: populatedOrder.customerName || populatedOrder.customerDetails?.fullName || populatedOrder.customer?.name || 'Customer',
        order: populatedOrder.toObject(),
        orderDate: new Date(populatedOrder.createdAt).toLocaleString('en-KE'),
      });
      if (!emailResult?.success) console.error('Customer payment confirmation email was not sent:', emailResult?.message || 'Unknown email error', { orderNumber: populatedOrder.orderNumber });
    } else {
      console.warn('Paid order has no customer email address; customer receipt was skipped.', { orderNumber: populatedOrder.orderNumber });
    }

    const operationsRecipients = [
      'sales@sylvatechnologies.co.ke',
      process.env.ORDERS_EMAIL || 'order@sylvatechnologies.co.ke',
      process.env.PAYMENT_EMAIL || 'payment@sylvatechnologies.co.ke',
    ];
    const uniqueRecipients = [...new Set(operationsRecipients.map((address) => String(address || '').trim().toLowerCase()).filter(Boolean))];
    const adminEmailResult = await sendAdminOrderNotificationEmail({
      to: uniqueRecipients,
      order: populatedOrder.toObject(),
      customer: {
        name: populatedOrder.customerName || populatedOrder.customerDetails?.fullName || 'Customer',
        email: populatedOrder.customerEmail || populatedOrder.customerDetails?.email || '',
        phone: populatedOrder.customerPhone || populatedOrder.customerDetails?.phone || populatedOrder.customer?.phone || '',
      },
    });
    if (!adminEmailResult?.success) console.error('Admin order/payment notification email was not sent:', adminEmailResult?.message || 'Unknown email error', { orderNumber: populatedOrder.orderNumber });
    await sendSellerOrderEmails(populatedOrder, 'payment');
  } catch (error) {
    console.error('Paid order email notification failed:', error.message);
  }
};

const escapeEmailHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const sendSellerOrderEmails = async (order, event = 'new_order', previousStatus = '') => {
  try {
    const populated = await Order.findById(order._id).populate({
      path: 'items.product',
      select: 'name seller',
      populate: { path: 'seller', select: 'name email sellerProfile.storeEmail sellerProfile.storeName sellerProfile.country' },
    });
    if (!populated) return;

    const eventCopy = {
      new_order: {
        subject: 'New customer order',
        heading: 'You have received a new order',
        message: 'A customer order includes products from your store.',
      },
      payment: {
        subject: 'Payment confirmed for order',
        heading: 'Customer payment confirmed',
        message: 'Payment for this order has been verified by Sylva Technologies.',
      },
      status: {
        subject: 'Order status update',
        heading: 'Your order status has changed',
        message: 'The order fulfillment status was updated from ' + (previousStatus || 'previous status') + ' to ' + (populated.status || 'Pending') + '.',
      },
      wallet_credit: {
        subject: 'Seller wallet settlement processed',
        heading: 'Seller wallet settlement processed',
        message: 'Delivery was confirmed and the seller settlement process has completed for this order.',
      },
    }[event] || {
      subject: 'Order update',
      heading: 'Order update',
      message: 'There is an update to this order.',
    };

    const groups = new Map();
    for (const item of populated.items || []) {
      const product = item.product;
      const seller = product?.seller;
      if (!seller?._id) continue;
      const sellerId = String(seller._id);
      if (!groups.has(sellerId)) groups.set(sellerId, { seller, items: [] });
      groups.get(sellerId).items.push(item);
    }

    const configuredCommission = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.04);
    const commissionRate = Number.isFinite(configuredCommission)
      ? Math.min(1, Math.max(0, configuredCommission > 1 ? configuredCommission / 100 : configuredCommission))
      : 0.04;

    for (const { seller, items } of groups.values()) {
      const recipient = String(seller.sellerProfile?.storeEmail || seller.email || '').trim();
      if (!recipient) {
        console.warn('[Seller order email] Seller has no email address:', { orderNumber: populated.orderNumber, sellerId: String(seller._id), event });
        continue;
      }

      const itemRows = items.map((item) => '<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb">' +
        escapeEmailHtml(item.name || item.product?.name || 'Product') + '</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:center">' +
        Number(item.quantity || 0) + '</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">KSh ' +
        Number(item.subtotal || 0).toLocaleString('en-KE') + '</td></tr>').join('');
      const details = populated.customerDetails || {};
      // Share only fulfillment details needed by this seller; never expose customer ID numbers.
      const addressLines = [
        details.fullName, details.phone, details.email,
        details.country, details.county, details.subCounty, details.ward,
        details.deliveryLocation, details.address, details.notes || populated.notes,
      ].filter(Boolean);
      const safeOrderNumber = escapeEmailHtml(populated.orderNumber);
      const safePaymentStatus = escapeEmailHtml(populated.paymentStatus || 'Pending');
      const safePaymentMethod = escapeEmailHtml(populated.paymentMethod || 'Not specified');
      const deliveryHtml = addressLines.map((line) => '<div style="padding:3px 0">' + escapeEmailHtml(line) + '</div>').join('');
      const sellerGross = roundMoney(items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
      const sellerCommission = roundMoney(sellerGross * commissionRate);
      const sellerNet = roundMoney(sellerGross - sellerCommission);
      const sellerCountry = String(seller.sellerProfile?.country || 'KE').toUpperCase();
      const netLabel = !['KE', 'KENYA'].includes(sellerCountry) && Number(process.env.WALLET_KES_PER_USD) > 0
        ? 'Estimated net after 4% commission: KSh ' + sellerNet.toLocaleString('en-KE') + ' before configured USD conversion.'
        : 'Estimated net after platform commission (' + (commissionRate * 100) + '%): KSh ' + sellerNet.toLocaleString('en-KE') + '.';
      const eventSubject = eventCopy.subject + ' ' + populated.orderNumber + ' — Sylva Technologies';
      const emailResult = await sendMail({
        to: recipient,
        sender: 'orders',
        subject: eventSubject,
        html: '<div style="font-family:Arial,sans-serif;color:#17211b;max-width:720px;margin:auto;padding:24px">' +
          '<h2 style="color:#166534">' + escapeEmailHtml(eventCopy.heading) + '</h2><p>Hello ' + escapeEmailHtml(seller.sellerProfile?.storeName || seller.name || 'Seller') +
          ', ' + escapeEmailHtml(eventCopy.message) + '</p><p><b>Order:</b> ' + safeOrderNumber + '<br><b>Order status:</b> ' +
          escapeEmailHtml(populated.status || 'Pending') + '<br><b>Payment status:</b> ' + safePaymentStatus + '<br><b>Payment method:</b> ' + safePaymentMethod + '</p>' +
          '<h3>Items in your store</h3><table style="border-collapse:collapse;width:100%"><thead><tr><th align="left" style="padding:9px;border-bottom:2px solid #ddd">Product</th><th style="padding:9px;border-bottom:2px solid #ddd">Qty</th><th align="right" style="padding:9px;border-bottom:2px solid #ddd">Item total</th></tr></thead><tbody>' +
          itemRows + '</tbody></table><p><b>Gross value of your items:</b> KSh ' + sellerGross.toLocaleString('en-KE') + '<br>' +
          '<b>Platform commission estimate:</b> KSh ' + sellerCommission.toLocaleString('en-KE') + '<br><b>' + escapeEmailHtml(netLabel) + '</b></p>' +
          '<h3>Customer delivery note</h3><div style="background:#f8faf8;border:1px solid #dce5dd;border-radius:8px;padding:14px">' +
          (deliveryHtml || 'No delivery information provided.') + '</div><p>Use the delivery details only to fulfil this order. Seller settlement follows the marketplace payment and delivery rules.</p>' +
          '<p><a href="https://www.sylvatechnologies.co.ke/seller/dashboard" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Open Seller Dashboard</a></p></div>',
        text: eventCopy.heading + '. ' + eventCopy.message + ' Order ' + populated.orderNumber +
          '. Status: ' + (populated.status || 'Pending') + '. Payment status: ' + (populated.paymentStatus || 'Pending') +
          '. Payment method: ' + (populated.paymentMethod || '') + '. Seller items gross: KSh ' + sellerGross +
          '. Estimated commission: KSh ' + sellerCommission + '. Estimated net: KSh ' + sellerNet +
          '. Customer delivery details: ' + addressLines.join(', ') +
          '. Review it at https://www.sylvatechnologies.co.ke/seller/dashboard',
      });
      if (!emailResult?.success) console.error('[Seller order email] Failed:', emailResult?.message || 'Unknown email error', { orderNumber: populated.orderNumber, sellerId: String(seller._id), event });
    }
  } catch (error) {
    console.error('[Seller order email] Notification failed:', error.message, { orderNumber: order?.orderNumber, event });
  }
};

const validateSuccessfulTransaction = (transaction, order) => {
  if (!transaction || transaction.status !== 'success') {
    throw new Error('Paystack has not confirmed a successful payment.');
  }

  if (String(transaction.reference || '') !== String(order.paymentReference || order.orderNumber)) {
    throw new Error('Payment reference does not match this order.');
  }

  const expectedMinorAmount = Math.round(Number(order.total || 0) * 100);
  if (Number(transaction.amount) !== expectedMinorAmount) {
    throw new Error('The verified payment amount does not match the order total.');
  }

  if (String(transaction.currency || '').toUpperCase() !== 'KES') {
    throw new Error('The verified payment currency does not match KES.');
  }
};

const confirmPaidOrder = async (order, transaction) => {
  validateSuccessfulTransaction(transaction, order);

  // A late Paystack success after cancellation must be refunded, not settled to a seller.
  if (order.status === 'Cancelled' && ['Refund Pending', 'Refund Processing', 'Refund Failed', 'Refunded'].includes(order.paymentStatus)) {
    return order;
  }

  if (order.status === 'Cancelled') {
    const refund = await refundTransaction({
      reference: order.paymentReference || order.orderNumber,
      amount: order.total,
      customerNote: 'Payment completed after the order was cancelled.',
    });
    if (!refund?.status) {
      throw new Error('Payment arrived after cancellation, but Paystack did not accept the automatic refund. Please contact support.');
    }
    order.paymentStatus = 'Refund Pending';
    order.paidAt = order.paidAt || new Date();
    order.refundReference = String(refund.data?.id || refund.data?.reference || '');
    await order.save();
    return order;
  }

  const wasAlreadyPaid = order.paymentStatus === 'Paid';
  let newlyConfirmed = false;
  if (!wasAlreadyPaid) {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: mongoose.trusted({ $ne: 'Paid' }), status: mongoose.trusted({ $ne: 'Cancelled' }) },
      {
        $set: {
          paymentStatus: 'Paid',
          paidAt: new Date(),
          cancellationDeadline: new Date(Date.now() + 5 * 60 * 1000),
          status: order.status === 'Pending' ? 'Confirmed' : order.status,
        },
      },
      { returnDocument: 'after' }
    );

    if (updated) {
      newlyConfirmed = true;
      order = updated;
    } else {
      order = await Order.findById(order._id);
      if (
        order &&
        order.status === 'Cancelled' &&
        !['Refund Pending', 'Refund Processing', 'Refund Failed', 'Refunded'].includes(order.paymentStatus)
      ) {
        return confirmPaidOrder(order, transaction);
      }
    }
  }

  // Seller funds remain unsettled until fulfillment reaches Delivered.
  if (newlyConfirmed && order.paymentStatus === 'Paid') {
    await sendPaidOrderEmails(order);
  }

  return order;
};

const restoreOrderStock = async (order) => {
  for (const item of order.items || []) {
    if (!item.product) continue;
    await Product.updateOne(
      { _id: item.product },
      { $inc: { stock: Number(item.quantity || 0) } }
    );
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL ORDERS - ADMIN
|--------------------------------------------------------------------------
*/

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    // One-time compatibility backfill: existing orders predate inbox review tracking.
    await Order.collection.updateMany(
      { adminReviewedAt: { $exists: false } },
      { $set: { adminReviewedAt: new Date() } }
    );

    const orders = await Order.find()
      .populate(
        'customer',
        'name email phone createdAt adminReviewedAt'
      )
      .populate({
        path: 'items.product',
        select: 'name slug price images stock seller',
        populate: { path: 'seller', select: 'name sellerProfile.storeName' },
      })
      .sort({ createdAt: -1 });

    const classifiedOrders = orders.map((order) => {
      const hasSellerItems = (order.items || []).some((item) => Boolean(item.product?.seller));
      return { ...order.toObject(), orderType: hasSellerItems ? 'marketplace' : 'platform' };
    });
    const requestedType = String(req.query.type || 'all').toLowerCase();
    const filteredOrders = ['marketplace', 'platform'].includes(requestedType)
      ? classifiedOrders.filter((order) => order.orderType === requestedType)
      : classifiedOrders;

    return res.json({
      success: true,
      data: filteredOrders,
      counts: {
        all: classifiedOrders.length,
        marketplace: classifiedOrders.filter((order) => order.orderType === 'marketplace').length,
        platform: classifiedOrders.filter((order) => order.orderType === 'platform').length,
      },
    });
  } catch (error) {
    console.error('Get all orders error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve orders.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| MARK ORDER AS REVIEWED BY ADMIN
|--------------------------------------------------------------------------
*/
router.patch('/:id/admin-review', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID.' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: { adminReviewedAt: new Date(), adminReviewedBy: req.user._id } },
      { returnDocument: 'after' }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    return res.json({ success: true, message: 'Order marked as reviewed.', data: order });
  } catch (error) {
    console.error('Mark order reviewed error:', error);
    return res.status(500).json({ success: false, message: 'Unable to mark this order as reviewed.' });
  }
});

/*
|--------------------------------------------------------------------------
| GET MY ORDERS - CUSTOMER
|--------------------------------------------------------------------------
*/

router.get('/my-orders', protect, async (req, res) => {
  try {
    const orders = await Order.find({
      customer: req.user._id,
    })
      .populate(
        'items.product',
        'name slug price images stock'
      )
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    console.error('Get my orders error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve your orders.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET SELLER ORDERS
|--------------------------------------------------------------------------
| Return only line items owned by the authenticated seller. Delivery details
| are provided so the seller can fulfil their own orders.
|--------------------------------------------------------------------------
*/
router.get('/seller/my-orders', protect, async (req, res) => {
  try {
    if (req.user?.role !== 'seller') {
      return res.status(403).json({ success: false, message: 'Seller access is required.' });
    }
    const sellerId = String(req.user._id);
    const sellerProducts = await Product.find({ seller: sellerId }).select('_id').lean();
    const sellerProductIds = sellerProducts.map((product) => product._id);
    if (!sellerProductIds.length) {
      return res.json({ success: true, data: [] });
    }
    const orders = await Order.find({ 'items.product': mongoose.trusted({ $in: sellerProductIds }) })
      .populate({
        path: 'items.product',
        select: 'name seller images',
        populate: { path: 'seller', select: '_id' },
      })
      .sort({ createdAt: -1 })
      .lean();

    
    const configuredCommission = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.04);
    const commissionRate = Number.isFinite(configuredCommission)
      ? Math.min(1, Math.max(0, configuredCommission > 1 ? configuredCommission / 100 : configuredCommission))
      : 0.04;
    const sellerAccount = await User.findById(sellerId)
      .select('sellerProfile.country wallet.transactions usdWallet.transactions')
      .lean();
    const sellerWalletTransactions = sellerAccount?.wallet?.transactions || [];
    const sellerUsdTransactions = sellerAccount?.usdWallet?.transactions || [];
    const settlementTransactions = new Map(
      [...sellerWalletTransactions, ...sellerUsdTransactions]
        .filter((transaction) => transaction?.reference)
        .map((transaction) => [String(transaction.reference), transaction])
    );
    const usdSettlementReferences = new Set(
      sellerUsdTransactions
        .filter((transaction) => transaction?.reference && transaction?.category === 'order_settlement')
        .map((transaction) => String(transaction.reference))
    );
    const sellerCountry = String(sellerAccount?.sellerProfile?.country || 'KE').toUpperCase();
    const internationalSeller = !['KE', 'KENYA'].includes(sellerCountry);
    const kesPerUsd = Number(process.env.WALLET_KES_PER_USD);
    const canConvertToUsd = Number.isFinite(kesPerUsd) && kesPerUsd > 0;
    const sellerOrders = [];
    for (const order of orders) {
      const sellerItems = (order.items || []).filter((item) =>
        item.product && item.product.seller && String(item.product.seller._id || item.product.seller) === sellerId
      ).map((item) => ({
        ...item,
        product: item.product ? { _id: item.product._id, name: item.product.name, images: item.product.images || [] } : null,
      }));
      if (!sellerItems.length) continue;
      const sellerGross = roundMoney(sellerItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
      const sellerCommission = roundMoney(sellerGross * commissionRate);
      const sellerNetBeforeConversion = roundMoney(sellerGross - sellerCommission);
      const sellerCurrency = internationalSeller ? 'USD' : 'KES';
      const sellerNet = internationalSeller
        ? (canConvertToUsd ? roundMoney(sellerNetBeforeConversion / kesPerUsd) : null)
        : sellerNetBeforeConversion;
      const settlementReference = 'order:' + String(order.orderNumber || '');
      const settlementTransaction = settlementTransactions.get(settlementReference);
      const settlementCredited = Boolean(
        settlementTransaction && settlementTransaction.category === 'order_settlement'
      );
      const sellerCreditedCurrency = usdSettlementReferences.has(settlementReference) ? 'USD' : 'KES';
      const safeDeliveryDetails = { ...(order.customerDetails || {}) };
      delete safeDeliveryDetails.idNumber;
      delete safeDeliveryDetails.customerReference;
      const settlementStatus = settlementCredited
        ? 'Credited to wallet'
        : String(order.paymentStatus || '').toLowerCase() !== 'paid'
          ? 'Awaiting payment'
          : internationalSeller && !canConvertToUsd
            ? 'Exchange rate configuration required'
            : 'Pending settlement';
      sellerOrders.push({
        ...order,
        customerDetails: safeDeliveryDetails,
        items: sellerItems,
        sellerGross,
        sellerGrossCurrency: 'KES',
        sellerCommission,
        sellerCommissionCurrency: 'KES',
        sellerNet,
        sellerNetBeforeConversion,
        sellerCurrency,
        sellerSettlementStatus: settlementStatus,
        sellerCreditedAmount: settlementCredited ? roundMoney(settlementTransaction.amount || 0) : null,
        sellerCreditedCurrency: settlementCredited ? sellerCreditedCurrency : null,
      });
    }
    return res.json({ success: true, data: sellerOrders });
  } catch (error) {
    console.error('Get seller orders error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to retrieve seller orders.' });
  }
});

/*
|--------------------------------------------------------------------------
| CUSTOMER CONFIRMS DELIVERY (EMAIL LINK)
|--------------------------------------------------------------------------
| The link is a high-entropy bearer token. Opening the page is read-only;
| this POST is the explicit customer confirmation action.
|--------------------------------------------------------------------------
*/
router.get('/delivery-confirmation/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (token.length < 40 || token.length > 200) {
      return res.status(400).json({ success: false, message: 'This delivery confirmation link is invalid.' });
    }
    const order = await Order.findOne({ deliveryConfirmationTokenHash: hashDeliveryToken(token) })
      .select('+deliveryConfirmationTokenHash')
      .select('orderNumber status paymentStatus deliveryConfirmationExpiresAt deliveryConfirmedAt customer customerName customerDetails items');
    if (!order) {
      return res.status(404).json({ success: false, message: 'This delivery confirmation link is invalid or has already been used.' });
    }
    if (!order.deliveryConfirmationExpiresAt || order.deliveryConfirmationExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: 'This delivery confirmation link has expired.' });
    }
    if (!['Shipped', 'Delivered'].includes(order.status) || order.paymentStatus !== 'Paid') {
      return res.status(409).json({ success: false, message: 'This order is not eligible for delivery confirmation yet.' });
    }
    const details = order.customerDetails || {};
    const productIds = [...new Set((order.items || []).map((item) => item?.product ? String(item.product._id || item.product) : '').filter(Boolean))];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds } }).select('_id seller name').populate('seller', '_id name sellerProfile.storeName').lean()
      : [];
    const sellerByProduct = new Map(products.map((product) => [String(product._id), product.seller || null]));
    const storeMap = new Map();
    (order.items || []).forEach((item) => {
      const productId = item?.product ? String(item.product._id || item.product) : '';
      const seller = sellerByProduct.get(productId);
      const storeId = seller?._id ? String(seller._id) : 'SYLVA-PLATFORM';
      const storeName = seller ? String(seller.sellerProfile?.storeName || seller.name || 'Marketplace Seller').trim() : 'Sylva Technologies';
      if (!storeMap.has(storeId)) storeMap.set(storeId, { storeName, storeId, items: [] });
      storeMap.get(storeId).items.push({ name: item.name, quantity: item.quantity });
    });
    const stores = [...storeMap.values()];
    return res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        alreadyConfirmed: Boolean(order.deliveryConfirmedAt),
        customerId: order.customer ? String(order.customer) : (details.customerReference || 'CUSTOMER'),
        stores,
        items: (order.items || []).map((item) => {
          const productId = item?.product ? String(item.product._id || item.product) : '';
          const seller = sellerByProduct.get(productId);
          return {
            name: item.name,
            quantity: item.quantity,
            subtotal: item.subtotal,
            storeName: seller ? String(seller.sellerProfile?.storeName || seller.name || 'Marketplace Seller').trim() : 'Sylva Technologies',
          };
        }),
        deliveryNote: {
          recipient: details.fullName || order.customerName || '',
          phone: details.phone || '',
          country: details.country || 'Kenya',
          county: details.county || '',
          subCounty: details.subCounty || '',
          ward: details.ward || '',
          deliveryLocation: details.deliveryLocation || '',
          address: details.address || '',
          notes: details.notes || '',
        },
      },
    });
  } catch (error) {
    console.error('[Delivery confirmation] preview failed:', error.stack || error.message);
    return res.status(500).json({ success: false, message: 'Unable to load the delivery note right now.' });
  }
});

router.post('/confirm-delivery', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const signature = String(req.body?.signature || '').trim();
    const signatureImage = String(req.body?.signatureImage || '').trim();
    const idNumber = String(req.body?.idNumber || '').trim();
    const acknowledged = req.body?.acknowledged === true;
    const validSignatureImage = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signatureImage) && signatureImage.length <= 240000;
    if (token.length < 40 || token.length > 200 || !signature || signature.length > 120 || !idNumber || idNumber.length > 50 || !validSignatureImage || !acknowledged) {
      return res.status(400).json({ success: false, message: 'Enter your full name and ID number, sign in the signature box, and confirm receipt of the product and delivery note.' });
    }
    const tokenHash = hashDeliveryToken(token);
    const order = await Order.findOne({ deliveryConfirmationTokenHash: tokenHash }).select('+deliveryConfirmationTokenHash');
    if (!order) {
      return res.status(400).json({ success: false, message: 'This delivery confirmation link is invalid or has already been used. Contact support if you need help.' });
    }
    if (!order.deliveryConfirmationExpiresAt || order.deliveryConfirmationExpiresAt.getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: 'This delivery confirmation link has expired. Please contact Sylva Support.' });
    }
    if (!['Shipped', 'Delivered'].includes(order.status)) {
      return res.status(409).json({ success: false, message: 'This order has not been marked as shipped yet.' });
    }
    if (order.paymentStatus !== 'Paid') {
      return res.status(409).json({ success: false, message: 'Payment must be verified before seller funds can be released. Contact support if you paid on delivery.' });
    }
    if (!order.deliveryConfirmedAt) {
      order.deliveryConfirmedAt = new Date();
      order.deliveryConfirmationSignature = signature;
      order.deliveryConfirmationSignatureImage = signatureImage;
      order.customerDetails = { ...(order.customerDetails?.toObject?.() || order.customerDetails || {}), idNumber };
      order.deliveryConfirmationIp = String(req.ip || '').slice(0, 100);
      order.deliveryConfirmationUserAgent = String(req.get('user-agent') || '').slice(0, 500);
      order.status = 'Delivered';
      await order.save();
    }

    const settlementResult = await applySellerSettlement(order);
    if (!settlementResult.settled) {
      return res.status(409).json({ success: false, message: 'Receipt was recorded, but seller settlement is not yet complete. Please retry shortly or contact support; the link remains available for retry.' });
    }
    await sendSellerOrderEmails(order, 'wallet_credit');
    const commissionResult = await recordPlatformCommissionForSettlements(order);
    order.sellerSettledAt = new Date();
    if (commissionResult.recorded || commissionResult.recorded === 0) order.platformCommissionRecordedAt = new Date();
    order.deliveryConfirmationTokenHash = '';
    order.deliveryConfirmationExpiresAt = null;
    await order.save();

    const customerEmail = order.customerEmail || order.customerDetails?.email;
    if (customerEmail) {
      const statusEmail = await sendOrderStatusUpdateEmail({
        to: customerEmail,
        customerName: order.customerName || order.customerDetails?.fullName || 'Customer',
        orderNumber: order.orderNumber,
        status: 'Delivered',
      });
      if (!statusEmail?.success) console.error('[Delivery confirmation] receipt email failed:', statusEmail?.message || 'Unknown email error', { orderNumber: order.orderNumber });
    }
    return res.json({
      success: true,
      message: 'Delivery confirmed. Seller earnings have been credited to the seller wallet and Sylva commission has been recorded.',
      data: { orderNumber: order.orderNumber, status: order.status, deliveryConfirmedAt: order.deliveryConfirmedAt, settlementComplete: true },
    });
  } catch (error) {
    console.error('[Delivery confirmation] failed:', error.stack || error.message);
    return res.status(500).json({ success: false, message: 'Unable to complete delivery confirmation right now. Please retry using the email link.' });
  }
});

/*
|--------------------------------------------------------------------------
| GET SINGLE ORDER
|--------------------------------------------------------------------------
*/

router.get('/:id', protect, async (req, res) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID.',
      });
    }

    const order = await Order.findById(req.params.id)
      .populate(
        'customer',
        'name email phone'
      )
      .populate(
        'items.product',
        'name slug price images stock'
      );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    const isAdmin =
      req.user.role === 'admin';

    const isOwner =
      order.customer &&
      order.customer._id.toString() ===
        req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message:
          'You are not authorized to view this order.',
      });
    }

    return res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error(
      'Get single order error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve the order.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| CREATE ORDER
|--------------------------------------------------------------------------
|
| The backend calculates:
|
|   item subtotal = database product price × quantity
|   order subtotal = sum of item subtotals
|   total = order subtotal + delivery fee
|
| The frontend does NOT control the final order total.
|
|--------------------------------------------------------------------------
*/

const createOrderFromRequest = async ({
  req,
  res,
  user,
  requireVerification = false,
}) => {
  try {
    const {
      items,
      deliveryFee = 0,
      customerDetails,
      mpesaPhone = '',
      paymentMethod = 'Cash on Delivery',
      paymentReference = '',
      notes = '',
    } = req.body;

    /*
    |--------------------------------------------------------------------------
    | BASIC VALIDATION
    |--------------------------------------------------------------------------
    */

    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Your order must contain at least one product.',
      });
    }

    if (!['Paystack', 'Card', 'M-Pesa', 'Wallet'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Choose Wallet, M-Pesa, Paystack, or Visa/Mastercard to pay for your order.',
      });
    }

    if (!customerDetails?.fullName) {
      return res.status(400).json({
        success: false,
        message:
          'Customer name is required.',
      });
    }

    if (!customerDetails?.phone) {
      return res.status(400).json({
        success: false,
        message:
          'Customer phone number is required.',
      });
    }

    if (user && !String(user.idNumber || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'A government ID number is required for delivery records. Please contact support to update your existing account before ordering.',
      });
    }

    if (!customerDetails?.deliveryLocation) {
      return res.status(400).json({
        success: false,
        message:
          'Delivery location is required.',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFIED ACCOUNT CHECK
    |--------------------------------------------------------------------------
    */

    if (
      requireVerification &&
      user &&
      !user.isVerified
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Verification required. Please verify your account before continuing.',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | DELIVERY FEE
    |--------------------------------------------------------------------------
    */

    // Always calculate shipping on the server. Never trust a fee supplied by the browser.
    let shippingQuote;
    try {
      shippingQuote = await getShippingQuote(customerDetails);
    } catch (shippingError) {
      return res.status(422).json({
        success: false,
        message: shippingError.message || 'Unable to calculate shipping for this location.',
      });
    }
    const normalizedDeliveryFee = Number(shippingQuote.fee);

    /*
    |--------------------------------------------------------------------------
    | PREPARE ORDER ITEMS
    |--------------------------------------------------------------------------
    */

    const preparedItems = [];

    for (const item of items) {
      /*
      |--------------------------------------------------------------------------
      | VALIDATE PRODUCT ID
      |--------------------------------------------------------------------------
      */

      if (
        !item.product ||
        !mongoose.Types.ObjectId.isValid(
          item.product
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'One of the products in the order is invalid.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | VALIDATE QUANTITY
      |--------------------------------------------------------------------------
      */

      const quantity = Number(
        item.quantity
      );

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Product quantity must be a positive whole number.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | FETCH PRODUCT FROM DATABASE
      |--------------------------------------------------------------------------
      */

      const product =
        await Product.findById(
          item.product
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            'One of the selected products no longer exists.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK PRODUCT STATUS
      |--------------------------------------------------------------------------
      */

      if (product.isActive === false) {
        return res.status(400).json({
          success: false,
          message:
            `${product.name} is currently unavailable.`,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CHECK STOCK
      |--------------------------------------------------------------------------
      */

      if (
        Number(product.stock || 0) <
        quantity
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Insufficient stock for ${product.name}.`,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | USE DATABASE PRICE
      |--------------------------------------------------------------------------
      */

      const unitPrice = Number(
        product.price || 0
      );

      if (
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Invalid price configured for ${product.name}.`,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CALCULATE ITEM SUBTOTAL
      |--------------------------------------------------------------------------
      */

      const subtotal = roundMoney(
        unitPrice * quantity
      );

      preparedItems.push({
        product: product._id,
        name: product.name,
        quantity,
        unitPrice,
        subtotal,
        image:
          Array.isArray(product.images) &&
          product.images.length > 0
            ? product.images[0]
            : '',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CALCULATE ORDER SUBTOTAL
    |--------------------------------------------------------------------------
    */

    const orderSubtotal = roundMoney(
      preparedItems.reduce(
        (sum, item) =>
          sum +
          Number(item.subtotal || 0),
        0
      )
    );

    /*
    |--------------------------------------------------------------------------
    | CALCULATE FINAL ORDER TOTAL
    |--------------------------------------------------------------------------
    */

    const orderTotal = roundMoney(
      orderSubtotal +
        normalizedDeliveryFee
    );

    /*
    |--------------------------------------------------------------------------
    | GENERATE ORDER NUMBER
    |--------------------------------------------------------------------------
    */

    const today = new Date();

const datePart =
  `${today.getFullYear()}` +
  `${String(today.getMonth() + 1).padStart(2, '0')}` +
  `${String(today.getDate()).padStart(2, '0')}`;

// Generate a unique order number without querying createdAt.
// This avoids date-range casting issues and remains unique even
// when multiple customers place orders at nearly the same time.
const uniquePart = `${Date.now()}${Math.floor(
  Math.random() * 1000
)}`.slice(-7);

const orderNumber = `ST-${datePart}-${uniquePart}`;

    /*
    |--------------------------------------------------------------------------
    | CUSTOMER EMAIL
    |--------------------------------------------------------------------------
    */

    const customerEmail =
      customerDetails.email ||
      user?.email ||
      '';

    /*
    |--------------------------------------------------------------------------
    | CREATE ORDER
    |--------------------------------------------------------------------------
    */

    const deliveryDetails = {
      ...customerDetails,
      idNumber: String(user?.idNumber || '').trim(),
      customerReference: user?._id
        ? `CUS-${String(user._id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`
        : '',
    };

    const order = await Order.create({
      orderNumber,
      trackingCode: orderNumber,

      customer:
        user?._id || null,

      customerName:
        customerDetails.fullName,

      customerEmail,

      customerPhone:
        customerDetails.phone,

      // Save the number used for STK separately from the delivery contact number.
      mpesaPhone: String(mpesaPhone || customerDetails.mpesaPhone || customerDetails.phone || '').trim(),

      items: preparedItems,

      /*
      |--------------------------------------------------------------------------
      | IMPORTANT:
      | These values are calculated by the backend.
      |--------------------------------------------------------------------------
      */

      subtotal: orderSubtotal,

      deliveryFee:
        normalizedDeliveryFee,

      total: orderTotal,

      customerDetails: deliveryDetails,

      paymentMethod,

      paymentReference,

      paymentStatus: 'Pending',

      status: 'Pending',

      notes,
    });

    /*
    |--------------------------------------------------------------------------
    | DEDUCT STOCK
    |--------------------------------------------------------------------------
    */

    const successfullyDeducted = [];

    // Use a MongoDB transaction to atomically decrement stock for all items.
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      for (const item of preparedItems) {
        const stockUpdate = await Product.updateOne(
          {
            _id: item.product,
            stock: mongoose.trusted({ $gte: item.quantity }),
          },
          {
            $inc: { stock: -item.quantity },
          },
          { session }
        );

        if (!stockUpdate || stockUpdate.modifiedCount !== 1) {
          throw new Error(`Insufficient stock for product ${item.product}`);
        }
      }

      if (paymentMethod === 'Wallet') {
        if (!user?._id) throw new Error('Please sign in to pay with your Sylva Wallet.');
        const walletReference = `order:${orderNumber}`;
        const walletDebit = await User.updateOne(
          { _id: user._id, 'wallet.availableBalance': mongoose.trusted({ $gte: orderTotal }), 'wallet.transactions.reference': mongoose.trusted({ $ne: walletReference }) },
          {
            $inc: { 'wallet.availableBalance': -orderTotal },
            $set: { 'wallet.lastUpdatedAt': new Date() },
            $push: { 'wallet.transactions': {
              type: 'debit', amount: orderTotal, category: 'order_payment', status: 'completed',
              description: `Wallet payment for order ${orderNumber}.`, reference: walletReference,
              relatedOrder: order._id, createdAt: new Date(), updatedAt: new Date(),
            } },
          },
          { session }
        );
        if (walletDebit.modifiedCount !== 1) {
          throw new Error('Insufficient wallet balance. Please top up your wallet or choose another payment method.');
        }
        await Order.updateOne(
          { _id: order._id, paymentStatus: 'Pending' },
          { $set: { paymentStatus: 'Paid', paidAt: new Date(), status: 'Confirmed' } },
          { session }
        );
      }

      // Commit stock and wallet changes together so a failed checkout cannot debit twice.
      await session.commitTransaction();
      session.endSession();
    } catch (stockError) {
      // Abort transaction and roll back
      try {
        await session.abortTransaction();
      } catch (e) {
        /* ignore */
      }

      session.endSession();

      // Remove the created order since inventory update failed
      await Order.findByIdAndDelete(order._id);

      return res.status(400).json({
        success: false,
        message: String(stockError.message || '').includes('Insufficient wallet balance') || String(stockError.message || '').includes('pay with your Sylva Wallet')
          ? stockError.message
          : 'The order could not be completed because stock changed. Please try again.',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | POPULATE CREATED ORDER
    |--------------------------------------------------------------------------
    */

    const populatedOrder =
      await Order.findById(order._id)
        .populate(
          'customer',
          'name email phone'
        )
        .populate(
          'items.product',
          'name slug price images stock'
        );

        /*
|--------------------------------------------------------------------------
| INITIALIZE PAYSTACK PAYMENT
|--------------------------------------------------------------------------
*/

let paystackPayment = null;
let mpesaPayment = null;

if (paymentMethod === 'M-Pesa') {
  try {
    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = String(process.env.MPESA_SHORTCODE || '').trim();
    const passkey = process.env.MPESA_PASSKEY;
    const tillNumber = String(process.env.MPESA_TILL_NUMBER || '').trim();
    const transactionType = String(
      process.env.MPESA_TRANSACTION_TYPE ||
      (tillNumber ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline')
    ).trim();
    if (!['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(transactionType)) {
      throw new Error('MPESA_TRANSACTION_TYPE must be CustomerPayBillOnline or CustomerBuyGoodsOnline.');
    }
    if (transactionType === 'CustomerBuyGoodsOnline' && !/^\d{5,10}$/.test(tillNumber)) {
      throw new Error('M-Pesa Till configuration is incomplete. Set MPESA_TILL_NUMBER to the approved Buy Goods Till number.');
    }
    const partyB = transactionType === 'CustomerBuyGoodsOnline' ? tillNumber : shortcode;
    const host = getMpesaHost();
    const callbackUrl = process.env.MPESA_ORDER_CALLBACK_URL ||
      'https://sylva-technologies-backend.onrender.com/api/orders/mpesa/callback';
    const phoneInput = String(mpesaPhone || customerDetails.mpesaPhone || customerDetails.phone || '').replace(/[\s()+-]/g, '');
    const phone = phoneInput.startsWith('0') ? '254' + phoneInput.slice(1)
      : phoneInput.startsWith('7') || phoneInput.startsWith('1') ? '254' + phoneInput
      : phoneInput;
    if (!key || !secret || !shortcode || !passkey) {
      throw new Error('M-Pesa production credentials are not fully configured.');
    }
    if (!/^254(?:7|1)\d{8}$/.test(phone)) {
      throw new Error('Enter a valid Kenyan M-Pesa phone number, e.g. 07XXXXXXXX.');
    }
    if (!String(callbackUrl).startsWith('https://')) {
      throw new Error('The M-Pesa order callback URL must use HTTPS.');
    }
    const rawTotal = Number(orderTotal);
    const amount = Math.round(rawTotal);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 150000 || rawTotal !== amount) {
      throw new Error('M-Pesa checkout requires a whole-KSh order total between KSh 1 and KSh 150,000.');
    }
    const auth = Buffer.from(key + ':' + secret).toString('base64');
    const tokenResponse = await axios.get(
      host + '/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: 'Basic ' + auth }, timeout: 15000 }
    );
    const token = tokenResponse.data?.access_token;
    if (!token) throw new Error('Safaricom did not return an access token.');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const timestamp = values.year + values.month + values.day + values.hour + values.minute + values.second;
    const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
    const stkResponse = await axios.post(host + '/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: amount,
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: String(order.orderNumber).slice(0, 12),
      TransactionDesc: 'Sylva order ' + order.orderNumber,
    }, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    if (String(stkResponse.data?.ResponseCode) !== '0' || !stkResponse.data?.CheckoutRequestID) {
      throw new Error(stkResponse.data?.ResponseDescription || 'Safaricom did not accept the M-Pesa request.');
    }
    order.paymentReference = 'MPESA_STK:' + stkResponse.data.CheckoutRequestID;
    order.mpesaCheckoutRequestId = stkResponse.data.CheckoutRequestID;
    await order.save();
    mpesaPayment = {
      checkoutRequestId: stkResponse.data.CheckoutRequestID,
      customerMessage: stkResponse.data.CustomerMessage || 'Check your phone and enter your M-Pesa PIN to complete payment.',
      amount,
      phone: '+' + phone,
      orderNumber: order.orderNumber,
    };
  } catch (mpesaError) {
    console.error('M-Pesa order payment initialization failed:', mpesaError.response?.data || mpesaError.message);
    try {
      for (const item of preparedItems) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } });
      }
      await Order.findByIdAndDelete(order._id);
    } catch (rollbackError) {
      console.error('M-Pesa order rollback error:', rollbackError.message);
    }
    return res.status(502).json({
      success: false,
      message: mpesaError.message || 'Unable to start M-Pesa payment. Please try again.',
    });
  }
}

if (['Paystack', 'Card'].includes(paymentMethod)) {
  try {
    const paystackReference = order.orderNumber;

    const frontendBaseUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://www.sylvatechnologies.co.ke'
        : 'http://localhost:5173')
    )
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');

    const callbackUrl =
      `${frontendBaseUrl}/payment/callback?reference=${encodeURIComponent(
        paystackReference
      )}`;

    const paystackResponse =
      await initializeTransaction({
        email: customerEmail,
        amount: orderTotal,
        reference: paystackReference,
        callbackUrl,
        channels: paymentMethod === 'Card' ? ['card'] : undefined,
        metadata: {
          paymentMethod,
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          trackingCode:
            order.trackingCode ||
            order.orderNumber,
          customerName:
            customerDetails.fullName,
          customerPhone:
            customerDetails.phone,
        },
      });

    if (
      !paystackResponse ||
      !paystackResponse.status ||
      !paystackResponse.data?.authorization_url
    ) {
      throw new Error(
        paystackResponse?.message ||
          'Paystack did not return a payment authorization URL.'
      );
    }

    order.paymentReference =
      paystackResponse.data.reference ||
      paystackReference;

    await order.save();

    populatedOrder.paymentReference =
      order.paymentReference;

    paystackPayment = {
      authorization_url:
        paystackResponse.data.authorization_url,

      access_code:
        paystackResponse.data.access_code,

      reference:
        paystackResponse.data.reference ||
        paystackReference,
    };

    console.info(
      'Paystack payment initialized:',
      order.orderNumber
    );
  } catch (paystackError) {
    console.error(
      'Paystack initialization error:',
      paystackError.response?.data ||
        paystackError.message
    );

    /*
    |--------------------------------------------------------------------------
    | RESTORE STOCK IF PAYSTACK INITIALIZATION FAILS
    |--------------------------------------------------------------------------
    */

    try {
      for (const item of preparedItems) {
        await Product.updateOne(
          { _id: item.product },
          {
            $inc: {
              stock: item.quantity,
            },
          }
        );
      }

      await Order.findByIdAndDelete(order._id);
    } catch (rollbackError) {
      console.error(
        'Paystack rollback error:',
        rollbackError
      );
    }

    return res.status(502).json({
      success: false,
      message:
        'Unable to initialize Paystack payment. Please try again.',
    });
  }
}

    // Notify the sales inbox as soon as an order has been successfully created.
    // This event is separate from the later payment-confirmed notification.
    try {
      const orderItemsText = (populatedOrder.items || []).map((item) =>
        (item.name || item.product?.name || 'Product') + ' x ' + Number(item.quantity || 1)
      ).join(', ');
      const safeOrderNumber = String(order.orderNumber).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeCustomerName = String(customerDetails.fullName || 'Customer').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeCustomerEmail = String(customerEmail || 'Not provided').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeCustomerPhone = String(customerDetails.phone || 'Not provided').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeDelivery = String(customerDetails.deliveryLocation || customerDetails.address || 'Not provided').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeItems = String(orderItemsText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePaymentMethod = String(paymentMethod).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePaymentStatus = String(populatedOrder.paymentStatus || 'Pending').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const adminUrl = 'https://www.sylvatechnologies.co.ke/admin';
      const notification = await sendSalesNotificationEmail({
        subject: 'New order placed: ' + order.orderNumber,
        html: '<div style="font-family:Arial,sans-serif;color:#17211b;max-width:680px;margin:auto;padding:24px">' +
          '<h2 style="color:#166534">New order placed</h2><p>A customer has placed an order on Sylva Technologies.</p>' +
          '<table style="border-collapse:collapse;width:100%">' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Order number</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeOrderNumber + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Customer</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeCustomerName + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Email</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeCustomerEmail + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Phone</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeCustomerPhone + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Items</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeItems + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Total</b></td><td style="padding:8px;border-bottom:1px solid #ddd">KSh ' + Number(order.total || 0).toLocaleString('en-KE') + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Payment method</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safePaymentMethod + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Payment status</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safePaymentStatus + '</td></tr>' +
          '<tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Delivery location</b></td><td style="padding:8px;border-bottom:1px solid #ddd">' + safeDelivery + '</td></tr>' +
          '</table><p><a href="' + adminUrl + '" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Open admin dashboard</a></p></div>',
        text: 'New order placed: ' + order.orderNumber + '. Customer: ' + customerDetails.fullName +
          '; email: ' + customerEmail + '; phone: ' + customerDetails.phone + '; items: ' + orderItemsText +
          '; total: KSh ' + order.total + '; payment method: ' + paymentMethod +
          '; payment status: ' + populatedOrder.paymentStatus + '; delivery location: ' + (customerDetails.deliveryLocation || customerDetails.address || 'Not provided') +
          '. Admin dashboard: ' + adminUrl,
      });
      if (!notification?.success) {
        console.error('[Sales email] new order notification failed:', notification?.message || 'Unknown email error', { orderNumber: order.orderNumber });
      } else {
        console.info('[Sales email] new order notification sent', { orderNumber: order.orderNumber, messageId: notification.messageId });
      }
    } catch (notificationError) {
      console.error('[Sales email] new order notification threw an error:', notificationError.message, { orderNumber: order.orderNumber });
    }

    // Notify every seller whose product is included in this order, independently of payment method.
    await sendSellerOrderEmails(populatedOrder);

    // Wallet orders are already paid inside the order transaction. Send the paid
    // receipt and payment alert here; Paystack and M-Pesa notify from verification callbacks.
    if (paymentMethod === 'Wallet' && populatedOrder.paymentStatus === 'Paid') {
      await sendPaidOrderEmails(populatedOrder);
    }

    /*
    |--------------------------------------------------------------------------
    | SUCCESS
    |--------------------------------------------------------------------------
    */

 return res.status(201).json({
  success: true,
  message: paymentMethod === 'Card'
    ? 'Order created. Continue to Paystack to pay securely with Visa or Mastercard.'
    : paymentMethod === 'Paystack'
      ? 'Order created. Continue to Paystack to complete your payment.'
      : 'M-Pesa prompt sent. Enter your PIN on your phone; the order will be confirmed after Safaricom verifies payment.',
  data: populatedOrder,
  payment: paystackPayment,
  mpesaPayment,
});

  } catch (error) {
    console.error(
      'Create order error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to create the order.',
    });
  }
};

/*
|--------------------------------------------------------------------------
| CREATE GUEST ORDER
|--------------------------------------------------------------------------
*/

router.post('/guest', async (req, res) => {
  return createOrderFromRequest({
    req,
    res,
    user: null,
    requireVerification: false,
  });
});

/*
|--------------------------------------------------------------------------
| CREATE AUTHENTICATED ORDER
|--------------------------------------------------------------------------
*/

router.post(
  '/',
  protect,
  requireVerified,
  async (req, res) => {
    return createOrderFromRequest({
      req,
      res,
      user: req.user,
      requireVerification: true,
    });
  }
);


/*
|--------------------------------------------------------------------------
| M-PESA ORDER CALLBACK AND STATUS
|--------------------------------------------------------------------------
*/
router.post('/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    const checkoutRequestId = String(callback?.CheckoutRequestID || '');
    if (!checkoutRequestId) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });

    const order = await Order.findOne({
      paymentMethod: 'M-Pesa',
      $or: [
        { mpesaCheckoutRequestId: checkoutRequestId },
        { paymentReference: 'MPESA_STK:' + checkoutRequestId },
      ],
    });
    if (!order) return res.json({ ResultCode: 0, ResultDesc: 'Callback received.' });
    if (order.paymentStatus === 'Failed') {
      return res.json({ ResultCode: 0, ResultDesc: 'Callback already processed.' });
    }
    // A status check may have already confirmed payment. Still accept a later
    // successful callback so the official Safaricom receipt can be recorded.
    if (order.paymentStatus === 'Paid' && Number(callback.ResultCode) !== 0) {
      return res.json({ ResultCode: 0, ResultDesc: 'Payment already confirmed.' });
    }
    if (Number(callback.ResultCode) !== 0) {
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'Pending' },
        { $set: { paymentStatus: 'Failed' } },
        { returnDocument: 'after' }
      );
      if (updated) await restoreOrderStock(updated);
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received.' });
    }

    const key = process.env.MPESA_CONSUMER_KEY;
    const secret = process.env.MPESA_CONSUMER_SECRET;
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    if (!key || !secret || !shortcode || !passkey) {
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payment verification is not configured.' });
    }
    const host = getMpesaHost();
    const auth = Buffer.from(key + ':' + secret).toString('base64');
    const tokenResponse = await axios.get(
      host + '/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: 'Basic ' + auth }, timeout: 15000 }
    );
    const token = tokenResponse.data?.access_token;
    if (!token) return res.status(503).json({ ResultCode: 1, ResultDesc: 'Unable to verify payment.' });

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const timestamp = values.year + values.month + values.day + values.hour + values.minute + values.second;
    const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
    const verification = await axios.post(host + '/mpesa/stkpushquery/v1/query', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (String(verification.data?.ResultCode) !== '0') {
      return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payment is not yet confirmed.' });
    }

    const items = callback.CallbackMetadata?.Item || [];
    const field = (name) => items.find((item) => item.Name === name)?.Value;
    const amount = Number(field('Amount'));
    const receipt = String(field('MpesaReceiptNumber') || '');
    const phone = String(field('PhoneNumber') || '');
    const expectedAmount = Math.round(Number(order.total || 0));
        const storedPhone = String(order.mpesaPhone || order.customerDetails?.mpesaPhone || order.customerDetails?.phone || order.customerPhone || '').replace(/[\s()+-]/g, '');
    const expectedPhone = storedPhone.startsWith('0') ? '254' + storedPhone.slice(1)
      : storedPhone.startsWith('7') || storedPhone.startsWith('1') ? '254' + storedPhone
      : storedPhone;
    if (!receipt || amount !== expectedAmount || !/^254(?:7|1)\d{8}$/.test(phone) || phone !== expectedPhone) {
      console.error('M-Pesa order callback validation failed:', order.orderNumber);
      return res.json({ ResultCode: 0, ResultDesc: 'Callback received for review.' });
    }
    const duplicate = await Order.exists({
      _id: { $ne: order._id },
      paymentMethod: 'M-Pesa',
      paymentReference: receipt,
      paymentStatus: 'Paid',
    });
    if (duplicate) return res.json({ ResultCode: 0, ResultDesc: 'Receipt already used.' });

    if (order.paymentStatus === 'Paid') {
      await Order.updateOne(
        { _id: order._id, paymentStatus: 'Paid' },
        { $set: { mpesaReceiptNumber: receipt, paymentReference: receipt } }
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Payment receipt recorded.' });
    }
    const paidOrder = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: 'Pending', status: mongoose.trusted({ $ne: 'Cancelled' }) },
      {
        $set: {
          paymentStatus: 'Paid',
          paidAt: new Date(),
          cancellationDeadline: new Date(Date.now() + 5 * 60 * 1000),
          status: order.status === 'Pending' ? 'Confirmed' : order.status,
          paymentReference: receipt,
          mpesaReceiptNumber: receipt,
        },
      },
      { returnDocument: 'after' }
    );
    if (paidOrder) await sendPaidOrderEmails(paidOrder);
    return res.json({ ResultCode: 0, ResultDesc: paidOrder ? 'Payment confirmed.' : 'Callback already processed.' });
  } catch (error) {
    console.error('M-Pesa order callback failed:', error.response?.data || error.message);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Callback processing failed.' });
  }
});

router.get('/mpesa/status/:orderNumber', protect, async (req, res) => {
  try {
    let order = await Order.findOne({
      orderNumber: req.params.orderNumber,
      customer: req.user._id,
      paymentMethod: 'M-Pesa',
    }).select('orderNumber trackingCode paymentStatus status total paymentMethod paymentReference mpesaCheckoutRequestId mpesaReceiptNumber paidAt createdAt items subtotal deliveryFee customerName customerEmail customerPhone customerDetails mpesaPhone');

    if (!order) return res.status(404).json({ success: false, message: 'M-Pesa order not found.' });

    // Safaricom callbacks can be delayed or missed. Reconcile pending orders
    // directly against Safaricom's STK query API before returning Pending.
    if (order.paymentStatus === 'Pending' && order.status !== 'Cancelled') {
      const checkoutRequestId = String(
        order.mpesaCheckoutRequestId ||
        String(order.paymentReference || '').replace(/^MPESA_STK:/, '')
      );
      const key = process.env.MPESA_CONSUMER_KEY;
      const secret = process.env.MPESA_CONSUMER_SECRET;
      const shortcode = String(process.env.MPESA_SHORTCODE || '').trim();
      const passkey = process.env.MPESA_PASSKEY;

      if (checkoutRequestId && checkoutRequestId !== order.paymentReference && key && secret && shortcode && passkey) {
        const host = getMpesaHost();
        const auth = Buffer.from(key + ':' + secret).toString('base64');
        const tokenResponse = await axios.get(
          host + '/oauth/v1/generate?grant_type=client_credentials',
          { headers: { Authorization: 'Basic ' + auth }, timeout: 12000 }
        );
        const token = tokenResponse.data?.access_token;
        if (token) {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
          }).formatToParts(new Date());
          const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
          const timestamp = values.year + values.month + values.day + values.hour + values.minute + values.second;
          const password = Buffer.from(String(shortcode) + String(passkey) + timestamp).toString('base64');
          const verification = await axios.post(host + '/mpesa/stkpushquery/v1/query', {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId,
          }, {
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            timeout: 12000,
          });

          if (String(verification.data?.ResultCode) === '0') {
            const confirmed = await Order.findOneAndUpdate(
              { _id: order._id, paymentStatus: 'Pending', status: mongoose.trusted({ $ne: 'Cancelled' }) },
              { $set: {
                paymentStatus: 'Paid',
                paidAt: new Date(),
                cancellationDeadline: new Date(Date.now() + 5 * 60 * 1000),
                status: order.status === 'Pending' ? 'Confirmed' : order.status,
              } },
              { returnDocument: 'after' }
            );
            if (confirmed) {
              order = confirmed;
              await sendPaidOrderEmails(confirmed);
            } else {
              order = await Order.findById(order._id).select('orderNumber trackingCode paymentStatus status total paymentMethod paymentReference mpesaCheckoutRequestId mpesaReceiptNumber paidAt createdAt items subtotal deliveryFee customerName customerEmail customerPhone customerDetails mpesaPhone');
            }
          }
        }
      }
    }
    return res.json({ success: true, data: order });
  } catch (error) {
    console.error('M-Pesa order status reconciliation failed:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: 'Unable to check M-Pesa payment status. Please retry shortly.' });
  }
});

/*
|--------------------------------------------------------------------------
| PAYSTACK WEBHOOK
|--------------------------------------------------------------------------
| Configure Paystack to POST events to:
| https://sylva-technologies-backend.onrender.com/api/orders/paystack/webhook
*/

router.post('/paystack/webhook', async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    if (!secret || !signature || !req.rawBody) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const expected = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex');
    const suppliedBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expected);
    if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const event = req.body?.event;
    const data = req.body?.data || {};

    if (event === 'charge.success' && data.reference) {
      const order = await Order.findOne({
        $or: [{ paymentReference: String(data.reference) }, { orderNumber: String(data.reference) }],
      });
      if (order && ['Paystack', 'Card'].includes(order.paymentMethod)) {
        const verification = await verifyTransaction(data.reference);
        if (verification?.status && verification.data) {
          await confirmPaidOrder(order, verification.data);
        }
      }
    } else if (
      ['refund.pending', 'refund.processing', 'refund.processed', 'refund.failed'].includes(event)
    ) {
      const transactionReference = data.transaction_reference || data.transaction?.reference;
      if (transactionReference) {
        const refundStatus = {
          'refund.pending': 'Refund Pending',
          'refund.processing': 'Refund Processing',
          'refund.processed': 'Refunded',
          'refund.failed': 'Refund Failed',
        }[event];
        await Order.updateOne(
          {
            paymentReference: String(transactionReference),
            paymentStatus: { $in: ['Refund Pending', 'Refund Processing', 'Refund Failed'] },
          },
          { $set: { paymentStatus: refundStatus } }
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Paystack webhook processing failed:', error.message);
    return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
  }
});

/*
|--------------------------------------------------------------------------
| VERIFY PAYMENT AFTER PAYSTACK REDIRECT
|--------------------------------------------------------------------------
*/

router.post('/paystack/verify', protect, async (req, res) => {
  try {
    const reference = String(req.body?.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, message: 'Payment reference is required.' });
    }

    const order = await Order.findOne({
      $or: [{ paymentReference: reference }, { orderNumber: reference }],
    });

    if (!order || !['Paystack', 'Card'].includes(order.paymentMethod)) {
      return res.status(404).json({ success: false, message: 'No Paystack order was found for this reference.' });
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && (!order.customer || String(order.customer) !== String(req.user._id))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to verify this order.' });
    }

    const verification = await verifyTransaction(reference);
    if (!verification?.status || !verification.data) {
      return res.status(502).json({ success: false, message: 'Paystack could not verify this payment yet.' });
    }

    if (verification.data.status !== 'success') {
      return res.status(409).json({
        success: false,
        paymentStatus: verification.data.status || 'pending',
        message: 'Payment has not completed. If you have paid, refresh shortly while Paystack confirms it.',
        data: { orderNumber: order.orderNumber, paymentStatus: order.paymentStatus, status: order.status },
      });
    }

    const updatedOrder = await confirmPaidOrder(order, verification.data);
    return res.json({
      success: true,
      message: 'Payment verified successfully.',
      data: {
        _id: updatedOrder._id,
        orderNumber: updatedOrder.orderNumber,
        trackingCode: updatedOrder.trackingCode,
        paymentStatus: updatedOrder.paymentStatus,
        status: updatedOrder.status,
        paidAt: updatedOrder.paidAt,
        cancellationDeadline: updatedOrder.cancellationDeadline,
        total: updatedOrder.total,
      },
    });
  } catch (error) {
    console.error('Paystack verification failed:', error.message);
    return res.status(400).json({ success: false, message: error.message || 'Unable to verify payment.' });
  }
});

/*
|--------------------------------------------------------------------------
| CUSTOMER CANCELLATION (FIVE-MINUTE WINDOW)
|--------------------------------------------------------------------------
*/

router.post('/:id/cancel', protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID.' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && (!order.customer || String(order.customer) !== String(req.user._id))) {
      return res.status(403).json({ success: false, message: 'You are not authorized to cancel this order.' });
    }

    if (order.status === 'Cancelled') {
      return res.json({ success: true, message: 'This order is already cancelled.', data: order });
    }

    if (['Shipped', 'Delivered'].includes(order.status)) {
      return res.status(409).json({ success: false, message: 'This order has already been shipped or delivered. Please contact support for assistance.' });
    }

    const windowStart = order.paidAt || order.createdAt;
    const deadline = order.paidAt
      ? new Date(order.paidAt.getTime() + 5 * 60 * 1000)
      : new Date(windowStart.getTime() + 5 * 60 * 1000);

    if (!isAdmin && Date.now() > deadline.getTime()) {
      return res.status(409).json({
        success: false,
        message: 'The five-minute cancellation window has expired. Please contact support for assistance.',
        cancellationDeadline: deadline,
      });
    }

    if (order.paymentStatus === 'Paid') {
      const refund = await refundTransaction({
        reference: order.paymentReference || order.orderNumber,
        amount: order.total,
        customerNote: 'Customer cancellation requested within the five-minute cancellation window.',
      });
      if (!refund?.status) {
        return res.status(502).json({ success: false, message: 'Paystack did not accept the refund request. The order has not been cancelled.' });
      }
      order.paymentStatus = 'Refund Pending';
      order.refundReference = String(refund.data?.id || refund.data?.reference || '');
    } else if (order.paymentStatus === 'Pending') {
      order.paymentStatus = 'Failed';
    }

    order.status = 'Cancelled';
    order.cancellationRequestedAt = new Date();
    await order.save();
    await restoreOrderStock(order);

    return res.json({
      success: true,
      message: order.paymentStatus === 'Refund Pending'
        ? 'Order cancelled. Your refund has been requested and will update when Paystack confirms it.'
        : 'Order cancelled successfully.',
      data: order,
    });
  } catch (error) {
    console.error('Customer cancellation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to cancel this order right now.' });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE ORDER STATUS - ADMIN
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/status',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { status } = req.body;

      if (
        !ORDER_STATUSES.includes(status)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid order status.',
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid order ID.',
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            'Order not found.',
        });
      }

      const previousStatus =
        order.status;

      if (status === 'Delivered' && !order.deliveryConfirmedAt) {
        return res.status(409).json({
          success: false,
          message: 'The customer must confirm receipt through the secure delivery email link before the order can be marked Delivered.',
        });
      }

      if (
        ['Confirmed', 'Processing', 'Ready for Delivery', 'Shipped', 'Delivered'].includes(status) &&
        order.paymentStatus !== 'Paid'
      ) {
        return res.status(409).json({
          success: false,
          message: 'This order cannot move forward until Paystack payment is verified.',
        });
      }

      if (
        previousStatus === status
      ) {
        const unchangedOrder =
          await Order.findById(
            order._id
          )
            .populate(
              'customer',
              'name email phone'
            )
            .populate(
              'items.product',
              'name slug price images stock'
            );

        return res.json({
          success: true,
          message:
            'Order status is already set to this value.',
          data: unchangedOrder,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | RESTORE STOCK WHEN CANCELLED
      |--------------------------------------------------------------------------
      */

      if (status === 'Cancelled' && previousStatus !== 'Cancelled') {
        if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Refund Pending') {
          return res.status(409).json({
            success: false,
            message: 'Paid orders must use the cancellation/refund workflow so customer funds are not left unrefunded.',
          });
        }
        await restoreOrderStock(order);
      }

      /*
      |--------------------------------------------------------------------------
      | UPDATE ONLY STATUS
      |--------------------------------------------------------------------------
      */

      let deliveryConfirmationLink = '';
      const shouldIssueDeliveryLink = status === 'Shipped' && order.paymentStatus === 'Paid' && !order.deliveryConfirmedAt;
      if (shouldIssueDeliveryLink) {
        deliveryConfirmationLink = await createDeliveryConfirmationToken(order);
      }

      await Order.updateOne(
        { _id: order._id },
        { $set: { status } }
      );

      const updated =
        await Order.findById(
          order._id
        )
          .populate(
            'customer',
            'name email phone'
          )
          .populate(
            'items.product',
            'name slug price images stock'
          );

      // Notify only sellers whose own products are part of this order.
      if (previousStatus !== status) await sendSellerOrderEmails(updated, 'status', previousStatus);

      // Keep the customer informed whenever an admin changes fulfillment status.
      const statusCustomerEmail = updated.customerEmail || updated.customerDetails?.email || updated.customer?.email;
      if (statusCustomerEmail && previousStatus !== status) {
        const customerStatusEmail = await sendOrderStatusUpdateEmail({
          to: statusCustomerEmail,
          customerName: updated.customerName || updated.customerDetails?.fullName || updated.customer?.name || 'Customer',
          orderNumber: updated.orderNumber,
          status: updated.status,
          deliveryConfirmationLink,
        });
        if (!customerStatusEmail?.success) {
          console.error('[Order email] customer status update email failed:', customerStatusEmail?.message || 'Unknown email error', { orderNumber: updated.orderNumber, status });
        }
      }

      const safeStatusOrderNumber = String(updated.orderNumber || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safePreviousStatus = String(previousStatus || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeCurrentStatus = String(status || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const statusAdminEmail = await sendSalesNotificationEmail({
        subject: 'Order status updated: ' + updated.orderNumber + ' — ' + status,
        html: '<div style="font-family:Arial,sans-serif;color:#17211b;max-width:680px;margin:auto;padding:24px">' +
          '<h2 style="color:#166534">Order status updated</h2><p>Order <b>' + safeStatusOrderNumber + '</b> changed from <b>' +
          safePreviousStatus + '</b> to <b>' + safeCurrentStatus + '</b>.</p><p>Customer: ' +
          String(updated.customerName || updated.customerDetails?.fullName || updated.customer?.name || 'Customer').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</p><p>Payment status: ' + String(updated.paymentStatus || 'Pending').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</p></div>',
        text: 'Order ' + updated.orderNumber + ' status changed from ' + previousStatus + ' to ' + status +
          '. Customer: ' + (updated.customerName || updated.customerDetails?.fullName || updated.customer?.name || 'Customer') +
          '. Payment status: ' + updated.paymentStatus + '.',
      });
      if (!statusAdminEmail?.success) {
        console.error('[Sales email] order status notification failed:', statusAdminEmail?.message || 'Unknown email error', { orderNumber: updated.orderNumber, status });
      }

      return res.json({
        success: true,
        message:
          `Order status updated to ${status}.`,
        data: updated,
      });
    } catch (error) {
      console.error(
        'Update order status error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update order status.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| UPDATE PAYMENT STATUS - ADMIN
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/payment-status',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { paymentStatus } =
        req.body;

      if (
        !PAYMENT_STATUSES.includes(
          paymentStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid payment status.',
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid order ID.',
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            'Order not found.',
        });
      }

      if (paymentStatus === 'Paid' && ['Paystack', 'Card'].includes(order.paymentMethod)) {
        return res.status(409).json({
          success: false,
          message: 'Paystack payments can only be marked paid after successful gateway verification.',
        });
      }

      const isFirstPaymentConfirmation =
        paymentStatus === 'Paid' &&
        order.paymentStatus !== 'Paid';

      order.paymentStatus =
        paymentStatus;

      if (
        paymentStatus === 'Paid'
      ) {
        order.status =
          order.status === 'Pending'
            ? 'Confirmed'
            : order.status;

        // Seller funds are released only after the customer confirms receipt.
        // Payment confirmation alone must not settle marketplace earnings.
      }

      await order.save();

      const updated =
        await Order.findById(
          order._id
        )
          .populate(
            'customer',
            'name email phone'
          )
          .populate(
            'items.product',
            'name slug price images stock'
          );

      if (isFirstPaymentConfirmation && updated?.paymentStatus === 'Paid') {
        await sendPaidOrderEmails(updated);
      }

      return res.json({
        success: true,
        message:
          `Payment status updated to ${paymentStatus}.`,
        data: updated,
      });
    } catch (error) {
      console.error(
        'Update payment status error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update payment status.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| DELETE ORDER - ADMIN
|--------------------------------------------------------------------------
*/

router.delete(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid order ID.',
        });
      }

      const order =
        await Order.findById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          success: false,
          message:
            'Order not found.',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | RESTORE STOCK BEFORE DELETE
      |--------------------------------------------------------------------------
      */

      if (
        order.status !== 'Cancelled'
      ) {
        for (const item of order.items) {
          if (!item.product) {
            continue;
          }

          await Product.updateOne(
            {
              _id: item.product,
            },
            {
              $inc: {
                stock: Number(
                  item.quantity || 0
                ),
              },
            }
          );
        }
      }

      await Order.findByIdAndDelete(
        order._id
      );

      return res.json({
        success: true,
        message:
          'Order deleted successfully.',
      });
    } catch (error) {
      console.error(
        'Delete order error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to delete order.',
      });
    }
  }
);

module.exports = router;