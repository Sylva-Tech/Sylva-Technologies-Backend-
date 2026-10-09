const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userRoutes = require('./routes/userRoutes');
const contactRoutes = require('./routes/contactRoutes');
const advertisementRoutes = require('./routes/advertisementRoutes');
const flipAdvertisementRoutes = require('./routes/flipAdvertisementRoutes');
const adminRoutes = require('./routes/adminRoutes');
const walletRoutes = require('./routes/walletRoutes');
const sellerManagementRoutes = require('./routes/sellerManagementRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();

/*
|--------------------------------------------------------------------------
| ENVIRONMENT
|--------------------------------------------------------------------------
*/

const isProduction = process.env.NODE_ENV === 'production';

/*
|--------------------------------------------------------------------------
| TRUST PROXY
|--------------------------------------------------------------------------
|
| Required when running behind Render/Vercel/proxy infrastructure.
| This also allows express-rate-limit to correctly identify client IPs.
|
*/

app.set('trust proxy', 1);

/*
|--------------------------------------------------------------------------
| EXPRESS SECURITY
|--------------------------------------------------------------------------
|
| Do not reveal that the server is running Express.
|
*/

app.disable('x-powered-by');

/*
|--------------------------------------------------------------------------
| MONGOOSE SECURITY SETTINGS
|--------------------------------------------------------------------------
|
| Mongoose should reject unexpected query fields instead of allowing
| potentially dangerous query structures to pass through unchecked.
|
*/

mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

/*
|--------------------------------------------------------------------------
| CORS CONFIGURATION
|--------------------------------------------------------------------------
*/

const configuredOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowedOrigins = [
  ...configuredOrigins,

  // Production frontend
  'https://sylvatechnologies.co.ke',
  'https://www.sylvatechnologies.co.ke',
  'https://sylvatechnologies.vercel.app',
  'https://sylva-technologies-frontend.vercel.app',
  'https://sylva-technologies-frontend-jucbjftlx.vercel.app',

  // Local development
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:4173',

  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'http://127.0.0.1:4173',
];

const localOriginRegex =
  /^https?:\/\/(localhost|127\.0\.0\.1):(3000|4173|5173|5174|5175)$/;

const corsOptions = {
  origin: (origin, callback) => {
    /*
     * Requests such as server-to-server requests, health checks,
     * curl and some tools may not send an Origin header.
     */
    if (!origin) {
      return callback(null, true);
    }

    const cleanOrigin = origin.replace(/\/$/, '');

    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    if (localOriginRegex.test(cleanOrigin)) {
      return callback(null, true);
    }

    console.warn(`CORS blocked origin: ${origin}`);

    return callback(new Error('Not allowed by CORS'));
  },

  credentials: true,

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
  ],

  optionsSuccessStatus: 204,
};

/*
|--------------------------------------------------------------------------
| SECURITY HEADERS
|--------------------------------------------------------------------------
*/

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

app.use(cors(corsOptions));

/*
|--------------------------------------------------------------------------
| BODY PARSING
|--------------------------------------------------------------------------
|
| Keep these limits because the application currently supports
| seller verification and other data that may require larger payloads.
|
| File uploads handled through Multer remain controlled by their
| individual Multer configuration.
|
*/

app.use(
  express.json({
    limit: '10mb',
    strict: true,
    verify: (req, res, buffer) => {
      // Paystack signs the exact request bytes, so preserve them before JSON parsing.
      if (req.originalUrl.split('?')[0] === '/api/orders/paystack/webhook') {
        req.rawBody = Buffer.from(buffer);
      }
    },
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: '10mb',
    parameterLimit: 100,
  })
);

/*
|--------------------------------------------------------------------------
| GLOBAL API RATE LIMITER
|--------------------------------------------------------------------------
|
| This protects the API against excessive automated requests while
| still allowing normal browsing and shopping activity.
|
*/

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 200,

  standardHeaders: 'draft-8',
  legacyHeaders: false,

  skip: (req) => {
    /*
     * Health checks should remain available to Render/monitoring.
     */
    return req.path === '/health';
  },

  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

