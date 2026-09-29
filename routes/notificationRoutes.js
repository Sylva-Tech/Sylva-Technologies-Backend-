const express = require('express');

const Notification = require('../models/Notification');
const {
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require('../services/notificationService');

const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET MY NOTIFICATIONS
|--------------------------------------------------------------------------
*/

router.get('/', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error(
      'Get notifications error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to load notifications.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET UNREAD COUNT
|--------------------------------------------------------------------------
*/

router.get('/unread-count', protect, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error(
      'Get unread notification count error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to load notification count.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| MARK ONE NOTIFICATION AS READ
|--------------------------------------------------------------------------
*/

router.patch('/:id/read', protect, async (req, res) => {
  try {
    const notification =
      await markNotificationAsRead(
        req.params.id,
        req.user._id
      );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    return res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    console.error(
      'Mark notification read error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to update notification.',
    });
  }
});

/*
|--------------------------------------------------------------------------
| MARK ALL NOTIFICATIONS AS READ
|--------------------------------------------------------------------------
*/

router.patch('/read-all', protect, async (req, res) => {
  try {
    await markAllNotificationsAsRead(
      req.user._id
    );

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read.',
    });
  } catch (error) {
    console.error(
      'Mark all notifications read error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Unable to update notifications.',
    });
  }
});

module.exports = router;