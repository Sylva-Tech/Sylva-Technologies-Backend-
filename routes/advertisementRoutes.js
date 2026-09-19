const express = require('express');
const Advertisement = require('../models/Advertisement');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const ads = await Advertisement.find({ active: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }] }).sort({ createdAt: -1 });
    res.json(ads);
  } catch (error) {
    console.error('Unable to load advertisements:', error.message);
    res.status(500).json({ message: 'Unable to load advertisements.' });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, image, link, active, startsAt, endsAt } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Advertisement title and message are required.' });
    const ad = await Advertisement.create({ title, message, image, link, active: active !== false, startsAt: startsAt || null, endsAt: endsAt || null });
    res.status(201).json(ad);
  } catch (error) {
    console.error('Unable to create advertisement:', error.message);
    res.status(500).json({ message: 'Unable to create advertisement.' });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const ad = await Advertisement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!ad) return res.status(404).json({ message: 'Advertisement not found.' });
    res.json(ad);
  } catch (error) {
    console.error('Unable to update advertisement:', error.message);
    res.status(500).json({ message: 'Unable to update advertisement.' });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const ad = await Advertisement.findByIdAndDelete(req.params.id);
    if (!ad) return res.status(404).json({ message: 'Advertisement not found.' });
    res.json({ message: 'Advertisement deleted successfully.' });
  } catch (error) {
    console.error('Unable to delete advertisement:', error.message);
    res.status(500).json({ message: 'Unable to delete advertisement.' });
  }
});

module.exports = router;
