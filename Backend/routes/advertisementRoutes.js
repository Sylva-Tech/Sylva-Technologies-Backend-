const express = require('express');
const Advertisement = require('../models/Advertisement');

const router = express.Router();

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

router.get('/', sendActiveAdvertisements);

/*
|--------------------------------------------------------------------------
| CREATE ADVERTISEMENT
|--------------------------------------------------------------------------
*/
router.post('/', async (req, res) => {
  try {
    const {
      title,
      message,
      image,
      imageUrl,
      mobileImageUrl,
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
      link: link || '/shop',
      buttonText: buttonText || 'Shop Now',
      buttonLink: buttonLink || link || '/shop',
      active: active !== undefined ? Boolean(active) : true,
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
router.put('/:id', async (req, res) => {
  try {
    const {
      title,
      message,
      image,
      imageUrl,
      mobileImageUrl,
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
      advertisement.active = Boolean(active);
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
router.delete('/:id', async (req, res) => {
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
