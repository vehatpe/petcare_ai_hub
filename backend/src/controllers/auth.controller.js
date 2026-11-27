'use strict';
const { wrap, ok } = require('../utils/http');
const { toPublicUser } = require('../services/auth.service');

module.exports = ({ authService }) => ({
  register: wrap(async (req, res) => {
    const data = await authService.register(req.body);
    ok(res, data, data.token ? 'Đăng ký thành công.' : 'Đăng ký thành công. Tài khoản đối tác đang chờ quản trị viên phê duyệt.', 201);
  }),
  login: wrap(async (req, res) => ok(res, await authService.login(req.body), 'Đăng nhập thành công.')),
  me: wrap(async (req, res) => ok(res, { user: toPublicUser(req.user) })),
  changePassword: wrap(async (req, res) => {
    const data = await authService.changePassword(req.user.id, req.body);
    ok(res, data, 'Đổi mật khẩu thành công.');
  }),
  setAvatar: wrap(async (req, res) => ok(res, await authService.setAvatar(req.user.id, req.file.buffer), 'Đã cập nhật ảnh đại diện.')),
  clearAvatar: wrap(async (req, res) => ok(res, await authService.clearAvatar(req.user.id), 'Đã xóa ảnh đại diện.'))
});
