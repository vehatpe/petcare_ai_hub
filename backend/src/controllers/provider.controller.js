'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ providerService }) => ({
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
  })
});
