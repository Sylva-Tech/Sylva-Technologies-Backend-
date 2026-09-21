const express = require('express');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { protect, adminOnly, requireVerified } = require('../middleware/authMiddleware');
const { sendOrderConfirmationEmail, sendAdminOrderNotificationEmail, sendOrderStatusUpdateEmail } = require('../services/emailService');

const router = express.Router();

const validStatuses = ['Pending', 'Confirmed', 'Processing', 'Ready for Delivery', 'Shipped', 'Delivered', 'Cancelled'];
const validPaymentMethods = ['Cash on Delivery', 'M-Pesa', 'PayPal', 'WhatsApp Order'];

const generateOrderNumber = async () => {
  const date = new Date();
  const dateStamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const sequence = await Order.countDocuments({
    createdAt: {
      $gte: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0),
      $lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0),
    },
  });
  return `ST-${dateStamp}-${String(sequence + 1).padStart(5, '0')}`;
};

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { status, paymentStatus, search } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    const orders = await Order.find(filter)
      .populate('customer', 'name email phone')
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Fetch orders error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load orders.' });
  }
});

router.get('/my-orders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
    return res.json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to load your orders.' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (req.user.role !== 'admin' && order.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    return res.json({ success: true, data: order });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Unable to fetch order.' });
  }
});

router.post('/', protect, requireVerified, async (req, res) => {
  try {
    const { items, customerDetails, paymentMethod, paymentReference, notes } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
    }

    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Please select a valid payment method.' });
    }

    if (['M-Pesa', 'PayPal'].includes(paymentMethod) && !paymentReference?.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide your payment reference.' });
    }

    let subtotal = 0;
    const preparedItems = [];

    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.product || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ success: false, message: 'Each order item must have a valid quantity.' });
      }

      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ success: false, message: `Product not found: ${item.product}` });
      }

      if (!product.isActive || product.stock < quantity) {
        return res.status(400).json({ success: false, message: `${product.name} is no longer available in the requested quantity.` });
      }

      const unitPrice = Number(product.price);
      const itemSubtotal = unitPrice * quantity;
      subtotal += itemSubtotal;

      preparedItems.push({
        product: product._id,
        name: product.name,
        image: product.images?.[0] || '',
        quantity,
        unitPrice,
        subtotal: itemSubtotal,
      });
    }

    const deliveryFee = 0;
    const total = subtotal + deliveryFee;
    const orderNumber = await generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      customer: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: req.user.phone || customerDetails?.phone || '',
      items: preparedItems,
      subtotal,
      deliveryFee,
      total,
      customerDetails,
      paymentMethod,
      paymentReference: paymentReference || '',
      paymentStatus: 'Pending',
      status: 'Pending',
      notes: notes || '',
    });

    const populatedOrder = await Order.findById(order._id).populate('customer', 'name email phone');

    try {
      const user = await User.findById(req.user._id);
      const adminEmail = process.env.ADMIN_EMAIL;
      if (user?.email) {
        await sendOrderConfirmationEmail({
          to: user.email,
          customerName: user.name,
          order: populatedOrder.toObject(),
          orderDate: new Date(populatedOrder.createdAt).toLocaleDateString(),
        });
      }

      if (adminEmail) {
        await sendAdminOrderNotificationEmail({
          to: adminEmail,
          order: populatedOrder.toObject(),
          customer: { name: user?.name || req.user.name, email: user?.email || req.user.email, phone: user?.phone || req.user.phone },
        });
      }
    } catch (emailError) {
      console.error('Order email notification failed:', emailError.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      data: populatedOrder,
    });
  } catch (error) {
    console.error('Create order error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create order.' });
  }
});

router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid order status.' });
    }

    if (paymentStatus && !['Pending', 'Paid', 'Failed', 'Refunded'].includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: 'Invalid payment status.' });
    }

    const order = await Order.findById(req.params.id).populate('customer', 'name email phone');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (status) order.status = status;
    if (paymentStatus) order.paymentStatus = paymentStatus;
    const updated = await order.save();

    if (order.customer?.email && status) {
      try {
        await sendOrderStatusUpdateEmail({
          to: order.customer.email,
          customerName: order.customer.name,
          orderNumber: order.orderNumber,
          status,
        });
      } catch (emailError) {
        console.error('Order status email failed:', emailError.message);
      }
    }

    return res.json({ success: true, message: 'Order updated successfully.', data: updated });
  } catch (error) {
    console.error('Update order status error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to update order status.' });
  }
});

module.exports = router;
