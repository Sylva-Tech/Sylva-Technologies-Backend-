const express = require('express');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Product = require('../models/Product');
const {
  protect,
  adminOnly,
  requireVerified,
} = require('../middleware/authMiddleware');

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

/*
|--------------------------------------------------------------------------
| GET ALL ORDERS - ADMIN
|--------------------------------------------------------------------------
*/
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('customer', 'name email phone')
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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID.',
      });
    }

    const order = await Order.findById(req.params.id)
      .populate('customer', 'name email phone')
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

    const isAdmin = req.user.role === 'admin';
    const isOwner =
      order.customer &&
      order.customer._id.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this order.',
      });
    }

    return res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error('Get single order error:', error);

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
*/
router.post('/', protect, requireVerified, async (req, res) => {
  try {
    const {
      items,
      deliveryFee = 0,
      total,
      customerDetails,
      paymentMethod = 'Cash on Delivery',
      paymentReference = '',
      notes = '',
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Your order must contain at least one product.',
      });
    }

    if (!customerDetails?.fullName) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required.',
      });
    }

    if (!customerDetails?.phone) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone number is required.',
      });
    }

    if (!customerDetails?.deliveryLocation) {
      return res.status(400).json({
        success: false,
        message: 'Delivery location is required.',
      });
    }

    if (!Number.isFinite(Number(total)) || Number(total) < 0) {
      return res.status(400).json({
        success: false,
        message: 'A valid order total is required.',
      });
    }

    const preparedItems = [];

    for (const item of items) {
      if (!item.product || !mongoose.Types.ObjectId.isValid(item.product)) {
        return res.status(400).json({
          success: false,
          message: 'One of the products in the order is invalid.',
        });
      }

      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Product quantity must be a positive whole number.',
        });
      }

      const product = await Product.findById(item.product);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'One of the selected products no longer exists.',
        });
      }

      if (product.isActive === false) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is currently unavailable.`,
        });
      }

      if (Number(product.stock || 0) < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}.`,
        });
      }

      preparedItems.push({
        product: product._id,
        name: product.name,
        quantity,
        price: Number(product.price || 0),
        image:
          Array.isArray(product.images) && product.images.length > 0
            ? product.images[0]
            : '',
      });
    }

    const today = new Date();
    const datePart =
      `${today.getFullYear()}` +
      `${String(today.getMonth() + 1).padStart(2, '0')}` +
      `${String(today.getDate()).padStart(2, '0')}`;

    const orderCount = await Order.countDocuments({
      createdAt: {
        $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        $lt: new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() + 1
        ),
      },
    });

    const orderNumber =
      `ST-${datePart}-${String(orderCount + 1).padStart(4, '0')}`;

    const order = await Order.create({
      orderNumber,
      customer: req.user._id,
      customerName: customerDetails.fullName,
      customerEmail: customerDetails.email || req.user.email || '',
      customerPhone: customerDetails.phone,
      items: preparedItems,
      deliveryFee: Number(deliveryFee || 0),
      total: Number(total),
      customerDetails,
      paymentMethod,
      paymentReference,
      paymentStatus: 'Pending',
      status: 'Pending',
      notes,
    });

    const successfullyDeducted = [];

    try {
      for (const item of preparedItems) {
        const stockUpdate = await Product.updateOne(
          {
            _id: item.product,
            stock: { $gte: item.quantity },
          },
          {
            $inc: {
              stock: -item.quantity,
            },
          }
        );

        if (stockUpdate.modifiedCount !== 1) {
          throw new Error(
            `Stock could not be deducted for product ${item.product}.`
          );
        }

        successfullyDeducted.push(item);
      }
    } catch (stockError) {
      for (const item of successfullyDeducted) {
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

      return res.status(400).json({
        success: false,
        message:
          'The order could not be completed because stock changed. Please try again.',
      });
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('customer', 'name email phone')
      .populate(
        'items.product',
        'name slug price images stock'
      );

    return res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      data: populatedOrder,
    });
  } catch (error) {
    console.error('Create order error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create the order.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE ORDER STATUS - ADMIN
|--------------------------------------------------------------------------
*/
router.patch('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID.',
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    const previousStatus = order.status;

    if (previousStatus === status) {
      const unchangedOrder = await Order.findById(order._id)
        .populate('customer', 'name email phone')
        .populate(
          'items.product',
          'name slug price images stock'
        );

      return res.json({
        success: true,
        message: 'Order status is already set to this value.',
        data: unchangedOrder,
      });
    }

    /*
     * Restore stock when an active order is cancelled.
     */
    if (
      status === 'Cancelled' &&
      previousStatus !== 'Cancelled'
    ) {
      for (const item of order.items) {
        if (!item.product) continue;

        await Product.updateOne(
          { _id: item.product },
          {
            $inc: {
              stock: Number(item.quantity || 0),
            },
          }
        );
      }
    }

    order.status = status;

    await order.save();

    const updated = await Order.findById(order._id)
      .populate('customer', 'name email phone')
      .populate(
        'items.product',
        'name slug price images stock'
      );

    return res.json({
      success: true,
      message: `Order status updated to ${status}.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update order status error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update order status.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE PAYMENT STATUS - ADMIN
|--------------------------------------------------------------------------
*/
router.patch('/:id/payment-status', protect, adminOnly, async (req, res) => {
  try {
    const { paymentStatus } = req.body;

    if (!PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID.',
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    order.paymentStatus = paymentStatus;

    await order.save();

    const updated = await Order.findById(order._id)
      .populate('customer', 'name email phone')
      .populate(
        'items.product',
        'name slug price images stock'
      );

    return res.json({
      success: true,
      message: `Payment status updated to ${paymentStatus}.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update payment status error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update payment status.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| DELETE ORDER - ADMIN
|--------------------------------------------------------------------------
*/
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID.',
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      });
    }

    /*
     * If the order is still active, restore stock before deleting it.
     */
    if (order.status !== 'Cancelled') {
      for (const item of order.items) {
        if (!item.product) continue;

        await Product.updateOne(
          { _id: item.product },
          {
            $inc: {
              stock: Number(item.quantity || 0),
            },
          }
        );
      }
    }

    await Order.findByIdAndDelete(order._id);

    return res.json({
      success: true,
      message: 'Order deleted successfully.',
    });
  } catch (error) {
    console.error('Delete order error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to delete order.',
    });
  }
});

module.exports = router;