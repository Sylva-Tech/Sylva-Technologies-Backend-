const express = require('express');
const crypto = require('node:crypto');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const MarketingConversation = require('../models/MarketingConversation');

const router = express.Router();
const graphVersion = () => String(process.env.META_GRAPH_API_VERSION || 'v27.0').trim();
const clean = (value, max = 5000) => String(value || '').trim().slice(0, max);

function verifyWebhookSignature(req) {
  const secret = String(process.env.META_APP_SECRET || '');
  const signature = String(req.get('x-hub-signature-256') || '');
  if (!secret || !req.rawBody || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge || ''));
  return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  if (!verifyWebhookSignature(req)) return res.sendStatus(401);
  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};
        const contacts = new Map((value.contacts || []).map((contact) => [String(contact.wa_id), contact.profile?.name || '']));
        for (const message of value.messages || []) {
          const phone = clean(message.from, 120);
          const externalId = clean(message.id, 180);
          if (!phone || !externalId) continue;
          const existing = await MarketingConversation.findOne({ platform: 'whatsapp', 'messages.externalId': externalId }).select('_id');
          if (existing) continue;
          const text = message.type === 'text' ? clean(message.text?.body) : '[' + clean(message.type || 'message', 40) + ' received]';
          await MarketingConversation.findOneAndUpdate(
            { platform: 'whatsapp', externalContactId: phone },
            {
              $set: { displayName: contacts.get(phone) || '', status: 'unread', lastMessageAt: new Date(), lastInboundAt: new Date() },
              $push: { messages: { externalId, direction: 'inbound', type: clean(message.type, 40) || 'text', text, status: 'received', at: new Date(Number(message.timestamp || 0) * 1000) || new Date() } },
              $setOnInsert: { platform: 'whatsapp', externalContactId: phone },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook processing failed:', error.message);
    res.sendStatus(500);
  }
});

router.use(protect, adminOnly, rateLimit({ windowMs: 15 * 60 * 1000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }));

router.get('/conversations', async (req, res) => {
  try {
    const status = ['unread', 'open', 'resolved'].includes(req.query.status) ? req.query.status : '';
    const filter = { platform: 'whatsapp' };
    if (status) filter.status = status;
    const conversations = await MarketingConversation.find(filter).sort({ lastMessageAt: -1 }).limit(100).lean();
    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to load customer conversations.' });
  }
});

router.post('/conversations/:id/reply', async (req, res) => {
  try {
    const text = clean(req.body?.text, 4000);
    if (!text) return res.status(400).json({ success: false, message: 'Write a message before sending.' });
    const conversation = await MarketingConversation.findById(req.params.id);
    if (!conversation || conversation.platform !== 'whatsapp') return res.status(404).json({ success: false, message: 'WhatsApp conversation not found.' });
    if (!conversation.lastInboundAt || Date.now() - new Date(conversation.lastInboundAt).getTime() > 24 * 60 * 60 * 1000) {
      return res.status(409).json({ success: false, code: 'WHATSAPP_TEMPLATE_REQUIRED', message: 'The 24-hour customer service window has closed. Use an approved WhatsApp message template to contact this customer.' });
    }
    const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    if (!phoneId || !token) return res.status(503).json({ success: false, message: 'WhatsApp Cloud API credentials are not configured on the server.' });
    const response = await axios.post('https://graph.facebook.com/' + graphVersion() + '/' + phoneId + '/messages', {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: conversation.externalContactId, type: 'text', text: { preview_url: false, body: text },
    }, { headers: { Authorization: 'Bearer ' + token }, timeout: 20000 });
    const messageId = clean(response.data?.messages?.[0]?.id, 180);
    if (!messageId) throw new Error('WhatsApp did not return a message ID.');
    conversation.messages.push({ externalId: messageId, direction: 'outbound', type: 'text', text, status: 'sent', at: new Date() });
    conversation.status = 'open';
    conversation.lastMessageAt = new Date();
    await conversation.save();
    res.json({ success: true, message: 'WhatsApp reply sent.', conversation });
  } catch (error) {
    console.error('WhatsApp reply failed:', error.response?.data?.error?.message || error.message);
    res.status(error.response?.status || 500).json({ success: false, message: error.response?.data?.error?.message || 'Unable to send WhatsApp reply.' });
  }
});

router.patch('/conversations/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!['open', 'resolved', 'unread'].includes(status)) return res.status(400).json({ success: false, message: 'Choose a valid conversation status.' });
  const conversation = await MarketingConversation.findOneAndUpdate({ _id: req.params.id, platform: 'whatsapp' }, { $set: { status } }, { new: true });
  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found.' });
  res.json({ success: true, conversation });
});

module.exports = router;
