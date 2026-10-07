const cloudinary = require('../config/cloudinary');

const uploadProductImage = (buffer) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'sylva/products',
        resource_type: 'image',
        type: 'upload',
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

module.exports = uploadProductImage;