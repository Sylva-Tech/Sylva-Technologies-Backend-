const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
const MailboxMessage = require('../models/MailboxMessage');
const MailboxDocument = require('../models/MailboxDocument');
const SupportMessage = require('../models/SupportMessage');
const ContactMessage = require('../models/ContactMessage');
const { encryptAttachment, decryptAttachment, getKey } = require('../utils/mailAttachmentCrypto');
const { encryptMessageContent, decryptMessageContent, getMessageKey } = require('../utils/mailMessageCrypto');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const SENDERS = {
  support: 'Sylva Technologies <support@sylvatechnologies.co.ke>',
  sales: 'Sylva Technologies <sales@sylvatechnologies.co.ke>',
  orders: 'Sylva Technologies <order@sylvatechnologies.co.ke>',
  payment: 'Sylva Technologies <payment@sylvatechnologies.co.ke>',
  admin: 'Sylva Technologies <admin@sylvatechnologies.co.ke>',
  verification: 'Sylva Technologies <verification@sylvatechnologies.co.ke>',
  resetpassword: 'Sylva Technologies <resetpassword@sylvatechnologies.co.ke>',
  sellers: 'Sylva Technologies <sellers@sylvatechnologies.co.ke>',
  noreply: 'Sylva Technologies <no-reply@sylvatechnologies.co.ke>',
};
const sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeList = value => (Array.isArray(value) ? value : value ? [value] : [])
  .map(item => String(item).trim().toLowerCase()).filter(Boolean);
const validList = list => list.length <= 50 && list.every(value => emailPattern.test(value));
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeAttachments = list => (Array.isArray(list) ? list : []).slice(0, 10).map(item => ({
  filename: String(item.filename || 'attachment').slice(0, 255),
  contentType: String(item.contentType || 'application/octet-stream').slice(0, 150),
  size: Number(item.size || 0),
  providerId: String(item.providerId || ''),
}));

async function storeDocumentFiles(messageId, files, replace = false) {
  const list = Array.isArray(files) ? files.filter(file => file && file.content) : [];
  if (!list.length) {
    if (replace) await MailboxDocument.deleteMany({ messageId });
    return;
  }
  let totalSize = 0;
  const records = list.slice(0, 10).map(file => {
    const encoded = String(file.content || '');
    if (!encoded || encoded.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new Error('Each attachment must be valid base64 and under 5 MB.');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Each attachment must be under 5 MB.');
    totalSize += bytes.length;
    const encrypted = encryptAttachment(bytes);
    return {
      messageId,
      filename: String(file.filename || 'attachment').slice(0, 255),
      contentType: String(file.contentType || 'application/octet-stream').slice(0, 150),
      size: bytes.length,
      ...encrypted,
    };
  });
  if (totalSize > 6 * 1024 * 1024) throw new Error('Combined attachments must be under 6 MB.');
  if (replace) await MailboxDocument.deleteMany({ messageId });
  await MailboxDocument.insertMany(records);
}

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const allowedFolders = ['inbox', 'outbox', 'sent', 'drafts', 'archive', 'spam', 'trash'];
    const folder = allowedFolders.includes(req.query.folder) ? req.query.folder : 'inbox';
    const query = { folder };
    const messages = await MailboxMessage.find(query)
      .select('-events.details +contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion')
      .sort(folder === 'sent' ? { sentAt: -1, updatedAt: -1 } : { receivedAt: -1, updatedAt: -1 })
      .limit(300).lean();
    const openedMessages = messages.map(item => {
      const opened = decryptMessageContent(item);
      delete opened.html;
      return opened;
    });
    return res.json({ success: true, folder, messages: openedMessages });
  } catch (e) {
    console.error('Mailbox list failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to load mailbox messages.' });
  }
});

router.get('/encryption-status', protect, adminOnly, async (req, res) => {
  try {
    getKey();
    getMessageKey();
    return res.json({ success: true, configured: true, messageEncryptionConfigured: true, algorithm: 'AES-256-GCM' });
  } catch (e) {
    return res.status(503).json({ success: true, configured: false, messageEncryptionConfigured: false, algorithm: 'AES-256-GCM', message: e.message });
  }
});

