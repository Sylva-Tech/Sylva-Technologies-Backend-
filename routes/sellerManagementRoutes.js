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

const VALID_SELLER_ID = (id) =>
  mongoose.Types.ObjectId.isValid(id);

const getStoreName = (seller) =>
  seller?.sellerProfile?.storeName?.trim() || '';

const getEffectiveStatus = (seller) => {
  if (seller.sellerStatus === 'pending') {
    return 'pending';
  }

  if (seller.sellerStatus === 'rejected') {
    return 'rejected';
  }

  if (seller.accountStatus === 'banned') {
    return 'banned';
  }

  if (seller.accountStatus === 'suspended') {
    return 'suspended';
  }

  if (
    seller.sellerStatus === 'approved' &&
    seller.accountStatus !== 'suspended' &&
    seller.accountStatus !== 'banned'
  ) {
    return 'active';
  }

  return 'pending';
};

const serializeSeller = (seller) => {
  const item = seller.toObject
    ? seller.toObject()
    : seller;

  return {
    _id: item._id,
    name: item.name,
    email: item.email,
    phone: item.phone,

    sellerStatus: item.sellerStatus || 'none',

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

    idNumber:
      item.sellerProfile?.idNumber || '',

    kraPin:
      item.sellerProfile?.kraPin || '',

    applicationDate:
      item.sellerProfile?.applicationDate ||
      item.createdAt,

    reviewedAt:
      item.sellerProfile?.reviewedAt || null,

    rejectionReason:
      item.sellerProfile?.rejectionReason || '',

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

    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

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
      const sellers = await User.find({
        role: 'seller',
      })
        .select('-password')
        .sort({ createdAt: -1 });

      return res.json({
        success: true,
        data: sellers.map(serializeSeller),
      });
    } catch (error) {
      console.error(
        'Seller management list error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Unable to load sellers.',
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
      if (!VALID_SELLER_ID(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const seller = await User.findOne({
        _id: req.params.id,
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

      const productCount =
        await Product.countDocuments({
          seller: seller._id,
        });

      const activeProductCount =
        await Product.countDocuments({
          seller: seller._id,
          isActive: true,
          approvalStatus: 'approved',
        });

      const lastProduct =
        await Product.findOne({
          seller: seller._id,
        })
          .sort({ createdAt: -1 })
          .select('createdAt');

      const appealHistory =
        await SellerAppeal.find({
          seller: seller._id,
        })
          .populate(
            'reviewedBy',
            'name email'
          )
          .sort({ createdAt: -1 });

      const result =
        serializeSeller(seller);

      result.productCount =
        productCount;

      result.activeProductCount =
        activeProductCount;

      result.lastProductAddedAt =
        lastProduct?.createdAt ||
        seller.lastProductAddedAt ||
        null;

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

      result.appeals = appealHistory;

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
      if (!VALID_SELLER_ID(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const storeName =
        String(req.body.storeName || '')
          .trim();

      if (!storeName) {
        return res.status(400).json({
          success: false,
          message: 'Store name is required.',
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
            _id: req.params.id,
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
        data: serializeSeller(seller),
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
      if (!VALID_SELLER_ID(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const reason =
        String(req.body.reason || '')
          .trim();

      if (!reason) {
        return res.status(400).json({
          success: false,
          message:
            'A suspension reason is required.',
        });
      }

      const seller =
        await User.findOne({
          _id: req.params.id,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (seller.sellerStatus !== 'approved') {
        return res.status(400).json({
          success: false,
          message:
            'Only an approved seller can be suspended.',
        });
      }

      if (seller.accountStatus === 'banned') {
        return res.status(400).json({
          success: false,
          message:
            'A banned seller cannot be suspended.',
        });
      }

      seller.accountStatus = 'suspended';
      seller.storeStatus = 'inactive';
      seller.suspensionReason = reason;
      seller.suspendedAt = new Date();
      seller.suspendedBy = req.user._id;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller store suspended.',
        data: serializeSeller(seller),
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
      if (!VALID_SELLER_ID(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const reason =
        String(req.body.reason || '')
          .trim();

      if (!reason) {
        return res.status(400).json({
          success: false,
          message:
            'A ban reason is required.',
        });
      }

      const seller =
        await User.findOne({
          _id: req.params.id,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (seller.sellerStatus !== 'approved') {
        return res.status(400).json({
          success: false,
          message:
            'Only an approved seller can be banned.',
        });
      }

      seller.accountStatus = 'banned';
      seller.storeStatus = 'inactive';
      seller.banReason = reason;
      seller.bannedAt = new Date();
      seller.bannedBy = req.user._id;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller has been banned.',
        data: serializeSeller(seller),
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
      if (!VALID_SELLER_ID(req.params.id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid seller ID.',
        });
      }

      const seller =
        await User.findOne({
          _id: req.params.id,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message: 'Seller not found.',
        });
      }

      if (seller.sellerStatus !== 'approved') {
        return res.status(400).json({
          success: false,
          message:
            'Seller application is not approved.',
        });
      }

      seller.accountStatus = 'active';
      seller.storeStatus = 'active';

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
        data: serializeSeller(seller),
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
      if (req.user.role !== 'seller') {
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
        data: serializeSeller(seller),
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
      if (req.user.role !== 'seller') {
        return res.status(403).json({
          success: false,
          message:
            'Seller account required.',
        });
      }

      const reason =
        String(req.body.reason || '')
          .trim();

      const type =
        req.body.type === 'ban'
          ? 'ban'
          : 'suspension';

      if (reason.length < 10) {
        return res.status(400).json({
          success: false,
          message:
            'Please provide at least 10 characters explaining your appeal.',
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
          seller: currentSeller._id,
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
          seller: currentSeller._id,
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
      if (req.user.role !== 'seller') {
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
          .sort({ createdAt: -1 });

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
            'name email phone sellerStatus sellerProfile accountStatus storeStatus'
          )
          .populate(
            'reviewedBy',
            'name email'
          )
          .sort({ createdAt: -1 });

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
    try {
      if (
        !VALID_SELLER_ID(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid appeal ID.',
        });
      }

      const appeal =
        await SellerAppeal.findById(
          req.params.id
        );

      if (!appeal) {
        return res.status(404).json({
          success: false,
          message:
            'Appeal not found.',
        });
      }

      if (appeal.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message:
            'This appeal has already been reviewed.',
        });
      }

      const seller =
        await User.findOne({
          _id: appeal.seller,
          role: 'seller',
        });

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller not found.',
        });
      }

      if (
        appeal.type === 'suspension' &&
        seller.accountStatus !== 'suspended'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller is no longer suspended.',
        });
      }

      if (
        appeal.type === 'ban' &&
        seller.accountStatus !== 'banned'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller is no longer banned.',
        });
      }

      appeal.status = 'approved';
      appeal.reviewedAt = new Date();
      appeal.reviewedBy = req.user._id;
      appeal.adminResponse =
        String(
          req.body.response ||
            'Appeal approved.'
        ).trim();

      seller.accountStatus = 'active';
      seller.storeStatus = 'active';

      seller.suspensionReason = '';
      seller.suspendedAt = null;
      seller.suspendedBy = null;

      seller.banReason = '';
      seller.bannedAt = null;
      seller.bannedBy = null;

      await seller.save();
      await appeal.save();

      return res.json({
        success: true,
        message:
          'Appeal approved and seller reactivated.',
        data: appeal,
      });
    } catch (error) {
      console.error(
        'Approve appeal error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to approve appeal.',
      });
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
      if (
        !VALID_SELLER_ID(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid appeal ID.',
        });
      }

      const response =
        String(
          req.body.response || ''
        ).trim();

      if (!response) {
        return res.status(400).json({
          success: false,
          message:
            'An admin response is required when rejecting an appeal.',
        });
      }

      const appeal =
        await SellerAppeal.findById(
          req.params.id
        );

      if (!appeal) {
        return res.status(404).json({
          success: false,
          message:
            'Appeal not found.',
        });
      }

      if (appeal.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message:
            'This appeal has already been reviewed.',
        });
      }

      appeal.status = 'rejected';
      appeal.reviewedAt = new Date();
      appeal.reviewedBy = req.user._id;
      appeal.adminResponse = response;

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