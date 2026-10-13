const express = require('express');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const { simpleParser } = require('mailparser');
const SupportMessage = require('../models/SupportMessage');
const MailboxMessage = require('../models/MailboxMessage');
const MailboxDocument = require('../models/MailboxDocument');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const router = express.Router();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const SENDERS = {
  support: 'Sylva Technologies <support@sylvatechnologies.co.ke>',
  sales: 'Sylva Technologies <sales@sylvatechnologies.co.ke>',
  orders: 'Sylva Technologies <order@sylvatechnologies.co.ke>',
  payment: 'Sylva Technologies <payment@sylvatechnologies.co.ke>',
  admin: 'Sylva Technologies <admin@sylvatechnologies.co.ke>',
};
const replyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const messages = await SupportMessage.find().select('-html').sort({ isRead: 1, receivedAt: -1 }).limit(300).lean();
    return res.json({ success: true, messages });
  } catch (e) {
    console.error('Support inbox list failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to load the support inbox.' });
  }
});
router.get('/:id', protect, adminOnly, async (req, res) => {
  try {
    const message = await SupportMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    if (!message.isRead) { message.isRead = true; await message.save(); }
    return res.json({ success: true, message });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    console.error('Support message load failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to load this message.' });
  }
});
router.patch('/:id/read', protect, adminOnly, async (req, res) => {
  try {
    const message = await SupportMessage.findByIdAndUpdate(req.params.id, { isRead: req.body?.isRead !== false }, { new: true, runValidators: true }).select('-html');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    return res.json({ success: true, message });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    return res.status(500).json({ success: false, message: 'Unable to update message status.' });
  }
});
router.post('/:id/reply', protect, adminOnly, replyLimiter, async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim().toLowerCase();
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const text = String(req.body?.text || '').trim();
    const from = SENDERS[String(req.body?.sender || 'support').toLowerCase()];
    if (!from) return res.status(400).json({ success: false, message: 'Choose a permitted Sylva sender address.' });
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ success: false, message: 'A valid recipient email is required.' });
    if (!subject || !text || text.length > 12000) return res.status(400).json({ success: false, message: 'Enter a subject and a reply under 12,000 characters.' });
    if (!resend) return res.status(503).json({ success: false, message: 'Email sending is not configured on the server.' });
    const message = await SupportMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    const fromAddress = from.match(/<([^>]+)>/)?.[1] || from;
    const safeText = escapeHtml(text).replace(/\r?\n/g, '<br>');
    const { data, error } = await resend.emails.send({
      from, to: [to], replyTo: fromAddress, subject, text,
      html: '<div style="font-family:Arial,sans-serif;line-height:1.6">' + safeText + '<hr><p style="color:#64748b;font-size:12px">Sylva Technologies — Empowering Your Digital Life</p></div>',
    });
    if (error) {
      console.error('Support reply send failed:', error.message);
      return res.status(502).json({ success: false, message: 'The email provider could not send this reply. Check sender verification and try again.' });
    }
    message.replies.push({ from: fromAddress, to, subject, text, providerMessageId: data?.id || '', sentAt: new Date() });
    message.isRead = true;
    await message.save();
    return res.json({ success: true, message: 'Reply sent.', supportMessage: message });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    console.error('Support reply failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to send this reply.' });
  }
});

