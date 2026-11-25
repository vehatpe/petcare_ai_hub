'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict } = require('../utils/errors');
const { validateWeight, validateVaccination, validateMedicalRecord, isUuid, isValidYmd } = require('../utils/validators');
const { todayInTz } = require('../utils/time');
const { evaluateVaccinations } = require('../utils/health');
const { VALID_BOOKING_STATUSES } = require('../utils/booking-state');

function createHealthService({ models, config, clock = () => new Date() }) {
  const today = () => todayInTz(clock(), config.timezone);
  const fail = (errors) => { throw validation('Vui lòng kiểm tra lại các trường được đánh dấu.', errors); };
  const ownedPet = async (ownerId, petId) => {
    const pet = await models.pets.getByOwner(petId, ownerId);
    if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
    return pet;
  };

  return {
    async aggregate(ownerId, petId) {
      if (!isUuid(petId)) fail({ petId: 'Vui lòng chọn thú cưng.' });
      const pet = await ownedPet(ownerId, petId.toLowerCase());
      const [weights, vacc, records] = await Promise.all([
        models.health.listWeights(pet.id),
        models.health.listVaccinations(pet.id),
        models.health.listMedicalRecords(pet.id)
      ]);
      const ev = evaluateVaccinations(vacc, today());
      return {
        pet: { id: pet.id, name: pet.name },
        weights,
        weightChart: { count: weights.length, canRender: weights.length >= 2 },
        vaccinations: ev.list,
        vaccineSummary: ev.summary,
        medicalRecords: records
      };
    },

    async addWeight(ownerId, petId, input) {
      const pet = await ownedPet(ownerId, petId);
      const { errors, value } = validateWeight(input || {}, today());
      if (Object.keys(errors).length) fail(errors);
      return models.health.addWeight({ id: crypto.randomUUID(), petId: pet.id, ...value });
    },

    async deleteWeight(ownerId, petId, metricId) {
      const pet = await ownedPet(ownerId, petId);
      if (!(await models.health.deleteWeight(pet.id, metricId))) throw notFound('Không tìm thấy số đo này.');
      return { deleted: true };
    },

    async addVaccination(ownerId, petId, input) {
      const pet = await ownedPet(ownerId, petId);
      const { errors, value } = validateVaccination(input || {}, today());
      if (Object.keys(errors).length) fail(errors);
      const row = await models.health.addVaccination({
        id: crypto.randomUUID(), petId: pet.id, ...value, source: 'owner', createdAt: clock().toISOString()
      });
      // status is evaluated against the pet's other doses of the same vaccine
      const all = evaluateVaccinations(await models.health.listVaccinations(pet.id), today());
      return all.list.find((v) => v.id === row.id);
    },

    async deleteVaccination(ownerId, petId, vaccinationId) {
      const pet = await ownedPet(ownerId, petId);
      const v = await models.health.getVaccination(pet.id, vaccinationId);
      if (!v) throw notFound('Không tìm thấy bản ghi tiêm chủng này.');
      if (v.source !== 'owner') throw conflict('Bản ghi do cơ sở y tế xác nhận không thể xóa tại đây. Vui lòng liên hệ cơ sở đó.');
      await models.health.deleteVaccination(pet.id, vaccinationId);
      return { deleted: true };
    },

    async listVetBookings(vet, query = {}) {
      const filters = {};
      const errors = {};
      if (query.status !== undefined && query.status !== '') {
        if (!VALID_BOOKING_STATUSES.has(query.status)) errors.status = 'Trạng thái không hợp lệ.';
        else filters.status = query.status;
      }
      if (query.date !== undefined && query.date !== '') {
        if (!isValidYmd(query.date)) errors.date = 'Ngày không hợp lệ (YYYY-MM-DD).';
        else filters.date = query.date;
      }
      if (query.from !== undefined && query.from !== '') {
        if (!isValidYmd(query.from)) errors.from = 'Từ ngày không hợp lệ (YYYY-MM-DD).';
        else filters.from = query.from;
      }
      if (query.to !== undefined && query.to !== '') {
        if (!isValidYmd(query.to)) errors.to = 'Đến ngày không hợp lệ (YYYY-MM-DD).';
        else filters.to = query.to;
      }
      if (filters.from && filters.to) {
        const diffDays = Math.round((new Date(filters.to) - new Date(filters.from)) / 86400000);
        if (diffDays < 0) errors.from = 'Khoảng ngày không hợp lệ.';
        else if (diffDays > 92) errors.to = 'Khoảng ngày tối đa 92 ngày.';
      }
      if (query.q !== undefined && query.q !== '') {
        const q = String(query.q).trim();
        if (q.length > 60) errors.q = 'Từ khóa tìm kiếm tối đa 60 ký tự.';
        else if (q.length > 0) filters.q = q;
      }
      if (Object.keys(errors).length) fail(errors);
      return models.bookings.listForVet(vet.id, filters);
    },

    async getVetBookingDetail(vet, bookingId) {
      const b = await models.bookings.getForVet(bookingId, vet.id);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');
      const pet = b.petId ? await models.pets.getById(b.petId) : null;
      await models.audit.log({
        actorUserId: vet.id,
        action: 'health_record_viewed',
        targetType: 'pet',
        targetId: b.petId || null,
        details: null
      });
      if (!pet) {
        return {
          booking: b,
          pet: null,
          petDeleted: true,
          weights: [],
          vaccinations: [],
          medicalRecords: [],
          bookingMedicalRecord: null
        };
      }
      const [weights, vacc, records, bookingMedicalRecord] = await Promise.all([
        models.health.listWeights(pet.id),
        models.health.listVaccinations(pet.id),
        models.health.listMedicalRecords(pet.id),
        models.health.getMedicalRecordByBooking(b.id)
      ]);
      const ev = evaluateVaccinations(vacc, today());
      const { photo: _omitPhoto, ...petBasic } = pet;
      return {
        booking: b,
        pet: petBasic,
        petDeleted: false,
        weights,
        vaccinations: ev.list,
        medicalRecords: records,
        bookingMedicalRecord
      };
    },

    async addMedicalRecordForBooking(vet, bookingId, input) {
      const cleanInput = { ...(input || {}), visitDate: today() };
      delete cleanInput.bookingId;
      const { errors, value } = validateMedicalRecord(cleanInput, today());
      if (Object.keys(errors).length) fail(errors);

      return models.admin.transaction(async (tx) => {
        const b = await models.bookings.getForVet(bookingId, vet.id, tx);
        if (!b) throw notFound('Không tìm thấy lịch hẹn này.');
        if (b.status !== 'confirmed' && b.status !== 'completed') {
          throw conflict('Chỉ ghi bệnh án khi lịch đã xác nhận hoặc hoàn tất.', {}, 'invalid_transition');
        }
        const pet = b.petId ? await models.pets.getById(b.petId) : null;
        if (!pet) {
          throw conflict('Hồ sơ thú cưng đã bị xóa, không thể ghi bệnh án.', {}, 'pet_deleted');
        }
        const existing = await models.health.getMedicalRecordByBooking(b.id, tx);
        if (existing) {
          throw conflict('Lịch hẹn này đã có bệnh án.', {}, 'already_recorded');
        }
        const created = await models.health.addMedicalRecord({
          id: crypto.randomUUID(),
          petId: b.petId,
          vetId: vet.id,
          bookingId: b.id,
          visitDate: b.date,
          subjective: value.subjective,
          objective: value.objective,
          assessment: value.assessment,
          plan: value.plan
        }, tx);
        await models.audit.log({
          actorUserId: vet.id,
          action: 'medical_record_created',
          targetType: 'booking',
          targetId: b.id,
          details: null
        }, tx);
        return created;
      });
    },

    async addVaccinationForBooking(vet, bookingId, input) {
      const { errors, value } = validateVaccination(input || {}, today());
      if (Object.keys(errors).length) fail(errors);

      const b = await models.bookings.getForVet(bookingId, vet.id);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');
      if (b.status !== 'confirmed' && b.status !== 'completed') {
        throw conflict('Chỉ ghi tiêm chủng khi lịch đã xác nhận hoặc hoàn tất.', {}, 'invalid_transition');
      }
      const pet = b.petId ? await models.pets.getById(b.petId) : null;
      if (!pet) {
        throw conflict('Hồ sơ thú cưng đã bị xóa, không thể ghi tiêm chủng.', {}, 'pet_deleted');
      }
      const row = await models.health.addVaccination({
        id: crypto.randomUUID(),
        petId: b.petId,
        ...value,
        providerName: b.providerName || '',
        source: 'clinic',
        createdAt: clock().toISOString()
      });
      await models.audit.log({
        actorUserId: vet.id,
        action: 'vaccination_created',
        targetType: 'booking',
        targetId: b.id,
        details: null
      });
      const all = evaluateVaccinations(await models.health.listVaccinations(b.petId), today());
      return all.list.find((v) => v.id === row.id);
    }
  };
}

module.exports = { createHealthService };
