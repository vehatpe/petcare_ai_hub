'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ petService }) => ({
  list: wrap(async (req, res) => ok(res, await petService.list(req.user.id))),
  get: wrap(async (req, res) => ok(res, await petService.get(req.user.id, req.params.id))),
  create: wrap(async (req, res) => ok(res, await petService.create(req.user.id, req.body), 'Đã tạo hồ sơ thú cưng.', 201)),
  update: wrap(async (req, res) => ok(res, await petService.update(req.user.id, req.params.id, req.body), 'Đã cập nhật hồ sơ.')),
  remove: wrap(async (req, res) => ok(res, await petService.remove(req.user.id, req.params.id), 'Đã xóa hồ sơ thú cưng.')),
  setPhoto: wrap(async (req, res) => ok(res, await petService.setPhoto(req.user.id, req.params.id, req.file.buffer), 'Đã cập nhật ảnh thú cưng.')),
  clearPhoto: wrap(async (req, res) => ok(res, await petService.clearPhoto(req.user.id, req.params.id), 'Đã xóa ảnh thú cưng.'))
});
