export default {
  async email(message, env) {
    const outlook = String(env.OUTLOOK_DESTINATION || '').trim();
    const resendInbound = String(env.RESEND_INBOUND_ADDRESS || '').trim();

    if (!outlook || !resendInbound) {
      throw new Error('Set OUTLOOK_DESTINATION and RESEND_INBOUND_ADDRESS in Worker variables.');
    }

    // Preserve the original alias so the admin inbox can display the real address.
    const headers = new Headers();
    headers.set('X-Original-Recipient', message.to);

    // Keep the existing Outlook forwarding while sending a second copy to Resend
    // for parsing and delivery to the support-inbox webhook.
    const results = await Promise.allSettled([
      message.forward(outlook),
      message.forward(resendInbound, headers),
    ]);

    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      console.error('One or more email forwards failed:', failures.length);
      throw new Error('Email forwarding failed. Check destination verification and Worker logs.');
    }
  },
};
