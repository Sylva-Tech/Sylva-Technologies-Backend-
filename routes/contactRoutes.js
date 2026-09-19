const express = require('express');
const ContactMessage = require('../models/ContactMessage');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    res.json(messages);
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
      subject,
      message,
    });

    res.status(201).json(contactMessage);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Unable to send message.' });
  }
});

module.exports = router;
