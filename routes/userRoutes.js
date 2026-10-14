const express = require('express');
const crypto = require('crypto');

const User = require('../models/User');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const VerificationToken = require('../models/VerificationToken');

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
| MARK CUSTOMER ACCOUNT AS REVIEWED BY ADMIN
|--------------------------------------------------------------------------
*/
router.patch('/:id/admin-review', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'customer' },
      { $set: { adminReviewedAt: new Date(), adminReviewedBy: req.user._id } },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Customer account not found.' });
    }

    return res.json({ success: true, message: 'Customer marked as reviewed.', data: user });
  } catch (error) {
    console.error('Mark customer reviewed error:', error);
    return res.status(500).json({ success: false, message: 'Unable to mark this customer as reviewed.' });
  }
});

router.put(
  '/me/profile',
  protect,
  sellerUpload.single('profilePicture'),
  async (req, res) => {
    try {
      const user = await User.findById(req.user._id).select('+profilePicturePublicId');
      if (!user || user.accountDeleted) {
        return res.status(404).json({ success: false, message: 'Account not found.' });
      }

      const name = req.body?.name;
      const email = req.body?.email;
      const phone = req.body?.phone;
      const bio = req.body?.bio;
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');

      if (name !== undefined) {
        const value = String(name).trim();
        if (value.length < 2 || value.length > 100) {
          return res.status(400).json({ success: false, message: 'Name must be between 2 and 100 characters.' });
        }
        user.name = value;
      }

      if (email !== undefined) {
        const value = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 150) {
          return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
        }
        if (value !== user.email) {
          const existing = await User.findOne({ email: value }).select('_id');
          if (existing && String(existing._id) !== String(user._id)) {
            return res.status(409).json({ success: false, message: 'That email address is already in use.' });
          }
          user.email = value;
          user.isVerified = false;
        }
      }

      if (phone !== undefined) {
        const value = String(phone).trim();
        if (value.length > 30) return res.status(400).json({ success: false, message: 'Phone number is too long.' });
        user.phone = value;
      }

      if (bio !== undefined) {
        const value = String(bio).trim();
        if (value.length > 500) return res.status(400).json({ success: false, message: 'Bio cannot exceed 500 characters.' });
        user.bio = value;
      }

      if (newPassword) {
        if (!currentPassword || !(await user.matchPassword(currentPassword))) {
          return res.status(400).json({ success: false, message: 'Enter your current password to change it.' });
        }
        if (newPassword.length < 8) {
          return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
        }
        if (newPassword === currentPassword) {
          return res.status(400).json({ success: false, message: 'Choose a password different from your current password.' });
        }
        user.password = newPassword;
      }

      if (req.file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) {
          return res.status(400).json({ success: false, message: 'Profile pictures must be JPG, PNG or WEBP images.' });
        }
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: 'sylva/profile-pictures', resource_type: 'image', type: 'upload', transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' }] },
            (error, result) => error ? reject(error) : resolve(result)
          );
          stream.end(req.file.buffer);
        });
        user.profilePicture = uploaded.secure_url;
        user.profilePicturePublicId = uploaded.public_id;
      }

      await user.save();
      const safeUser = user.toObject();
      delete safeUser.password;
      delete safeUser.profilePicturePublicId;

      return res.json({ success: true, message: 'Profile updated successfully.', data: { user: safeUser } });
    } catch (error) {
      console.error('Update own profile error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Unable to update your profile.' });
    }
  }
);

