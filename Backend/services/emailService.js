const { Resend } = require('resend');

const {
  verificationEmailTemplate,
} = require('../templates/verificationEmail');

const {
  passwordResetTemplate,
} = require('../templates/passwordReset');

const {
  orderConfirmationTemplate,
} = require('../templates/orderConfirmation');

const {
  adminOrderNotificationTemplate,
} = require('../templates/adminOrderNotification');

const {
  orderStatusUpdateTemplate,
} = require('../templates/orderStatusUpdate');

// ============================================================
// INITIALIZE RESEND
// ============================================================

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// ============================================================
// GET SENDER EMAIL
// ============================================================

/**
 * Get the correct sender email based on the purpose of the email.
 */
const getFromEmail = (type = 'verification') => {
  const senders = {
    verification:
      process.env.EMAIL_FROM_VERIFICATION ||
      'Sylva Technologies <verification@sylvatechnologies.co.ke>',

    passwordReset:
      process.env.EMAIL_FROM_PASSWORD_RESET ||
      'Sylva Technologies <resetpassword@sylvatechnologies.co.ke>',

    orders:
      process.env.EMAIL_FROM_ORDERS ||
      'Sylva Technologies <order@sylvatechnologies.co.ke>',

    payment:
      process.env.EMAIL_FROM_PAYMENT ||
      'Sylva Technologies <payment@sylvatechnologies.co.ke>',

    admin:
      process.env.EMAIL_FROM_ADMIN ||
      'Sylva Technologies <admin@sylvatechnologies.co.ke>',

    sales:
      process.env.EMAIL_FROM_SALES ||
      'Sylva Technologies <sales@sylvatechnologies.co.ke>',

    support:
      process.env.EMAIL_FROM_SUPPORT ||
      'Sylva Technologies <support@sylvatechnologies.co.ke>',

    sellers:
      process.env.EMAIL_FROM_SELLERS ||
      'Sylva Technologies <sellers@sylvatechnologies.co.ke>',
  };

  return senders[type] || senders.verification;
};

// ============================================================
// CUSTOMER CARE FOOTER — APPLY TO EVERY OUTGOING EMAIL
// ============================================================

const CUSTOMER_CARE_PHONE = '0700932014';

const appendCustomerCareHtml = (html = '') => {
  const content = String(html || '');
  if (content.includes(CUSTOMER_CARE_PHONE)) return content;

  const footer = `
    <div style="margin:24px auto 0;padding:16px 20px;max-width:640px;border-top:1px solid #e5e7eb;background:#f8fafc;color:#475569;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;text-align:center;">
      <strong style="color:#166534;">Sylva Technologies Customer Care</strong><br>
      Need help with this email or your order? Call
      <a href="tel:0700932014" style="color:#166534;font-weight:bold;text-decoration:none;">0700932014</a>.
    </div>
  `;

  if (/<\/body\s*>/i.test(content)) {
    return content.replace(/<\/body\s*>/i, footer + '</body>');
  }
  return content + footer;
};

const appendCustomerCareText = (text = '') => {
  const content = String(text || '');
  if (content.includes(CUSTOMER_CARE_PHONE)) return content;
  return content + '\n\nSylva Technologies Customer Care: 0700932014';
};

// ============================================================
// GENERIC SEND MAIL FUNCTION
// ============================================================

/**
 * Send an email using Resend.
 */
const sendMail = async ({
  to,
  subject,
  html,
  text,
  sender = 'verification',
}) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      'Email service is not configured. Missing RESEND_API_KEY.'
    );

    return {
      success: false,
      message:
        'Email service not configured. Please set RESEND_API_KEY.',
    };
  }

  if (!resend) {
    console.error(
      'Resend client could not be initialized.'
    );

    return {
      success: false,
      message: 'Email service is unavailable.',
    };
  }

  try {
    const { data, error } =
      await resend.emails.send({
        from: getFromEmail(sender),
        to,
        ...(sender === 'payment'
          ? {
              replyTo:
                process.env.EMAIL_REPLY_TO_SUPPORT ||
                'support@sylvatechnologies.co.ke',
            }
          : {}),
        // Keep an internal admin copy of business emails. Never copy account
        // verification or password-reset codes/links to another mailbox.
        ...(sender !== 'verification' && sender !== 'passwordReset'
          ? {
              bcc: [
                process.env.ADMIN_EMAIL ||
                  'admin@sylvatechnologies.co.ke',
              ],
            }
          : {}),
        subject,
        html: appendCustomerCareHtml(html),
        text: appendCustomerCareText(text),
      });

    if (error) {
      console.error(
        'Resend email error:',
        error
      );

      return {
        success: false,
        message:
          error.message ||
          'Unable to send email at the moment. Please try again later.',
      };
    }

    return {
      success: true,
      messageId: data?.id || null,
    };
  } catch (error) {
    console.error(
      'Email send failed:',
      error.message
    );

    return {
      success: false,
      message:
        'Unable to send email at the moment. Please try again later.',
    };
  }
};

