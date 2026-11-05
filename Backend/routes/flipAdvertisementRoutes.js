const express = require('express');
const FlipAdvertisement = require('../models/FlipAdvertisement');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/
const EDITABLE_FIELDS = [
  'title',
  'description',
  'imageUrl',
  'badge',
  'price',
  'oldPrice',
  'buttonText',
  'buttonLink',
  'theme',
  'active',
  'startsAt',
  'endsAt',
  'priority',
];

// Copies only the fields we allow, and cleans them up.
const pickFields = (body = {}) => {
  const data = {};

  EDITABLE_FIELDS.forEach((field) => {
    if (body[field] === undefined) return;

    if (field === 'active') {
      data.active = Boolean(body.active);
    } else if (field === 'priority') {
      data.priority =
        body.priority === '' || body.priority === null
          ? 0
          : Number(body.priority);
    } else if (field === 'startsAt' || field === 'endsAt') {
      data[field] = body[field] || null;
    } else {
      data[field] = String(body[field] ?? '').trim();
    }
  });

  return data;
};

/*
|--------------------------------------------------------------------------
| GET ACTIVE FLIP ADVERTISEMENTS  (public - used by the homepage)
|--------------------------------------------------------------------------
| Dates are filtered in JavaScript, same as the main advertisements route.
*/
router.get('/', async (req, res) => {
  try {
    const now = new Date();

    const items = await FlipAdvertisement.find({ active: true })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const activeItems = items.filter((item) => {
      const startsAt = item.startsAt ? new Date(item.startsAt) : null;
      const endsAt = item.endsAt ? new Date(item.endsAt) : null;

      return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
    });

    return res.json({
      success: true,
      count: activeItems.length,
      data: activeItems,
    });
  } catch (error) {
    console.error('Unable to load flip advertisements:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load flip advertisements.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET ALL FLIP ADVERTISEMENTS  (admin list - includes inactive/expired)
|--------------------------------------------------------------------------
*/
router.get('/all', async (req, res) => {
  try {
    const items = await FlipAdvertisement.find()
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: items.length,
      data: items,
    });
  } catch (error) {
    console.error('Unable to load all flip advertisements:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load flip advertisements.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| CREATE
|--------------------------------------------------------------------------
*/
router.post('/', async (req, res) => {
  try {
    const data = pickFields(req.body);

    if (!data.title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required.',
      });
    }

    const item = await FlipAdvertisement.create(data);

    return res.status(201).json({
      success: true,
      message: 'Flip advertisement created successfully.',
      data: item,
    });
  } catch (error) {
    console.error('Unable to create flip advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create flip advertisement.',
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE
|--------------------------------------------------------------------------
*/
router.put('/:id', async (req, res) => {
  try {
    const item = await FlipAdvertisement.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Flip advertisement not found.',
      });
    }

    const data = pickFields(req.body);

    if (data.title === '') {
      return res.status(400).json({
        success: false,
        message: 'Title cannot be empty.',
      });
    }

    Object.assign(item, data);
    await item.save();

    return res.json({
      success: true,
      message: 'Flip advertisement updated successfully.',
      data: item,
    });
  } catch (error) {
    console.error('Unable to update flip advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update flip advertisement.',
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| DELETE
|--------------------------------------------------------------------------
*/
router.delete('/:id', async (req, res) => {
  try {
    const item = await FlipAdvertisement.findById(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Flip advertisement not found.',
      });
    }

    await FlipAdvertisement.findByIdAndDelete(req.params.id);

    return res.json({
      success: true,
      message: 'Flip advertisement deleted successfully.',
    });
  } catch (error) {
    console.error('Unable to delete flip advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to delete flip advertisement.',
      error: error.message,
    });
  }
});

module.exports = router;