router.delete('/me', protect, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const user = await User.findById(req.user._id);
    if (!user || user.accountDeleted) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    if (!currentPassword || !(await user.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Your current password is required to confirm account deletion.' });
    }

    if (user.role === 'admin') {
      const adminAccounts = await User.find({ role: 'admin' }).select('accountDeleted');
      const activeAdmins = adminAccounts.filter(account => !account.accountDeleted).length;
      if (activeAdmins <= 1) {
        return res.status(409).json({ success: false, message: 'This is the only active administrator. Create and verify another administrator before deleting this account.' });
      }
    }

    const available = Number(user.wallet?.availableBalance || 0);
    const pending = Number(user.wallet?.pendingBalance || 0);
    if (available > 0 || pending > 0) {
      return res.status(409).json({ success: false, message: 'Please withdraw your available wallet funds and resolve pending transactions before deleting your account.' });
    }
    const pendingWalletAction = (user.wallet?.transactions || []).some(tx =>
      tx.status === 'pending' && ['payout_request', 'mpesa_topup'].includes(tx.category)
    );
    if (pendingWalletAction) {
      return res.status(409).json({ success: false, message: 'Please wait for pending wallet deposits or withdrawals to be resolved before deleting your account.' });
    }

    // Preserve order and financial history; disable access and anonymize sign-in details.
    user.accountDeleted = true;
    user.deletedAt = new Date();
    user.name = 'Deleted Sylva account';
    user.email = 'deleted-' + String(user._id) + '@deleted.sylva.invalid';
    user.phone = '';
    user.bio = '';
    user.profilePicture = '';
    user.profilePicturePublicId = '';
    user.isVerified = false;
    user.password = crypto.randomBytes(48).toString('hex');
    await user.save();

    await Promise.all([
      Notification.deleteMany({ user: user._id }),
      VerificationToken.deleteMany({ user: user._id }),
    ]);

    return res.json({ success: true, message: 'Your account has been deactivated and your sign-in details anonymized. Historical order and financial records are retained for recordkeeping.' });
  } catch (error) {
    console.error('Delete current user error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete your account right now.' });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const targetId = req.params.id;

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required.',
      });
    }

    if (req.user.role !== 'admin' && req.user._id.toString() !== targetId) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to delete this account.',
      });
    }

    const targetUser = await User.findById(targetId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User account not found.',
      });
    }

    if (targetUser.role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin accounts cannot be deleted here.',
      });
    }

    await Promise.all([
      User.findByIdAndDelete(targetId),
      Order.deleteMany({ customer: targetId }),
      Order.deleteMany({ customerEmail: targetUser.email }),
      Notification.deleteMany({ user: targetId }),
      VerificationToken.deleteMany({ user: targetId }),
    ]);

    return res.json({
      success: true,
      message: 'Customer account and all associated records were deleted successfully.',
    });
  } catch (error) {
    console.error('Delete user error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Unable to delete this account.',
    });
  }
});

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
      // One-time compatibility backfill: existing accounts predate inbox review tracking.
      await User.collection.updateMany(
        { adminReviewedAt: { $exists: false } },
        { $set: { adminReviewedAt: new Date() } }
      );

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
   * IMPORTANT:
   * Authenticate the currently logged-in seller first.
   *
   * This populates req.user and allows the route
   * to safely use req.user._id below.
   */
  protect,

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
      /*
       * protect middleware has already authenticated
       * the user and populated req.user.
       */
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
       * Make sure sellerProfile exists before
       * reading existing seller information.
       */
      if (!user.sellerProfile) {
        user.sellerProfile = {};
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
       * IMPORTANT:
       *
       * If Store Name is not supplied by the frontend,
       * preserve the Store Name originally submitted
       * during seller registration.
       */
      const finalStoreName =
        storeName !== undefined
          ? storeName.trim()
          : (
              user.sellerProfile.storeName || ''
            ).trim();

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
        idNumber.trim().length < 3 ||
        !kraPin ||
        !/^[A-Za-z]\d{9}[A-Za-z]$/.test(String(kraPin).trim())
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide a valid identification number and KRA PIN number.',
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
        !finalStoreName ||
        finalStoreName.length < 2
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide your store name.',
        });
      }

      /*
       * Store the old Cloudinary references.
       *
       * They will only be deleted if a replacement
       * document is successfully uploaded and the
       * database update succeeds.
       */
      const oldIdFrontDocument =
        user.sellerProfile.idFrontDocument ||
        null;

      const oldIdBackDocument =
        user.sellerProfile.idBackDocument ||
        null;

      const oldKraPinDocument =
        user.sellerProfile.kraPinDocument ||
        null;

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

      /*
       * Preserve the existing date of birth
       * if no new value was submitted.
       */
      if (dateOfBirth) {
        user.sellerProfile.dateOfBirth =
          dateOfBirth;
      }

      /*
       * Use the Store Name originally registered
       * by the seller unless a new Store Name was
       * supplied.
       */
      user.sellerProfile.storeName =
        finalStoreName;

      /*
       * Preserve existing store email if the
       * frontend doesn't send a new value.
       */
      if (storeEmail !== undefined) {
        user.sellerProfile.storeEmail =
          storeEmail
            ? storeEmail
                .trim()
                .toLowerCase()
            : '';
      }

      /*
       * Preserve existing store phone if the
       * frontend doesn't send a new value.
       */
      if (storePhone !== undefined) {
        user.sellerProfile.storePhone =
          storePhone
            ? storePhone.trim()
            : '';
      }

      user.sellerProfile.mpesaPhone =
        mpesaPhone.trim();

      /*
       * Preserve the existing KRA PIN value
       * unless a new value was submitted.
       */
      if (
  kraPin !== undefined &&
  typeof kraPin === 'string'
) {
  user.sellerProfile.kraPin =
    kraPin.trim();
}

      /*
       * Preserve existing store location if
       * the frontend does not send a new value.
       */
      if (storeLocation !== undefined) {
        user.sellerProfile.storeLocation =
          storeLocation
            ? storeLocation.trim()
            : '';
      }

      /*
       * Replace Cloudinary document references
       * only when a new file was uploaded.
       */
      if (idFrontUpload) {
        user.sellerProfile.idFrontDocument =
          idFrontUpload.public_id;
      }

      if (idBackUpload) {
        user.sellerProfile.idBackDocument =
          idBackUpload.public_id;
      }

      if (kraPinUpload) {
        user.sellerProfile.kraPinDocument =
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

      user.sellerProfile.applicationDate =
        new Date();

      user.sellerProfile.reviewedAt =
        null;

      user.sellerProfile.rejectionReason =
        '';

      /*
       * Save the updated application.
       */
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
        oldDocumentsToDelete.push({
          publicId: oldIdFrontDocument,
          resourceType:
            idFrontUpload.resource_type ||
            'image',
        });
      }

      if (
        idBackUpload &&
        oldIdBackDocument
      ) {
        oldDocumentsToDelete.push({
          publicId: oldIdBackDocument,
          resourceType:
            idBackUpload.resource_type ||
            'image',
        });
      }

      if (
        kraPinUpload &&
        oldKraPinDocument
      ) {
        oldDocumentsToDelete.push({
          publicId: oldKraPinDocument,
          resourceType:
            kraPinUpload.resource_type ||
            'image',
        });
      }

      for (
        const document of oldDocumentsToDelete
      ) {
        try {
          await cloudinary.uploader.destroy(
            document.publicId,
            {
              type: 'authenticated',
              resource_type:
                document.resourceType,
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

      /*
       * Return the updated application.
       *
       * Private Cloudinary document references
       * are intentionally NOT returned.
       */
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

            /*
             * This will now contain the
             * Store Name from registration
             * unless the seller edited it.
             */
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