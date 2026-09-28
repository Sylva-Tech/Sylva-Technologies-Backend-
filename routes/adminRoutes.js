const express = require('express');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');

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

const getSellerStoreStatus = (seller) => {
  return (
    seller.storeStatus ||
    (seller.sellerStatus === 'approved'
      ? 'active'
      : 'inactive')
  );
};

const sanitizeSeller = (
  seller,
  {
    includeSensitive = false,
  } = {}
) => {
  const sellerObject =
    seller?.toObject
      ? seller.toObject()
      : seller;

  const sellerProfile =
    sellerObject?.sellerProfile || {};

  const data = {
    _id: sellerObject._id,

    id: sellerObject._id,

    name:
      sellerObject.name || '',

    email:
      sellerObject.email || '',

    phone:
      sellerObject.phone || '',

    role:
      sellerObject.role || 'customer',

    sellerStatus:
      sellerObject.sellerStatus ||
      'none',

    accountStatus:
      sellerObject.accountStatus ||
      'active',

    storeStatus:
      getSellerStoreStatus(
        sellerObject
      ),

    suspensionReason:
      sellerObject.suspensionReason ||
      '',

    banReason:
      sellerObject.banReason ||
      '',

    storeName:
      sellerProfile.storeName ||
      'Not provided',

    applicationDate:
      sellerProfile.applicationDate ||
      sellerObject.createdAt ||
      null,

    createdAt:
      sellerObject.createdAt ||
      null,

    reviewedAt:
      sellerProfile.reviewedAt ||
      null,

    rejectionReason:
      sellerProfile.rejectionReason ||
      '',

    sellerProfile: {
      officialName:
        sellerProfile.officialName ||
        '',

      storeName:
        sellerProfile.storeName ||
        'Not provided',

      storeEmail:
        sellerProfile.storeEmail ||
        '',

      storePhone:
        sellerProfile.storePhone ||
        '',

      mpesaPhone:
        sellerProfile.mpesaPhone ||
        '',

      applicationDate:
        sellerProfile.applicationDate ||
        null,

      reviewedAt:
        sellerProfile.reviewedAt ||
        null,

      rejectionReason:
        sellerProfile.rejectionReason ||
        '',

      storeLocation:
        sellerProfile.storeLocation ||
        '',
    },
  };

  /*
   * Private document references are only
   * returned when explicitly requested.
   */
  if (includeSensitive) {
    data.sellerProfile.idFrontDocument =
      sellerProfile.idFrontDocument ||
      '';

    data.sellerProfile.idBackDocument =
      sellerProfile.idBackDocument ||
      '';

    data.sellerProfile.kraPinDocument =
      sellerProfile.kraPinDocument ||
      '';
  }

  return data;
};

/*
|--------------------------------------------------------------------------
| ADMIN DASHBOARD STATS
|--------------------------------------------------------------------------
| GET /api/admin/stats
|--------------------------------------------------------------------------
*/

