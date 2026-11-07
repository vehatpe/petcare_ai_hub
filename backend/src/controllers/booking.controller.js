'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ bookingService }) => ({
  list: wrap(async (req, res) => ok(res, await bookingService.list(req.user.id))),
  create: wrap(async (req, res) => ok(res, await bookingService.create(req.user.id, req.body), 'Đã gửi yêu cầu đặt lịch. Cơ sở sẽ xác nhận sớm.', 201)),
  cancel: wrap(async (req, res) => ok(res, await bookingService.cancel(req.user.id, req.params.id), 'Đã hủy lịch hẹn.'))
});
