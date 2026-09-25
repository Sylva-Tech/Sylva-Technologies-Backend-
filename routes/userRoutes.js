const express = require('express');

const User = require('../models/User');

const {
  protect,
  adminOnly,
} = require('../middleware/authMiddleware');

const sellerUpload = require('../middleware/sellerUpload');

const uploadBufferToCloudinary = require('../utils/uploadToCloudinary');

const cloudinary = require('../config/cloudinary');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| ADMIN - LOAD ALL USERS
|--------------------------------------------------------------------------
*/

router.get(
  '/',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const users = await User.find()
        .select('-password')
        .sort({
          createdAt: -1,
        });

      return res.json(users);
    } catch (error) {
      console.error(
        'Load users error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to load users.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER - GET OWN APPLICATION
|--------------------------------------------------------------------------
|
| Used by sellers to see:
| - application status
| - rejection reason
| - information that can be edited
|
| IMPORTANT:
| Private Cloudinary document references are
| intentionally NOT returned.
|
*/

router.get(
  '/seller/application',
  protect,
  async (req, res) => {
    try {
      const user = await User.findById(
        req.user._id
      )
        .select(
          [
            'name',
            'email',
            'phone',
            'role',
            'sellerStatus',
            'createdAt',
            'sellerProfile.officialName',
            'sellerProfile.idType',
            'sellerProfile.idNumber',
            'sellerProfile.dateOfBirth',
            'sellerProfile.storeName',
            'sellerProfile.storeEmail',
            'sellerProfile.storePhone',
            'sellerProfile.mpesaPhone',
            'sellerProfile.kraPin',
            'sellerProfile.storeLocation',
            'sellerProfile.applicationDate',
            'sellerProfile.reviewedAt',
            'sellerProfile.rejectionReason',
          ].join(' ')
        )
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User account not found.',
        });
      }

      if (
        ![
          'pending',
          'approved',
          'rejected',
        ].includes(user.sellerStatus)
      ) {
        return res.status(404).json({
          success: false,
          message:
            'You do not currently have a seller application.',
        });
      }

      return res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      console.error(
        'Load seller application error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load your seller application.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER - RESUBMIT REJECTED APPLICATION
|--------------------------------------------------------------------------
|
| PUT /api/users/seller/application/resubmit
|
| Multipart/form-data fields:
|
| Text:
| - officialName
| - idType
| - idNumber
| - dateOfBirth
| - storeName
| - storeEmail
| - storePhone
| - mpesaPhone
| - kraPin
| - storeLocation
|
| Optional files:
| - idFront
| - idBack
| - kraPin
|
| The document files are optional during resubmission.
| A newly supplied document replaces the existing
| Cloudinary document reference.
|
*/

router.put(
  '/seller/application/resubmit',

  /*
   * Reuse the exact same upload middleware
   * used by seller registration.
   */
  (req, res, next) => {
    sellerUpload.fields([
      {
        name: 'idFront',
        maxCount: 1,
      },
      {
        name: 'idBack',
        maxCount: 1,
      },
      {
        name: 'kraPin',
        maxCount: 1,
      },
    ])(req, res, (error) => {
      if (error) {
        console.error(
          'Seller resubmission upload error:',
          error
        );

        return res.status(400).json({
          success: false,
          message:
            error.message ||
            'Unable to upload seller documents.',
        });
      }

      next();
    });
  },

  async (req, res) => {
    /*
     * Keep track of newly uploaded Cloudinary
     * files so they can be cleaned up if the
     * database operation fails.
     */
    const newlyUploadedFiles = [];

    try {
      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User account not found.',
        });
      }

      /*
       * Only rejected applications can
       * be resubmitted.
       */
      if (
        user.sellerStatus !== 'rejected'
      ) {
        return res.status(400).json({
          success: false,
          message:
            user.sellerStatus === 'pending'
              ? 'Your seller application is already under review.'
              : user.sellerStatus === 'approved'
              ? 'Your seller application has already been approved.'
              : 'There is no rejected seller application to resubmit.',
        });
      }

      /*
       * Multipart/form-data text fields are
       * available through req.body.
       */
      const {
        officialName,
        idType,
        idNumber,
        dateOfBirth,
        storeName,
        storeEmail,
        storePhone,
        mpesaPhone,
        kraPin,
        storeLocation,
      } = req.body;

      /*
       * Uploaded files are available through
       * req.files.
       */
      const files = req.files || {};

      const idFrontFile =
        files.idFront?.[0] || null;

      const idBackFile =
        files.idBack?.[0] || null;

      const kraPinFile =
        files.kraPin?.[0] || null;

      /*
       * Validate important seller details.
       */
      if (
        !officialName ||
        officialName.trim().length < 2
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide your official name.',
        });
      }

      if (
        !idType ||
        ![
          'national_id',
          'passport',
          'military_id',
          'other',
        ].includes(idType)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please select a valid identification type.',
        });
      }

      if (
        !idNumber ||
        idNumber.trim().length < 3
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide your identification number.',
        });
      }

      if (
        !mpesaPhone ||
        mpesaPhone.trim().length < 7
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide a valid M-Pesa phone number.',
        });
      }

      if (
        !storeName ||
        storeName.trim().length < 2
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide your store name.',
        });
      }

      /*
       * Make sure sellerProfile exists.
       */
      if (!user.sellerProfile) {
        user.sellerProfile = {};
      }

      /*
       * Store the old Cloudinary references.
       *
       * We delete them only after the database
       * has been successfully updated.
       */
      const oldIdFrontDocument =
        user.sellerProfile
          .idFrontDocument || null;

      const oldIdBackDocument =
        user.sellerProfile
          .idBackDocument || null;

      const oldKraPinDocument =
        user.sellerProfile
          .kraPinDocument || null;

      /*
       * Upload newly selected documents.
       *
       * These uploads are optional.
       *
       * If the seller doesn't select a new
       * document, the existing Cloudinary
       * reference remains unchanged.
       */

      let idFrontUpload = null;
      let idBackUpload = null;
      let kraPinUpload = null;

      if (idFrontFile) {
        idFrontUpload =
          await uploadBufferToCloudinary(
            idFrontFile.buffer
          );

        newlyUploadedFiles.push(
          idFrontUpload
        );
      }

      if (idBackFile) {
        idBackUpload =
          await uploadBufferToCloudinary(
            idBackFile.buffer
          );

        newlyUploadedFiles.push(
          idBackUpload
        );
      }

      if (kraPinFile) {
        kraPinUpload =
          await uploadBufferToCloudinary(
            kraPinFile.buffer
          );

        newlyUploadedFiles.push(
          kraPinUpload
        );
      }

      /*
       * Update application information.
       */
      user.name =
        officialName.trim();

      user.phone =
        mpesaPhone.trim();

      user.sellerProfile.officialName =
        officialName.trim();

      user.sellerProfile.idType =
        idType;

      user.sellerProfile.idNumber =
        idNumber.trim();

      if (dateOfBirth) {
        user.sellerProfile.dateOfBirth =
          dateOfBirth;
      }

      user.sellerProfile.storeName =
        storeName.trim();

      user.sellerProfile.storeEmail =
        storeEmail
          ? storeEmail
              .trim()
              .toLowerCase()
          : '';

      user.sellerProfile.storePhone =
        storePhone
          ? storePhone.trim()
          : '';

      user.sellerProfile.mpesaPhone =
        mpesaPhone.trim();

      /*
       * Preserve the existing KRA PIN
       * value unless a new value was
       * submitted.
       */
      if (kraPin !== undefined) {
        user.sellerProfile.kraPin =
          kraPin
            ? kraPin.trim()
            : '';
      }

      user.sellerProfile.storeLocation =
        storeLocation
          ? storeLocation.trim()
          : '';

      /*
       * Replace Cloudinary document
       * references only when a new file
       * was uploaded.
       */
      if (idFrontUpload) {
        user.sellerProfile
          .idFrontDocument =
          idFrontUpload.public_id;
      }

      if (idBackUpload) {
        user.sellerProfile
          .idBackDocument =
          idBackUpload.public_id;
      }

      if (kraPinUpload) {
        user.sellerProfile
          .kraPinDocument =
          kraPinUpload.public_id;
      }

      /*
       * Reset the application review state.
       */
      user.sellerStatus =
        'pending';

      /*
       * Keep the user as a customer until
       * an administrator approves the
       * seller application again.
       */
      user.role = 'customer';

      user.sellerProfile
        .applicationDate =
        new Date();

      user.sellerProfile.reviewedAt =
        null;

      user.sellerProfile
        .rejectionReason = '';

      await user.save();

      /*
       * The database update succeeded.
       *
       * Now remove the old Cloudinary
       * document only when it was replaced.
       */
      const oldDocumentsToDelete = [];

      if (
        idFrontUpload &&
        oldIdFrontDocument
      ) {
        oldDocumentsToDelete.push(
          oldIdFrontDocument
        );
      }

      if (
        idBackUpload &&
        oldIdBackDocument
      ) {
        oldDocumentsToDelete.push(
          oldIdBackDocument
        );
      }

      if (
        kraPinUpload &&
        oldKraPinDocument
      ) {
        oldDocumentsToDelete.push(
          oldKraPinDocument
        );
      }

      for (
        const publicId of oldDocumentsToDelete
      ) {
        try {
          await cloudinary.uploader.destroy(
            publicId,
            {
              type: 'authenticated',
              resource_type: 'image',
            }
          );
        } catch (cleanupError) {
          /*
           * Do not fail the seller
           * resubmission because an old
           * Cloudinary file could not be
           * deleted.
           */
          console.error(
            'Old Cloudinary document cleanup error:',
            cleanupError.message
          );
        }
      }

      return res.status(200).json({
        success: true,
        message:
          'Your seller application has been resubmitted successfully and is now pending admin review.',
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          sellerStatus:
            user.sellerStatus,
          sellerProfile: {
            officialName:
              user.sellerProfile
                .officialName,

            idType:
              user.sellerProfile
                .idType,

            idNumber:
              user.sellerProfile
                .idNumber,

            dateOfBirth:
              user.sellerProfile
                .dateOfBirth,

            storeName:
              user.sellerProfile
                .storeName,

            storeEmail:
              user.sellerProfile
                .storeEmail,

            storePhone:
              user.sellerProfile
                .storePhone,

            mpesaPhone:
              user.sellerProfile
                .mpesaPhone,

            kraPin:
              user.sellerProfile
                .kraPin,

            storeLocation:
              user.sellerProfile
                .storeLocation,

            applicationDate:
              user.sellerProfile
                .applicationDate,

            reviewedAt:
              user.sellerProfile
                .reviewedAt,

            rejectionReason:
              user.sellerProfile
                .rejectionReason,
          },
        },
      });
    } catch (error) {
      console.error(
        'Seller application resubmission error:',
        error
      );

      /*
       * If anything failed after uploading
       * new files, remove those newly
       * uploaded files so Cloudinary does
       * not accumulate orphaned documents.
       */
      for (
        const uploadedFile of newlyUploadedFiles
      ) {
        try {
          if (
            uploadedFile?.public_id
          ) {
            await cloudinary.uploader.destroy(
              uploadedFile.public_id,
              {
                type: 'authenticated',
                resource_type:
                  uploadedFile.resource_type ||
                  'image',
              }
            );
          }
        } catch (cleanupError) {
          console.error(
            'Cloudinary cleanup error:',
            cleanupError.message
          );
        }
      }

      return res.status(500).json({
        success: false,
        message:
          'Unable to resubmit your seller application.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN - GET USER BY ID
|--------------------------------------------------------------------------
*/

router.get(
  '/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.params.id
        ).select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User not found.',
        });
      }

      return res.json(user);
    } catch (error) {
      console.error(
        'Fetch user error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          'Unable to fetch user.',
      });
    }
  }
);

module.exports = router;