const express = require('express');

const mongoose = require('mongoose');

const Advertisement = require('../models/Advertisement');

const {
  protect,
  adminOnly,
} = require('../middleware/authMiddleware');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET ACTIVE ADVERTISEMENTS
|--------------------------------------------------------------------------
| GET /api/advertisements
|--------------------------------------------------------------------------
*/

const buildActiveAdvertisementQuery = () => {
  const now = new Date();

  return {
    active: true,
    $and: [
      {
        $or: [
          { startsAt: null },
          { startsAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { endsAt: null },
          { endsAt: { $gte: now } },
        ],
      },
    ],
  };
};

const sendActiveAdvertisements = async (req, res) => {
  try {
    const ads = await Advertisement.find(buildActiveAdvertisementQuery())
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: ads.length,
      data: ads,
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
router.get('/active', sendActiveAdvertisements);

/*
|--------------------------------------------------------------------------
| CREATE ADVERTISEMENT
|--------------------------------------------------------------------------
| POST /api/advertisements
|--------------------------------------------------------------------------
*/

router.post(
  '/',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const {
        title,
        message,
        image,
        link,
        active,
        startsAt,
        endsAt,
      } = req.body;

      const trimmedTitle =
        String(title || '').trim();

      const trimmedMessage =
        String(message || '').trim();

      if (!trimmedTitle) {
        return res.status(400).json({
          success: false,
          message:
            'Advertisement title is required.',
        });
      }

      if (!trimmedMessage) {
        return res.status(400).json({
          success: false,
          message:
            'Advertisement message is required.',
        });
      }

      let parsedStartsAt = null;
      let parsedEndsAt = null;

      if (startsAt) {
        parsedStartsAt =
          new Date(startsAt);

        if (
          Number.isNaN(
            parsedStartsAt.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid advertisement start date.',
          });
        }
      }

      if (endsAt) {
        parsedEndsAt =
          new Date(endsAt);

        if (
          Number.isNaN(
            parsedEndsAt.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid advertisement end date.',
          });
        }
      }

      if (
        parsedStartsAt &&
        parsedEndsAt &&
        parsedEndsAt <= parsedStartsAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Advertisement end date must be after the start date.',
        });
      }

      const ad =
        await Advertisement.create({
          title: trimmedTitle,

          message: trimmedMessage,

          image:
            image
              ? String(image).trim()
              : '',

          link:
            link
              ? String(link).trim()
              : '',

          active: active !== false,

          startsAt:
            parsedStartsAt,

          endsAt:
            parsedEndsAt,
        });

      return res.status(201).json({
        success: true,
        message:
          'Advertisement created successfully.',
        data: ad,
      });
    } catch (error) {
      console.error(
        'Unable to create advertisement:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to create advertisement.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| UPDATE ADVERTISEMENT
|--------------------------------------------------------------------------
| PUT /api/advertisements/:id
|--------------------------------------------------------------------------
*/

router.put(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid advertisement ID.',
        });
      }

      const allowedFields = [
        'title',
        'message',
        'image',
        'link',
        'active',
        'startsAt',
        'endsAt',
      ];

      const update = {};

      for (
        const field of allowedFields
      ) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            field
          )
        ) {
          update[field] =
            req.body[field];
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          update,
          'title'
        )
      ) {
        update.title =
          String(
            update.title || ''
          ).trim();

        if (!update.title) {
          return res.status(400).json({
            success: false,
            message:
              'Advertisement title is required.',
          });
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          update,
          'message'
        )
      ) {
        update.message =
          String(
            update.message || ''
          ).trim();

        if (!update.message) {
          return res.status(400).json({
            success: false,
            message:
              'Advertisement message is required.',
          });
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          update,
          'startsAt'
        )
      ) {
        if (
          update.startsAt ===
            null ||
          update.startsAt === ''
        ) {
          update.startsAt = null;
        } else {
          const date =
            new Date(
              update.startsAt
            );

          if (
            Number.isNaN(
              date.getTime()
            )
          ) {
            return res.status(400).json({
              success: false,
              message:
                'Invalid advertisement start date.',
            });
          }

          update.startsAt =
            date;
        }
      }

      if (
        Object.prototype.hasOwnProperty.call(
          update,
          'endsAt'
        )
      ) {
        if (
          update.endsAt ===
            null ||
          update.endsAt === ''
        ) {
          update.endsAt = null;
        } else {
          const date =
            new Date(
              update.endsAt
            );

          if (
            Number.isNaN(
              date.getTime()
            )
          ) {
            return res.status(400).json({
              success: false,
              message:
                'Invalid advertisement end date.',
            });
          }

          update.endsAt =
            date;
        }
      }

      /*
       * Validate date relationship when
       * both dates are being updated.
       */
      if (
        update.startsAt &&
        update.endsAt &&
        update.endsAt <=
          update.startsAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Advertisement end date must be after the start date.',
        });
      }

      const ad =
        await Advertisement.findByIdAndUpdate(
          req.params.id,
          update,
          {
            new: true,
            runValidators: true,
          }
        );

      if (!ad) {
        return res.status(404).json({
          success: false,
          message:
            'Advertisement not found.',
        });
      }

      return res.json({
        success: true,
        message:
          'Advertisement updated successfully.',
        data: ad,
      });
    } catch (error) {
      console.error(
        'Unable to update advertisement:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update advertisement.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| DELETE ADVERTISEMENT
|--------------------------------------------------------------------------
| DELETE /api/advertisements/:id
|--------------------------------------------------------------------------
*/

router.delete(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid advertisement ID.',
        });
      }

      const ad =
        await Advertisement.findByIdAndDelete(
          req.params.id
        );

      if (!ad) {
        return res.status(404).json({
          success: false,
          message:
            'Advertisement not found.',
        });
      }

      return res.json({
        success: true,
        message:
          'Advertisement deleted successfully.',
      });
    } catch (error) {
      console.error(
        'Unable to delete advertisement:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to delete advertisement.',
      });
    }
  }
);

module.exports = router;