// Resend inbound webhook: verify its signature, then retrieve the full parsed email.
router.post('/inbound/resend', async (req, res) => {
  if (!resend || !process.env.RESEND_INBOUND_WEBHOOK_SECRET || !req.rawBody) {
    return res.status(503).json({ success: false, message: 'Inbound email webhook is not configured.' });
  }
  let event;
  try {
    event = resend.webhooks.verify({
      payload: req.rawBody.toString('utf8'),
      headers: {
        id: req.get('svix-id'),
        timestamp: req.get('svix-timestamp'),
        signature: req.get('svix-signature'),
      },
      webhookSecret: process.env.RESEND_INBOUND_WEBHOOK_SECRET,
    });
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }
  const deliveryStatusMap = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delivery_delayed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
  };
  if (deliveryStatusMap[event?.type]) {
    const providerMessageId = String(event.data?.email_id || event.data?.id || '').trim();
    if (!providerMessageId) return res.status(200).json({ success: true, ignored: true });
    try {
      const message = await MailboxMessage.findOne({ providerMessageId });
      if (!message) return res.status(200).json({ success: true, unmatched: true });
      message.status = deliveryStatusMap[event.type];
      message.lastStatusAt = event.created_at ? new Date(event.created_at) : new Date();
      if (event.type === 'email.delivered') message.deliveredAt = event.created_at ? new Date(event.created_at) : new Date();
      message.events.push({
        type: event.type,
        at: event.created_at ? new Date(event.created_at) : new Date(),
        details: { eventId: event.id || '', reason: event.data?.reason || event.data?.bounce?.message || '' },
      });
      await message.save();
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('Mailbox delivery event update failed:', e.message);
      return res.status(500).json({ success: false, message: 'Unable to store email delivery status.' });
    }
  }
  if (event?.type !== 'email.received' || !event.data?.email_id) {
    return res.status(200).json({ success: true, ignored: true });
  }
  try {
    const { data: email, error: receiveError } = await resend.emails.receiving.get(event.data.email_id);
    if (receiveError || !email) {
      console.error('Resend inbound email retrieval failed:', receiveError?.message || 'Email not found');
      return res.status(502).json({ success: false, message: 'Unable to retrieve the received email content.' });
    }
    const headers = email.headers || [];
    const originalRecipient = Array.isArray(headers)
      ? headers.find(h => String(h.name || h.key || '').toLowerCase() === 'x-original-recipient')?.value
      : (headers['x-original-recipient'] || headers['X-Original-Recipient']);
    const to = originalRecipient
      ? [String(originalRecipient).toLowerCase()]
      : (Array.isArray(event.data.to) ? event.data.to : [event.data.to]).filter(Boolean);
    const providerMessageId = String(email.message_id || event.data.message_id || event.data.email_id).slice(0, 300);
    if (await SupportMessage.findOne({ providerMessageId })) {
      return res.status(200).json({ success: true, duplicate: true });
    }
    const rawFrom = String(email.from || event.data.from || '').trim();
    const from = (rawFrom.match(/<([^>]+)>/)?.[1] || rawFrom).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
      return res.status(400).json({ success: false, message: 'Received email has an invalid sender.' });
    }
    const subject = String(email.subject || event.data.subject || '(No subject)').slice(0, 300);
    const text = String(email.text || '');
    const html = String(email.html || '');
    const receivedAt = email.created_at ? new Date(email.created_at) : new Date();
    const attachments = Array.isArray(email.attachments) ? email.attachments.map(item => ({
      filename: String(item.filename || item.name || 'attachment').slice(0, 255),
      contentType: String(item.content_type || item.contentType || 'application/octet-stream').slice(0, 150),
      size: Number(item.size || 0),
      providerId: String(item.id || item.attachment_id || ''),
    })) : [];

    await SupportMessage.create({
      providerMessageId, source: 'email', from, to, subject, text, html, receivedAt, isRead: false,
    });
    await MailboxMessage.create({
      providerMessageId,
      providerEmailId: String(event.data.email_id || ''),
      direction: 'inbound',
      folder: 'inbox',
      from,
      to,
      subject,
      text,
      html,
      attachments,
      status: 'received',
      receivedAt,
      isRead: false,
      lastStatusAt: receivedAt,
      events: [{ type: 'email.received', at: receivedAt, details: { source: 'Resend inbound webhook' } }],
    });
    return res.status(201).json({ success: true });
  } catch (e) {
    if (e.code === 11000) return res.status(200).json({ success: true, duplicate: true });
    console.error('Resend inbound webhook failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to store the received email.' });
  }
});

