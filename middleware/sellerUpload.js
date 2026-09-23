const multer = require('multer');

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(
      new Error(
        'Only JPG, PNG, WEBP images or PDF documents are allowed.'
      )
    );
  }

  cb(null, true);
};

const sellerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
  },
});

module.exports = sellerUpload;