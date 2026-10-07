const express = require('express');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');

const {
  protect,
  adminOnly,
  requireVerified,
} = require('../middleware/authMiddleware');

const {
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
} = require('../services/emailService');

const router = express.Router();

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

  const commissionRate = Number(
    process.env.PLATFORM_COMMISSION_RATE || 0.1
  );

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

    const wallet = seller.wallet || {
      currency: 'KES',
      availableBalance: 0,
      pendingBalance: 0,
      transactions: [],
    };

    wallet.currency = wallet.currency || 'KES';

    wallet.availableBalance = roundMoney(
      Number(wallet.availableBalance || 0) +
        Number(settlement.netAmount || 0)
    );

    wallet.lastUpdatedAt = new Date();

    wallet.transactions = Array.isArray(
      wallet.transactions
    )
      ? wallet.transactions
      : [];

    wallet.transactions.unshift({
      _id: new mongoose.Types.ObjectId(),
      type: 'credit',
      amount: roundMoney(settlement.netAmount),
      category: 'order_settlement',
      status: 'completed',
      description: `Order settlement for ${order.orderNumber}.`,
      reference: `order:${order.orderNumber}`,
      relatedOrder: order._id,
      metadata: {
        commission: roundMoney(settlement.commission),
        grossAmount: roundMoney(settlement.grossAmount),
        products: settlement.products,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    seller.wallet = wallet;

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
| GET ALL ORDERS - ADMIN
|--------------------------------------------------------------------------
*/

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate(
        'customer',
        'name email phone'
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

    const normalizedDeliveryFee =
      Number(deliveryFee || 0);

    if (
      !Number.isFinite(
        normalizedDeliveryFee
      ) ||
      normalizedDeliveryFee < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          'A valid delivery fee is required.',
      });
    }

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

      customerDetails,

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

      // Commit transaction
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
        message:
          'The order could not be completed because stock changed. Please try again.',
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
    | SEND ORDER EMAILS
    |--------------------------------------------------------------------------
    */

    try {
      if (customerEmail) {
        await sendOrderConfirmationEmail({
          to: customerEmail,

          customerName:
            customerDetails.fullName,

          order: {
            ...populatedOrder.toObject(),

            orderNumber:
              populatedOrder.orderNumber,

            trackingCode:
              populatedOrder.trackingCode ||
              populatedOrder.orderNumber,
          },

          orderDate:
            new Date(
              populatedOrder.createdAt
            ).toLocaleString(),
        });
      }

      const adminAddress =
        process.env.SALES_EMAIL ||
        'sales@sylvatechnologies.co.ke';

      await sendAdminOrderNotificationEmail({
        to: adminAddress,

        order: {
          ...populatedOrder.toObject(),

          orderNumber:
            populatedOrder.orderNumber,

          trackingCode:
            populatedOrder.trackingCode ||
            populatedOrder.orderNumber,
        },

        customer: {
          name:
            customerDetails.fullName,

          email:
            customerEmail,

          phone:
            customerDetails.phone,
        },
      });
    } catch (emailError) {
      /*
      |--------------------------------------------------------------------------
      | EMAIL FAILURE SHOULD NOT CANCEL THE ORDER
      |--------------------------------------------------------------------------
      */

      console.error(
        'Order email notification failed:',
        emailError
      );
    }

    /*
    |--------------------------------------------------------------------------
    | SUCCESS
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({
      success: true,
      message:
        'Order created successfully.',
      data: populatedOrder,
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

      if (
        status === 'Cancelled' &&
        previousStatus !== 'Cancelled'
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

        if (
          isFirstPaymentConfirmation
        ) {
          const settlementResult =
            await applySellerSettlement(
              order
            );

          if (
            settlementResult.settled
          ) {
            console.info(
              'Seller settlements applied for order:',
              order.orderNumber,
              settlementResult.count
            );
          }
        }
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