const express = require('express');
const ContactMessage = require('../models/ContactMessage');
const SupportMessage = require('../models/SupportMessage');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { encryptMessageContent, decryptMessageContent } = require('../utils/mailMessageCrypto');

const router = express.Router();

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const messages = await ContactMessage.find().select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion').sort({ createdAt: -1 }).lean();
    res.json(messages.map(item => { const opened = decryptMessageContent(item); return { ...opened, message: opened.text, text: undefined, html: undefined }; }));
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to load messages.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: 'Name, email and message are required.' });
    }

    const contactMessage = await ContactMessage.create({
      name,
      email,
      phone,
      ...encryptMessageContent({ subject: String(subject || '').trim(), text: String(message).trim(), html: '' }),
      message: '(Encrypted message)',
    });

    await SupportMessage.create({
      source: 'website',
      from: String(email).trim().toLowerCase(),
      to: ['support@sylvatechnologies.co.ke'],
      name: String(name).trim(),
      subject: String(subject || 'Website enquiry').trim(),
      text: String(message).trim(),
      receivedAt: new Date(),
      isRead: false,
    });

    res.status(201).json(contactMessage);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to send message.' });
  }
});

module.exports = router;
