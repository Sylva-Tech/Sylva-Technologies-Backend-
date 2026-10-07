const express = require('express');
const Category = require('../models/Category');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const buildSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({
      isActive: true,
    }).sort({ name: 1 });

    res.json(categories);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to fetch categories.',
    });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      image,
      parentCategory,
      isActive,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        message: 'Category name is required.',
      });
    }

    const slug = buildSlug(name);

    const existing = await Category.findOne({ slug });

    if (existing) {
      return res.status(400).json({
        message: 'Category already exists.',
      });
    }

    const category = await Category.create({
      name,
      slug,
      description: description || '',
      image: image || '',
      parentCategory: parentCategory || null,
      isActive: isActive !== false,
    });

    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to create category.',
    });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        message: 'Category not found.',
      });
    }

    if (req.body.name && req.body.name !== category.name) {
      category.name = req.body.name;
      category.slug = buildSlug(req.body.name);
    }

    if (req.body.description !== undefined) {
      category.description = req.body.description;
    }

    if (req.body.image !== undefined) {
      category.image = req.body.image;
    }

    if (req.body.parentCategory !== undefined) {
      category.parentCategory = req.body.parentCategory || null;
    }

    if (req.body.isActive !== undefined) {
      category.isActive = Boolean(req.body.isActive);
    }

    const updated = await category.save();

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to update category.',
    });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        message: 'Category not found.',
      });
    }

    await category.deleteOne();

    res.json({
      message: 'Category deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({
      message: error.message || 'Unable to delete category.',
    });
  }
});

module.exports = router;