// Cloudflare Email Worker inbound endpoint.
// The Worker forwards the original RFC 822 message here after routing a copy to Outlook.
router.post('/inbound/cloudflare', async (req, res) => {
  const expected = process.env.CLOUDFLARE_EMAIL_WORKER_SECRET;
  const supplied = req.get('x-cloudflare-email-secret');
  if (!expected || !supplied || supplied !== expected) {
    return res.status(401).json({ success: false, message: 'Unauthorized Cloudflare email hook.' });
  }

  try {
    const rawEmail = typeof req.body?.rawEmail === 'string' ? req.body.rawEmail : '';
    if (!rawEmail || rawEmail.length > 8 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Missing email content or message is too large.' });
    }

    const parsed = await simpleParser(rawEmail);
    const from = String(parsed.from?.value?.[0]?.address || '').trim().toLowerCase();
    const to = (parsed.to?.value || []).map(item => String(item.address || '').trim().toLowerCase()).filter(Boolean).slice(0, 10);
    const subject = String(parsed.subject || '(No subject)').slice(0, 300);
    const text = String(parsed.text || '').slice(0, 100000);
    const html = typeof parsed.html === 'string' ? parsed.html.slice(0, 250000) : '';
    const receivedAt = parsed.date && !Number.isNaN(new Date(parsed.date).getTime()) ? new Date(parsed.date) : new Date();
    const providerMessageId = String(parsed.messageId || '').trim().replace(/[<>]/g, '').slice(0, 300)
      || require('crypto').createHash('sha256').update(rawEmail).digest('hex');

    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(from)) {
      return res.status(400).json({ success: false, message: 'Email has an invalid sender address.' });
    }

    let mailboxMessage = await MailboxMessage.findOne({ providerMessageId });
    let supportMessage = await SupportMessage.findOne({ providerMessageId });
    if (mailboxMessage && supportMessage) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    const attachmentMetadata = (parsed.attachments || []).slice(0, 10).map((item, index) => ({
      filename: String(item.filename || `attachment-${index + 1}`).slice(0, 255),
      contentType: String(item.contentType || 'application/octet-stream').slice(0, 150),
      size: Number(item.size || item.content?.length || 0),
      providerId: `cloudflare:${providerMessageId}:${index}`,
    }));

    if (!supportMessage) {
      supportMessage = await SupportMessage.create({
        providerMessageId, source: 'email', from,
        to: to.length ? to : ['support@sylvatechnologies.co.ke'],
        subject, text, html, receivedAt, isRead: false,
      });
    }

    if (!mailboxMessage) {
      mailboxMessage = await MailboxMessage.create({
        providerMessageId,
        direction: 'inbound',
        folder: 'inbox',
        from,
        to: to.length ? to : ['support@sylvatechnologies.co.ke'],
        subject,
        text,
        html,
        attachments: attachmentMetadata,
        status: 'received',
        receivedAt,
        isRead: false,
        lastStatusAt: new Date(),
        events: [{ type: 'email.received', at: new Date(), details: { source: 'Cloudflare Email Worker' } }],
      });

      const attachments = (parsed.attachments || []).slice(0, 10);
      const totalAttachmentBytes = attachments.reduce((sum, item) => sum + Number(item.content?.length || 0), 0);
      if (attachments.length && totalAttachmentBytes <= 6 * 1024 * 1024) {
        await MailboxDocument.insertMany(attachments.map((item, index) => ({
          messageId: mailboxMessage._id,
          filename: String(item.filename || `attachment-${index + 1}`).slice(0, 255),
          contentType: String(item.contentType || 'application/octet-stream').slice(0, 150),
          size: Number(item.size || item.content?.length || 0),
          contentBase64: Buffer.from(item.content).toString('base64'),
        })));
      }
    }

    return res.status(201).json({ success: true });
  } catch (e) {
    if (e.code === 11000) return res.status(200).json({ success: true, duplicate: true });
    console.error('Cloudflare inbound email failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to store Cloudflare email.' });
  }
});

// A trusted email processor must POST parsed fields and the shared secret.
// Configure SUPPORT_INBOUND_SECRET in Render and the processor; never expose it in the frontend.
router.post('/inbound', async (req, res) => {
  const expected = process.env.SUPPORT_INBOUND_SECRET;
  const supplied = req.get('x-support-inbound-secret');
  if (!expected || !supplied || supplied !== expected) return res.status(401).json({ success: false, message: 'Unauthorized inbound mail hook.' });
  try {
    const rawFrom = String(req.body?.from || '').trim();
    const from = (rawFrom.match(/<([^>]+)>/)?.[1] || rawFrom).trim().toLowerCase();
    const subject = String(req.body?.subject || '(No subject)').trim().slice(0, 300);
    const text = String(req.body?.text || '').slice(0, 50000);
    const html = String(req.body?.html || '').slice(0, 100000);
    const toList = Array.isArray(req.body?.to) ? req.body.to : [req.body?.to || 'support@sylvatechnologies.co.ke'];
    const to = toList.map(v => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 10);
    const providerMessageId = String(req.body?.messageId || '').trim().slice(0, 300);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) || (!text && !html)) return res.status(400).json({ success: false, message: 'A valid sender and message body are required.' });
    if (providerMessageId && await SupportMessage.findOne({ providerMessageId })) return res.status(200).json({ success: true, duplicate: true });
    await SupportMessage.create({ providerMessageId: providerMessageId || undefined, source: 'email', from, to, subject, text, html, receivedAt: req.body?.receivedAt ? new Date(req.body.receivedAt) : new Date(), isRead: false });
    return res.status(201).json({ success: true });
  } catch (e) {
    if (e.code === 11000) return res.status(200).json({ success: true, duplicate: true });
    console.error('Inbound support email failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to store inbound email.' });
  }
});
module.exports = router;
