const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/User');
const Product = require('../models/Product');
const SellerAppeal = require('../models/SellerAppeal');

const {
  protect,
  adminOnly,
} = require('../middleware/authMiddleware');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const isValidObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const getStoreName = (seller) =>
  seller?.sellerProfile?.storeName?.trim() || '';

const getEffectiveStatus = (seller) => {
  const sellerStatus = seller?.sellerStatus || 'none';
  const accountStatus = seller?.accountStatus || 'active';

  if (sellerStatus === 'pending') {
    return 'pending';
  }

  if (sellerStatus === 'rejected') {
    return 'rejected';
  }

  if (accountStatus === 'banned') {
    return 'banned';
  }

  if (accountStatus === 'suspended') {
    return 'suspended';
  }

  if (
    sellerStatus === 'approved' &&
    accountStatus !== 'suspended' &&
    accountStatus !== 'banned'
  ) {
    return 'active';
  }

  return 'pending';
};

/*
 * General seller serializer.
 *
 * Sensitive verification information such as ID number and KRA PIN
 * is only included when explicitly requested by an admin details route.
 */
const serializeSeller = (
  seller,
  { includeSensitive = false } = {}
) => {
  const item = seller?.toObject
    ? seller.toObject()
    : seller;

  if (!item) {
    return null;
  }

  const result = {
    _id: item._id,
    name: item.name,
    email: item.email,
    phone: item.phone,

    sellerStatus:
      item.sellerStatus || 'none',

    accountStatus:
      item.accountStatus || 'active',

    storeStatus:
      item.storeStatus ||
      (item.sellerStatus === 'approved'
        ? 'active'
        : 'inactive'),

    effectiveStatus:
      getEffectiveStatus(item),

    storeName:
      getStoreName(item) || 'Not provided',

    storeProfile:
      item.sellerProfile?.storeProfile || '',

    storeLocation:
      item.sellerProfile?.storeLocation || '',

    officialName:
      item.sellerProfile?.officialName ||
      item.name ||
      '',

    idType:
      item.sellerProfile?.idType || '',

    applicationDate:
      item.sellerProfile?.applicationDate ||
      item.createdAt ||
      null,

    reviewedAt:
      item.sellerProfile?.reviewedAt ||
      null,

    rejectionReason:
      item.sellerProfile?.rejectionReason ||
      '',

    suspensionReason:
      item.suspensionReason || '',

    suspendedAt:
      item.suspendedAt || null,

    suspendedBy:
      item.suspendedBy || null,

    banReason:
      item.banReason || '',

    bannedAt:
      item.bannedAt || null,

    bannedBy:
      item.bannedBy || null,

    lastProductAddedAt:
      item.lastProductAddedAt || null,

    createdAt:
      item.createdAt || null,

    updatedAt:
      item.updatedAt || null,
  };

  /*
   * Only admin seller-details requests should receive
   * these sensitive verification fields.
   */
  if (includeSensitive) {
    result.idNumber =
      item.sellerProfile?.idNumber || '';

    result.kraPin =
      item.sellerProfile?.kraPin || '';
  }

  return result;
};

const getReason = (value) =>
  String(value || '').trim();

const getAdminResponse = (body = {}) =>
  String(
    body.adminResponse ??
      body.response ??
      ''
  ).trim();

/*
|--------------------------------------------------------------------------
| ADMIN — SELLER LIST
|--------------------------------------------------------------------------
*/

