const crypto = require('node:crypto');
const axios = require('axios');

const REQUIRED_PERMISSIONS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const TARGET_PAGE_NAME = 'Sylva Technologies';

function getMetaConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const redirectUri = String(process.env.META_REDIRECT_URI || '').trim();
  const version = String(process.env.META_GRAPH_API_VERSION || 'v27.0').trim();

  if (!appId || !appSecret || !redirectUri) {
    const error = new Error('Facebook connection is not configured on the server.');
    error.code = 'META_CONFIGURATION_MISSING';
    throw error;
  }
  if (!/^v\d+\.\d+$/.test(version)) {
    const error = new Error('The configured Meta Graph API version is invalid.');
    error.code = 'META_CONFIGURATION_INVALID';
    throw error;
  }
  return { appId, appSecret, redirectUri, version };
}

function getEncryptionKey() {
  const raw = String(process.env.META_TOKEN_ENCRYPTION_KEY || '').trim();
  let key;
  if (/^[a-f\d]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    const error = new Error('Facebook token encryption is not configured. Set META_TOKEN_ENCRYPTION_KEY to a 32-byte key.');
    error.code = 'META_ENCRYPTION_KEY_MISSING';
    throw error;
  }
  return key;
}

function encryptPageToken(token) {
  if (!token) throw new Error('Meta did not return a Page access token.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return {
    pageTokenCiphertext: ciphertext.toString('base64'),
    pageTokenIv: iv.toString('base64'),
    pageTokenAuthTag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptPageToken(connection) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(connection.pageTokenIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(connection.pageTokenAuthTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.pageTokenCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function createOAuthStateSecret() {
  const secret = String(process.env.JWT_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('The server JWT secret is not configured securely enough for Meta OAuth state.');
    error.code = 'META_STATE_SECRET_MISSING';
    throw error;
  }
  return crypto.createHash('sha256').update(secret + ':sylva-meta-facebook-oauth').digest();
}

function buildAuthorizationUrl(state) {
  const config = getMetaConfig();
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', REQUIRED_PERMISSIONS.join(','));
  return url.toString();
}

async function graphRequest(path, params, accessToken, method = 'GET') {
  const config = getMetaConfig();
  const url = `https://graph.facebook.com/${config.version}/${String(path).replace(/^\/+/, '')}`;
  const values = { ...(params || {}), access_token: accessToken };
  try {
    const response = await axios({
      method,
      url,
      params: method === 'GET' ? values : undefined,
      data: method === 'GET' ? undefined : new URLSearchParams(
        Object.entries(values).map(([key, value]) => [key, String(value)])
      ).toString(),
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      maxRedirects: 0,
    });
    return response.data;
  } catch (error) {
    const graphError = error.response?.data?.error;
    const failure = new Error(graphError?.message || 'Meta Graph API request failed.');
    failure.code = 'META_GRAPH_API_ERROR';
    failure.metaCode = graphError?.code || null;
    failure.metaSubcode = graphError?.error_subcode || null;
    failure.httpStatus = error.response?.status || null;
    throw failure;
  }
}

async function exchangeCodeForUserToken(code) {
  const config = getMetaConfig();
  const shortLived = await graphRequest('oauth/access_token', {
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  }, undefined, 'GET').catch(async (error) => {
    // OAuth token exchange is a query-string request; graphRequest's token
    // parameter is optional for this endpoint.
    if (error.code === 'META_GRAPH_API_ERROR') throw error;
    throw error;
  });
  if (!shortLived?.access_token) throw new Error('Meta did not return a user access token.');
  const longLived = await graphRequest('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortLived.access_token,
  }, undefined, 'GET');
  return longLived?.access_token || shortLived.access_token;
}

async function getManagedPages(userToken) {
  const response = await graphRequest('me/accounts', {
    fields: 'id,name,access_token,tasks',
    limit: 100,
  }, userToken);
  return Array.isArray(response?.data) ? response.data : [];
}

function chooseSylvaPage(pages) {
  const matches = (pages || []).filter((page) =>
    String(page.name || '').trim().toLowerCase() === TARGET_PAGE_NAME.toLowerCase()
  );
  if (matches.length !== 1) {
    const error = new Error(matches.length
      ? 'More than one Facebook Page is named Sylva Technologies. Resolve the duplicate Page names before connecting.'
      : 'The Facebook account did not return a Page named Sylva Technologies. Switch to an account with access to the official Page and try again.');
    error.code = matches.length ? 'META_PAGE_AMBIGUOUS' : 'META_PAGE_NOT_FOUND';
    throw error;
  }
  const page = matches[0];
  const tasks = Array.isArray(page.tasks) ? page.tasks.map((task) => String(task).toUpperCase()) : [];
  if (!tasks.includes('CREATE_CONTENT') && !tasks.includes('MANAGE')) {
    const error = new Error('The Facebook account does not have permission to publish content on the Sylva Technologies Page.');
    error.code = 'META_PAGE_TASK_MISSING';
    throw error;
  }
  if (!page.id || !page.access_token) {
    const error = new Error('Meta did not provide the Page ID and Page access token.');
    error.code = 'META_PAGE_TOKEN_MISSING';
    throw error;
  }
  return page;
}

async function schedulePagePost(connection, campaign) {
  const token = decryptPageToken(connection);
  const scheduledAt = new Date(campaign.scheduledAt);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const scheduledSeconds = Math.floor(scheduledAt.getTime() / 1000);
  if (!Number.isFinite(scheduledSeconds) || scheduledSeconds < nowSeconds + 600 || scheduledSeconds > nowSeconds + (75 * 24 * 60 * 60)) {
    const error = new Error('Facebook scheduling must be between 10 minutes and 75 days from now. Choose a date in that range.');
    error.code = 'META_SCHEDULE_WINDOW_INVALID';
    throw error;
  }

  const platformContent = campaign.content?.facebook || {};
  const captionParts = [
    platformContent.caption || campaign.content?.body || campaign.content?.headline || campaign.name,
    ...(Array.isArray(platformContent.hashtags) ? platformContent.hashtags : []),
    platformContent.callToAction || '',
  ].filter(Boolean);
  const message = captionParts.join('\n\n').slice(0, 5000);
  const asset = Array.isArray(campaign.assets) ? campaign.assets.find((item) => item.status === 'approved' && item.url) : null;
  let path = `${connection.pageId}/feed`;
  const params = {
    message,
    published: 'false',
    scheduled_publish_time: String(scheduledSeconds),
    unpublished_content_type: 'SCHEDULED',
  };

  if (asset?.kind === 'video') {
    path = `${connection.pageId}/videos`;
    params.file_url = asset.url;
    params.description = message;
    params.title = String(campaign.content?.headline || campaign.name).slice(0, 255);
  } else if (asset) {
    path = `${connection.pageId}/photos`;
    params.url = asset.url;
    params.caption = message;
  } else if (campaign.product?.productUrl) {
    params.link = campaign.product.productUrl;
  }

  const response = await graphRequest(path, params, token, 'POST');
  const externalId = response?.post_id || response?.id;
  if (!externalId) {
    const error = new Error('Meta accepted the request without returning a post ID. Check the Page scheduled posts before retrying.');
    error.code = 'META_POST_ID_MISSING';
    throw error;
  }
  return { externalId: String(externalId), mediaId: response?.id ? String(response.id) : '', scheduledAt };
}

async function getPagePostStatus(connection, postId) {
  const token = decryptPageToken(connection);
  return graphRequest(String(postId), { fields: 'id,is_published,permalink_url,scheduled_publish_time' }, token);
}

module.exports = {
  REQUIRED_PERMISSIONS,
  TARGET_PAGE_NAME,
  getMetaConfig,
  createOAuthStateSecret,
  buildAuthorizationUrl,
  encryptPageToken,
  decryptPageToken,
  exchangeCodeForUserToken,
  getManagedPages,
  chooseSylvaPage,
  schedulePagePost,
  getPagePostStatus,
};
