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
        $and: [
          { $or: [
            { accessTokenExpiresAt: { $lte: new Date(now.getTime() + REFRESH_AHEAD_MS) } },
            { accessTokenExpiresAt: null },
            { accessTokenExpiresAt: { $exists: false } },
          ] },
          { $or: [
            { tokenRefreshLockUntil: null },
            { tokenRefreshLockUntil: { $exists: false } },
            { tokenRefreshLockUntil: { $lte: now } },
          ] },
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getUsableBuyerToken = async (connection) => {
  if (!connection?._id) throw new Error('AliExpress connection is unavailable.');
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const latest = await AliExpressConnection.findById(connection._id)
      .select('+accessTokenEncrypted +refreshTokenEncrypted +tokenRefreshLockId');
    if (!latest || latest.status !== 'connected') throw new Error('AliExpress buyerApp connection is not active.');
    const expiresAt = latest.accessTokenExpiresAt ? new Date(latest.accessTokenExpiresAt).getTime() : 0;
    const lockUntil = latest.tokenRefreshLockUntil ? new Date(latest.tokenRefreshLockUntil).getTime() : 0;
    if (lockUntil > Date.now()) {
      await wait(750);
      continue;
    }
    if (latest.accessTokenEncrypted && expiresAt > Date.now() + 60000) {
      connection.accessTokenExpiresAt = latest.accessTokenExpiresAt;
      connection.tokenLastRefreshedAt = latest.tokenLastRefreshedAt;
      return decryptSecret(latest.accessTokenEncrypted);
    }
    await refreshConnectedBuyerToken();
    await wait(500);
  }
  const error = new Error('AliExpress token refresh is still pending. Retry the request shortly; the admin session is unchanged.');
  error.code = 'ALIEXPRESS_TOKEN_REFRESH_PENDING';
  error.status = 503;
  throw error;
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

module.exports = { startAliExpressTokenRefresh, refreshConnectedBuyerToken, getUsableBuyerToken };
