'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AppError, DuplicateError, validation, conflict } = require('../utils/errors');
const { validateRegister, normalizePhone } = require('../utils/validators');

const DUP_MSG = {
  email: ['Email này đã được đăng ký.', 'Email này đã có tài khoản. Hãy đăng nhập hoặc dùng email khác.'],
  phone: ['Số điện thoại này đã được đăng ký.', 'Số điện thoại này đã có tài khoản. Hãy đăng nhập hoặc dùng số khác.']
};

function toPublicUser(u) {
  const out = { id: u.id, role: u.role, status: u.status, fullName: u.fullName, email: u.email, phone: u.phone };
  if (u.orgName) out.orgName = u.orgName;
  if (u.orgType) out.orgType = u.orgType;
  out.createdAt = u.createdAt;
  return out;
}

function createAuthService({ models, config, clock = () => new Date() }) {
  // Used to keep timing similar when the account does not exist.
  const dummyHash = bcrypt.hashSync('not-a-real-password-1', config.bcryptCost);

  const sign = (user, remember) =>
    jwt.sign({ role: user.role }, config.jwtSecret, { algorithm: 'HS256', subject: user.id, expiresIn: remember ? '30d' : '1d' });

  const dupError = (field) => conflict(DUP_MSG[field][0], { [field]: DUP_MSG[field][1] }, 'duplicate');

  return {
    toPublicUser,

    async register(input) {
      const { errors, value } = validateRegister(input || {});
      if (Object.keys(errors).length) throw validation('Vui lòng kiểm tra lại các trường được đánh dấu.', errors);
      if (await models.users.findByEmail(value.email)) throw dupError('email');
      if (await models.users.findByPhone(value.phone)) throw dupError('phone');

      const user = {
        id: crypto.randomUUID(),
        role: value.role,
        status: value.role === 'customer' ? 'active' : 'pending',
        fullName: value.fullName,
        email: value.email,
        phone: value.phone,
        passwordHash: await bcrypt.hash(value.password, config.bcryptCost),
        orgName: value.role === 'provider' ? value.orgName : null,
        orgType: value.role === 'provider' ? value.orgType : null,
        createdAt: clock().toISOString()
      };
      try {
        await models.users.create(user);
      } catch (e) {
        if (e instanceof DuplicateError) throw dupError(e.field);
        throw e;
      }
      return { user: toPublicUser(user), token: user.status === 'active' ? sign(user, input.remember !== false) : null };
    },

    async login(input) {
      const identifier = String((input && input.identifier) || '').trim();
      const password = String((input && input.password) || '');
      const errors = {};
      if (!identifier) errors.identifier = 'Vui lòng nhập email hoặc số điện thoại.';
      if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
      if (Object.keys(errors).length) throw validation('Vui lòng nhập đủ thông tin đăng nhập.', errors);

      const phone = normalizePhone(identifier);
      let user = await models.users.findByEmail(identifier.toLowerCase());
      if (!user && phone) user = await models.users.findByPhone(phone);
      const generic = new AppError(401, 'credentials', 'Email/số điện thoại hoặc mật khẩu chưa đúng. Vui lòng thử lại.');
      if (!user) { await bcrypt.compare(password, dummyHash); throw generic; }
      if (!(await bcrypt.compare(password, user.passwordHash))) throw generic;
      if (user.status === 'pending') {
        throw new AppError(403, 'pending', 'Tài khoản đối tác của bạn đang chờ quản trị viên phê duyệt. Chúng tôi sẽ liên hệ qua email hoặc số điện thoại đã đăng ký.');
      }
      if (user.status !== 'active') {
        throw new AppError(403, 'disabled', 'Tài khoản này hiện không thể đăng nhập. Vui lòng liên hệ hotline để được hỗ trợ.');
      }
      return { user: toPublicUser(user), token: sign(user, Boolean(input.remember)) };
    }
  };
}

module.exports = { createAuthService, toPublicUser };