// ============================================================
// VERIFICATION EMAIL - OTP
// ============================================================

/**
 * Verification email using OTP.
 */
const sendVerificationEmail = async ({
  to,
  name,
  otp,
  expiresInMinutes,
}) => {
  const html =
    verificationEmailTemplate({
      name,
      otp,
      expiresInMinutes,
    });

  return sendMail({
    to,
    subject:
      'Verify your Sylva Technologies account',
    html,
    text: `Hello ${name}, your Sylva Technologies verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    sender: 'verification',
  });
};

// ============================================================
// PASSWORD RESET EMAIL - OTP ONLY
// ============================================================

/**
 * Password reset email using OTP.
 */
const sendPasswordResetEmail = async ({
  to,
  name,
  otp,
  expiresInMinutes,
}) => {
  const html =
    passwordResetTemplate({
      name,
      otp,
      expiresInMinutes,
    });

  return sendMail({
    to,
    subject:
      'Reset your Sylva Technologies password',
    html,
    text: `Hello ${name}, your Sylva Technologies password reset code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    sender: 'passwordReset',
  });
};

// ============================================================
// VERIFICATION EMAIL - LINK
// ============================================================

/**
 * Verification email using a secure link.
 */
const sendVerificationCodeAndLinkEmail = async ({
  to,
  name,
  otp,
  verifyLink,
  expiresInMinutes,
}) => {
  const safeName = name || 'Customer';

  const html = `
    <div
      style="
        font-family:Arial,sans-serif;
        background:#f4f7fb;
        padding:24px;
        color:#1a1a1a;
      "
    >
      <div
        style="
          max-width:620px;
          margin:0 auto;
          background:#ffffff;
          border-radius:12px;
          overflow:hidden;
          border:1px solid #e5e7eb;
        "
      >
        <div
          style="
            background:linear-gradient(135deg,#0f172a,#1d4ed8);
            padding:24px 32px;
            color:#fff;
          "
        >
          <h2 style="margin:0;font-size:26px;">
            Sylva Technologies
          </h2>
        </div>

        <div style="padding:32px;">
          <h3 style="margin-top:0; font-size:22px;">Verify your email address</h3>
          <p>Hello <strong>${safeName}</strong>,</p>
          <p>Your verification code is:</p>
          <div style="background:#eff6ff; border:2px dashed #2563eb; border-radius:10px; text-align:center; padding:20px; margin:24px 0;">
            <span style="font-size:32px; font-weight:bold; letter-spacing:8px; color:#1d4ed8;">${otp}</span>
          </div>
          <p>Enter this code on the verification page, or click the button below to verify directly.</p>
          <p style="text-align:center;">
            <a href="${verifyLink}" style="display:inline-block; background:#1d4ed8; color:#fff; padding:12px 20px; border-radius:8px; text-decoration:none;">
              Verify My Email
            </a>
          </p>
          <p>This code and link expire in ${expiresInMinutes} minutes.</p>
          <p>If the button does not work, copy and paste this link:</p>
          <p style="word-break:break-all;">${verifyLink}</p>
        </div>

        <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
          © 2026 Sylva Technologies. All rights reserved.
        </div>
      </div>
    </div>
  `;

  return sendMail({
    to,
    subject: 'Verify your Sylva Technologies email',
    html,
    text: `Hello ${safeName}, your Sylva Technologies verification code is ${otp}. Visit ${verifyLink} to verify your account. The code expires in ${expiresInMinutes} minutes.`,
    sender: 'verification',
  });
};

