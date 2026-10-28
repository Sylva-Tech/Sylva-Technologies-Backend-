const express = require('express');
const MovingBarConfig = require('../models/MovingBarConfig');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();
const safeItem = (item = {}) => ({
  ...( /^[a-f0-9]{24}$/i.test(String(item._id || '')) ? { _id: String(item._id) } : {}),
  label: String(item.label || '').trim().slice(0, 80),
  text: String(item.text || '').trim().slice(0, 240),
  href: String(item.href || '/shop').trim().slice(0, 500),
  active: item.active !== false && item.active !== 'false',
  priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
});

router.get('/', async (req, res) => {
  try {
    const config = await MovingBarConfig.findOne({ key: 'homepage' }).lean();
    const items = (config?.items || [
      { label: 'Free Delivery', text: 'On selected orders across Kenya', href: '/shop', active: true, priority: 50 },
      { label: 'Quality IT Products', text: 'Laptops, desktops and accessories', href: '/shop', active: true, priority: 40 },
      { label: 'Trusted Support', text: 'Helpful support for your technology needs', href: '/support', active: true, priority: 30 },
      { label: 'Secure Payments', text: 'Checkout with confidence', href: '/shop', active: true, priority: 20 },
      { label: 'Sell on Sylva', text: 'Join our seller marketplace', href: '/sell-on-sylva', active: true, priority: 10 },
    ])
      .filter(item => item.active !== false)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    return res.json({ success: true, items });
  } catch (error) {
    console.error('Moving bar load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load homepage announcements.' });
  }
});

router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const config = await MovingBarConfig.findOne({ key: 'homepage' }).lean();
    return res.json({ success: true, items: config?.items || [
      { label: 'Free Delivery', text: 'On selected orders across Kenya', href: '/shop', active: true, priority: 50 },
      { label: 'Quality IT Products', text: 'Laptops, desktops and accessories', href: '/shop', active: true, priority: 40 },
      { label: 'Trusted Support', text: 'Helpful support for your technology needs', href: '/support', active: true, priority: 30 },
      { label: 'Secure Payments', text: 'Checkout with confidence', href: '/shop', active: true, priority: 20 },
      { label: 'Sell on Sylva', text: 'Join our seller marketplace', href: '/sell-on-sylva', active: true, priority: 10 },
    ] });
  } catch (error) {
    console.error('Moving bar admin load failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to load homepage announcements.' });
  }
});

router.put('/', protect, adminOnly, async (req, res) => {
  try {
    if (!Array.isArray(req.body?.items) || req.body.items.length > 30) {
      return res.status(400).json({ success: false, message: 'Provide up to 30 moving-bar announcements.' });
    }
    const items = req.body.items.map(safeItem);
    if (items.some(item => !item.label || !item.text)) {
      return res.status(400).json({ success: false, message: 'Each announcement needs a label and message.' });
    }
    const config = await MovingBarConfig.findOneAndUpdate(
      { key: 'homepage' },
      { $set: { items } },
      { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, message: 'Moving-bar announcements saved.', items: config.items });
  } catch (error) {
    console.error('Moving bar save failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to save homepage announcements.' });
  }
});

module.exports = router;