router.get(
  '/admin/sellers',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers =
        await User.find({
          role: 'seller',
        })
          .select('-password')
          .sort({
            createdAt: -1,
          });

      return res.json({
        success: true,
        data: sellers.map((seller) =>
          serializeSeller(seller)
        ),
      });
    } catch (error) {
      console.error(
        'Admin seller list error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load sellers.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — SELLER DETAILS
|--------------------------------------------------------------------------
*/

router.get(
  '/admin/sellers/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellerId =
        req.params.id;

      if (!isValidObjectId(sellerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const seller =
        await User.findOne({
          _id: sellerId,
          role: 'seller',
        })
          .select('-password')
          .populate(
            'suspendedBy',
            'name email'
          )
          .populate(
            'bannedBy',
            'name email'
          );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      const [
        productCount,
        activeProductCount,
        lastProduct,
        appealHistory,
      ] = await Promise.all([
        Product.countDocuments({
          seller: seller._id,
        }),

        Product.countDocuments({
          seller: seller._id,
          isActive: true,
          approvalStatus: 'approved',
        }),

        Product.findOne({
          seller: seller._id,
        })
          .sort({
            createdAt: -1,
          })
          .select('createdAt')
          .lean(),

        SellerAppeal.find({
          seller: seller._id,
        })
          .populate(
            'reviewedBy',
            'name email'
          )
          .sort({
            createdAt: -1,
          }),
      ]);

      /*
       * Sensitive verification fields are intentionally
       * included only on this admin-only details endpoint.
       */
      const result = serializeSeller(
        seller,
        {
          includeSensitive: true,
        }
      );

      result.productCount =
        productCount;

      result.activeProductCount =
        activeProductCount;

      result.lastProductAddedAt =
        lastProduct?.createdAt ||
        seller.lastProductAddedAt ||
        null;

      /*
       * Do not expose actual document paths/files.
       * Only tell the admin whether the documents exist.
       */
      result.documents = {
        idFront: Boolean(
          seller.sellerProfile
            ?.idFrontDocument
        ),

        idBack: Boolean(
          seller.sellerProfile
            ?.idBackDocument
        ),

        kraPin: Boolean(
          seller.sellerProfile
            ?.kraPinDocument
        ),
      };

      result.appeals =
        appealHistory;

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error(
        'Seller details error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load seller details.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — UPDATE STORE NAME
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/sellers/:id/store',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellerId =
        req.params.id;

      if (!isValidObjectId(sellerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const storeName =
        String(
          req.body?.storeName || ''
        ).trim();

      if (!storeName) {
        return res.status(400).json({
          success: false,
          message:
            'Store name is required.',
        });
      }

      if (storeName.length < 2) {
        return res.status(400).json({
          success: false,
          message:
            'Store name must contain at least 2 characters.',
        });
      }

      if (storeName.length > 100) {
        return res.status(400).json({
          success: false,
          message:
            'Store name cannot exceed 100 characters.',
        });
      }

      const seller =
        await User.findOneAndUpdate(
          {
            _id: sellerId,
            role: 'seller',
          },
          {
            $set: {
              'sellerProfile.storeName':
                storeName,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        ).select('-password');

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      return res.json({
        success: true,
        message:
          'Store name updated successfully.',
        data:
          serializeSeller(seller),
      });
    } catch (error) {
      console.error(
        'Update seller store error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update store information.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — SUSPEND SELLER
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/sellers/:id/suspend',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellerId =
        req.params.id;

      if (!isValidObjectId(sellerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const reason =
        getReason(req.body?.reason);

      if (!reason) {
        return res.status(400).json({
          success: false,
          message:
            'A suspension reason is required.',
        });
      }

      if (reason.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            'The suspension reason must contain at least 5 characters.',
        });
      }

      if (reason.length > 1000) {
        return res.status(400).json({
          success: false,
          message:
            'The suspension reason cannot exceed 1000 characters.',
        });
      }

      const seller =
        await User.findOne({
          _id: sellerId,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (
        seller.sellerStatus !==
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Only an approved seller can be suspended.',
        });
      }

      if (
        seller.accountStatus ===
        'suspended'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller is already suspended.',
        });
      }

      if (
        seller.accountStatus ===
        'banned'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'A banned seller cannot be suspended.',
        });
      }

      seller.accountStatus =
        'suspended';

      seller.storeStatus =
        'inactive';

      seller.suspensionReason =
        reason;

      seller.suspendedAt =
        new Date();

      seller.suspendedBy =
        req.user._id;

      /*
       * Clear any stale ban information.
       */
      seller.banReason = '';
      seller.bannedAt = null;
      seller.bannedBy = null;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller store suspended.',
        data:
          serializeSeller(seller),
      });
    } catch (error) {
      console.error(
        'Suspend seller error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to suspend seller.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — BAN SELLER
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/sellers/:id/ban',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellerId =
        req.params.id;

      if (!isValidObjectId(sellerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const reason =
        getReason(req.body?.reason);

      if (!reason) {
        return res.status(400).json({
          success: false,
          message:
            'A ban reason is required.',
        });
      }

      if (reason.length < 5) {
        return res.status(400).json({
          success: false,
          message:
            'The ban reason must contain at least 5 characters.',
        });
      }

      if (reason.length > 1000) {
        return res.status(400).json({
          success: false,
          message:
            'The ban reason cannot exceed 1000 characters.',
        });
      }

      const seller =
        await User.findOne({
          _id: sellerId,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (
        seller.sellerStatus !==
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Only an approved seller can be banned.',
        });
      }

      if (
        seller.accountStatus ===
        'banned'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller is already banned.',
        });
      }

      seller.accountStatus =
        'banned';

      seller.storeStatus =
        'inactive';

      seller.banReason =
        reason;

      seller.bannedAt =
        new Date();

      seller.bannedBy =
        req.user._id;

      /*
       * Clear any stale suspension information.
       */
      seller.suspensionReason = '';
      seller.suspendedAt = null;
      seller.suspendedBy = null;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller has been banned.',
        data:
          serializeSeller(seller),
      });
    } catch (error) {
      console.error(
        'Ban seller error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to ban seller.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — REACTIVATE SELLER
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/sellers/:id/reactivate',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellerId =
        req.params.id;

      if (!isValidObjectId(sellerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const seller =
        await User.findOne({
          _id: sellerId,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (
        seller.sellerStatus !==
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Seller application is not approved.',
        });
      }

      const accountStatus =
        seller.accountStatus ||
        'active';

      if (
        accountStatus ===
        'active'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller is already active.',
        });
      }

      if (
        accountStatus !==
          'suspended' &&
        accountStatus !==
          'banned'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller cannot be reactivated from the current account state.',
        });
      }

      seller.accountStatus =
        'active';

      seller.storeStatus =
        'active';

      seller.suspensionReason = '';
      seller.suspendedAt = null;
      seller.suspendedBy = null;

      seller.banReason = '';
      seller.bannedAt = null;
      seller.bannedBy = null;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller has been reactivated.',
        data:
          serializeSeller(seller),
      });
    } catch (error) {
      console.error(
        'Reactivate seller error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to reactivate seller.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER — CURRENT STATUS
|--------------------------------------------------------------------------
*/

router.get(
  '/seller/status',
  protect,
  async (req, res) => {
    try {
      if (
        req.user.role !==
        'seller'
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Seller account required.',
        });
      }

      const seller =
        await User.findById(
          req.user._id
        ).select('-password');

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller not found.',
        });
      }

      return res.json({
        success: true,
        data:
          serializeSeller(seller),
      });
    } catch (error) {
      console.error(
        'Seller status error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load seller status.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER — SUBMIT APPEAL
|--------------------------------------------------------------------------
*/

router.post(
  '/seller/appeals',
  protect,
  async (req, res) => {
    try {
      if (
        req.user.role !==
        'seller'
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Seller account required.',
        });
      }

      const reason =
        getReason(req.body?.reason);

      if (reason.length < 10) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide at least 10 characters explaining your appeal.',
        });
      }

      if (reason.length > 2000) {
        return res.status(400).json({
          success: false,
          message:
            'Your appeal cannot exceed 2000 characters.',
        });
      }

      const currentSeller =
        await User.findById(
          req.user._id
        );

      if (!currentSeller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller account not found.',
        });
      }

      /*
       * Accept the frontend's explicit type.
       *
       * If no type is supplied, derive it from the
       * current account status for backward compatibility.
       */
      const requestedType =
        String(
          req.body?.type || ''
        )
          .trim()
          .toLowerCase();

      let type =
        requestedType;

      if (!type) {
        if (
          currentSeller.accountStatus ===
          'banned'
        ) {
          type = 'ban';
        } else if (
          currentSeller.accountStatus ===
          'suspended'
        ) {
          type = 'suspension';
        }
      }

      if (
        !['suspension', 'ban'].includes(
          type
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Appeal type must be either suspension or ban.',
        });
      }

      if (
        currentSeller.sellerStatus !==
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Only an approved seller can submit a suspension or ban appeal.',
        });
      }

      if (
        type === 'suspension' &&
        currentSeller.accountStatus !==
          'suspended'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Your account is not currently suspended.',
        });
      }

      if (
        type === 'ban' &&
        currentSeller.accountStatus !==
          'banned'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Your account is not currently banned.',
        });
      }

      const existing =
        await SellerAppeal.findOne({
          seller:
            currentSeller._id,
          type,
          status: 'pending',
        });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            'You already have a pending appeal of this type.',
        });
      }

      const appeal =
        await SellerAppeal.create({
          seller:
            currentSeller._id,
          type,
          reason,
        });

      return res.status(201).json({
        success: true,
        message:
          'Your appeal has been submitted.',
        data: appeal,
      });
    } catch (error) {
      /*
       * If a future unique database index is added for
       * pending appeals, this also handles duplicate-key races.
       */
      if (
        error?.code === 11000
      ) {
        return res.status(409).json({
          success: false,
          message:
            'You already have a pending appeal of this type.',
        });
      }

      console.error(
        'Seller appeal error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to submit your appeal.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER — APPEAL HISTORY
|--------------------------------------------------------------------------
*/

router.get(
  '/seller/appeals',
  protect,
  async (req, res) => {
    try {
      if (
        req.user.role !==
        'seller'
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Seller account required.',
        });
      }

      const appeals =
        await SellerAppeal.find({
          seller: req.user._id,
        })
          .populate(
            'reviewedBy',
            'name email'
          )
          .sort({
            createdAt: -1,
          });

      return res.json({
        success: true,
        data: appeals,
      });
    } catch (error) {
      console.error(
        'Seller appeal history error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load your appeals.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — APPEALS
|--------------------------------------------------------------------------
*/

router.get(
  '/admin/appeals',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const appeals =
        await SellerAppeal.find()
          .populate(
            'seller',
            'name email phone sellerStatus accountStatus storeStatus sellerProfile.storeName sellerProfile.storeProfile sellerProfile.officialName'
          )
          .populate(
            'reviewedBy',
            'name email'
          )
          .sort({
            createdAt: -1,
          });

      return res.json({
        success: true,
        data: appeals,
      });
    } catch (error) {
      console.error(
        'Admin appeals error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load appeals.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — APPROVE APPEAL
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/appeals/:id/approve',
  protect,
  adminOnly,
  async (req, res) => {
    const session =
      await mongoose.startSession();

    try {
      const appealId =
        req.params.id;

      if (
        !isValidObjectId(
          appealId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid appeal ID.',
        });
      }

      const adminResponse =
        getAdminResponse(
          req.body
        );

      if (
        adminResponse.length > 2000
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Admin response cannot exceed 2000 characters.',
        });
      }

      let approvedAppeal = null;

      await session.withTransaction(
        async () => {
          /*
           * Read the appeal inside the transaction.
           */
          const appeal =
            await SellerAppeal.findById(
              appealId
            ).session(session);

          if (!appeal) {
            const error =
              new Error(
                'Appeal not found.'
              );

            error.statusCode = 404;

            throw error;
          }

          if (
            appeal.status !==
            'pending'
          ) {
            const error =
              new Error(
                'This appeal has already been reviewed.'
              );

            error.statusCode = 400;

            throw error;
          }

          if (
            !['suspension', 'ban'].includes(
              appeal.type
            )
          ) {
            const error =
              new Error(
                'Invalid appeal type.'
              );

            error.statusCode = 400;

            throw error;
          }

          const seller =
            await User.findOne({
              _id: appeal.seller,
              role: 'seller',
            }).session(session);

          if (!seller) {
            const error =
              new Error(
                'Seller not found.'
              );

            error.statusCode = 404;

            throw error;
          }

          /*
           * The seller must still be in the state
           * that the appeal was submitted against.
           */
          if (
            appeal.type ===
              'suspension' &&
            seller.accountStatus !==
              'suspended'
          ) {
            const error =
              new Error(
                'This seller is no longer suspended.'
              );

            error.statusCode = 400;

            throw error;
          }

          if (
            appeal.type === 'ban' &&
            seller.accountStatus !==
              'banned'
          ) {
            const error =
              new Error(
                'This seller is no longer banned.'
              );

            error.statusCode = 400;

            throw error;
          }

          const now =
            new Date();

          appeal.status =
            'approved';

          appeal.reviewedAt =
            now;

          appeal.reviewedBy =
            req.user._id;

          appeal.adminResponse =
            adminResponse ||
            'Appeal approved.';

          /*
           * Reactivate the seller.
           */
          seller.accountStatus =
            'active';

          seller.storeStatus =
            'active';

          /*
           * Clear suspension information.
           */
          seller.suspensionReason =
            '';

          seller.suspendedAt =
            null;

          seller.suspendedBy =
            null;

          /*
           * Clear ban information.
           */
          seller.banReason =
            '';

          seller.bannedAt =
            null;

          seller.bannedBy =
            null;

          await seller.save({
            session,
          });

          await appeal.save({
            session,
          });

          approvedAppeal =
            appeal;
        }
      );

      return res.json({
        success: true,
        message:
          'Appeal approved and seller reactivated.',
        data:
          approvedAppeal,
      });
    } catch (error) {
      console.error(
        'Approve appeal error:',
        error
      );

      /*
       * Transaction conflicts can occur if two admins
       * attempt to review the same appeal simultaneously.
       */
      if (
        error?.errorLabels?.includes(
          'TransientTransactionError'
        ) ||
        error?.errorLabels?.includes(
          'UnknownTransactionCommitResult'
        )
      ) {
        return res.status(409).json({
          success: false,
          message:
            'The appeal was being reviewed at the same time. Please refresh and try again.',
        });
      }

      const status =
        error.statusCode || 500;

      return res.status(status).json({
        success: false,
        message:
          status >= 500
            ? 'Unable to approve appeal.'
            : error.message,
      });
    } finally {
      await session.endSession();
    }
  }
);

/*
|--------------------------------------------------------------------------
| ADMIN — REJECT APPEAL
|--------------------------------------------------------------------------
*/

router.patch(
  '/admin/appeals/:id/reject',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const appealId =
        req.params.id;

      if (
        !isValidObjectId(
          appealId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid appeal ID.',
        });
      }

      const response =
        getAdminResponse(
          req.body
        );

      if (!response) {
        return res.status(400).json({
          success: false,
          message:
            'An admin response is required when rejecting an appeal.',
        });
      }

      if (response.length > 2000) {
        return res.status(400).json({
          success: false,
          message:
            'Admin response cannot exceed 2000 characters.',
        });
      }

      const appeal =
        await SellerAppeal.findById(
          appealId
        );

      if (!appeal) {
        return res.status(404).json({
          success: false,
          message:
            'Appeal not found.',
        });
      }

      if (
        appeal.status !==
        'pending'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This appeal has already been reviewed.',
        });
      }

      appeal.status =
        'rejected';

      appeal.reviewedAt =
        new Date();

      appeal.reviewedBy =
        req.user._id;

      appeal.adminResponse =
        response;

      await appeal.save();

      return res.json({
        success: true,
        message:
          'Appeal rejected.',
        data: appeal,
      });
    } catch (error) {
      console.error(
        'Reject appeal error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to reject appeal.',
      });
    }
  }
);

module.exports = router;