'use strict';
const crypto = require('node:crypto');
const path = require('node:path');

const WEAK = /change[-_ ]?me|secret|example|password|default/i;

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes)$/i.test(String(v));
}
const int = (v, def) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? def : Number(v));

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  let jwtSecret = env.JWT_SECRET || '';
  let jwtSecretEphemeral = false;
  if (nodeEnv === 'production') {
    if (jwtSecret.length < 32 || WEAK.test(jwtSecret)) {
      throw new Error('JWT_SECRET phải là chuỗi ngẫu nhiên dài tối thiểu 32 ký tự khi chạy production.');
    }
  } else if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(32).toString('hex');
    jwtSecretEphemeral = true;
  }

  const cancelWindowRaw = env.BOOKING_CANCEL_WINDOW_HOURS;
  const bookingCancelWindowHours = int(cancelWindowRaw, 2);
  if (
    !Number.isInteger(bookingCancelWindowHours) ||
    bookingCancelWindowHours < 0 ||
    bookingCancelWindowHours > 72 ||
    (cancelWindowRaw !== undefined && cancelWindowRaw !== '' && String(bookingCancelWindowHours) !== String(cancelWindowRaw).trim())
  ) {
    throw new Error('BOOKING_CANCEL_WINDOW_HOURS phải là số nguyên từ 0 đến 72.');
  }

  const storageDriver = String(env.STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (storageDriver !== 'local' && storageDriver !== 'cloudinary') {
    throw new Error('STORAGE_DRIVER chỉ nhận giá trị "local" hoặc "cloudinary".');
  }

  const uploadMaxRaw = env.UPLOAD_MAX_BYTES;
  const uploadMaxBytes = int(uploadMaxRaw, 5242880);
  if (
    !Number.isInteger(uploadMaxBytes) ||
    uploadMaxBytes < 1024 ||
    uploadMaxBytes > 20971520 ||
    (uploadMaxRaw !== undefined && uploadMaxRaw !== '' && String(uploadMaxBytes) !== String(uploadMaxRaw).trim())
  ) {
    throw new Error('UPLOAD_MAX_BYTES phải là số nguyên từ 1024 đến 20971520.');
  }

  const cloudinaryCloudName = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
  const cloudinaryApiKey = String(env.CLOUDINARY_API_KEY || '').trim();
  const cloudinaryApiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
  if (storageDriver === 'cloudinary') {
    const missing = [];
    if (!cloudinaryCloudName) missing.push('CLOUDINARY_CLOUD_NAME');
    if (!cloudinaryApiKey) missing.push('CLOUDINARY_API_KEY');
    if (!cloudinaryApiSecret) missing.push('CLOUDINARY_API_SECRET');
    if (missing.length > 0) {
      throw new Error(`Thiếu cấu hình Cloudinary bắt buộc: ${missing.join(', ')}.`);
    }
  }

  const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(__dirname, '../../uploads');
  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');

  return {
    nodeEnv,
    port: int(env.PORT, 3000),
    timezone: env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh',
    bookingCancelWindowHours,
    // Dev convenience: allow VS Code Live Server (5500/5501) when CORS_ORIGIN is not set. Never in production.
    corsOrigin: env.CORS_ORIGIN || (nodeEnv === 'production' ? '' : 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501'),
    serveFrontend: bool(env.SERVE_FRONTEND, true),
    trustProxy: env.TRUST_PROXY || '',
    jwtSecret,
    jwtSecretEphemeral,
    bcryptCost: int(env.BCRYPT_COST, 10),
    rateLimit: {
      windowMs: int(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      authMax: int(env.AUTH_RATE_LIMIT_MAX, 15),
      meMax: int(env.ME_RATE_LIMIT_MAX, 300),
      aiMax: int(env.AI_RATE_LIMIT_MAX, 20),
      uploadMax: int(env.UPLOAD_RATE_LIMIT_MAX, 30)
    },
    storage: {
      driver: storageDriver,
      uploadDir,
      uploadMaxBytes,
      publicBaseUrl,
      cloudinary: {
        cloudName: cloudinaryCloudName,
        apiKey: cloudinaryApiKey,
        apiSecret: cloudinaryApiSecret
      }
    },
    db: {
      server: env.DB_SERVER || 'localhost',
      database: env.DB_NAME || 'PetCareAIHub',
      user: env.DB_USER || '',
      password: env.DB_PASSWORD || '',
      port: int(env.DB_PORT, 1433),
      encrypt: bool(env.DB_ENCRYPT, true),
      trustServerCertificate: bool(env.DB_TRUST_SERVER_CERT, false)
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || 'gemini-2.5-flash',
      embedModel: env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
      embedDim: int(env.GEMINI_EMBED_DIM, 768),
      timeoutMs: int(env.GEMINI_TIMEOUT_MS, 25000)
    },
    rag: {
      topK: int(env.RAG_TOP_K, 4),
      minScore: Number(env.RAG_MIN_SCORE || 0.6),
      cacheTtlMs: int(env.RAG_CACHE_TTL_MS, 60000),
      requireApproved: bool(env.RAG_REQUIRE_APPROVED, false)
    }
  };
}

module.exports = { loadConfig };
