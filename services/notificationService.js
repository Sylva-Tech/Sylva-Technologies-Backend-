const Notification = require('../models/Notification');
const User = require('../models/User');
const {
  sendMail,
} = require('./emailService');

/* ==========================================
 * CREATE NOTIFICATION
 * ========================================== */

const createNotification = async ({
  userId,
  type,
  title,
  message,
  relatedId = null,
  relatedModel = '',
  sendEmail = true,
  emailSubject = null,
}) => {
  if (!userId) {
    throw new Error('Notification userId is required.');
  }

  if (!type) {
    throw new Error('Notification type is required.');
  }

  if (!title) {
    throw new Error('Notification title is required.');
  }

  if (!message) {
    throw new Error('Notification message is required.');
  }

  const notification = await Notification.create({
    user: userId,
    type,
    title,
    message,
    relatedId,
    relatedModel,
  });

  /*
   * Email is deliberately separate from notification
   * creation. If email fails, the in-app notification
   * still remains available.
   */

  if (sendEmail) {
    try {
      const user = await User.findById(userId).select(
        'name email'
      );

      if (user?.email) {
        const subject =
          emailSubject ||
          `${title} - Sylva Technologies`;

        const html = `
          <div
            style="
              font-family: Arial, sans-serif;
              background: #f4f7fb;
              padding: 24px;
              color: #1a1a1a;
            "
          >
            <div
              style="
                max-width: 620px;
                margin: 0 auto;
                background: #ffffff;
                border-radius: 12px;
                overflow: hidden;
                border: 1px solid #e5e7eb;
              "
            >
              <div
                style="
                  background: linear-gradient(
                    135deg,
                    #0f172a,
                    #166534
                  );
                  padding: 24px 32px;
                  color: #ffffff;
                "
              >
                <h2 style="margin: 0;">
                  Sylva Technologies
                </h2>
              </div>

              <div style="padding: 32px;">
                <h3
                  style="
                    margin-top: 0;
                    font-size: 22px;
                  "
                >
                  ${title}
                </h3>

                <p>
                  Hello <strong>${user.name || 'Seller'}</strong>,
                </p>

                <p>
                  ${message}
                </p>

                <p>
                  Please log in to your Sylva Technologies
                  account to view more information.
                </p>
              </div>

              <div
                style="
                  background: #f8fafc;
                  color: #475569;
                  padding: 18px 32px;
                  font-size: 12px;
                  border-top: 1px solid #e5e7eb;
                "
              >
                &copy; 2026 Sylva Technologies.
                All rights reserved.
              </div>
            </div>
          </div>
        `;

        const result = await sendMail({
          to: user.email,
          subject,
          html,
          text: `${title}\n\n${message}`,
        });

        if (result?.success) {
          notification.emailSent = true;
          notification.emailSentAt = new Date();
          await notification.save();
        }
      }
    } catch (error) {
      /*
       * Never allow an email failure to break the
       * seller/admin operation that created the notification.
       */

      console.error(
        'Notification email failed:',
        error.message
      );
    }
  }

  return notification;
};

/* ==========================================
 * MARK AS READ
 * ========================================== */

const markNotificationAsRead = async (
  notificationId,
  userId
) => {
  return Notification.findOneAndUpdate(
    {
      _id: notificationId,
      user: userId,
    },
    {
      isRead: true,
      readAt: new Date(),
    },
    {
      new: true,
    }
  );
};

/* ==========================================
 * MARK ALL AS READ
 * ========================================== */

const markAllNotificationsAsRead = async (userId) => {
  return Notification.updateMany(
    {
      user: userId,
      isRead: false,
    },
    {
      isRead: true,
      readAt: new Date(),
    }
  );
};

module.exports = {
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};