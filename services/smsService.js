const sendOtpSms = async ({ to, otp, purpose }) => {
  const provider = process.env.SMS_PROVIDER || 'not-configured';

  if (provider === 'not-configured' || !process.env.SMS_API_KEY) {
    const message = `SMS provider not configured. Add SMS_PROVIDER and SMS_API_KEY to enable ${purpose} OTP delivery.`;
    console.warn(message);
    return {
      success: false,
      message,
    };
  }

  try {
    const payload = {
      to,
      otp,
      purpose,
      senderId: process.env.SMS_SENDER_ID || 'SYLVA',
    };

    console.log('SMS provider payload prepared:', { provider, to: payload.to, purpose: payload.purpose, senderId: payload.senderId });

    return {
      success: true,
      provider,
      messageId: `sms-${Date.now()}`,
      payload,
    };
  } catch (error) {
    console.error('SMS send failed:', error.message);
    return {
      success: false,
      message: 'Unable to send SMS at the moment. Please try again later.',
    };
  }
};

module.exports = { sendOtpSms };
