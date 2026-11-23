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
      if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
        throw new AppError(401, 'token_revoked', 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.');
      }
      if (user.mustChangePassword) {
        // Cổng must_change_password: chỉ cho phép GET /auth/me và POST /auth/change-password
        const path = req.path || req.originalUrl || '';
        const isAllowed = (req.method === 'GET' && path.endsWith('/auth/me')) ||
                          (req.method === 'POST' && path.endsWith('/auth/change-password'));
        if (!isAllowed) {
          throw new AppError(403, 'must_change_password', 'Bạn phải đổi mật khẩu lần đầu trước khi tiếp tục sử dụng hệ thống.');
        }
      }
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
