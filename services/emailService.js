const { Resend } = require('resend');

const { verificationEmailTemplate } = require('../templates/verificationEmail');
const { passwordResetTemplate } = require('../templates/passwordReset');
const { orderConfirmationTemplate } = require('../templates/orderConfirmation');
const { adminOrderNotificationTemplate } = require('../templates/adminOrderNotification');
const { orderStatusUpdateTemplate } = require('../templates/orderStatusUpdate');

// Initialize Resend
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const getFromEmail = () => {
  return (
    process.env.EMAIL_FROM ||
    'Sylva Technologies <verification@sylvatechnologies.co.ke>'
  );
};

/**
 * Send an email using Resend
 */
const sendMail = async ({ to, subject, html, text }) => {
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
    console.error('Resend client could not be initialized.');

    return {
      success: false,
      message: 'Email service is unavailable.',
    };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error('Resend email error:', error);

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
    console.error('Email send failed:', error.message);

    return {
      success: false,
      message:
        'Unable to send email at the moment. Please try again later.',
    };
  }
};

const sendVerificationEmail = async ({
  to,
  name,
  otp,
  expiresInMinutes,
}) => {
  const html = verificationEmailTemplate({
    name,
    otp,
    expiresInMinutes,
  });

  return sendMail({
    to,
    subject: 'Verify your Sylva Technologies account',
    html,
    text: `Hello ${name}, your Sylva Technologies verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
  });
};

const sendPasswordResetEmail = async ({
  to,
  name,
  otp,
  expiresInMinutes,
}) => {
  const html = passwordResetTemplate({
    name,
    otp,
    expiresInMinutes,
  });

  return sendMail({
    to,
    subject: 'Reset your Sylva Technologies password',
    html,
    text: `Hello ${name}, your Sylva Technologies password reset code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
  });
};

const sendVerificationLinkEmail = async ({
  to,
  name,
  verifyLink,
  expiresInMinutes,
}) => {
  const html = `
    <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
      <div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">

        <div style="background:linear-gradient(135deg,#0f172a,#1d4ed8); padding:24px 32px; color:#fff;">
          <h2 style="margin:0; font-size:26px;">Sylva Technologies</h2>
        </div>

        <div style="padding:32px;">
          <h3 style="margin-top:0; font-size:22px;">
            Verify your email address
          </h3>

          <p>Hello <strong>${name}</strong>,</p>

          <p>
            Click the button below to verify your Sylva Technologies account.
            This link expires in ${expiresInMinutes} minutes.
          </p>

          <p style="text-align:center;">
            <a
              href="${verifyLink}"
              style="display:inline-block; background:#1d4ed8; color:#fff; padding:12px 20px; border-radius:8px; text-decoration:none;"
            >
              Verify My Email
            </a>
          </p>

          <p>
            If the button doesn't work, copy and paste this link into your browser:
          </p>

          <p style="word-break:break-all;">
            ${verifyLink}
          </p>
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
    text: `Hello ${name}, verify your email by visiting: ${verifyLink}`,
  });
};

const sendPasswordResetLinkEmail = async ({
  to,
  name,
  resetLink,
  expiresInMinutes,
}) => {
  const html = `
    <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px; color:#1a1a1a;">
      <div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">

        <div style="background:linear-gradient(135deg,#111827,#4338ca); padding:24px 32px; color:#fff;">
          <h2 style="margin:0; font-size:26px;">Sylva Technologies</h2>
        </div>

        <div style="padding:32px;">
          <h3 style="margin-top:0; font-size:22px;">
            Reset your password
          </h3>

          <p>Hello <strong>${name}</strong>,</p>

          <p>
            Click the button below to reset your password.
            This link expires in ${expiresInMinutes} minutes.
          </p>

          <p style="text-align:center;">
            <a
              href="${resetLink}"
              style="display:inline-block; background:#4338ca; color:#fff; padding:12px 20px; border-radius:8px; text-decoration:none;"
            >
              Reset My Password
            </a>
          </p>

          <p>
            If the button doesn't work, copy and paste this link into your browser:
          </p>

          <p style="word-break:break-all;">
            ${resetLink}
          </p>
        </div>

        <div style="background:#f8fafc; color:#475569; padding:18px 32px; font-size:12px; border-top:1px solid #e5e7eb;">
          © 2026 Sylva Technologies. All rights reserved.
        </div>

      </div>
    </div>
  `;

  return sendMail({
    to,
    subject: 'Reset your Sylva Technologies password',
    html,
    text: `Hello ${name}, reset your password by visiting: ${resetLink}`,
  });
};

const sendOrderConfirmationEmail = async ({
  to,
  customerName,
  order,
  orderDate,
}) => {
  const html = orderConfirmationTemplate({
    customerName,
    order,
    orderDate,
  });

  return sendMail({
    to,
    subject: `Order Confirmation - ${order.orderNumber}`,
    html,
    text: `Thank you ${customerName} for shopping with Sylva Technologies. Your order ${order.orderNumber} has been placed successfully.`,
  });
};

const sendAdminOrderNotificationEmail = async ({
  to,
  order,
  customer,
}) => {
  const html = adminOrderNotificationTemplate({
    order,
    customer,
  });

  return sendMail({
    to,
    subject: `New order received - ${order.orderNumber}`,
    html,
    text: `A new order ${order.orderNumber} has been placed by ${customer.name}.`,
  });
};

const sendOrderStatusUpdateEmail = async ({
  to,
  customerName,
  orderNumber,
  status,
}) => {
  const html = orderStatusUpdateTemplate({
    customerName,
    orderNumber,
    status,
  });

  return sendMail({
    to,
    subject: `Order status update - ${orderNumber}`,
    html,
    text: `Hello ${customerName}, your Sylva Technologies order ${orderNumber} status is now ${status}.`,
  });
};

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendVerificationLinkEmail,
  sendPasswordResetLinkEmail,
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendOrderStatusUpdateEmail,
};