const express = require('express');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const SupportMessage = require('../models/SupportMessage');
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
