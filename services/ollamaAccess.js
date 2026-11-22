const getOllamaRequestHeaders = () => {
  const clientId = String(process.env.OLLAMA_ACCESS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.OLLAMA_ACCESS_CLIENT_SECRET || '').trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw Object.assign(
      new Error('Sylva AI Cloudflare Access credentials are incomplete.'),
      { code: 'AI_CONTENT_NOT_CONFIGURED', status: 503 }
    );
  }
  const headers = { 'Content-Type': 'application/json' };
  if (clientId && clientSecret) {
    headers['CF-Access-Client-Id'] = clientId;
    headers['CF-Access-Client-Secret'] = clientSecret;
  }
  return headers;
};

module.exports = { getOllamaRequestHeaders };