router.get('/:id/attachments', protect, adminOnly, async (req, res) => {
  try {
    const message = await MailboxMessage.findById(req.params.id).select('direction providerEmailId attachments');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });

    // Prefer files stored in Sylva Mail so the authenticated viewer can decrypt them server-side.
    const documents = await MailboxDocument.find({ messageId: message._id })
      .select('+encryptionIv +encryptionAuthTag +encryptionVersion')
      .lean();
    if (documents.length) {
      return res.json({
        success: true,
        attachments: documents.map(item => ({
          documentId: String(item._id),
          filename: item.filename,
          contentType: item.contentType,
          size: item.size,
          encrypted: Number(item.encryptionVersion) === 1,
          downloadUrl: '',
        })),
      });
    }

    // Resend-hosted inbound files remain provider-hosted; do not persist their temporary URLs.
    if (!message.providerEmailId || !resend) {
      return res.json({ success: true, attachments: (message.attachments || []).map(item => ({ ...item.toObject(), downloadUrl: '' })) });
    }
    const { data, error } = await resend.emails.receiving.attachments.list({ emailId: message.providerEmailId });
    if (error) {
      console.error('Received attachment lookup failed:', error.message);
      return res.status(502).json({ success: false, message: 'Unable to retrieve attachment links.' });
    }
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    // Provider URLs are never sent to the browser. Fetch each file server-side,
    // encrypt it, and only then expose our authenticated document endpoint.
    const stored = [];
    let storedBytes = 0;
    for (const item of items.slice(0, 10)) {
      const filename = String(item.filename || 'attachment').slice(0, 255);
      const contentType = String(item.content_type || item.contentType || 'application/octet-stream').slice(0, 150);
      const rawUrl = String(item.download_url || item.downloadUrl || '');
      try {
        const parsedUrl = new URL(rawUrl);
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname || ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname.toLowerCase())) {
          throw new Error('Untrusted attachment URL.');
        }
        const response = await fetch(parsedUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('Provider attachment download failed.');
        const announcedSize = Number(response.headers.get('content-length') || 0);
        if (announcedSize > 5 * 1024 * 1024) throw new Error('Attachment exceeds size limit.');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 5 * 1024 * 1024 || storedBytes + bytes.length > 6 * 1024 * 1024) {
          throw new Error('Attachment exceeds encrypted mailbox storage limit.');
        }
        const encrypted = encryptAttachment(bytes);
        const document = await MailboxDocument.create({
          messageId: message._id, filename, contentType, size: bytes.length, ...encrypted,
        });
        storedBytes += bytes.length;
        stored.push({
          documentId: String(document._id), filename, contentType, size: bytes.length,
          encrypted: true, downloadUrl: '',
        });
      } catch (downloadError) {
        console.warn('Provider attachment was not imported into encrypted storage:', downloadError.message);
        stored.push({ filename, contentType, size: Number(item.size || 0), encrypted: false, downloadUrl: '' });
      }
    }
    if (stored.length) return res.json({ success: true, attachments: stored });
    return res.json({ success: true, attachments: (message.attachments || []).map(item => ({
      filename: item.filename, contentType: item.contentType, size: item.size, encrypted: false, downloadUrl: '',
    })) });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    console.error('Mailbox attachment lookup failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to load attachments.' });
  }
});

// Decrypt an attachment only after authentication and message ownership checks.
// The file is streamed with a safe disposition; executable/unknown types are never rendered inline.
router.get('/:id/attachments/:documentId/content', protect, adminOnly, async (req, res) => {
  try {
    const message = await MailboxMessage.findById(req.params.id).select('_id');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    const document = await MailboxDocument.findOne({ _id: req.params.documentId, messageId: message._id })
      .select('+contentBase64 +encryptionIv +encryptionAuthTag +encryptionVersion');
    if (!document) return res.status(404).json({ success: false, message: 'Attachment not found.' });

    const bytes = decryptAttachment(document);
    const type = String(document.contentType || 'application/octet-stream').toLowerCase();
    const inlineTypes = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4)|application\/pdf|text\/plain)$/.test(type);
    const requestedInline = String(req.query.disposition || '').toLowerCase() === 'inline';
    const disposition = requestedInline && inlineTypes ? 'inline' : 'attachment';
    const safeName = String(document.filename || 'attachment').replace(/[\r\n"\\]/g, '_');
    res.set({
      'Content-Type': type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': disposition + "; filename=\"" + safeName + "\"; filename*=UTF-8''" + encodeURIComponent(safeName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
    });
    return res.status(200).send(bytes);
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid attachment identifier.' });
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    if (e.code === 'MAIL_ATTACHMENT_LEGACY_FORMAT') return res.status(409).json({ success: false, message: e.message });
    console.error('Attachment decrypt/stream failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to open this attachment. It may be damaged or its encryption key may not match.' });
  }
});

