const isAliExpressOAuthStateValid = (expiresAt, now = Date.now()) => {
  if (!(expiresAt instanceof Date)) return false;
  const expiryTime = expiresAt.getTime();
  return Number.isFinite(expiryTime) && expiryTime > now;
};

module.exports = { isAliExpressOAuthStateValid };
