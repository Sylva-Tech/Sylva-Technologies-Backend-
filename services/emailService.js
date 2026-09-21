const nodemailer = require('nodemailer');
const { verificationEmailTemplate } = require('../templates/verificationEmail');
const { passwordResetTemplate } = require('../templates/passwordReset');
const { orderConfirmationTemplate } = require('../templates/orderConfirmation');
const { adminOrderNotificationTemplate } = require('../templates/adminOrderNotification');
const { orderStatusUpdateTemplate } = require('../templates/orderStatusUpdate');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: Number(process.env.EMAIL_PORT || 587) === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn('Email service is not configured. Missing EMAIL_HOST, EMAIL_USER or EMAIL_PASSWORD.');
    return {
      success: false,
      message: 'Email service not configured. Please set the email environment variables.',
    };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html,
      text,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('Email send failed:', error.message);
    return {
      success: false,
      message: 'Unable to send email at the moment. Please try again later.',
    };
  }
};

const sendVerificationEmail = async ({ to, name, otp, expiresInMinutes }) => {
  const html = verificationEmailTemplate({ name, otp, expiresInMinutes });
  return sendMail({
    to,
    subject: 'Verify your Sylva Technologies account',
    html,
    text: `Hello ${name}, your Sylva Technologies verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
  });
};

const sendPasswordResetEmail = async ({ to, name, otp, expiresInMinutes }) => {
  const html = passwordResetTemplate({ name, otp, expiresInMinutes });
  return sendMail({
    to,
    subject: 'Reset your Sylva Technologies password',
    html,
    text: `Hello ${name}, your Sylva Technologies password reset code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
  });
};

const sendOrderConfirmationEmail = async ({ to, customerName, order, orderDate }) => {
  const html = orderConfirmationTemplate({ customerName, order, orderDate });
  return sendMail({
    to,
    subject: `Order Confirmation - ${order.orderNumber}`,
    html,
    text: `Thank you ${customerName} for shopping with Sylva Technologies. Your order ${order.orderNumber} has been placed successfully.`,
  });
};

const sendAdminOrderNotificationEmail = async ({ to, order, customer }) => {
  const html = adminOrderNotificationTemplate({ order, customer });
  return sendMail({
    to,
    subject: `New order received - ${order.orderNumber}`,
    html,
    text: `A new order ${order.orderNumber} has been placed by ${customer.name}.`,
  });
};

const sendOrderStatusUpdateEmail = async ({ to, customerName, orderNumber, status }) => {
  const html = orderStatusUpdateTemplate({ customerName, orderNumber, status });
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
  sendOrderConfirmationEmail,
  sendAdminOrderNotificationEmail,
  sendOrderStatusUpdateEmail,
};
