const express = require('express');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const Advertisement = require('../models/Advertisement');

const router = express.Router();

// HTML form fields and some clients send booleans as strings.
// Avoid Boolean('false') becoming true.
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

/*
|--------------------------------------------------------------------------
| GET ACTIVE ADVERTISEMENTS
|--------------------------------------------------------------------------
| We intentionally filter startsAt/endsAt in JavaScript instead of
| using MongoDB date operators. This avoids the Mongoose CastError
| currently affecting the deployed advertisement endpoint.
*/
const sendActiveAdvertisements = async (req, res) => {
  try {
    const now = new Date();

    const ads = await Advertisement.find({ active: true })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    const activeAds = ads.filter((ad) => {
      const startsAt = ad.startsAt ? new Date(ad.startsAt) : null;
      const endsAt = ad.endsAt ? new Date(ad.endsAt) : null;

      const hasStarted = !startsAt || startsAt <= now;
      const hasNotExpired = !endsAt || endsAt > now;

      return hasStarted && hasNotExpired;
    });

    return res.json({
      success: true,
      count: activeAds.length,
      data: activeAds,
    });
  } catch (error) {
    console.error('Unable to load advertisements:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to load advertisements.',
    });
  }
};

// Admin management list: include inactive and scheduled banners as well.
// Keep this route before the public '/' route so '/all' is not treated as an ID.
router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const advertisements = await Advertisement.find({})
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: advertisements.length,
      data: advertisements,
    });
  } catch (error) {
    console.error('Unable to load all advertisements:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to load advertisements.',
    });
  }
});

router.get('/', sendActiveAdvertisements);

/*
|--------------------------------------------------------------------------
| CREATE ADVERTISEMENT
|--------------------------------------------------------------------------
*/
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      title,
      message,
      image,
      imageUrl,
      mobileImageUrl,
      backgroundColor,
      marketingMessage,
      seoTitle,
      seoDescription,
      seoKeywords,
      imageAlt,
      link,
      buttonText,
      buttonLink,
      active,
      startsAt,
      endsAt,
      priority,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required.',
      });
    }

    const advertisement = await Advertisement.create({
      title: title.trim(),
      message: message.trim(),
      image: image || '',
      imageUrl: imageUrl || '',
      mobileImageUrl: mobileImageUrl || '',
      backgroundColor: /^#[0-9a-fA-F]{6}$/.test(String(backgroundColor || '#eaf6ee')) ? String(backgroundColor || '#eaf6ee') : '#eaf6ee',
      marketingMessage: String(marketingMessage || 'Power Your Day with Reliable Technology.').trim().slice(0, 120),
      seoTitle: String(seoTitle || '').trim().slice(0, 70),
      seoDescription: String(seoDescription || '').trim().slice(0, 160),
      seoKeywords: Array.isArray(seoKeywords) ? seoKeywords.map(value => String(value).trim()).filter(Boolean).slice(0, 15) : String(seoKeywords || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 15),
      imageAlt: String(imageAlt || '').trim().slice(0, 180),
      link: link || '/shop',
      buttonText: buttonText || 'Shop Now',
      buttonLink: buttonLink || link || '/shop',
      active: parseBoolean(active, true),
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      priority:
        priority !== undefined && priority !== ''
          ? Number(priority)
          : 0,
    });

    return res.status(201).json({
      success: true,
      message: 'Advertisement created successfully.',
      data: advertisement,
    });
  } catch (error) {
    console.error('Unable to create advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to create advertisement.',
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| UPDATE ADVERTISEMENT
|--------------------------------------------------------------------------
*/
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const {
      title,
      message,
      image,
      imageUrl,
      mobileImageUrl,
      seoTitle,
      seoDescription,
      seoKeywords,
      imageAlt,
      link,
      buttonText,
      buttonLink,
      active,
      startsAt,
      endsAt,
      priority,
    } = req.body;

    const advertisement = await Advertisement.findById(req.params.id);

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    if (title !== undefined) {
      advertisement.title = String(title).trim();
    }

    if (message !== undefined) {
      advertisement.message = String(message).trim();
    }

    if (image !== undefined) {
      advertisement.image = image || '';
    }

    if (imageUrl !== undefined) {
      advertisement.imageUrl = imageUrl || '';
    }

    if (mobileImageUrl !== undefined) {
      advertisement.mobileImageUrl = mobileImageUrl || '';
    }

    if (backgroundColor !== undefined) {
      advertisement.backgroundColor = /^#[0-9a-fA-F]{6}$/.test(String(backgroundColor)) ? String(backgroundColor) : '#eaf6ee';
    }
    if (marketingMessage !== undefined) {
      advertisement.marketingMessage = String(marketingMessage || '').trim().slice(0, 120);
    }

    if (seoTitle !== undefined) advertisement.seoTitle = String(seoTitle || '').trim().slice(0, 70);
    if (seoDescription !== undefined) advertisement.seoDescription = String(seoDescription || '').trim().slice(0, 160);
    if (seoKeywords !== undefined) advertisement.seoKeywords = (Array.isArray(seoKeywords) ? seoKeywords : String(seoKeywords || '').split(',')).map(value => String(value).trim()).filter(Boolean).slice(0, 15);
    if (imageAlt !== undefined) advertisement.imageAlt = String(imageAlt || '').trim().slice(0, 180);

    if (link !== undefined) {
      advertisement.link = link || '/shop';
    }

    if (buttonText !== undefined) {
      advertisement.buttonText = buttonText || 'Shop Now';
    }

    if (buttonLink !== undefined) {
      advertisement.buttonLink = buttonLink || '/shop';
    }

    if (active !== undefined) {
      advertisement.active = parseBoolean(active, advertisement.active);
    }

    if (startsAt !== undefined) {
      advertisement.startsAt = startsAt || null;
    }

    if (endsAt !== undefined) {
      advertisement.endsAt = endsAt || null;
    }

    if (priority !== undefined && priority !== '') {
      advertisement.priority = Number(priority);
    }

    await advertisement.save();

    return res.json({
      success: true,
      message: 'Advertisement updated successfully.',
      data: advertisement,
    });
  } catch (error) {
    console.error('Unable to update advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to update advertisement.',
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| DELETE ADVERTISEMENT
|--------------------------------------------------------------------------
*/
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const advertisement = await Advertisement.findById(req.params.id);

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found.',
      });
    }

    await Advertisement.findByIdAndDelete(req.params.id);

    return res.json({
      success: true,
      message: 'Advertisement deleted successfully.',
    });
  } catch (error) {
    console.error('Unable to delete advertisement:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to delete advertisement.',
      error: error.message,
    });
  }
});

module.exports = router;
