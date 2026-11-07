'use strict';
const jwt = require('jsonwebtoken');
const { unauthenticated, forbidden, AppError } = require('../utils/errors');

function createAuth({ models, config }) {
  async function authenticate(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const m = /^Bearer (.+)$/.exec(header);
      if (!m) throw unauthenticated();
      let payload;
      try {
        payload = jwt.verify(m[1], config.jwtSecret, { algorithms: ['HS256'] });
      } catch (_) {
        throw unauthenticated('Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.');
      }
      const user = await models.users.findById(payload.sub);
      if (!user) throw unauthenticated('Tài khoản không còn tồn tại. Vui lòng đăng nhập lại.');
      if (user.status !== 'active') throw new AppError(403, 'disabled', 'Tài khoản này hiện không thể sử dụng. Vui lòng liên hệ hotline để được hỗ trợ.');
      req.user = user;
      next();
    } catch (e) { next(e); }
  }

  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
    next();
  };

  return { authenticate, requireRole };
}

module.exports = { createAuth };
