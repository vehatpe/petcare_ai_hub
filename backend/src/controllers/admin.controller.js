'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ adminService }) => ({
  listUsers: wrap(async (req, res) => {
    const { users, meta } = await adminService.listUsers(req.query);
    ok(res, { users }, 'Lấy danh sách người dùng thành công.', 200, meta);
  }),

  approve: wrap(async (req, res) => {
    const data = await adminService.approve(req.user.id, req.params.id, req.body || {});
    ok(res, data, 'Phê duyệt đối tác thành công.');
  }),

  reject: wrap(async (req, res) => {
    const data = await adminService.reject(req.user.id, req.params.id, req.body || {});
    ok(res, data, 'Từ chối đối tác thành công.');
  }),

  disable: wrap(async (req, res) => {
    const data = await adminService.disable(req.user.id, req.params.id);
    ok(res, data, 'Khóa tài khoản thành công.');
  }),

  enable: wrap(async (req, res) => {
    const data = await adminService.enable(req.user.id, req.params.id);
    ok(res, data, 'Mở khóa tài khoản thành công.');
  })
});
