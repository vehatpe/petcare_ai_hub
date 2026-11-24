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
  const s = { users: [], providers: [], services: [], pets: [], metrics: [], vaccs: [], records: [], bookings: [], chunks: [], auditLogs: [] };
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
    return {
      id: sv.id, category: sv.category, categoryLabel: sv.categoryLabel, providerId: sv.providerId,
      providerName: p.name, providerArea: p.area,
      providerAddress: p.address || null, providerPhone: p.phone || null, providerDescription: p.description || null,
      name: sv.name, description: sv.description || '', priceVnd: sv.priceVnd, unit: sv.unit,
      isSample: sv.isSample, slotCapacity: sv.slotCapacity
    };
  };

  const userOut = (u) => {
    if (!u) return null;
    return {
      id: u.id,
      role: u.role,
      status: u.status,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      passwordHash: u.passwordHash,
      orgName: u.orgName || null,
      orgType: u.orgType || null,
      createdAt: u.createdAt || null,
      providerId: u.providerId || null,
      orgArea: u.orgArea || null,
      approvedBy: u.approvedBy || null,
      approvedAt: u.approvedAt || null,
      mustChangePassword: Boolean(u.mustChangePassword),
      rejectReason: u.rejectReason || null,
      tokenVersion: u.tokenVersion !== undefined && u.tokenVersion !== null ? Number(u.tokenVersion) : 0,
      orgLicenseNo: u.orgLicenseNo || null,
      orgTaxCode: u.orgTaxCode || null
    };
  };

  const models = {
    users: {
      async create(u, runner) { // eslint-disable-line no-unused-vars
        if (s.users.some((x) => x.email === u.email)) throw new DuplicateError('email');
        if (s.users.some((x) => x.phone === u.phone)) throw new DuplicateError('phone');
        const userObj = {
          ...u,
          providerId: u.providerId || null,
          orgArea: u.orgArea || null,
          approvedBy: u.approvedBy || null,
          approvedAt: u.approvedAt || null,
          mustChangePassword: Boolean(u.mustChangePassword),
          rejectReason: u.rejectReason || null,
          tokenVersion: u.tokenVersion !== undefined && u.tokenVersion !== null ? Number(u.tokenVersion) : 0,
          orgLicenseNo: u.orgLicenseNo || null,
          orgTaxCode: u.orgTaxCode || null
        };
        s.users.push(clone(userObj));
        return userOut(userObj);
      },
      async findByEmail(e) { return userOut(s.users.find((u) => u.email === e)); },
      async findByPhone(p) { return userOut(s.users.find((u) => u.phone === p)); },
      async findById(id) { return userOut(s.users.find((u) => u.id === id)); },
      async updatePassword(userId, passwordHash, mustChangePassword = false) {
        const u = s.users.find((x) => x.id === userId);
        if (u) {
          u.passwordHash = passwordHash;
          u.mustChangePassword = Boolean(mustChangePassword);
          u.tokenVersion = (u.tokenVersion || 0) + 1;
        }
      }
    },
    audit: {
      async log({ actorUserId, action, targetType, targetId, detail }) {
        s.auditLogs.push({
          auditId: ++seq,
          actorUserId: actorUserId || null,
          action,
          targetType,
          targetId: String(targetId),
          detail: detail || null,
          createdAt: tick()
        });
      }
    },
    admin: {
      async listUsers({ status, role, q, limit = 20, offset = 0 }) {
        const lim = Math.max(1, Math.min(50, Number(limit) || 20));
        const off = Math.max(0, Number(offset) || 0);
        const search = q ? String(q).trim().toLowerCase().slice(0, 100) : null;

        let filtered = s.users.slice();
        if (status) filtered = filtered.filter((u) => u.status === status);
        if (role) filtered = filtered.filter((u) => u.role === role);
        if (search) {
          filtered = filtered.filter((u) =>
            (u.fullName && u.fullName.toLowerCase().includes(search)) ||
            (u.email && u.email.toLowerCase().includes(search)) ||
            (u.phone && u.phone.includes(search))
          );
        }

        const total = filtered.length;
        // Sort by createdAt DESC
        filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const paged = filtered.slice(off, off + lim);

        return {
          users: paged.map((u) => {
            const out = userOut(u);
            delete out.passwordHash;
            delete out.tokenVersion;
            delete out.orgLicenseNo;
            delete out.orgTaxCode;
            if (u.role === 'provider') {
              let licenseNo = null;
              let taxCode = null;
              if (u.providerId) {
                const prov = s.providers.find((p) => p.id === u.providerId);
                licenseNo = prov && prov.licenseNo ? prov.licenseNo : null;
                taxCode = prov && prov.taxCode ? prov.taxCode : null;
              } else {
                licenseNo = u.orgLicenseNo || null;
                taxCode = u.orgTaxCode || null;
              }
              out.licenseNo = licenseNo;
              out.taxCode = taxCode;
              out.hasLegalInfo = Boolean(licenseNo || taxCode);
            }
            return out;
          }),
          meta: { limit: lim, offset: off, total }
        };
      },

      async transaction(work) {
        // Sao chụp trạng thái trước transaction
        const snapshot = {
          users: clone(s.users),
          providers: clone(s.providers),
          services: clone(s.services),
          pets: clone(s.pets),
          metrics: clone(s.metrics),
          vaccs: clone(s.vaccs),
          records: clone(s.records),
          bookings: clone(s.bookings),
          chunks: clone(s.chunks),
          auditLogs: clone(s.auditLogs),
          seq
        };
        try {
          // fake tx object pass through
          const tx = models.admin;
          const result = await work(tx);
          return result;
        } catch (err) {
          // Khôi phục trạng thái khi callback ném lỗi
          s.users.length = 0; s.users.push(...snapshot.users);
          s.providers.length = 0; s.providers.push(...snapshot.providers);
          s.services.length = 0; s.services.push(...snapshot.services);
          s.pets.length = 0; s.pets.push(...snapshot.pets);
          s.metrics.length = 0; s.metrics.push(...snapshot.metrics);
          s.vaccs.length = 0; s.vaccs.push(...snapshot.vaccs);
          s.records.length = 0; s.records.push(...snapshot.records);
          s.bookings.length = 0; s.bookings.push(...snapshot.bookings);
          s.chunks.length = 0; s.chunks.push(...snapshot.chunks);
          s.auditLogs.length = 0; s.auditLogs.push(...snapshot.auditLogs);
          seq = snapshot.seq;
          throw err;
        }
      },

      async getUserForUpdate(tx, userId) {
        const u = s.users.find((x) => x.id === userId);
        return userOut(u);
      },

      async providerExists(tx, providerId) {
        return s.providers.some((p) => p.id === providerId);
      },

      async isProviderActive(tx, providerId) {
        const p = s.providers.find((x) => x.id === providerId);
        return Boolean(p && p.active !== false);
      },

      async countActiveAdmins(tx) {
        return s.users.filter((u) => u.role === 'admin' && u.status === 'active').length;
      },

      async insertProvider(tx, p) {
        if (s.providers.some((x) => x.id === p.providerId)) {
          const err = new Error(`Violation of PRIMARY KEY constraint. Cannot insert duplicate key in object 'dbo.Providers'. The duplicate key value is (${p.providerId}).`);
          err.number = 2627;
          throw err;
        }
        s.providers.push({
          id: p.providerId,
          name: p.name,
          area: p.area,
          type: p.type,
          isSample: Boolean(p.isSample),
          active: Boolean(p.isActive),
          address: p.address || null,
          phone: p.phone || null,
          description: p.description || null,
          licenseNo: p.licenseNo || null,
          taxCode: p.taxCode || null,
          updatedAt: p.updatedAt || null,
          createdAt: tick()
        });
      },

      async updateUserApproval(tx, { userId, providerId, approvedBy, approvedAt }) {
        const u = s.users.find((x) => x.id === userId);
        if (u) {
          u.providerId = providerId;
          u.status = 'active';
          u.approvedBy = approvedBy;
          u.approvedAt = approvedAt;
        }
      },

      async updateUserRejection(tx, { userId, rejectReason }) {
        const u = s.users.find((x) => x.id === userId);
        if (u) {
          u.status = 'rejected';
          u.rejectReason = rejectReason;
        }
      },

      async updateUserStatus(tx, userId, status, incrementTokenVersion = false) {
        const u = s.users.find((x) => x.id === userId);
        if (u) {
          u.status = status;
          if (incrementTokenVersion) {
            u.tokenVersion = (u.tokenVersion || 0) + 1;
          }
        }
      },

      async disableProviderAndVets(tx, providerId) {
        const p = s.providers.find((x) => x.id === providerId);
        if (p) p.active = false;
        for (const u of s.users) {
          if (u.providerId === providerId && u.role === 'vet') {
            u.status = 'disabled';
            u.tokenVersion = (u.tokenVersion || 0) + 1;
          }
        }
      },

      async enableProviderOnly(tx, providerId) {
        const p = s.providers.find((x) => x.id === providerId);
        if (p) p.active = true;
      },

      async logAudit(tx, logEntry) {
        await models.audit.log(logEntry);
      }
    },
    providerMember: {
      async transaction(work) {
        return models.admin.transaction(work);
      },
      async listVets({ providerId, limit = 20, offset = 0 }) {
        const lim = Math.max(1, Math.min(50, Number(limit) || 20));
        const off = Math.max(0, Number(offset) || 0);

        let filtered = s.users.filter((u) => u.role === 'vet' && u.providerId === providerId);
        const total = filtered.length;

        filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const paged = filtered.slice(off, off + lim).map((u) => ({
          id: u.id,
          role: u.role,
          status: u.status,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          providerId: u.providerId,
          mustChangePassword: Boolean(u.mustChangePassword),
          createdAt: u.createdAt
        }));

        return {
          vets: clone(paged),
          meta: { limit: lim, offset: off, total }
        };
      },
      async getVetForUpdate(tx, vetId) {
        const u = s.users.find((x) => x.id === vetId && x.role === 'vet');
        if (!u) return null;
        return {
          id: u.id,
          role: u.role,
          status: u.status,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          providerId: u.providerId,
          mustChangePassword: Boolean(u.mustChangePassword),
          createdAt: u.createdAt
        };
      },
      async updateVetStatus(tx, vetId, status, incrementTokenVersion = false) {
        const u = s.users.find((x) => x.id === vetId);
        if (u) {
          u.status = status;
          if (incrementTokenVersion) {
            u.tokenVersion = (u.tokenVersion || 0) + 1;
          }
        }
      },
      async getProviderProfile(providerId) {
        const p = s.providers.find((x) => x.id === providerId);
        if (!p) return null;
        return {
          id: p.id,
          name: p.name,
          area: p.area,
          type: p.type,
          address: p.address || null,
          phone: p.phone || null,
          description: p.description || null,
          licenseNo: p.licenseNo || null,
          taxCode: p.taxCode || null,
          isActive: p.active !== false,
          isSample: Boolean(p.isSample),
          updatedAt: p.updatedAt || null
        };
      },
      async getProviderForUpdate(tx, providerId) {
        const p = s.providers.find((x) => x.id === providerId);
        if (!p) return null;
        return {
          id: p.id,
          name: p.name,
          area: p.area,
          type: p.type,
          address: p.address || null,
          phone: p.phone || null,
          description: p.description || null,
          licenseNo: p.licenseNo || null,
          taxCode: p.taxCode || null,
          isActive: p.active !== false,
          isSample: Boolean(p.isSample),
          updatedAt: p.updatedAt || null
        };
      },
      async updateProviderProfile(tx, providerId, fields, updatedAt) {
        const p = s.providers.find((x) => x.id === providerId);
        if (p) {
          p.address = fields.address;
          p.phone = fields.phone;
          p.description = fields.description;
          p.licenseNo = fields.licenseNo;
          p.taxCode = fields.taxCode;
          p.updatedAt = updatedAt;
        }
      },
      async listServices({ providerId, limit = 50, offset = 0 }) {
        const lim = Math.max(1, Math.min(100, Number(limit) || 50));
        const off = Math.max(0, Number(offset) || 0);

        let filtered = s.services.filter((x) => x.providerId === providerId);
        const total = filtered.length;

        filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const paged = filtered.slice(off, off + lim).map((x) => ({
          id: x.id,
          providerId: x.providerId,
          category: x.category,
          categoryLabel: x.categoryLabel,
          name: x.name,
          description: x.description || '',
          priceVnd: x.priceVnd,
          unit: x.unit,
          slotCapacity: x.slotCapacity,
          isActive: x.active !== false,
          isSample: Boolean(x.isSample),
          createdAt: x.createdAt
        }));

        return {
          services: clone(paged),
          meta: { limit: lim, offset: off, total }
        };
      },
      async countServices(tx, providerId) {
        return s.services.filter((x) => x.providerId === providerId).length;
      },
      async getServiceForUpdate(tx, serviceId) {
        const x = s.services.find((sv) => sv.id === serviceId);
        if (!x) return null;
        return {
          id: x.id,
          providerId: x.providerId,
          category: x.category,
          categoryLabel: x.categoryLabel,
          name: x.name,
          description: x.description || '',
          priceVnd: x.priceVnd,
          unit: x.unit,
          slotCapacity: x.slotCapacity,
          isActive: x.active !== false,
          isSample: Boolean(x.isSample),
          createdAt: x.createdAt
        };
      },
      async findServiceByName(tx, providerId, name, excludeServiceId = null) {
        const trimmed = (name || '').trim().toLowerCase();
        const found = s.services.find((x) =>
          x.providerId === providerId &&
          (x.name || '').trim().toLowerCase() === trimmed &&
          (!excludeServiceId || x.id !== excludeServiceId)
        );
        return found ? { ServiceId: found.id, Name: found.name } : null;
      },
      async serviceIdExists(tx, serviceId) {
        return s.services.some((x) => x.id === serviceId);
      },
      async createService(tx, service) {
        s.services.push({
          id: service.id,
          providerId: service.providerId,
          category: service.category,
          categoryLabel: service.categoryLabel,
          name: service.name,
          description: service.description || '',
          priceVnd: service.priceVnd,
          unit: service.unit,
          slotCapacity: service.slotCapacity,
          active: Boolean(service.isActive),
          isSample: Boolean(service.isSample),
          createdAt: service.createdAt instanceof Date ? service.createdAt.toISOString() : service.createdAt || tick()
        });
      },
      async updateService(tx, serviceId, fields) {
        const x = s.services.find((sv) => sv.id === serviceId);
        if (x) {
          x.name = fields.name;
          x.description = fields.description;
          x.category = fields.category;
          x.categoryLabel = fields.categoryLabel;
          x.priceVnd = fields.priceVnd;
          x.unit = fields.unit;
          x.slotCapacity = fields.slotCapacity;
        }
      },
      async setServiceActive(tx, serviceId, isActive) {
        const x = s.services.find((sv) => sv.id === serviceId);
        if (x) {
          x.active = Boolean(isActive);
        }
      }
    },
    catalog: {
      async listProviders() {
        return s.providers.filter((p) => p.active !== false).map((p) => ({
          id: p.id,
          name: p.name,
          area: p.area,
          type: p.type,
          address: p.address || null,
          phone: p.phone || null,
          description: p.description || null,
          isSample: Boolean(p.isSample)
        }));
      },
      async listServices({ category, providerId, q }) {
        return s.services.filter((x) => x.active !== false)
          .filter((x) => {
            const p = s.providers.find((prov) => prov.id === x.providerId);
            return p && p.active !== false;
          })
          .filter((x) => (!category || x.category === category) && (!providerId || x.providerId === providerId))
          .filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()))
          .map(svcOut);
      },
      async getService(id) {
        const x = s.services.find((v) => v.id === id && v.active !== false);
        if (!x) return null;
        const p = s.providers.find((prov) => prov.id === x.providerId);
        if (!p || p.active === false) return null;
        return svcOut(x);
      }
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
    },
    async queryAuditLogs(filter = {}) {
      let logs = s.auditLogs.slice();
      if (filter.action) logs = logs.filter((l) => l.action === filter.action);
      if (filter.targetType) logs = logs.filter((l) => l.targetType === filter.targetType);
      return clone(logs);
    }
  };
  return { models, testHelpers };
}

module.exports = { createFakeModels };
