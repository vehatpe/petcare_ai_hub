'use strict';
const crypto = require('node:crypto');

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
  return {
    nodeEnv,
    port: int(env.PORT, 3000),
    timezone: env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh',
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
      aiMax: int(env.AI_RATE_LIMIT_MAX, 20)
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
