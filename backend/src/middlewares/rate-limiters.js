'use strict';
const rateLimit = require('express-rate-limit');

function createRateLimiters(config) {
  const handler = (req, res) => res.status(429).json({
    success: false,
    data: null,
    code: 'rate_limited',
    message: 'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.'
  });

  // 1. Auth limiter (register & login): keyed by IP + normalized identifier
  const authLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const id = String(req.body?.identifier || req.body?.email || req.body?.phone || '').trim().toLowerCase();
      return `${req.ip}_${id}`;
    },
    handler
  });

  // 2. Me limiter (/auth/me): much broader limit
  const meLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.meMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    handler
  });

  // 3. AI limiter (/ai/chat): keyed by authenticated user ID (placed after authenticate)
  const aiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.aiMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    handler
  });

  // 4. Password change limiter (/auth/change-password): keyed by user ID (or IP) to prevent password brute force
  const changePasswordLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    handler
  });

  // 5. Upload limiter: keyed by authenticated user ID (placed after authenticate)
  const uploadLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.uploadMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    handler
  });

  return { authLimiter, meLimiter, aiLimiter, changePasswordLimiter, uploadLimiter };
}

module.exports = { createRateLimiters };
