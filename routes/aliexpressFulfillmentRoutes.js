const express = require('express');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const AliExpressFulfillment = require('../models/AliExpressFulfillment');
const { reconcilePaidAliExpressOrders } = require('../services/aliexpressFulfillmentService');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/queue', async (req, res) => {
  try {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit) || 100));
    const [items, counts] = await Promise.all([
      AliExpressFulfillment.find()
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('order', 'orderNumber paymentStatus status paidAt')
        .populate('product', 'name images')
        .lean(),
      AliExpressFulfillment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    return res.json({ success: true, items, counts: Object.fromEntries(counts.map((item) => [item._id, item.count])) });
  } catch (error) {
    console.error('[AliExpress fulfilment] queue read failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load AliExpress fulfilment queue.' });
  }
});

router.post('/reconcile', async (req, res) => {
  try {
    const result = await reconcilePaidAliExpressOrders({ limit: req.body?.limit });
    return res.json({
      success: true,
      message: 'Paid AliExpress orders reconciled. Supplier submission remains protected until the Dropshipper API is verified.',
      result,
    });
  } catch (error) {
    console.error('[AliExpress fulfilment] reconciliation failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to reconcile paid AliExpress orders.' });
  }
});

module.exports = router;