router.get(
  '/stats',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const totalOrders =
        await Order.countDocuments();

      const pendingOrders =
        await Order.countDocuments({
          status: 'Pending',
        });

      const processingOrders =
        await Order.countDocuments({
          status: 'Processing',
        });

      const completedOrders =
        await Order.countDocuments({
          status: 'Delivered',
        });

      const cancelledOrders =
        await Order.countDocuments({
          status: 'Cancelled',
        });

      const totalCustomers =
        await User.countDocuments({
          role: 'customer',
        });

      const totalProducts =
        await Product.countDocuments();

      const lowStock =
        await Product.countDocuments({
          stock: {
            $lt: Number(
              process.env
                .LOW_STOCK_THRESHOLD ||
                5
            ),
          },
        });

      const paidFilter = {
        paymentStatus: 'Paid',

        status: {
          $ne: 'Cancelled',
        },
      };

      const revenueAgg =
        await Order.aggregate([
          {
            $match: paidFilter,
          },

          {
            $group: {
              _id: null,

              total: {
                $sum: '$total',
              },
            },
          },
        ]);

      const totalRevenue =
        revenueAgg[0]?.total || 0;

      const now = new Date();

      const monthStart =
        new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        );

      const monthFilter = {
        ...paidFilter,

        createdAt: {
          $gte: monthStart,
        },
      };

      const monthAgg =
        await Order.aggregate([
          {
            $match: monthFilter,
          },

          {
            $group: {
              _id: null,

              total: {
                $sum: '$total',
              },
            },
          },
        ]);

      const monthRevenue =
        monthAgg[0]?.total || 0;

      return res.json({
        success: true,

        data: {
          totalOrders,

          pendingOrders,

          processingOrders,

          completedOrders,

          cancelledOrders,

          totalCustomers,

          totalProducts,

          lowStock,

          totalRevenue,

          monthRevenue,
        },
      });
    } catch (error) {
      console.error(
        'Admin stats error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load admin stats.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SELLER APPLICATIONS
|--------------------------------------------------------------------------
| GET /api/admin/sellers
|--------------------------------------------------------------------------
*/

router.get(
  '/sellers',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const requestedStatus =
        String(
          req.query.status ||
            'all'
        )
          .trim()
          .toLowerCase();

      const validStatuses = [
        'pending',
        'approved',
        'rejected',
      ];

      /*
       * Use $or instead of $in for the
       * "all" seller application query.
       *
       * This avoids the CastError currently
       * occurring with the sellerStatus field.
       */
      let filter = {
        $or: [
          {
            sellerStatus:
              'pending',
          },
          {
            sellerStatus:
              'approved',
          },
          {
            sellerStatus:
              'rejected',
          },
        ],
      };

      /*
       * For a specific status, use a
       * direct string comparison.
       */
      if (
        validStatuses.includes(
          requestedStatus
        )
      ) {
        filter = {
          sellerStatus:
            requestedStatus,
        };
      }

      const sellers =
        await User.find(filter)
          .select('-password')
          .sort({
            createdAt: -1,
          })
          .lean();

      const data =
        sellers.map((seller) =>
          sanitizeSeller(
            seller
          )
        );

      return res.json({
        success: true,

        status:
          requestedStatus,

        count:
          data.length,

        data,
      });
    } catch (error) {
      console.error(
        'Load seller applications error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load seller applications.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| PENDING SELLER APPLICATIONS
|--------------------------------------------------------------------------
| GET /api/admin/sellers/pending
|--------------------------------------------------------------------------
*/

router.get(
  '/sellers/pending',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers =
        await User.find({
          sellerStatus:
            'pending',
        })
          .select('-password')
          .sort({
            'sellerProfile.applicationDate':
              -1,

            createdAt:
              -1,
          });

      const data =
        sellers.map((seller) =>
          sanitizeSeller(
            seller
          )
        );

      return res.json({
        success: true,

        count:
          data.length,

        data,
      });
    } catch (error) {
      console.error(
        'Load pending sellers error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load pending seller applications.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SINGLE SELLER APPLICATION
|--------------------------------------------------------------------------
| GET /api/admin/sellers/:id
|--------------------------------------------------------------------------
*/

router.get(
  '/sellers/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid seller ID.',
        });
      }

      /*
       * Use $or instead of $in here as well
       * to prevent the same sellerStatus
       * casting problem.
       */
      const seller =
        await User.findOne({
          _id: req.params.id,

          $or: [
            {
              sellerStatus:
                'pending',
            },
            {
              sellerStatus:
                'approved',
            },
            {
              sellerStatus:
                'rejected',
            },
          ],
        }).select(
          '-password'
        );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller application not found.',
        });
      }

      return res.json({
        success: true,

        data: sanitizeSeller(
          seller,
          {
            includeSensitive:
              true,
          }
        ),
      });
    } catch (error) {
      console.error(
        'Load seller application error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load seller application.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| UPDATE SELLER STORE NAME
|--------------------------------------------------------------------------
| PATCH /api/admin/sellers/:id/store
|--------------------------------------------------------------------------
*/

router.patch(
  '/sellers/:id/store',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid seller ID.',
        });
      }

      const storeName =
        String(
          req.body?.storeName ||
            ''
        ).trim();

      if (
        !storeName ||
        storeName.length < 2 ||
        storeName.length > 100
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Store name is required and must be between 2 and 100 characters.',
        });
      }

      const seller =
        await User.findById(
          req.params.id
        );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller not found.',
        });
      }

      if (
        !seller.sellerProfile
      ) {
        seller.sellerProfile =
          {};
      }

      seller.sellerProfile.storeName =
        storeName;

      if (
        seller.role !==
          'seller' &&
        seller.sellerStatus ===
          'approved'
      ) {
        seller.role = 'seller';
      }

      await seller.save();

      return res.json({
        success: true,

        message:
          'Store name updated successfully.',

        data:
          sanitizeSeller(
            seller
          ),
      });
    } catch (error) {
      console.error(
        'Update seller store error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to update seller store information.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| APPROVE SELLER
|--------------------------------------------------------------------------
| PUT /api/admin/sellers/:id/approve
|--------------------------------------------------------------------------
*/

router.put(
  '/sellers/:id/approve',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid seller ID.',
        });
      }

      const seller =
        await User.findById(
          req.params.id
        );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller application not found.',
        });
      }

      if (
        seller.sellerStatus ===
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This seller account is already approved.',
        });
      }

      if (
        seller.sellerStatus !==
          'pending' &&
        seller.sellerStatus !==
          'rejected'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This account does not have a seller application.',
        });
      }

      if (
        !seller.sellerProfile
      ) {
        seller.sellerProfile =
          {};
      }

      seller.role = 'seller';

      seller.sellerStatus =
        'approved';

      /*
       * Approval controls seller
       * application status.
       *
       * It does NOT override a ban/suspension.
       */
      if (
        seller.accountStatus !==
          'banned' &&
        seller.accountStatus !==
          'suspended'
      ) {
        seller.accountStatus =
          'active';
      }

      seller.storeStatus =
        'active';

      seller.sellerProfile.reviewedAt =
        new Date();

      seller.sellerProfile.rejectionReason =
        '';

      await seller.save();

      return res.json({
        success: true,

        message:
          'Seller account approved successfully.',

        data:
          sanitizeSeller(
            seller
          ),
      });
    } catch (error) {
      console.error(
        'Approve seller error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to approve seller account.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| REJECT SELLER
|--------------------------------------------------------------------------
| PUT /api/admin/sellers/:id/reject
|--------------------------------------------------------------------------
*/

router.put(
  '/sellers/:id/reject',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.id
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid seller ID.',
        });
      }

      const reason =
        String(
          req.body?.reason ||
            req.body
              ?.rejectionReason ||
            ''
        ).trim();

      if (!reason) {
        return res.status(400).json({
          success: false,
          message:
            'A rejection reason is required.',
        });
      }

      const seller =
        await User.findById(
          req.params.id
        );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller application not found.',
        });
      }

      if (
        seller.sellerStatus ===
        'approved'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'An approved seller cannot be rejected from this endpoint.',
        });
      }

      if (
        seller.sellerStatus !==
          'pending' &&
        seller.sellerStatus !==
          'rejected'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'This account does not have a seller application.',
        });
      }

      seller.role =
        'customer';

      seller.sellerStatus =
        'rejected';

      /*
       * Rejection is an application
       * status, not a suspension or ban.
       *
       * The user can still log in and
       * resubmit the seller application.
       */
      if (
        seller.accountStatus !==
          'banned' &&
        seller.accountStatus !==
          'suspended'
      ) {
        seller.accountStatus =
          'active';
      }

      seller.storeStatus =
        'inactive';

      if (
        !seller.sellerProfile
      ) {
        seller.sellerProfile =
          {};
      }

      seller.sellerProfile.reviewedAt =
        new Date();

      seller.sellerProfile.rejectionReason =
        reason;

      await seller.save();

      return res.json({
        success: true,

        message:
          'Seller application rejected.',

        data:
          sanitizeSeller(
            seller
          ),
      });
    } catch (error) {
      console.error(
        'Reject seller error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to reject seller application.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| VENDOR STORES
|--------------------------------------------------------------------------
| GET /api/admin/vendor-stores
|--------------------------------------------------------------------------
*/

router.get(
  '/vendor-stores',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers =
        await User.find({
          role: 'seller',

          sellerStatus:
            'approved',
        })
          .select(
            'name email sellerStatus accountStatus storeStatus suspensionReason banReason sellerProfile.storeName createdAt'
          )
          .sort({
            createdAt: -1,
          });

      const stores =
        await Promise.all(
          sellers.map(
            async (seller) => {
              const productCount =
                await Product.countDocuments(
                  {
                    seller:
                      seller._id,
                  }
                );

              return {
                id: seller._id,

                name:
                  seller.name,

                email:
                  seller.email,

                storeName:
                  seller
                    .sellerProfile
                    ?.storeName ||
                  'Not provided',

                sellerStatus:
                  seller.sellerStatus,

                accountStatus:
                  seller.accountStatus ||
                  'active',

                storeStatus:
                  getSellerStoreStatus(
                    seller
                  ),

                suspensionReason:
                  seller.suspensionReason ||
                  '',

                banReason:
                  seller.banReason ||
                  '',

                createdAt:
                  seller.createdAt,

                productCount,
              };
            }
          )
        );

      return res.json({
        success: true,

        count:
          stores.length,

        data: stores,
      });
    } catch (error) {
      console.error(
        'Load vendor stores error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load vendor stores.',
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| VENDOR PRODUCTS
|--------------------------------------------------------------------------
| GET /api/admin/vendor-stores/:sellerId/products
|--------------------------------------------------------------------------
*/

router.get(
  '/vendor-stores/:sellerId/products',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      if (
        !mongoose.isValidObjectId(
          req.params.sellerId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid seller ID.',
        });
      }

      const seller =
        await User.findOne({
          _id:
            req.params.sellerId,

          role: 'seller',

          sellerStatus:
            'approved',
        }).select(
          'name email sellerStatus accountStatus storeStatus suspensionReason banReason sellerProfile.storeName createdAt'
        );

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Approved vendor not found.',
        });
      }

      const products =
        await Product.find({
          seller:
            seller._id,
        })
          .populate(
            'category'
          )
          .populate(
            'seller',
            'name email sellerProfile.storeName sellerStatus accountStatus storeStatus'
          )
          .sort({
            createdAt: -1,
          });

      return res.json({
        success: true,

        count:
          products.length,

        seller: {
          id: seller._id,

          name:
            seller.name,

          email:
            seller.email,

          storeName:
            seller
              .sellerProfile
              ?.storeName ||
            'Not provided',

          sellerStatus:
            seller.sellerStatus,

          accountStatus:
            seller.accountStatus ||
            'active',

          storeStatus:
            getSellerStoreStatus(
              seller
            ),

          createdAt:
            seller.createdAt,
        },

        data: products,
      });
    } catch (error) {
      console.error(
        'Load vendor products error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load vendor products.',
      });
    }
  }
);

module.exports = router;


