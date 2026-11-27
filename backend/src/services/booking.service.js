'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict } = require('../utils/errors');
const { validateBooking, isUuid } = require('../utils/validators');
const { nowInTz } = require('../utils/time');
const { parsePagination, buildMeta } = require('../utils/pagination');

const VALID_SCOPES = new Set(['all', 'upcoming', 'history']);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.randomBytes(8);
  let s = 'BK-';
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

function createBookingService({ models, config, clock = () => new Date() }) {
  return {
    async list(ownerId, query = {}) {
      const { page, limit, offset } = parsePagination(query);
      const scope = typeof query.scope === 'string' && query.scope.trim() ? query.scope.trim() : 'all';
      if (!VALID_SCOPES.has(scope)) {
        throw validation('Phạm vi lọc lịch hẹn không hợp lệ.', { scope: 'Phạm vi lọc phải là all, upcoming hoặc history.' });
      }
      let petId = null;
      if (query.petId !== undefined && query.petId !== '') {
        if (!isUuid(query.petId)) {
          throw validation('Mã thú cưng không hợp lệ.', { petId: 'Mã thú cưng không hợp lệ.' });
        }
        petId = String(query.petId).toLowerCase();
      }
      const now = nowInTz(clock(), config.timezone);
      const { rows, total } = await models.bookings.listByOwner(ownerId, {
        scope, petId, today: now.date, time: now.time, offset, limit
      });
      return { items: rows, meta: buildMeta({ page, limit, total }) };
    },

    async create(ownerId, input) {
      const now = nowInTz(clock(), config.timezone);
      const { errors, value } = validateBooking(input || {}, now);
      if (Object.keys(errors).length) throw validation('Vui lòng kiểm tra lại các trường được đánh dấu.', errors);

      const pet = await models.pets.getByOwner(value.petId, ownerId);
      if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng đã chọn.');
      const service = await models.catalog.getService(value.serviceId);
      if (!service) throw notFound('Dịch vụ đã chọn không còn khả dụng.');

      const booking = {
        id: crypto.randomUUID(), code: newCode(), ownerId, petId: pet.id, petName: pet.name,
        serviceId: service.id, serviceName: service.name,
        providerName: `${service.providerName} (${service.providerArea})`,
        priceVnd: service.priceVnd, date: value.date, time: value.time, notes: value.notes,
        status: 'pending', createdAt: clock().toISOString()
      };
      const res = await models.bookings.create(booking, { capacity: service.slotCapacity });
      if (!res.ok) {
        if (res.reason === 'pet_clash') {
          const msg = `${pet.name} đã có lịch hẹn vào khung giờ này. Vui lòng chọn giờ khác.`;
          throw conflict(msg, { time: msg });
        }
        const msg = 'Khung giờ này đã đủ chỗ. Vui lòng chọn khung giờ khác.';
        throw conflict(msg, { time: msg });
      }
      return res.booking;
    },

    async cancel(ownerId, id) {
      const b = await models.bookings.getByOwner(id, ownerId);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');
      const msg = b.status === 'cancelled' ? 'Lịch hẹn này đã được hủy trước đó.' : 'Lịch hẹn đã hoàn tất nên không thể hủy.';
      if (b.status === 'cancelled' || b.status === 'completed') throw conflict(msg);
      const updated = await models.bookings.cancel(id, ownerId, clock().toISOString());
      if (!updated) throw conflict('Lịch hẹn này không còn ở trạng thái có thể hủy.');
      return updated;
    }
  };
}

module.exports = { createBookingService };
