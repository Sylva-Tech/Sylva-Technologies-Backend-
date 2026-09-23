const cloudinary = require('../config/cloudinary');

const uploadBufferToCloudinary = (buffer) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'sylva/seller-verification',
        resource_type: 'auto',
        type: 'authenticated',
        use_filename: false,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });

module.exports = uploadBufferToCloudinary;