const sendVerificationLinkEmail = async ({
  to,
  name,
  verifyLink,
  expiresInMinutes,
}) => {
  const safeName = name || 'Customer';

  const html = `
    <div
      style="
        font-family:Arial,sans-serif;
        background:#f4f7fb;
        padding:24px;
        color:#1a1a1a;
      "
    >
      <div
        style="
          max-width:620px;
          margin:0 auto;
          background:#ffffff;
          border-radius:12px;
          overflow:hidden;
          border:1px solid #e5e7eb;
        "
      >

        <div
          style="
            background:linear-gradient(135deg,#0f172a,#1d4ed8);
            padding:24px 32px;
            color:#fff;
          "
        >
          <h2 style="margin:0;font-size:26px;">
            Sylva Technologies
          </h2>
        </div>

        <div style="padding:32px;">

          <h3
            style="
              margin-top:0;
              font-size:22px;
            "
          >
            Verify your email address
          </h3>

          <p>
            Hello <strong>${safeName}</strong>,
          </p>

          <p>
            Click the button below to verify your
            Sylva Technologies account.
            This link expires in
            ${expiresInMinutes} minutes.
          </p>

          <p style="text-align:center;">
            <a
              href="${verifyLink}"
              style="
                display:inline-block;
                background:#1d4ed8;
                color:#fff;
                padding:12px 20px;
                border-radius:8px;
                text-decoration:none;
              "
            >
              Verify My Email
            </a>
          </p>

          <p>
            If the button doesn't work, copy and
            paste this link into your browser:
          </p>

          <p style="word-break:break-all;">
            ${verifyLink}
          </p>

        </div>

        <div
          style="
            background:#f8fafc;
            color:#475569;
            padding:18px 32px;
            font-size:12px;
            border-top:1px solid #e5e7eb;
          "
        >
          © 2026 Sylva Technologies.
          All rights reserved.
        </div>

      </div>
    </div>
  `;

  return sendMail({
    to,
    subject:
      'Verify your Sylva Technologies email',
    html,
    text:
      `Hello ${safeName}, verify your email by visiting: ${verifyLink}`,
    sender: 'verification',
  });
};

// ============================================================
// PASSWORD RESET EMAIL - LINK ONLY
// ============================================================

/**
 * Password reset email using a secure reset link.
 *
 * This function is kept separately because authRoutes.js
 * may use sendPasswordResetLinkEmail for link-based resets.
 */
