const crypto = require('crypto');
const AliExpressConnection = require('../models/AliExpressConnection');
const { decryptSecret, encryptSecret, refreshAccessToken } = require('./aliexpressService');

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const LOCK_MS = 90 * 1000;
let interval = null;
let running = false;

const refreshConnectedBuyerToken = async () => {
  if (running) return;
  running = true;
  const now = new Date();
  const lockId = crypto.randomUUID();
  let locked = null;
  try {
    locked = await AliExpressConnection.findOneAndUpdate(
      {
        provider: 'aliexpress',
        status: 'connected',
        accessTokenExpiresAt: { $lte: new Date(now.getTime() + REFRESH_AHEAD_MS) },
        $or: [
          { tokenRefreshLockUntil: null },
          { tokenRefreshLockUntil: { $exists: false } },
          { tokenRefreshLockUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          tokenRefreshLockId: lockId,
          tokenRefreshLockUntil: new Date(now.getTime() + LOCK_MS),
        },
      },
      { new: true }
    ).select('+refreshTokenEncrypted +tokenRefreshLockId');

    if (!locked) return;
    if (!locked.refreshTokenEncrypted) {
      await AliExpressConnection.updateOne(
        { _id: locked._id, tokenRefreshLockId: lockId },
        { $set: { tokenRefreshLastError: 'Refresh credential is unavailable.' }, $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 } }
      );
      return;
    }

    const refreshToken = decryptSecret(locked.refreshTokenEncrypted);
    const token = await refreshAccessToken(refreshToken);
    if (!token?.access_token || !token?.expires_in) {
      throw new Error('AliExpress refresh response was incomplete.');
    }

    const update = {
      accessTokenEncrypted: encryptSecret(token.access_token),
      accessTokenExpiresAt: new Date(Date.now() + Number(token.expires_in) * 1000),
      tokenLastRefreshedAt: new Date(),
      tokenRefreshLastError: '',
    };
    if (token.refresh_token) update.refreshTokenEncrypted = encryptSecret(token.refresh_token);
    if (token.refresh_expires_in) update.refreshTokenExpiresAt = new Date(Date.now() + Number(token.refresh_expires_in) * 1000);

    await AliExpressConnection.updateOne(
      { _id: locked._id, tokenRefreshLockId: lockId },
      { $set: update, $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 } }
    );
  } catch (error) {
    if (locked?._id) {
      await AliExpressConnection.updateOne(
        { _id: locked._id, tokenRefreshLockId: lockId },
        {
          $set: { tokenRefreshLastError: String(error.message || 'Automatic token refresh failed.').slice(0, 300) },
          $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 },
        }
      ).catch(() => {});
    }
    console.error('AliExpress automatic token refresh failed:', String(error.message || 'Unknown refresh error'));
  } finally {
    running = false;
  }
};

const startAliExpressTokenRefresh = () => {
  if (interval) return;
  // Check on boot and then every five minutes. Refresh only when expiry is
  // within ten minutes, avoiding needless OAuth rotations and API traffic.
  refreshConnectedBuyerToken().catch(() => {});
  interval = setInterval(() => refreshConnectedBuyerToken().catch(() => {}), CHECK_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
  console.log('AliExpress token refresh monitor started (5-minute checks).');
};

module.exports = { startAliExpressTokenRefresh, refreshConnectedBuyerToken };
