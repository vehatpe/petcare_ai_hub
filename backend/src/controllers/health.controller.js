'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ healthService }) => ({
  aggregate: wrap(async (req, res) => ok(res, await healthService.aggregate(req.user.id, req.query.petId))),
  listMedicalRecords: wrap(async (req, res) => {
    const { items, meta } = await healthService.listMedicalRecords(req.user.id, req.params.id, req.query);
    return ok(res, { items }, 'Thành công.', 200, meta);
  }),
  addWeight: wrap(async (req, res) => ok(res, await healthService.addWeight(req.user.id, req.params.id, req.body), 'Đã lưu cân nặng.', 201)),
  deleteWeight: wrap(async (req, res) => ok(res, await healthService.deleteWeight(req.user.id, req.params.id, req.params.metricId), 'Đã xóa số đo.')),
  addVaccination: wrap(async (req, res) => ok(res, await healthService.addVaccination(req.user.id, req.params.id, req.body), 'Đã lưu mũi tiêm.', 201)),
  deleteVaccination: wrap(async (req, res) => ok(res, await healthService.deleteVaccination(req.user.id, req.params.id, req.params.vaccinationId), 'Đã xóa bản ghi tiêm chủng.')),
  listVetBookings: wrap(async (req, res) => {
    const { items, meta } = await healthService.listVetBookings(req.user, req.query);
    return ok(res, { items }, 'Thành công.', 200, meta);
  }),
  getVetBookingDetail: wrap(async (req, res) => ok(res, await healthService.getVetBookingDetail(req.user, req.params.id))),
  addMedicalRecordForBooking: wrap(async (req, res) => ok(res, await healthService.addMedicalRecordForBooking(req.user, req.params.id, req.body), 'Đã lưu bệnh án.', 201)),
  addVaccinationForBooking: wrap(async (req, res) => ok(res, await healthService.addVaccinationForBooking(req.user, req.params.id, req.body), 'Đã lưu mũi tiêm.', 201))
});
