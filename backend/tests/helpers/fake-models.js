'use strict';
/**
 * TEST DOUBLE - in-memory implementation of the SAME model interface the services use
 * (see src/models/*.model.js). Never import this from src/. It exists so tests run
 * without SQL Server. It mimics the DB rules the services rely on: unique email/phone,
 * pet limit, per-owner scoping, cascade on pet delete, booking capacity + pet-clash check.
 */
const { DuplicateError, LimitError } = require('../../src/utils/errors');

const clone = (o) => (o === null || o === undefined ? o : JSON.parse(JSON.stringify(o)));

function createFakeModels() {
  const s = { users: [], providers: [], services: [], pets: [], metrics: [], vaccs: [], records: [], bookings: [], chunks: [] };
  let seq = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq)).toISOString();

  const latestWeight = (petId) => {
    const w = s.metrics.filter((m) => m.petId === petId).sort((a, b) => a.measuredOn.localeCompare(b.measuredOn) || a.createdAt.localeCompare(b.createdAt));
    return w.length ? w[w.length - 1].weightKg : null;
  };
  const petOut = (p) => {
    if (!p) return null;
    const { ownerId, ...rest } = p; // eslint-disable-line no-unused-vars
    return { ...clone(rest), weightKg: latestWeight(p.id) };
  };
  const bookingOut = (b) => { if (!b) return null; const { ownerId, ...rest } = b; return clone(rest); }; // eslint-disable-line no-unused-vars
  const svcOut = (sv) => {
    const p = s.providers.find((x) => x.id === sv.providerId);
    return { id: sv.id, category: sv.category, categoryLabel: sv.categoryLabel, providerId: sv.providerId, providerName: p.name,
      providerArea: p.area, name: sv.name, description: sv.description || '', priceVnd: sv.priceVnd, unit: sv.unit,
      isSample: sv.isSample, slotCapacity: sv.slotCapacity };
  };

  const models = {
    users: {
      async create(u) {
        if (s.users.some((x) => x.email === u.email)) throw new DuplicateError('email');
        if (s.users.some((x) => x.phone === u.phone)) throw new DuplicateError('phone');
        s.users.push(clone(u)); return u;
      },
      async findByEmail(e) { return clone(s.users.find((u) => u.email === e)) || null; },
      async findByPhone(p) { return clone(s.users.find((u) => u.phone === p)) || null; },
      async findById(id) { return clone(s.users.find((u) => u.id === id)) || null; }
    },
    catalog: {
      async listProviders() { return s.providers.filter((p) => p.active !== false).map(({ active, ...p }) => clone(p)); }, // eslint-disable-line no-unused-vars
      async listServices({ category, providerId, q }) {
        return s.services.filter((x) => x.active !== false)
          .filter((x) => (!category || x.category === category) && (!providerId || x.providerId === providerId))
          .filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()))
          .map(svcOut);
      },
      async getService(id) { const x = s.services.find((v) => v.id === id && v.active !== false); return x ? svcOut(x) : null; }
    },
    pets: {
      async listByOwner(o) { return s.pets.filter((p) => p.ownerId === o).map(petOut); },
      async getByOwner(id, o) { return petOut(s.pets.find((p) => p.id === id && p.ownerId === o)) || null; },
      async getById(id) { return petOut(s.pets.find((p) => p.id === id)) || null; },
      async create(pet, weight, max) {
        if (s.pets.filter((p) => p.ownerId === pet.ownerId).length >= max) throw new LimitError('limit');
        s.pets.push(clone(pet));
        if (weight) s.metrics.push({ id: weight.id, petId: pet.id, weightKg: weight.weightKg, measuredOn: weight.measuredOn, createdAt: tick() });
        return petOut(pet);
      },
      async update(id, o, ch, newWeight) {
        const p = s.pets.find((x) => x.id === id && x.ownerId === o);
        if (!p) return null;
        Object.assign(p, clone(ch));
        if (newWeight) s.metrics.push({ id: newWeight.id, petId: id, weightKg: newWeight.weightKg, measuredOn: newWeight.measuredOn, createdAt: tick() });
        return petOut(p);
      },
      async remove(id, o) {
        const i = s.pets.findIndex((p) => p.id === id && p.ownerId === o);
        if (i < 0) return false;
        s.pets.splice(i, 1);
        s.metrics = s.metrics.filter((m) => m.petId !== id); s.vaccs = s.vaccs.filter((v) => v.petId !== id);
        s.records = s.records.filter((r) => r.petId !== id);
        s.bookings.forEach((b) => { if (b.petId === id) b.petId = null; }); // ON DELETE SET NULL
        return true;
      }
    },
    health: {
      async listWeights(petId) {
        return s.metrics.filter((m) => m.petId === petId).sort((a, b) => a.measuredOn.localeCompare(b.measuredOn) || a.createdAt.localeCompare(b.createdAt))
          .map((m) => ({ id: m.id, weightKg: m.weightKg, measuredOn: m.measuredOn }));
      },
      async addWeight(w) { s.metrics.push({ ...w, createdAt: tick() }); return { id: w.id, weightKg: w.weightKg, measuredOn: w.measuredOn }; },
      async deleteWeight(petId, id) { const n = s.metrics.length; s.metrics = s.metrics.filter((m) => !(m.id === id && m.petId === petId)); return s.metrics.length < n; },
      async listVaccinations(petId) { return clone(s.vaccs.filter((v) => v.petId === petId)); },
      async listVaccinationsForOwner(o) { const ids = new Set(s.pets.filter((p) => p.ownerId === o).map((p) => p.id)); return clone(s.vaccs.filter((v) => ids.has(v.petId))); },
      async getVaccination(petId, id) { return clone(s.vaccs.find((v) => v.id === id && v.petId === petId)) || null; },
      async addVaccination(v) { s.vaccs.push({ createdAt: tick(), ...clone(v) }); return v; },
      async deleteVaccination(petId, id) { const n = s.vaccs.length; s.vaccs = s.vaccs.filter((v) => !(v.id === id && v.petId === petId)); return s.vaccs.length < n; },
      async listMedicalRecords(petId) {
        return s.records.filter((r) => r.petId === petId).sort((a, b) => b.visitDate.localeCompare(a.visitDate))
          .map((r) => { const vet = s.users.find((u) => u.id === r.vetId); return { id: r.id, visitDate: r.visitDate, vetName: vet ? vet.fullName : null, subjective: r.subjective, objective: r.objective, assessment: r.assessment, plan: r.plan }; });
      },
      async addMedicalRecord(m) {
        s.records.push(clone(m));
        const vet = s.users.find((u) => u.id === m.vetId);
        return { id: m.id, visitDate: m.visitDate, vetName: vet ? vet.fullName : null, subjective: m.subjective, objective: m.objective, assessment: m.assessment, plan: m.plan };
      }
    },
    bookings: {
      async listByOwner(o) { return s.bookings.filter((b) => b.ownerId === o).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(bookingOut); },
      async getByOwner(id, o) { return bookingOut(s.bookings.find((b) => b.id === id && b.ownerId === o)) || null; },
      async getById(id) { return bookingOut(s.bookings.find((b) => b.id === id)) || null; },
      async countBySlot(serviceId, date) {
        const out = {};
        s.bookings.filter((b) => b.serviceId === serviceId && b.date === date && b.status !== 'cancelled').forEach((b) => { out[b.time] = (out[b.time] || 0) + 1; });
        return out;
      },
      async create(b, { capacity }) {
        const live = s.bookings.filter((x) => x.date === b.date && x.time === b.time && x.status !== 'cancelled');
        if (live.some((x) => x.petId === b.petId)) return { ok: false, reason: 'pet_clash' };
        if (live.filter((x) => x.serviceId === b.serviceId).length >= capacity) return { ok: false, reason: 'full' };
        s.bookings.push(clone(b));
        return { ok: true, booking: bookingOut(b) };
      },
      async cancel(id, o) {
        const b = s.bookings.find((x) => x.id === id && x.ownerId === o && ['pending', 'confirmed'].includes(x.status));
        if (!b) return null;
        b.status = 'cancelled'; return bookingOut(b);
      }
    },
    knowledge: {
      async listChunks() { return clone(s.chunks); },
      async replaceDoc({ docSlug, docTitle, reviewStatus }, chunks) {
        s.chunks = s.chunks.filter((c) => c.docSlug !== docSlug);
        chunks.forEach((c) => s.chunks.push({ chunkId: ++seq, docSlug, docTitle, reviewStatus, ...clone(c) }));
      }
    },
    async ping() { return true; }
  };

  // ---- test-only helpers (not part of the model interface) ----
  const testHelpers = {
    state: s,
    seedCatalog() {
      s.providers.push(
        { id: 'clinic-a', name: 'Phòng khám A', area: 'Quận 1', type: 'clinic', isSample: true },
        { id: 'spa-a', name: 'Spa A', area: 'Thảo Điền', type: 'spa', isSample: true });
      s.services.push(
        { id: 'medical-general', providerId: 'clinic-a', category: 'medical', categoryLabel: 'Khám & điều trị', name: 'Khám tổng quát', priceVnd: 250000, unit: 'lượt khám', slotCapacity: 2, isSample: true },
        { id: 'spa-combo', providerId: 'spa-a', category: 'grooming', categoryLabel: 'Spa', name: 'Combo spa', priceVnd: 320000, unit: 'combo', slotCapacity: 1, isSample: true },
        { id: 'retired', providerId: 'spa-a', category: 'grooming', categoryLabel: 'Spa', name: 'Dịch vụ ngừng', priceVnd: 1, unit: 'x', slotCapacity: 1, isSample: true, active: false });
    },
    async addStaff(role, { id, email, phone, passwordHash, fullName = 'Bác sĩ Test' }) {
      await models.users.create({ id, role, status: 'active', fullName, email, phone, passwordHash, orgName: null, orgType: null, createdAt: tick() });
    }
  };
  return { models, testHelpers };
}

module.exports = { createFakeModels };
