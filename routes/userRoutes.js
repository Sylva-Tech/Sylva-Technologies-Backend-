const express = require('express');
const User = require('../models/User');
const {
  protect,
  adminOnly,
} = require('../middleware/authMiddleware');

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
| Used by rejected sellers to see:
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
          message: 'User account not found.',
        });
      }

      if (
        !['pending', 'approved', 'rejected'].includes(
          user.sellerStatus
        )
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
*/

router.put(
  '/seller/application/resubmit',
  protect,
  async (req, res) => {
    try {
      const user = await User.findById(
        req.user._id
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User account not found.',
        });
      }

      /*
       * Only rejected applications can be
       * resubmitted.
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
       * Update application information.
       */
      user.name = officialName.trim();

      if (mpesaPhone) {
        user.phone = mpesaPhone.trim();
      }

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
          ? storeEmail.trim().toLowerCase()
          : '';

      user.sellerProfile.storePhone =
        storePhone
          ? storePhone.trim()
          : '';

      user.sellerProfile.mpesaPhone =
        mpesaPhone.trim();

      user.sellerProfile.kraPin =
        kraPin
          ? kraPin.trim()
          : '';

      user.sellerProfile.storeLocation =
        storeLocation
          ? storeLocation.trim()
          : '';

      /*
       * Reset the application review state.
       */
      user.sellerStatus = 'pending';

      user.role = 'customer';

      user.sellerProfile.applicationDate =
        new Date();

      user.sellerProfile.reviewedAt =
        null;

      user.sellerProfile.rejectionReason =
        '';

      await user.save();

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
              user.sellerProfile.idType,
            idNumber:
              user.sellerProfile.idNumber,
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
          message: 'User not found.',
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