const sendPasswordResetLinkEmail = async ({
  to,
  name,
  resetLink,
  expiresInMinutes = 10,
}) => {
  const safeName = name || 'Customer';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>Password Reset</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f5f7f6;
          font-family:Arial,Helvetica,sans-serif;
          color:#222;
        "
      >

        <div
          style="
            max-width:600px;
            margin:0 auto;
            padding:30px 15px;
          "
        >

          <div
            style="
              background:#ffffff;
              border-radius:12px;
              padding:30px;
              border:1px solid #e5e7eb;
            "
          >

            <h2
              style="
                margin-top:0;
                color:#166534;
              "
            >
              Sylva Technologies
            </h2>

            <h3>Password Reset Request</h3>

            <p>
              Hello ${safeName},
            </p>

            <p>
              We received a request to reset the password
              for your Sylva Technologies account.
            </p>

            <p>
              Click the button below to continue.
            </p>

            <div
              style="
                text-align:center;
                margin:30px 0;
              "
            >
              <a
                href="${resetLink}"
                style="
                  display:inline-block;
                  background:#166534;
                  color:#ffffff;
                  text-decoration:none;
                  padding:14px 24px;
                  border-radius:8px;
                  font-weight:bold;
                "
              >
                Reset My Password
              </a>
            </div>

            <p
              style="
                font-size:14px;
                color:#666;
              "
            >
              This password reset link expires in
              <strong>
                ${expiresInMinutes} minutes
              </strong>.
            </p>

            <p
              style="
                font-size:14px;
                color:#666;
              "
            >
              If the button doesn't work, copy and paste
              this link into your browser:
            </p>

            <p
              style="
                font-size:13px;
                color:#555;
                word-break:break-all;
              "
            >
              ${resetLink}
            </p>

            <p
              style="
                font-size:14px;
                color:#666;
              "
            >
              If you did not request a password reset,
              you can safely ignore this email.
            </p>

            <hr
              style="
                border:none;
                border-top:1px solid #e5e7eb;
                margin:30px 0;
              "
            />

            <p
              style="
                font-size:13px;
                color:#777;
                margin-bottom:0;
              "
            >
              Sylva Technologies<br />
              Empowering Your Digital Life
            </p>

          </div>
        </div>

      </body>
    </html>
  `;

  const text = `
Sylva Technologies - Password Reset

Hello ${safeName},

We received a request to reset your Sylva Technologies account password.

Open the password recovery page using this link:

${resetLink}

This link expires in ${expiresInMinutes} minutes.

If you did not request this password reset, you can safely ignore this email.

Sylva Technologies
Empowering Your Digital Life
  `;

  return sendMail({
    to,
    subject:
      'Reset your Sylva Technologies password',
    html,
    text,
    sender: 'passwordReset',
  });
};

// ============================================================
// PASSWORD RESET EMAIL - CODE + LINK
// ============================================================

/**
 * Password reset email containing both:
 *
 * 1. Six-digit reset code
 * 2. Secure password reset link
 */
const sendPasswordResetCodeAndLinkEmail = async ({
  to,
  name,
  resetCode,
  resetLink,
  expiresInMinutes = 10,
}) => {
  const safeName = name || 'Customer';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>Password Reset</title>
      </head>

      <body
        style="
          margin:0;
          padding:0;
          background:#f5f7f6;
          font-family:Arial,Helvetica,sans-serif;
          color:#222;
        "
      >

        <div
          style="
            max-width:600px;
            margin:0 auto;
            padding:30px 15px;
          "
        >

          <div
            style="
              background:#ffffff;
              border-radius:12px;
              padding:30px;
              border:1px solid #e5e7eb;
            "
          >

            <h2
              style="
                margin-top:0;
                color:#166534;
              "
            >
              Sylva Technologies
            </h2>

            <h3>Password Reset Request</h3>

            <p>
              Hello ${safeName},
            </p>

            <p>
              We received a request to reset the password
              for your Sylva Technologies account.
            </p>

            <p>
              Your password reset code is:
            </p>

            <div
              style="
                background:#f0fdf4;
                border:2px dashed #16a34a;
                border-radius:10px;
                padding:18px;
                text-align:center;
                margin:20px 0;
              "
            >
              <span
                style="
                  font-size:32px;
                  font-weight:bold;
                  letter-spacing:8px;
                  color:#166534;
                "
              >
                ${resetCode}
              </span>
            </div>

            <p>
              This code expires in
              <strong>
                ${expiresInMinutes} minutes
              </strong>.
            </p>

            <p>
              You can also open the password recovery page
              using the button below:
            </p>

            <div
              style="
                text-align:center;
                margin:30px 0;
              "
            >
              <a
                href="${resetLink}"
                style="
                  display:inline-block;
                  background:#166534;
                  color:#ffffff;
                  text-decoration:none;
                  padding:14px 24px;
                  border-radius:8px;
                  font-weight:bold;
                "
              >
                Reset My Password
              </a>
            </div>

            <p
              style="
                font-size:14px;
                color:#666;
              "
            >
              After opening the page, enter the
              6-digit code above before choosing
              your new password.
            </p>

            <p
              style="
                font-size:14px;
                color:#666;
              "
            >
              If you did not request a password reset,
              you can safely ignore this email.
            </p>

            <hr
              style="
                border:none;
                border-top:1px solid #e5e7eb;
                margin:30px 0;
              "
            />

            <p
              style="
                font-size:13px;
                color:#777;
                margin-bottom:0;
              "
            >
              Sylva Technologies<br />
              Empowering Your Digital Life
            </p>

          </div>
        </div>

      </body>
    </html>
  `;

  const text = `
Sylva Technologies - Password Reset

Hello ${safeName},

We received a request to reset your Sylva Technologies account password.

Your password reset code is:

${resetCode}

The code expires in ${expiresInMinutes} minutes.

Open the password recovery page:

${resetLink}

Enter the 6-digit code before choosing your new password.

If you did not request this password reset, you can safely ignore this email.

Sylva Technologies
Empowering Your Digital Life
  `;

  return sendMail({
    to,
    subject:
      'Your Sylva Technologies Password Reset Code',
    html,
    text,
    sender: 'passwordReset',
  });
};

// ============================================================
// CUSTOMER ORDER CONFIRMATION
// ============================================================

/**
 * Customer order confirmation.
 */
const sendOrderConfirmationEmail = async ({
  to,
  customerName,
  order,
  orderDate,
}) => {
  const html =
    orderConfirmationTemplate({
      customerName,
      order,
      orderDate,
    });

  return sendMail({
    to,
    subject:
      `Payment Confirmation & Order Receipt - ${order.orderNumber}`,
    html,
    text:
      `Hello ${customerName}, your payment for Sylva Technologies order ${order.orderNumber} has been confirmed. Your order is now being processed. Tracking code: ${order.trackingCode || order.orderNumber}. Please reply to support@sylvatechnologies.co.ke if you need assistance.`,
    sender: 'payment',
  });
};

// ============================================================
// ADMIN ORDER NOTIFICATION
// ============================================================

/**
 * Admin notification when a new order is received.
 */