router.get('/:id', protect, adminOnly, async (req, res) => {
  try {
    const message = await MailboxMessage.findById(req.params.id).select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    if (['inbox', 'spam'].includes(message.folder) && !message.isRead) {
      message.isRead = true;
      await message.save();
    }
    return res.json({ success: true, message: decryptMessageContent(message) });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    console.error('Mailbox message load failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to open this message.' });
  }
});

router.post('/drafts', protect, adminOnly, async (req, res) => {
  try {
    const to = normalizeList(req.body?.to);
    const cc = normalizeList(req.body?.cc);
    const bcc = normalizeList(req.body?.bcc);
    if (![to, cc, bcc].every(validList)) return res.status(400).json({ success: false, message: 'Check recipient email addresses (maximum 50 per field).' });
    const senderAlias = String(req.body?.sender || 'support').toLowerCase();
    if (!SENDERS[senderAlias]) return res.status(400).json({ success: false, message: 'Choose a permitted Sylva sender address.' });
    const values = {
      direction: 'outbound', folder: 'drafts', from: (SENDERS[senderAlias].match(/<([^>]+)>/) || [])[1],
      senderAlias, to, cc, bcc,
      ...encryptMessageContent({ subject: String(req.body?.subject || '').slice(0, 300), text: String(req.body?.text || '').slice(0, 100000), html: '' }),
      signatureName: String(req.body?.signatureName || '').trim().slice(0, 100),
      signatureTitle: String(req.body?.signatureTitle || '').trim().slice(0, 120),
      attachments: safeAttachments(req.body?.attachments),
      status: 'draft', isRead: true, lastStatusAt: new Date(),
    };
    let draft;
    if (req.body?.id) {
      draft = await MailboxMessage.findOneAndUpdate(
        { _id: req.body.id, direction: 'outbound', folder: 'drafts' },
        { $set: values },
        { new: true, runValidators: true }
      ).select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion');
      if (!draft) return res.status(404).json({ success: false, message: 'Draft not found.' });
    } else {
      draft = await MailboxMessage.create(values);
    }
    if (Array.isArray(req.body?.attachments) && req.body.attachments.some(file => file?.content)) {
      await storeDocumentFiles(draft._id, req.body.attachments, true);
    }
    return res.json({ success: true, draft: decryptMessageContent(draft) });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid draft identifier.' });
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    console.error('Save draft failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to save draft.' });
  }
});



