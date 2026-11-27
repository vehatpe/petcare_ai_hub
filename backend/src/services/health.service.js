'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict } = require('../utils/errors');
const { validateWeight, validateVaccination, validateMedicalRecord, isUuid } = require('../utils/validators');
const { todayInTz } = require('../utils/time');
const { evaluateVaccinations } = require('../utils/health');
const { parsePagination, buildMeta } = require('../utils/pagination');

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
      const [weights, vacc, medicalRes] = await Promise.all([
        models.health.listWeights(pet.id),
        models.health.listVaccinations(pet.id),
        models.health.listMedicalRecordsPaginated(pet.id, { offset: 0, limit: 10 })
      ]);
      const ev = evaluateVaccinations(vacc, today());
      return {
        pet: { id: pet.id, name: pet.name },
        weights,
        weightChart: { count: weights.length, canRender: weights.length >= 2 },
        vaccinations: ev.list,
        vaccineSummary: ev.summary,
        medicalRecords: medicalRes.rows,
        medicalRecordsMeta: { limit: 10, total: medicalRes.total }
      };
    },

    async listMedicalRecords(ownerId, petId, query = {}) {
      const pet = await ownedPet(ownerId, petId);
      const { page, limit, offset } = parsePagination(query);
      const { rows, total } = await models.health.listMedicalRecordsPaginated(pet.id, { offset, limit });
      return { items: rows, meta: buildMeta({ page, limit, total }) };
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

    async addMedicalRecord(vet, petId, input) {
      const pet = await models.pets.getById(petId);
      if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      const { errors, value } = validateMedicalRecord(input || {}, today());
      if (Object.keys(errors).length) fail(errors);
      if (value.bookingId) {
        const b = await models.bookings.getById(value.bookingId);
        if (!b || b.petId !== pet.id) fail({ bookingId: 'Lịch hẹn không tồn tại hoặc không thuộc thú cưng này.' });
      }
      return models.health.addMedicalRecord({
        id: crypto.randomUUID(), petId: pet.id, vetId: vet.id, bookingId: value.bookingId || null,
        visitDate: value.visitDate, subjective: value.subjective, objective: value.objective,
        assessment: value.assessment, plan: value.plan
      });
    }
  };
}

module.exports = { createHealthService };