const sendAdminOrderNotificationEmail =
  async ({
    to,
    order,
    customer,
  }) => {
    const html =
      adminOrderNotificationTemplate({
        order,
        customer,
      });

    return sendMail({
      to:
        to ||
        process.env.ORDERS_EMAIL ||
        process.env.SALES_EMAIL ||
        'sales@sylvatechnologies.co.ke',
      subject:
        `${order.paymentStatus === 'Paid' ? 'Payment received - order' : 'New order received'} ${order.orderNumber}`,
      html,
      text:
        `A new order ${order.orderNumber} has been placed by ${customer.name}. Tracking code: ${order.trackingCode || order.orderNumber}. Payment: ${order.paymentMethod}. Delivery: ${order.customerDetails?.deliveryLocation || order.customerDetails?.address || 'N/A'}.`,
      sender: 'orders',
    });
  };

// ============================================================
// CUSTOMER ORDER STATUS UPDATE
// ============================================================

/**
 * Customer order status update.
 */
const sendOrderStatusUpdateEmail = async ({
  to,
  customerName,
  orderNumber,
  status,
  deliveryConfirmationLink = '',
}) => {
  const safeName = String(customerName || 'Customer').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const baseHtml = orderStatusUpdateTemplate({ customerName: safeName, orderNumber, status });
  const safeOrderNumber = String(orderNumber || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeStatus = String(status || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeLink = String(deliveryConfirmationLink || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Build a complete email document rather than appending a fragment to another
  // template; this prevents mail clients from displaying an empty message when
  // the base template is transformed or lacks a closing body tag.
  const html = deliveryConfirmationLink
    ? '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sylva delivery confirmation</title></head><body style="margin:0;background:#f3f7f4;font-family:Arial,sans-serif;color:#17211b"><main style="max-width:640px;margin:24px auto;background:#fff;border:1px solid #d7e7dc;border-radius:12px;overflow:hidden"><header style="background:#166534;padding:24px;color:#fff"><h1 style="margin:0;font-size:24px">Sylva Technologies</h1><p style="margin:6px 0 0">Empowering Your Digital Life</p></header><section style="padding:24px"><p>Hello ' + safeName + ',</p><h2 style="color:#166534">Review and confirm your delivery</h2><p>Your order <strong>' + safeOrderNumber + '</strong> is marked <strong>' + safeStatus + '</strong>.</p><p>When you have physically received the product, open your secure delivery note, review the items and delivery details, enter your full name and ID/passport number, draw your signature, and submit the receipt confirmation.</p><p style="text-align:center;margin:28px 0"><a href="' + safeLink + '" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold">Open Secure Delivery Form</a></p><p>If the button does not open, copy and paste this secure link into your browser:</p><p style="overflow-wrap:anywhere"><a href="' + safeLink + '" style="color:#166534">' + safeLink + '</a></p><p style="font-size:13px;color:#52645a">Do not confirm receipt until you physically have the order. If you did not receive it or the items are missing, damaged or incorrect, contact support@sylvatechnologies.co.ke or call 0700 932 014.</p></section><footer style="padding:16px 24px;background:#f7faf8;border-top:1px solid #e5eee8;font-size:12px;color:#64746a">Sylva Technologies · Customer Care: 0700 932 014<br>© 2026 Sylva Technologies. All rights reserved.</footer></main></body></html>'
    : baseHtml;
  const text = 'Hello ' + String(customerName || 'Customer') + ', your Sylva Technologies order ' + orderNumber + ' status is now ' + status + '.' +
    (deliveryConfirmationLink ? '\n\nWhen you physically receive the product, open this secure delivery form: ' + deliveryConfirmationLink + '\nDo not confirm before receiving the product.' : '');
  return sendMail({
    to,
    subject: 'Order status update - ' + orderNumber,
    html,
    text,
    sender: 'orders',
  });
};

// ============================================================
// SALES / OPERATIONS NOTIFICATION
// ============================================================

/**
 * Send a business event notification to the Sylva sales inbox.
 * This is separate from customer receipts and account-security email.
 */
const sendSalesNotificationEmail = async ({ subject, html, text }) => {
  return sendMail({
    to: 'sales@sylvatechnologies.co.ke',
    subject,
    html,
    text,
    sender: 'sales',
  });
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  sendMail,
  sendSalesNotificationEmail,

  // Account verification
  sendVerificationEmail,
  sendVerificationLinkEmail,
  sendVerificationCodeAndLinkEmail,

  // Password reset
  sendPasswordResetEmail,
  sendPasswordResetLinkEmail,
  sendPasswordResetCodeAndLinkEmail,

  // Orders
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendOrderStatusUpdateEmail,
};
