const express = require('express');

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
| ADMIN DASHBOARD STATS
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
              process.env.LOW_STOCK_THRESHOLD || 5
            ),
          },
        });

      /*
       * Total revenue from paid orders,
       * excluding cancelled orders.
       */
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

      /*
       * Current month revenue.
       */
      const now = new Date();

      const monthStart = new Date(
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
|
| GET /api/admin/sellers
|
| Returns seller accounts in all application states.
|
*/

router.get(
  '/sellers',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers = await User.find({
        sellerStatus: {
          $in: [
            'pending',
            'approved',
            'rejected',
          ],
        },
      })
        .select('-password')
        .sort({
          sellerStatus: 1,
          'sellerProfile.applicationDate': -1,
          createdAt: -1,
        });

      return res.json({
        success: true,
        count: sellers.length,
        data: sellers,
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
|
| GET /api/admin/sellers/pending
|
*/

router.get(
  '/sellers/pending',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers = await User.find({
        sellerStatus: 'pending',
      })
        .select('-password')
        .sort({
          'sellerProfile.applicationDate': -1,
          createdAt: -1,
        });

      return res.json({
        success: true,
        count: sellers.length,
        data: sellers,
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
|
| GET /api/admin/sellers/:id
|
*/

router.get(
  '/sellers/:id',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const seller = await User.findOne({
        _id: req.params.id,
        sellerStatus: {
          $in: [
            'pending',
            'approved',
            'rejected',
          ],
        },
      }).select('-password');

      if (!seller) {
        return res.status(404).json({
          success: false,
          message:
            'Seller application not found.',
        });
      }

      return res.json({
        success: true,
        data: seller,
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
| APPROVE SELLER
|--------------------------------------------------------------------------
|
| PUT /api/admin/sellers/:id/approve
|
| Approval changes:
| - role -> seller
| - sellerStatus -> approved
| - reviewedAt -> current date
| - rejectionReason -> empty
|
*/

router.put(
  '/sellers/:id/approve',
  protect,
  adminOnly,
  async (req, res) => {
    try {
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

      /*
       * Make sure this account actually
       * submitted a seller application.
       */
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

      seller.role = 'seller';
      seller.sellerStatus = 'approved';

      seller.sellerProfile.reviewedAt =
        new Date();

      seller.sellerProfile.rejectionReason =
        '';

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller account approved successfully.',
        data: {
          id: seller._id,
          name: seller.name,
          email: seller.email,
          role: seller.role,
          sellerStatus:
            seller.sellerStatus,
          sellerProfile:
            seller.sellerProfile,
        },
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
|
| PUT /api/admin/sellers/:id/reject
|
| Expected body:
|
| {
|   "reason": "Reason for rejection"
| }
|
*/

router.put(
  '/sellers/:id/reject',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const reason = String(
        req.body?.reason ||
          req.body?.rejectionReason ||
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

      /*
       * Keep rejected applicants as
       * customers until they are approved.
       */
      seller.role = 'customer';
      seller.sellerStatus = 'rejected';

      seller.sellerProfile.reviewedAt =
        new Date();

      seller.sellerProfile.rejectionReason =
        reason;

      await seller.save();

      return res.json({
        success: true,
        message:
          'Seller application rejected.',
        data: {
          id: seller._id,
          name: seller.name,
          email: seller.email,
          role: seller.role,
          sellerStatus:
            seller.sellerStatus,
          rejectionReason:
            seller.sellerProfile
              .rejectionReason,
          reviewedAt:
            seller.sellerProfile
              .reviewedAt,
        },
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
|
| GET /api/admin/vendor-stores
|
| Returns approved sellers with:
| - store name
| - owner name
| - email
| - account creation date/time
| - number of products
|
*/

router.get(
  '/vendor-stores',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const sellers = await User.find({
        role: 'seller',
        sellerStatus: 'approved',
      })
        .select(
          'name email sellerStatus sellerProfile.storeName createdAt'
        )
        .sort({
          createdAt: -1,
        });

      const stores = await Promise.all(
        sellers.map(
          async (seller) => {
            const productCount =
              await Product.countDocuments(
                {
                  seller: seller._id,
                }
              );

            return {
              id: seller._id,
              name: seller.name,
              email: seller.email,
              storeName:
                seller.sellerProfile
                  ?.storeName ||
                `${seller.name}'s Store`,
              sellerStatus:
                seller.sellerStatus,
              createdAt:
                seller.createdAt,
              productCount,
            };
          }
        )
      );

      return res.json({
        success: true,
        count: stores.length,
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
|
| GET /api/admin/vendor-stores/:sellerId/products
|
| Returns products belonging to one
| approved seller.
|
*/

router.get(
  '/vendor-stores/:sellerId/products',
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const seller =
        await User.findOne({
          _id: req.params.sellerId,
          role: 'seller',
          sellerStatus: 'approved',
        }).select(
          'name email sellerStatus sellerProfile.storeName createdAt'
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
          seller: seller._id,
        })
          .populate('category')
          .populate(
            'seller',
            'name email sellerProfile.storeName'
          )
          .sort({
            createdAt: -1,
          });

      return res.json({
        success: true,
        count: products.length,
        seller: {
          id: seller._id,
          name: seller.name,
          email: seller.email,
          storeName:
            seller.sellerProfile
              ?.storeName ||
            `${seller.name}'s Store`,
          sellerStatus:
            seller.sellerStatus,
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

/*
|--------------------------------------------------------------------------
| EXPORT ROUTER
|--------------------------------------------------------------------------
*/

module.exports = router;