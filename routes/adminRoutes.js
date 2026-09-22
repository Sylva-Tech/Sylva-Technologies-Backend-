const express = require('express');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: 'Pending' });
    const processingOrders = await Order.countDocuments({ status: 'Processing' });
    const completedOrders = await Order.countDocuments({ status: 'Delivered' });
    const cancelledOrders = await Order.countDocuments({ status: 'Cancelled' });

    const totalCustomers = await User.countDocuments({ role: 'customer' });
    const totalProducts = await Product.countDocuments();
    const lowStock = await Product.countDocuments({ stock: { $lt: Number(process.env.LOW_STOCK_THRESHOLD || 5) } });

    // total revenue (sum of totals for paid orders excluding cancelled)
    const paidFilter = { paymentStatus: 'Paid', status: { $ne: 'Cancelled' } };
    const revenueAgg = await Order.aggregate([
      { $match: paidFilter },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    // current month revenue
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthFilter = { ...paidFilter, createdAt: { $gte: monthStart } };
    const monthAgg = await Order.aggregate([
      { $match: monthFilter },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const monthRevenue = monthAgg[0]?.total || 0;

    return res.json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        processingOrders,
        completedOrders,
        cancelledOrders,
        totalCustomers,
        totalProducts,
        lowStock,
        totalRevenue,
        monthRevenue,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load admin stats.' });
  }
});

module.exports = router;
