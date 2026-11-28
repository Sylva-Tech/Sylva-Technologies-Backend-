const crypto = require('node:crypto');
const axios = require('axios');

const REQUIRED_PERMISSIONS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const OPTIONAL_PERMISSIONS = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_messages', 'pages_manage_metadata'];
const TARGET_PAGE_NAME = 'Sylva Technologies';
const TARGET_PAGE_ID = '1436924676168084';

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
  url.searchParams.set('scope', [...REQUIRED_PERMISSIONS, ...OPTIONAL_PERMISSIONS].join(','));
  return url.toString();
}

async function graphRequest(path, params, accessToken, method = 'GET') {
  const config = getMetaConfig();
  const url = `https://graph.facebook.com/${config.version}/${String(path).replace(/^\/+/, '')}`;
  const values = Object.fromEntries(Object.entries({ ...(params || {}), access_token: accessToken }).filter(([, value]) => value !== undefined && value !== null));
  try {
    const response = await axios({
      method,
      url,
      params: method === 'GET' || method === 'DELETE' ? values : undefined,
      data: method === 'POST' ? new URLSearchParams(
        Object.entries(values).map(([key, value]) => [key, String(value)])
      ).toString() : undefined,
      headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
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

async function getMetaUserIdentity(userToken) {
  const response = await graphRequest('me', { fields: 'id,name' }, userToken);
  if (!response?.id) throw new Error('Meta did not return the authorizing account ID.');
  return { id: String(response.id), name: String(response.name || '') };
}

function verifyMetaSignedRequest(signedRequest) {
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  if (!appSecret) {
    const error = new Error('Meta app secret is not configured.');
    error.code = 'META_CONFIGURATION_MISSING';
    throw error;
  }
  const parts = String(signedRequest || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    const error = new Error('Invalid Meta signed request.');
    error.code = 'META_SIGNED_REQUEST_INVALID';
    throw error;
  }
  const [encodedSignature, encodedPayload] = parts;
  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    const error = new Error('Meta signed request signature did not match.');
    error.code = 'META_SIGNED_REQUEST_INVALID';
    throw error;
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')); }
  catch {
    const error = new Error('Meta signed request payload is invalid.');
    error.code = 'META_SIGNED_REQUEST_INVALID';
    throw error;
  }
  if (payload.algorithm !== 'HMAC-SHA256' || !payload.user_id) {
    const error = new Error('Meta signed request payload is missing the required user identifier.');
    error.code = 'META_SIGNED_REQUEST_INVALID';
    throw error;
  }
  return payload;
}

async function getGrantedPermissions(userToken) {
  const response = await graphRequest('me/permissions', {}, userToken);
  return new Set((response?.data || []).filter((item) => item.status === 'granted').map((item) => item.permission));
}

async function getManagedPages(userToken) {
  // Keep core Facebook Page discovery independent from optional Instagram scopes.
  const response = await graphRequest('me/accounts', {
    fields: 'id,name,access_token,tasks',
    limit: 100,
  }, userToken);
  const pages = Array.isArray(response?.data) ? response.data : [];
  let target = pages.find((page) => String(page.id) === TARGET_PAGE_ID);

  if (!target) {
    // Some New Pages Experience accounts have full Page access but Meta returns
    // an empty /me/accounts collection. Resolve only Sylva's known official Page.
    const page = await graphRequest(TARGET_PAGE_ID, {
      fields: 'id,name,access_token',
    }, userToken);
    if (String(page?.id || '') === TARGET_PAGE_ID &&
        String(page?.name || '').trim().toLowerCase() === TARGET_PAGE_NAME.toLowerCase() &&
        page?.access_token) {
      const capability = await graphRequest(TARGET_PAGE_ID, { fields: 'can_post' }, page.access_token);
      target = { ...page, can_post: capability?.can_post === true };
      pages.push(target);
    }
  }

  if (target) {
    try {
      const instagram = await graphRequest(TARGET_PAGE_ID, {
        fields: 'instagram_business_account{id,username}',
      }, userToken);
      target.instagram_business_account = instagram?.instagram_business_account || null;
    } catch (error) {
      // An optional Instagram permission/account must never prevent Facebook Page connection.
      console.warn('Optional Instagram account discovery was unavailable:', error.code || error.metaCode || 'INSTAGRAM_DISCOVERY_UNAVAILABLE');
    }
  }
  return pages;
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
  if (!tasks.includes('CREATE_CONTENT') && !tasks.includes('MANAGE') && page.can_post !== true) {
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
  const asset = Array.isArray(campaign.assets) ? campaign.assets.find((item) => item.status === 'approved' && item.url) : null;
  const captionParts = [
    platformContent.caption || campaign.content?.body || campaign.content?.headline || campaign.name,
    ...(Array.isArray(platformContent.hashtags) ? platformContent.hashtags : []),
    platformContent.callToAction || '',
    (asset || campaign.product?.image) && campaign.product?.productUrl ? campaign.product.productUrl : (campaign.destination?.url || ''),
  ].filter(Boolean);
  const message = captionParts.join('\n\n').slice(0, 5000);
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
  } else if (campaign.product?.image) {
    // Catalogue product images are the default creative when no custom asset
    // has been uploaded. Publish through /photos so the Page post contains
    // the actual product photo rather than only a link preview.
    path = `${connection.pageId}/photos`;
    params.url = campaign.product.image;
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



async function publishInstagramMedia(connection, campaign) {
  const instagramId = String(connection.instagramBusinessAccountId || '').trim();
  if (!instagramId) {
    const error = new Error('No Instagram Professional account is linked to the Sylva Facebook Page. Connect the account and refresh permissions.');
    error.code = 'INSTAGRAM_ACCOUNT_NOT_LINKED';
    throw error;
  }
  const granted = new Set(Array.isArray(connection.grantedPermissions) ? connection.grantedPermissions : []);
  if (!granted.has('instagram_basic') || !granted.has('instagram_content_publish')) {
    const error = new Error('Meta has not granted the Instagram account and publishing permissions. Reconnect and approve instagram_basic and instagram_content_publish.');
    error.code = 'INSTAGRAM_PERMISSION_MISSING';
    throw error;
  }

  const asset = Array.isArray(campaign.assets)
    ? campaign.assets.find((item) => item.status === 'approved' && ['image', 'poster', 'video'].includes(item.kind) && item.url)
    : null;
  const mediaUrl = String(asset?.url || campaign.product?.image || '').trim();
  if (!mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
    const error = new Error('Instagram publishing requires an approved public HTTPS image or video. Upload and approve a campaign asset first.');
    error.code = 'INSTAGRAM_MEDIA_REQUIRED';
    throw error;
  }
  const isVideo = asset?.kind === 'video';
  const platformContent = campaign.content?.instagram || {};
  const caption = [
    platformContent.caption || campaign.content?.body || campaign.content?.headline || campaign.name,
    ...(Array.isArray(platformContent.hashtags) ? platformContent.hashtags : []),
    platformContent.callToAction || '',
    campaign.product?.productUrl || campaign.destination?.url || '',
  ].filter(Boolean).join('\n\n').slice(0, 2200);
  const token = decryptPageToken(connection);
  const containerParams = isVideo
    ? { media_type: 'REELS', video_url: mediaUrl, caption, share_to_feed: true }
    : { image_url: mediaUrl, caption };
  const container = await graphRequest(`${instagramId}/media`, containerParams, token, 'POST');
  if (!container?.id) {
    const error = new Error('Meta did not return an Instagram media container ID.');
    error.code = 'INSTAGRAM_CONTAINER_FAILED';
    throw error;
  }

  if (isVideo) {
    let ready = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const status = await graphRequest(String(container.id), { fields: 'status_code,status' }, token);
      const code = String(status?.status_code || '').toUpperCase();
      if (code === 'FINISHED') { ready = true; break; }
      if (code === 'ERROR' || code === 'EXPIRED') {
        const error = new Error('Instagram could not process the Reel video. Check the video format and try again.');
        error.code = 'INSTAGRAM_VIDEO_PROCESSING_FAILED';
        throw error;
      }
    }
    if (!ready) {
      const error = new Error('Instagram is still processing the Reel. Check the account before retrying to avoid duplicate posts.');
      error.code = 'INSTAGRAM_VIDEO_PROCESSING_PENDING';
      throw error;
    }
  }

  const published = await graphRequest(`${instagramId}/media_publish`, {
    creation_id: String(container.id),
  }, token, 'POST');
  if (!published?.id) {
    const error = new Error('Meta did not confirm the Instagram publication. Check Instagram before retrying.');
    error.code = 'INSTAGRAM_PUBLISH_UNCONFIRMED';
    throw error;
  }

  let permalink = '';
  try {
    const media = await graphRequest(String(published.id), { fields: 'id,permalink,media_type,timestamp' }, token);
    permalink = String(media?.permalink || '');
  } catch (error) {
    console.warn('Instagram permalink lookup failed after confirmed publish:', error.code || error.metaCode || 'INSTAGRAM_MEDIA_LOOKUP_FAILED');
  }
  return { externalId: String(published.id), externalUrl: permalink, mediaType: isVideo ? 'REELS' : 'IMAGE' };
}

async function getPagePostStatus(connection, postId) {
  const token = decryptPageToken(connection);
  return graphRequest(String(postId), { fields: 'id,is_published,permalink_url,scheduled_publish_time' }, token);
}

async function deleteScheduledPagePost(connection, postId) {
  const token = decryptPageToken(connection);
  return graphRequest(String(postId), {}, token, 'DELETE');
}

module.exports = {
  REQUIRED_PERMISSIONS,
  OPTIONAL_PERMISSIONS,
  TARGET_PAGE_NAME,
  getMetaConfig,
  createOAuthStateSecret,
  buildAuthorizationUrl,
  encryptPageToken,
  decryptPageToken,
  exchangeCodeForUserToken,
  getMetaUserIdentity,
  verifyMetaSignedRequest,
  getGrantedPermissions,
  getManagedPages,
  chooseSylvaPage,
  schedulePagePost,
  publishInstagramMedia,
  getPagePostStatus,
  deleteScheduledPagePost,
};
