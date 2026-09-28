const User = require('../models/User');
const Product = require('../models/Product');

const INACTIVITY_DAYS = 60;

async function suspendInactiveSellers() {
  const cutoff = new Date(
    Date.now() -
      INACTIVITY_DAYS *
        24 *
        60 *
        60 *
        1000
  );

  const sellers =
    await User.find({
      role: 'seller',
      sellerStatus: 'approved',
      accountStatus: 'active',
    });

  let suspended = 0;

  for (const seller of sellers) {
    const latestProduct =
      await Product.findOne({
        seller: seller._id,
      })
        .sort({ createdAt: -1 })
        .select('createdAt');

    const lastProductDate =
      latestProduct?.createdAt || null;

    const sellerReferenceDate =
      lastProductDate ||
      seller.sellerProfile
        ?.applicationDate ||
      seller.createdAt;

    if (
      sellerReferenceDate <=
      cutoff
    ) {
      seller.accountStatus =
        'suspended';

      seller.storeStatus =
        'inactive';

      seller.suspensionReason =
        'Store suspended due to prolonged inactivity. No product has been added for 2 months.';

      seller.suspendedAt =
        new Date();

      seller.suspendedBy = null;

      seller.lastProductAddedAt =
        lastProductDate;

      await seller.save();

      suspended += 1;
    }
  }

  return suspended;
}

module.exports = {
  suspendInactiveSellers,
};
