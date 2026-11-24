'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ providerService }) => ({
  getProfile: wrap(async (req, res) => {
    const data = await providerService.getProfile(req.user);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, data);
  }),

  updateProfile: wrap(async (req, res) => {
    const data = await providerService.updateProfile(req.user, req.body);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, data, 'Cập nhật hồ sơ cơ sở thành công.');
  }),

  createVet: wrap(async (req, res) => {
    const data = await providerService.createVet(req.user, req.body);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, data, 'Tạo tài khoản bác sĩ thành công.', 201);
  }),

  listVets: wrap(async (req, res) => {
    const data = await providerService.listVets(req.user, req.query);
    ok(res, data);
  }),

  disableVet: wrap(async (req, res) => {
    const data = await providerService.disableVet(req.user, req.params.id);
    ok(res, data, 'Khóa tài khoản bác sĩ thành công.');
  }),

  enableVet: wrap(async (req, res) => {
    const data = await providerService.enableVet(req.user, req.params.id);
    ok(res, data, 'Mở khóa tài khoản bác sĩ thành công.');
  }),

  listServices: wrap(async (req, res) => {
    const data = await providerService.listServices(req.user, req.query);
    ok(res, data);
  }),

  createService: wrap(async (req, res) => {
    const data = await providerService.createService(req.user, req.body);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, data, 'Tạo dịch vụ thành công.', 201);
  }),

  updateService: wrap(async (req, res) => {
    const data = await providerService.updateService(req.user, req.params.id, req.body);
    res.setHeader('Cache-Control', 'no-store');
    ok(res, data, 'Cập nhật dịch vụ thành công.');
  }),

  disableService: wrap(async (req, res) => {
    const data = await providerService.disableService(req.user, req.params.id);
    ok(res, data, 'Ngừng cung cấp dịch vụ thành công.');
  }),

  enableService: wrap(async (req, res) => {
    const data = await providerService.enableService(req.user, req.params.id);
    ok(res, data, 'Kích hoạt lại dịch vụ thành công.');
  })
});
