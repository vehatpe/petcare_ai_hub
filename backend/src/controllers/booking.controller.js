'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ bookingService }) => ({
  list: wrap(async (req, res) => {
    const { items, meta } = await bookingService.list(req.user.id, req.query);
    return ok(res, { items }, 'Thành công.', 200, meta);
  }),
  create: wrap(async (req, res) => ok(res, await bookingService.create(req.user.id, req.body), 'Đã gửi yêu cầu đặt lịch. Cơ sở sẽ xác nhận sớm.', 201)),
  cancel: wrap(async (req, res) => ok(res, await bookingService.cancel(req.user, req.params.id, req.body), 'Đã hủy lịch hẹn.')),
  listForProvider: wrap(async (req, res) => {
    const { items, summary, meta } = await bookingService.listForProvider(req.user.providerId, req.query);
    return ok(res, { items, summary }, 'Thành công.', 200, meta);
  }),
  confirm: wrap(async (req, res) => ok(res, await bookingService.confirmByProvider(req.user.providerId, req.user.id, req.params.id), 'Đã xác nhận lịch hẹn.')),
  complete: wrap(async (req, res) => ok(res, await bookingService.completeByProvider(req.user.providerId, req.user.id, req.params.id), 'Đã hoàn tất lịch hẹn.')),
  noShow: wrap(async (req, res) => ok(res, await bookingService.noShowByProvider(req.user.providerId, req.user.id, req.params.id), 'Đã ghi nhận khách vắng mặt.')),
  assignVet: wrap(async (req, res) => ok(res, await bookingService.assignVet(req.user.providerId, req.user.id, req.params.id, req.body), 'Đã cập nhật bác sĩ phụ trách.'))
});
