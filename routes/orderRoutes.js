const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');

const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
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
  sendSellerPaymentNotificationEmail,
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

  // The configured marketplace commission is 4% by default.
  // Prefer integer basis points to avoid ambiguous decimal-rate settings.
  const commissionRateBps = Number(process.env.PLATFORM_COMMISSION_RATE_BPS ?? 400);
  if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
    throw new Error('PLATFORM_COMMISSION_RATE_BPS must be an integer from 0 to 10000.');
  }
  const commissionRate = commissionRateBps / 10000;

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
    if ((seller.wallet?.transactions || []).some((tx) => tx.reference === settlementReference)) continue;
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
      if (usdWallet.transactions.some((tx) => tx.reference === settlementReference)) continue;
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
      if (wallet.transactions.some((tx) => tx.reference === settlementReference)) continue;
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
    settled: settledCount > 0,
    count: settledCount,
  };
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
      .populate({
        path: 'items.product',
        select: 'name slug price images stock seller',
        populate: { path: 'seller', select: 'name email sellerProfile.storeName' },
      });

    if (!populatedOrder) return;

    const email = populatedOrder.customerEmail || populatedOrder.customerDetails?.email;
    if (email) {
      await sendOrderConfirmationEmail({
        to: email,
        customerName: populatedOrder.customerName || populatedOrder.customerDetails?.fullName || 'Customer',
        order: populatedOrder.toObject(),
        orderDate: new Date(populatedOrder.createdAt).toLocaleString('en-KE'),
      });
    }

    const operationsRecipients = [
      process.env.ORDERS_EMAIL || 'order@sylvatechnologies.co.ke',
      process.env.PAYMENT_EMAIL || 'payment@sylvatechnologies.co.ke',
      process.env.SALES_EMAIL || 'sales@sylvatechnologies.co.ke',
    ];
    const uniqueRecipients = [...new Set(operationsRecipients.map((address) => String(address || '').trim().toLowerCase()).filter(Boolean))];
    await sendAdminOrderNotificationEmail({
      to: uniqueRecipients,
      order: populatedOrder.toObject(),
      customer: {
        name: populatedOrder.customerName || populatedOrder.customerDetails?.fullName || 'Customer',
        email: populatedOrder.customerEmail || populatedOrder.customerDetails?.email || '',
        phone: populatedOrder.customerPhone || populatedOrder.customerDetails?.phone || '',
      },
    });

    // Notify each seller only about their own lines. This runs after the
    // provider-confirmed payment transition and never exposes another seller's items.
    const sellerOrders = new Map();
    for (const item of populatedOrder.items || []) {
      const product = item?.product;
      const seller = product?.seller;
      const sellerId = seller?._id ? String(seller._id) : '';
      const sellerEmail = String(seller?.email || '').trim().toLowerCase();
      if (!sellerId || !sellerEmail) continue;
      if (!sellerOrders.has(sellerId)) {
        sellerOrders.set(sellerId, {
          seller,
          items: [],
          productSubtotal: 0,
        });
      }
      const sellerOrder = sellerOrders.get(sellerId);
      const amount = roundMoney(Number(item.subtotal || 0));
      sellerOrder.productSubtotal = roundMoney(sellerOrder.productSubtotal + amount);
      sellerOrder.items.push({
        name: String(product.name || item.name || 'Product'),
        quantity: Number(item.quantity || 1),
        subtotal: amount,
      });
    }

    const commissionRateBps = Number(process.env.PLATFORM_COMMISSION_RATE_BPS ?? 400);
    if (!Number.isInteger(commissionRateBps) || commissionRateBps < 0 || commissionRateBps > 10000) {
      throw new Error('PLATFORM_COMMISSION_RATE_BPS must be an integer from 0 to 10000.');
    }
    const commissionRate = commissionRateBps / 10000;

    for (const sellerOrder of sellerOrders.values()) {
      const gross = sellerOrder.productSubtotal;
      const commission = roundMoney(gross * commissionRate);
      await sendSellerPaymentNotificationEmail({
        to: sellerOrder.seller.email,
        sellerName: sellerOrder.seller.name || sellerOrder.seller.sellerProfile?.storeName || 'Seller',
        storeName: sellerOrder.seller.sellerProfile?.storeName || '',
        orderNumber: populatedOrder.orderNumber,
        orderDate: new Date(populatedOrder.createdAt).toLocaleString('en-KE'),
        items: sellerOrder.items,
        grossAmount: gross,
        commissionAmount: commission,
        sellerNetAmount: roundMoney(gross - commission),
        currency: String(populatedOrder.currency || 'KES').toUpperCase(),
        paymentMethod: populatedOrder.paymentMethod || 'Payment provider',
        settlementStatus: 'Pending delivery confirmation',
      });
    }
  } catch (error) {
    console.error('Paid order email notification failed:', error.message);
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
      { new: true }
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
      { new: true }
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
          'name slug price images stock seller'
        );

    if (paymentMethod === 'Wallet' && populatedOrder.paymentStatus === 'Paid') {
      await sendPaidOrderEmails(populatedOrder);
    }

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

    // Order emails are sent only after Paystack verifies payment.

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
        { new: true }
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
      { _id: order._id, paymentStatus: 'Pending', status: { $ne: 'Cancelled' } },
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
      { new: true }
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
              { _id: order._id, paymentStatus: 'Pending', status: { $ne: 'Cancelled' } },
              { $set: {
                paymentStatus: 'Paid',
                paidAt: new Date(),
                cancellationDeadline: new Date(Date.now() + 5 * 60 * 1000),
                status: order.status === 'Pending' ? 'Confirmed' : order.status,
              } },
              { new: true }
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
        // Allow an admin retry to finish seller settlement if a previous delivery update
        // saved the order status but settlement failed part-way through.
        if (status === 'Delivered' && order.paymentStatus === 'Paid') {
          await applySellerSettlement(order);
        }

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

      await Order.updateOne(
        {
          _id: order._id,
        },
        {
          $set: {
            status,
          },
        }
      );

      if (
        status === 'Delivered' &&
        previousStatus !== 'Delivered' &&
        order.paymentStatus === 'Paid'
      ) {
        const settlementResult = await applySellerSettlement(order);
        if (settlementResult.settled) {
          console.info('Seller settlement applied after delivery:', order.orderNumber);
        }
      }

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

        // Seller settlement is deliberately deferred until delivery is confirmed.
        // Payment confirmation must never make seller funds withdrawable early.
      }

      await order.save();

      if (isFirstPaymentConfirmation && paymentStatus === 'Paid') {
        await sendPaidOrderEmails(order);
      }

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