// Bounded migration for legacy mailbox, support, and contact message bodies.
router.post('/content/encrypt-legacy', protect, adminOnly, async (req, res) => {
  try {
    getMessageKey();
    let migrated = 0;
    const mailboxLegacy = await MailboxMessage.find({
      contentEncryptionVersion: mongoose.trusted({ $ne: 1 }),
    }).select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion').limit(100);
    for (const document of mailboxLegacy) {
      Object.assign(document, encryptMessageContent({
        subject: document.subject, text: document.text, html: document.html,
      }));
      await document.save();
      migrated += 1;
    }

    const supportLegacy = await SupportMessage.find({
      contentEncryptionVersion: mongoose.trusted({ $ne: 1 }),
    }).select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion').limit(100);
    for (const document of supportLegacy) {
      Object.assign(document, encryptMessageContent({
        subject: document.subject, text: document.text, html: document.html,
        replies: Array.isArray(document.replies) ? document.replies : [],
      }));
      document.replies = [];
      await document.save();
      migrated += 1;
    }

    const contactLegacy = await ContactMessage.find({
      contentEncryptionVersion: mongoose.trusted({ $ne: 1 }),
    }).select('+contentCiphertext +contentIv +contentAuthTag +contentEncryptionVersion').limit(100);
    for (const document of contactLegacy) {
      Object.assign(document, encryptMessageContent({
        subject: document.subject, text: document.message, html: '',
      }));
      document.message = '(Encrypted message)';
      await document.save();
      migrated += 1;
    }

    const [mailboxRemaining, supportRemaining, contactRemaining] = await Promise.all([
      MailboxMessage.countDocuments({ contentEncryptionVersion: mongoose.trusted({ $ne: 1 }) }),
      SupportMessage.countDocuments({ contentEncryptionVersion: mongoose.trusted({ $ne: 1 }) }),
      ContactMessage.countDocuments({ contentEncryptionVersion: mongoose.trusted({ $ne: 1 }) }),
    ]);
    const remaining = mailboxRemaining + supportRemaining + contactRemaining;
    return res.json({
      success: true, migrated, remaining,
      batches: { mailbox: mailboxLegacy.length, support: supportLegacy.length, contact: contactLegacy.length },
      message: remaining ? 'Legacy messages remain. Run this migration again until remaining is zero.' : 'All stored message bodies in Sylva Mail, support inbox, and contact messages are encrypted.',
    });
  } catch (e) {
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    console.error('Legacy message encryption migration failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to encrypt legacy messages.' });
  }
});

// One-time, bounded migration for attachment records saved before encryption was enabled.
// Run repeatedly until remaining is zero; raw legacy bytes are encrypted before each update.
router.post('/attachments/encrypt-legacy', protect, adminOnly, async (req, res) => {
  try {
    getKey();
    const legacy = await MailboxDocument.find({
      $or: [
        { encryptionVersion: mongoose.trusted({ $ne: 1 }) },
        { encryptionIv: '' },
        { encryptionAuthTag: '' },
      ],
    }).select('+contentBase64 +encryptionIv +encryptionAuthTag +encryptionVersion').limit(100);
    let migrated = 0;
    for (const document of legacy) {
      const plainBytes = Buffer.from(String(document.contentBase64 || ''), 'base64');
      if (!plainBytes.length) {
        console.warn('Skipping empty legacy Sylva Mail attachment:', String(document._id));
        continue;
      }
      const encrypted = encryptAttachment(plainBytes);
      document.contentBase64 = encrypted.contentBase64;
      document.encryptionIv = encrypted.encryptionIv;
      document.encryptionAuthTag = encrypted.encryptionAuthTag;
      document.encryptionVersion = encrypted.encryptionVersion;
      await document.save();
      migrated += 1;
    }
    const remaining = await MailboxDocument.countDocuments({
      $or: [
        { encryptionVersion: mongoose.trusted({ $ne: 1 }) },
        { encryptionIv: '' },
        { encryptionAuthTag: '' },
      ],
    });
    return res.json({ success: true, migrated, remaining, message: remaining ? 'Run the migration again to encrypt the next batch.' : 'All stored attachments are encrypted.' });
  } catch (e) {
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    console.error('Legacy attachment encryption migration failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to encrypt legacy attachments.' });
  }
});