/*
|--------------------------------------------------------------------------
| AUTHENTICATION RATE LIMITER
|--------------------------------------------------------------------------
|
| Authentication endpoints receive stricter protection because they
| are common targets for credential stuffing and brute-force attempts.
|
*/

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 40,

  standardHeaders: 'draft-8',
  legacyHeaders: false,

  message: {
    success: false,
    message:
      'Too many authentication attempts. Please slow down and try again later.',
  },
});

/*
|--------------------------------------------------------------------------
| SENSITIVE ACTION RATE LIMITER
|--------------------------------------------------------------------------
|
| Used for operations such as seller applications, password-related
| actions, verification requests and similar sensitive endpoints when
| attached at route level.
|
*/

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 30,

  standardHeaders: 'draft-8',
  legacyHeaders: false,

  message: {
    success: false,
    message:
      'Too many requests for this operation. Please try again later.',
  },
});

/*
|--------------------------------------------------------------------------
| API RATE LIMITERS
|--------------------------------------------------------------------------
*/

app.use('/api', apiLimiter);

app.use('/api/auth', authLimiter);

/*
|--------------------------------------------------------------------------
| REQUEST METADATA
|--------------------------------------------------------------------------
|
| Useful for controlled server-side logging without exposing secrets.
|
*/

app.use((req, res, next) => {
  req.requestStartedAt = Date.now();
  next();
});

/*
|--------------------------------------------------------------------------
| ROOT ROUTE
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Sylva Technologies API is running',
  });
});

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Sylva Technologies API is running',

    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',

    environment: process.env.NODE_ENV || 'development',

    timestamp: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| API ROUTES
|--------------------------------------------------------------------------
*/

app.use('/api/auth', authRoutes);

app.use('/api/products', productRoutes);

app.use('/api/categories', categoryRoutes);

app.use('/api/orders', orderRoutes);

app.use('/api/users', userRoutes);

app.use('/api/contact', contactRoutes);

app.use('/api/advertisements', advertisementRoutes);

app.use('/api/flip-advertisements', flipAdvertisementRoutes);

app.use('/api/admin', adminRoutes);

app.use('/api/wallet', walletRoutes);

app.use(
  '/api/seller-management',
  sellerManagementRoutes
);
app.use(
  '/api/notifications',
  notificationRoutes
);

/*
|--------------------------------------------------------------------------
| 404 HANDLER
|--------------------------------------------------------------------------
|
| Do not echo the complete requested URL back to an attacker.
|
*/

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'The requested endpoint was not found.',
  });
});

/*
|--------------------------------------------------------------------------
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  /*
   * Log the complete error server-side.
   *
   * Do not send stack traces, database errors, JWT details,
   * filesystem paths or internal implementation details to users.
   */
  console.error('Unhandled API error:', {
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status || error.statusCode || 500,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  /*
   * CORS error
   */
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Access denied by CORS policy.',
    });
  }

  /*
   * Invalid JSON
   */
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON data received.',
    });
  }

  /*
   * Payload too large
   */
  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      message: 'The submitted data is too large.',
    });
  }

  /*
   * Unsupported content type
   */
  if (error.type === 'charset.unsupported') {
    return res.status(415).json({
      success: false,
      message: 'Unsupported request encoding.',
    });
  }

  /*
   * Malformed request
   */
  if (error.type === 'request.aborted') {
    return res.status(400).json({
      success: false,
      message: 'The request was interrupted.',
    });
  }

  /*
   * Mongoose validation error
   */
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'The submitted data is invalid.',
    });
  }

  /*
   * Invalid MongoDB ObjectId
   */
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid resource identifier.',
    });
  }

  /*
   * Duplicate MongoDB key
   */
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'A record with the submitted information already exists.',
    });
  }

  /*
   * Rate limit error
   */
  if (error.status === 429 || error.statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
    });
  }

  const status = error.status || error.statusCode || 500;

  /*
   * Never expose internal errors in production.
   */
  if (isProduction || status >= 500) {
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      message:
        status >= 500
          ? 'Something went wrong. Please try again later.'
          : 'The request could not be completed.',
    });
  }

  /*
   * Development response.
   *
   * Still avoid returning stack traces.
   */
  return res.status(status).json({
    success: false,
    message: error.message || 'Please check the information you sent.',
  });
});

/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

module.exports = app;
