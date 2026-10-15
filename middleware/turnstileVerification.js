const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const allowedHostnames = new Set([
  'sylvatechnologies.co.ke',
  'www.sylvatechnologies.co.ke',
  'localhost',
  '127.0.0.1',
]);

async function verifyTurnstile(req, res, next) {
  try {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    const token = req.body?.turnstileToken;

    if (!secret) {
      console.error('TURNSTILE_SECRET_KEY is not configured.');
      return res.status(503).json({
        success: false,
        message: 'Human verification is temporarily unavailable. Please try again later.',
      });
    }

    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please complete the human verification check and try again.',
      });
    }

    const body = new URLSearchParams({
      secret,
      response: token.trim(),
    });

    if (req.ip) body.set('remoteip', req.ip);

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Turnstile Siteverify returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (
      !result.success ||
      !allowedHostnames.has(String(result.hostname || '').toLowerCase())
    ) {
      return res.status(403).json({
        success: false,
        message: 'Human verification failed or expired. Please try again.',
      });
    }

    return next();
  } catch (error) {
    console.error('Turnstile verification unavailable:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Human verification could not be checked right now. Please try again.',
    });
  }
}

module.exports = verifyTurnstile;