router.post('/send', protect, adminOnly, sendLimiter, async (req, res) => {
  let record;
  try {
    const to = normalizeList(req.body?.to);
    const cc = normalizeList(req.body?.cc);
    const bcc = normalizeList(req.body?.bcc);
    const senderAlias = String(req.body?.sender || 'support').toLowerCase();
    const subject = String(req.body?.subject || '').trim().slice(0, 300);
    const bodyText = String(req.body?.text || '').trim();
    const signatureName = String(req.body?.signatureName || '').trim().slice(0, 100);
    const signatureTitle = String(req.body?.signatureTitle || '').trim().slice(0, 120);
    const signatureText = ['Regards,', signatureName, signatureTitle, 'Sylva Technologies', 'Empowering Your Digital Life'].filter(Boolean).join('\n');
    const text = [bodyText, signatureText].filter(Boolean).join('\n\n');
    const from = SENDERS[senderAlias];
    const inputAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (!from) return res.status(400).json({ success: false, message: 'Choose a permitted Sylva sender address.' });
    if (!validList(to) || !validList(cc) || !validList(bcc) || (to.length + cc.length + bcc.length === 0)) {
      return res.status(400).json({ success: false, message: 'Enter valid recipients in To, CC, or BCC (maximum 50 per field).' });
    }
    if (!subject || !bodyText || text.length > 100000) return res.status(400).json({ success: false, message: 'Enter a subject and message under 100,000 characters.' });
    if (inputAttachments.length > 10) return res.status(400).json({ success: false, message: 'You can attach up to 10 files.' });
    let totalSize = 0;
    const providerAttachments = inputAttachments.map(file => {
      const filename = String(file.filename || 'attachment').slice(0, 255);
      const content = String(file.content || '');
      const size = Math.floor(content.length * 0.75);
      totalSize += size;
      if (!content || content.length > 7 * 1024 * 1024) throw new Error('Each attachment must be a valid base64 file under 5 MB.');
      return { filename, content, contentType: String(file.contentType || 'application/octet-stream') };
    });
    if (totalSize > 6 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Combined attachments must be under 6 MB for safe delivery.' });
    let draftDocuments = [];
    if (req.body?.draftId && inputAttachments.length === 0) {
      draftDocuments = await MailboxDocument.find({ messageId: req.body.draftId }).select('+contentBase64 +encryptionIv +encryptionAuthTag +encryptionVersion').lean();
      for (const item of draftDocuments) {
        providerAttachments.push({ filename: item.filename, content: decryptAttachment(item).toString('base64'), contentType: item.contentType });
        totalSize += Number(item.size || 0);
      }
      if (totalSize > 6 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Combined attachments must be under 6 MB for safe delivery.' });
    }
    if (!resend) return res.status(503).json({ success: false, message: 'Email sending is not configured on the server.' });
    const fromAddress = (from.match(/<([^>]+)>/) || [])[1];
    const attachmentMetadata = inputAttachments.length
      ? inputAttachments.map(file => ({ ...file, size: Math.floor(String(file.content || '').length * 0.75) }))
      : draftDocuments.map(file => ({ filename: file.filename, contentType: file.contentType, size: file.size }));
    record = await MailboxMessage.create({
      direction: 'outbound', folder: 'outbox', from: fromAddress, senderAlias, to, cc, bcc,
      ...encryptMessageContent({ subject, text, html: '' }), signatureName, signatureTitle, attachments: safeAttachments(attachmentMetadata),
      status: 'queued', isRead: true, sentAt: new Date(), lastStatusAt: new Date(),
    });
    if (inputAttachments.length) await storeDocumentFiles(record._id, inputAttachments, true);
    else if (draftDocuments.length) {
      await MailboxDocument.insertMany(draftDocuments.map(file => ({
        messageId: record._id, filename: file.filename, contentType: file.contentType,
        size: file.size, contentBase64: file.contentBase64,
        encryptionIv: file.encryptionIv, encryptionAuthTag: file.encryptionAuthTag,
        encryptionVersion: file.encryptionVersion,
      })));
    }
    const { data, error } = await resend.emails.send({
      from, to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}),
      subject, text,
      html: '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.65;color:#0f172a">' + escapeHtml(bodyText).replace(/\r?\n/g, '<br>') +
        '<div style="margin-top:24px;padding-top:14px;border-top:3px solid #166534">' +
        '<p style="margin:0 0 5px;color:#475569">Regards,</p>' +
        (signatureName ? '<strong style="display:block">' + escapeHtml(signatureName) + '</strong>' : '') +
        (signatureTitle ? '<span style="display:block;color:#475569;font-size:13px">' + escapeHtml(signatureTitle) + '</span>' : '') +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>' +
        '<td style="vertical-align:middle;padding-right:12px"><img src="https://www.sylvatechnologies.co.ke/sylva-logo.svg" alt="Sylva Technologies" width="54" height="54" style="display:block;object-fit:contain"></td>' +
        '<td style="vertical-align:middle"><strong style="display:block;color:#166534;font-size:17px">Sylva Technologies</strong><span style="color:#475569;font-size:12px">Empowering Your Digital Life</span></td>' +
        '</tr></table></div></div>',
      replyTo: fromAddress, ...(providerAttachments.length ? { attachments: providerAttachments } : {}),
    });
    if (error) {
      const providerReason = String(error.message || error.name || 'Provider send failed').slice(0, 500);
      console.error('Resend rejected Sylva Mail message:', providerReason);
      record.status = 'failed';
      record.events.push({ type: 'email.failed', details: { message: providerReason } });
      record.lastStatusAt = new Date();
      await record.save();
      return res.status(502).json({ success: false, message: 'Resend rejected the email: ' + providerReason, messageId: record._id });
    }
    record.providerMessageId = data?.id || undefined;
    record.providerEmailId = data?.id || '';
    record.folder = 'sent';
    record.status = 'sent';
    record.events.push({ type: 'email.sent', details: { providerMessageId: data?.id || '' } });
    record.lastStatusAt = new Date();
    await record.save();
    if (req.body?.draftId) {
      await MailboxMessage.findOneAndUpdate(
        { _id: req.body.draftId, direction: 'outbound', folder: 'drafts' },
        { $set: { folder: 'trash' } }
      );
    }
    return res.json({ success: true, message: 'Email submitted to Resend.', email: decryptMessageContent(record) });
  } catch (e) {
    if (record && record.status === 'queued') {
      record.status = 'failed';
      record.lastStatusAt = new Date();
      record.events.push({ type: 'email.failed', details: { message: String(e.message || 'Send failed').slice(0, 500) } });
      await record.save().catch(() => {});
    }
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid draft identifier.' });
    if (e.code === 'MAIL_ATTACHMENT_ENCRYPTION_NOT_CONFIGURED') return res.status(503).json({ success: false, message: e.message });
    if (e.code === 'MAIL_ATTACHMENT_LEGACY_FORMAT') return res.status(409).json({ success: false, message: e.message });
    console.error('Mailbox send failed:', e.message);
    return res.status(400).json({ success: false, message: e.message.includes('attachment') ? e.message : 'Unable to send this email.' });
  }
});


