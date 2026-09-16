const express = require('express');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const generateOrderNumber = () => {
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const random = Math.floor(1000 + Math.random() * 9000);
  return `ST-${stamp}-${random}`;
};

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await Order.find().populate('customer', 'name email phone').sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load orders.' });
  }
});

router.get('/my-orders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load your orders.' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('customer', 'name email phone');
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    if (req.user.role !== 'admin' && order.customer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch order.' });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { items, customerDetails, paymentMethod, paymentReference, notes } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least one item.' });
    }

    if (!['Cash on Delivery', 'M-Pesa', 'PayPal', 'WhatsApp Order'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Please select a valid payment method.' });
    }

    if (['M-Pesa', 'PayPal'].includes(paymentMethod) && !paymentReference?.trim()) {
      return res.status(400).json({ message: 'Please provide your payment reference.' });
    }

    let subtotal = 0;
    const preparedItems = [];

    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!item.product || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Each order item must have a valid quantity.' });
      }
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      }

      if (!product.isActive || product.stock < quantity) {
        return res.status(400).json({ message: `${product.name} is no longer available in the requested quantity.` });
      }

      const itemSubtotal = product.price * quantity;
      subtotal += itemSubtotal;

      preparedItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity,
        subtotal: itemSubtotal,
      });
    }

    const deliveryFee = 0;
    const total = subtotal + deliveryFee;
    const orderNumber = generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      customer: req.user._id,
      items: preparedItems,
      subtotal,
      deliveryFee,
      total,
      customerDetails,
      paymentMethod,
      paymentReference,
      notes,
    });

    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to create order.' });
  }
});

router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    order.status = status;
    const updated = await order.save();
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to update order status.' });
  }
});

module.exports = router;
