const express = require('express');
const Brand = require('../models/Brand');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();
const buildSlug = value => String(value || '').toLowerCase().trim()
  .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');

router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    res.json(await Brand.find({}).sort({ name: 1 }));
  } catch (error) {
    res.status(500).json({ message: 'Unable to load brands.' });
  }
});

router.get('/', async (req, res) => {
  try {
    res.json(await Brand.find({ isActive: true }).sort({ name: 1 }));
  } catch (error) {
    res.status(500).json({ message: 'Unable to load brands.' });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Brand name is required.' });
    const slug = buildSlug(name);
    if (!slug) return res.status(400).json({ message: 'Enter a valid brand name.' });
    if (await Brand.findOne({ slug })) {
      return res.status(409).json({ message: 'This brand already exists.' });
    }
    const brand = await Brand.create({
      name, slug, description: String(req.body.description || '').trim(),
      logo: String(req.body.logo || '').trim(), isActive: req.body.isActive !== false,
    });
    res.status(201).json(brand);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'This brand already exists.' : 'Unable to create brand.' });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const brand = await Brand.findById(req.params.id);
    if (!brand) return res.status(404).json({ message: 'Brand not found.' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ message: 'Brand name is required.' });
      brand.name = name;
      brand.slug = buildSlug(name);
    }
    if (req.body.description !== undefined) brand.description = String(req.body.description || '').trim();
    if (req.body.logo !== undefined) brand.logo = String(req.body.logo || '').trim();
    if (req.body.isActive !== undefined) brand.isActive = Boolean(req.body.isActive);
    await brand.save();
    res.json(brand);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'A brand with that name already exists.' : 'Unable to update brand.' });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const brand = await Brand.findByIdAndDelete(req.params.id);
    if (!brand) return res.status(404).json({ message: 'Brand not found.' });
    res.json({ message: 'Brand deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Unable to delete brand.' });
  }
});

module.exports = router;