router.patch('/:id/read-status', protect, adminOnly, async (req, res) => {
  try {
    if (typeof req.body?.isRead !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isRead must be true or false.' });
    }
    const message = await MailboxMessage.findByIdAndUpdate(
      req.params.id,
      { $set: { isRead: req.body.isRead } },
      { new: true, runValidators: true }
    );
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    return res.json({ success: true, message: 'Message read status updated.', isRead: message.isRead });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    console.error('Mailbox read status update failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to update message read status.' });
  }
});

router.patch('/:id/folder', protect, adminOnly, async (req, res) => {
  try {
    const folder = String(req.body?.folder || '');
    if (!['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash'].includes(folder)) return res.status(400).json({ success: false, message: 'Invalid mailbox folder.' });
    const message = await MailboxMessage.findByIdAndUpdate(req.params.id, { $set: { folder } }, { new: true, runValidators: true });
    if (!message) return res.status(404).json({ success: false, message: 'Message not found.' });
    return res.json({ success: true, message });
  } catch (e) {
    if (e.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid message identifier.' });
    return res.status(500).json({ success: false, message: 'Unable to move this message.' });
  }
});

router.post('/events/resend', async (req, res) => {
  if (!resend || !process.env.RESEND_INBOUND_WEBHOOK_SECRET || !req.rawBody) {
    return res.status(503).json({ success: false, message: 'Resend event webhook is not configured.' });
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
  const type = String(event?.type || '');
  const providerMessageId = String(event?.data?.email_id || event?.data?.id || '').trim();
  const statusMap = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.delivery_delayed': 'delivery_delayed',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
  };
  if (!statusMap[type] || !providerMessageId) return res.status(200).json({ success: true, ignored: true });
  try {
    const message = await MailboxMessage.findOne({ $or: [{ providerEmailId: providerMessageId }, { providerMessageId }] });
    if (!message) return res.status(200).json({ success: true, unmatched: true });
    message.status = statusMap[type];
    message.lastStatusAt = new Date();
    if (type === 'email.delivered') message.deliveredAt = event.created_at ? new Date(event.created_at) : new Date();
    message.events.push({ type, at: event.created_at ? new Date(event.created_at) : new Date(), details: { eventId: event.id || '', reason: event.data?.reason || event.data?.bounce?.message || '' } });
    await message.save();
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Mailbox event webhook failed:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to store email status.' });
  }
});

module.exports = router;
