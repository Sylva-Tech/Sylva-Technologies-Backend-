const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

const buildSlug = (value) => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9\s-]/g, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-');

router.get('/', async (req, res) => {
  try {
    const { category, brand, search, featured, flashSale, offer, inStock, sort, page = 1, limit = 12 } = req.query;

    const filter = { isActive: true };

    if (category) {
      const categoryQuery = [{ slug: category }, { name: category }];
      if (mongoose.Types.ObjectId.isValid(category)) {
        categoryQuery.unshift({ _id: category });
      }

      const categoryRecord = await Category.findOne({ $or: categoryQuery }).select('_id');

      if (!categoryRecord) {
        return res.json({ products: [], page: Number(page), totalPages: 0, totalProducts: 0 });
      }

      filter.category = categoryRecord._id;
    }

    if (brand) {
      filter.brand = brand;
    }

    if (featured === 'true') {
      filter.featured = true;
    }

    if (flashSale === 'true') {
      filter.flashSale = true;
    }

    if (offer === 'true') {
      filter.offer = true;
    }

    if (flashSale === 'true' || offer === 'true') {
      const now = new Date();
      filter.$and = [
        { $or: [{ offerStartDate: null }, { offerStartDate: { $lte: now } }] },
        { $or: [{ offerEndDate: null }, { offerEndDate: { $gt: now } }] },
      ];
    }

    if (inStock === 'true') {
      filter.stock = { $gt: 0 };
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    let sortOption = { createdAt: -1 };
    switch (sort) {
      case 'price-asc':
        sortOption = { price: 1 };
        break;
      case 'price-desc':
        sortOption = { price: -1 };
        break;
      case 'discount':
        sortOption = { discount: -1 };
        break;
      default:
        break;
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category')
      .sort(sortOption)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      products,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      totalProducts: total,
    });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load products.' });
  }
});

router.get('/slug/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug }).populate('category');
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch product.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).populate('category');
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to fetch product.' });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { name, brand, category, sku, price, oldPrice, stock, description, shortDescription, specifications, featured, flashSale, offer, offerMessage, offerStartDate, offerEndDate, isNew, isActive, condition, warranty } = req.body;

    if (!name || !brand || !category || !sku || !price) {
      return res.status(400).json({ message: 'Required product fields are missing.' });
    }

    const productSlug = buildSlug(name);
    const duplicate = await Product.findOne({ $or: [{ slug: productSlug }, { sku }] });

    if (duplicate) {
      return res.status(400).json({ message: 'Product with the same slug or SKU already exists.' });
    }

    const categoryRecord = await Category.findOne(
      mongoose.Types.ObjectId.isValid(category) ? { _id: category } : { $or: [{ name: category }, { slug: buildSlug(category) }] }
    ).select('_id');
    if (!categoryRecord) {
      return res.status(400).json({ message: 'The selected category does not exist.' });
    }

    const product = await Product.create({
      name,
      slug: productSlug,
      sku,
      brand,
      category: categoryRecord._id,
      description,
      shortDescription,
      price,
      oldPrice: oldPrice || 0,
      discount: oldPrice ? Math.max(0, Math.round(((oldPrice - price) / oldPrice) * 100)) : 0,
      stock: stock || 0,
      specifications: specifications || {},
      featured: Boolean(featured),
      flashSale: Boolean(flashSale),
      offer: Boolean(offer),
      offerMessage: offerMessage || '',
      offerStartDate: offerStartDate || null,
      offerEndDate: offerEndDate || null,
      isNew: Boolean(isNew),
      isActive: isActive !== false,
      condition: condition || 'New',
      warranty: warranty || '',
      images: req.body.images || [],
    });

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to create product.' });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    if (req.body.name && req.body.name !== product.name) {
      product.slug = buildSlug(req.body.name);
    }

    Object.assign(product, req.body);

    if (req.body.oldPrice && req.body.price) {
      product.discount = Math.max(0, Math.round(((req.body.oldPrice - req.body.price) / req.body.oldPrice) * 100));
    }

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to update product.' });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to delete product.' });
  }
});

module.exports = router;
