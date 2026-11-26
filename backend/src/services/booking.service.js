'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict } = require('../utils/errors');
const { validateBooking } = require('../utils/validators');
const { nowInTz } = require('../utils/time');
const { assertTransition, minutesUntil, TERMINAL_STATUSES } = require('../utils/booking-state');

const VALID_BOOKING_STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.randomBytes(8);
  let s = 'BK-';
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

function createBookingService({ models, config, clock = () => new Date() }) {
  const cancelWindowHours = Number.isInteger(config?.bookingCancelWindowHours)
    ? config.bookingCancelWindowHours
    : 2;

  return {
    list: async (ownerId) => {
      const rows = await models.bookings.listByOwner(ownerId);
      return Array.isArray(rows) ? rows.map((b) => ({ ...b, cancelWindowHours })) : rows;
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
        id: crypto.randomUUID(),
        code: newCode(),
        ownerId,
        petId: pet.id,
        petName: pet.name,
        serviceId: service.id,
        providerId: service.providerId,
        serviceName: service.name,
        providerName: `${service.providerName} (${service.providerArea})`,
        priceVnd: service.priceVnd,
        date: value.date,
        time: value.time,
        notes: value.notes,
        status: 'pending',
        createdAt: clock().toISOString()
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

    async cancel(actor, id, input = {}) {
      if (actor && typeof actor === 'object' && actor.role === 'provider') {
        return this.cancelByProvider(actor.providerId, actor.id, id, input);
      }
      const ownerId = typeof actor === 'string' ? actor : actor.id;
      const b = await models.bookings.getByOwner(id, ownerId);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');

      // 2. Trạng thái kết thúc -> 409 (thông báo nói rõ lịch đã hủy/hoàn tất/vắng mặt)
      if (TERMINAL_STATUSES.has(b.status)) {
        let msg = 'Lịch hẹn đã kết thúc nên không thể hủy.';
        if (b.status === 'cancelled') msg = 'Lịch hẹn này đã được hủy trước đó.';
        else if (b.status === 'completed') msg = 'Lịch hẹn đã hoàn tất nên không thể hủy.';
        else if (b.status === 'no_show') msg = 'Lịch hẹn đã được ghi nhận vắng mặt nên không thể hủy.';
        throw conflict(msg, undefined, 'invalid_transition');
      }

      // Assert transition is valid in state machine
      assertTransition(b.status, 'cancelled');

      // 3. pending -> hủy được; confirmed -> nếu minutesUntil < cancelWindowHours * 60 thì 409 cancel_window
      if (b.status === 'confirmed') {
        const remainingMinutes = minutesUntil(b.date, b.time, clock, config.timezone);
        if (remainingMinutes < cancelWindowHours * 60) {
          throw conflict('Lịch sát giờ hẹn, vui lòng liên hệ cơ sở.', undefined, 'cancel_window');
        }
      }

      // 4. Validate reason (optional, <= 300, trim)
      let reason = null;
      if (input && input.reason !== undefined && input.reason !== null) {
        if (typeof input.reason !== 'string') {
          throw validation('Lý do hủy không hợp lệ.', { reason: 'Lý do hủy không hợp lệ.' });
        }
        const trimmed = input.reason.trim();
        if (trimmed.length > 300) {
          throw validation('Lý do hủy tối đa 300 ký tự.', { reason: 'Lý do hủy tối đa 300 ký tự.' });
        }
        reason = trimmed.length > 0 ? trimmed : null;
      }

      const cancelledAt = clock().toISOString();

      // Execute transition atomically
      const updated = await models.bookings.transition(null, id, {
        from: b.status,
        to: 'cancelled',
        fields: {
          cancelledAt,
          cancelledBy: 'customer',
          cancelReason: reason
        }
      });

      if (!updated) {
        throw conflict('Lịch hẹn này không còn ở trạng thái có thể hủy.', undefined, 'invalid_transition');
      }

      // 5. Ghi AuditLog (Action='booking_cancel', TargetType='booking', không đưa lý do vào log)
      if (models.audit && typeof models.audit.log === 'function') {
        await models.audit.log({
          actorUserId: ownerId,
          action: 'booking_cancel',
          targetType: 'booking',
          targetId: id,
          detail: null
        });
      }

      return updated;
    },

    async listForProvider(providerId, query = {}) {
      if (!providerId) throw notFound('Không tìm thấy cơ sở.');
      const filters = {};
      const errors = {};

      if (query.status !== undefined && query.status !== '') {
        if (!VALID_BOOKING_STATUSES.has(query.status)) {
          errors.status = 'Trạng thái không hợp lệ.';
        } else {
          filters.status = query.status;
        }
      }

      if (query.date !== undefined && query.date !== '') {
        if (!isYmd(query.date)) errors.date = 'Ngày không hợp lệ (YYYY-MM-DD).';
        else filters.date = query.date;
      }

      if (query.from !== undefined && query.from !== '') {
        if (!isYmd(query.from)) errors.from = 'Từ ngày không hợp lệ (YYYY-MM-DD).';
        else filters.from = query.from;
      }

      if (query.to !== undefined && query.to !== '') {
        if (!isYmd(query.to)) errors.to = 'Đến ngày không hợp lệ (YYYY-MM-DD).';
        else filters.to = query.to;
      }

      if (filters.from && filters.to) {
        const diffDays = Math.round((new Date(filters.to) - new Date(filters.from)) / 86400000);
        if (diffDays < 0) errors.from = 'Khoảng ngày không hợp lệ.';
        else if (diffDays > 92) errors.to = 'Khoảng ngày tối đa 92 ngày.';
      }

      if (query.vetId !== undefined && query.vetId !== '') {
        if (!isUuid(query.vetId)) errors.vetId = 'Mã bác sĩ không hợp lệ.';
        else filters.vetId = query.vetId;
      }

      if (query.q !== undefined && query.q !== '') {
        const q = String(query.q).trim();
        if (q.length > 60) errors.q = 'Từ khóa tìm kiếm tối đa 60 ký tự.';
        else if (q.length > 0) filters.q = q;
      }

      if (Object.keys(errors).length > 0) {
        throw validation('Tham số lọc không hợp lệ.', errors);
      }

      return models.bookings.listByProvider(providerId, filters);
    },

    async _requireActiveFacility(providerId) {
      if (!providerId) throw notFound('Không tìm thấy cơ sở.');
      const active = await models.bookings.isFacilityActive(providerId);
      if (!active) {
        throw conflict('Cơ sở đang tạm khóa, không thể thao tác lịch hẹn.', undefined, 'facility_inactive');
      }
    },

    async _transitionProvider({ providerId, actorUserId, id, to, checkTiming, buildFields, action }) {
      await this._requireActiveFacility(providerId);
      const b = await models.bookings.getByIdForProvider(id, providerId);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');

      assertTransition(b.status, to);
      if (checkTiming) checkTiming(b);

      const fields = buildFields ? buildFields() : {};
      const updated = await models.bookings.transition(null, id, { from: b.status, to, fields });
      if (!updated) {
        throw conflict('Trạng thái lịch hẹn đã thay đổi, vui lòng tải lại.', undefined, 'invalid_transition');
      }

      if (models.audit && typeof models.audit.log === 'function') {
        await models.audit.log({
          actorUserId,
          action,
          targetType: 'booking',
          targetId: id,
          detail: null
        });
      }

      return models.bookings.getByIdForProvider(id, providerId);
    },

    async confirmByProvider(providerId, actorUserId, id) {
      return this._transitionProvider({
        providerId,
        actorUserId,
        id,
        to: 'confirmed',
        action: 'booking_confirm',
        checkTiming: (b) => {
          if (minutesUntil(b.date, b.time, clock, config.timezone) <= 0) {
            throw conflict('Khung giờ hẹn đã qua, không thể xác nhận.', undefined, 'slot_passed');
          }
        },
        buildFields: () => ({ confirmedAt: clock().toISOString() })
      });
    },

    async completeByProvider(providerId, actorUserId, id) {
      return this._transitionProvider({
        providerId,
        actorUserId,
        id,
        to: 'completed',
        action: 'booking_complete',
        checkTiming: (b) => {
          if (minutesUntil(b.date, b.time, clock, config.timezone) > 0) {
            throw conflict('Chưa đến giờ hẹn, chưa thể hoàn tất.', undefined, 'too_early');
          }
        },
        buildFields: () => ({ completedAt: clock().toISOString() })
      });
    },

    async noShowByProvider(providerId, actorUserId, id) {
      return this._transitionProvider({
        providerId,
        actorUserId,
        id,
        to: 'no_show',
        action: 'booking_no_show',
        checkTiming: (b) => {
          if (minutesUntil(b.date, b.time, clock, config.timezone) > 0) {
            throw conflict('Chưa đến giờ hẹn, chưa thể ghi nhận vắng mặt.', undefined, 'too_early');
          }
        },
        buildFields: () => ({ noShowAt: clock().toISOString() })
      });
    },

    async cancelByProvider(providerId, actorUserId, id, input = {}) {
      if (!input || typeof input.reason !== 'string') {
        throw validation('Vui lòng nhập lý do hủy (3–300 ký tự).', { reason: 'Vui lòng nhập lý do hủy (3–300 ký tự).' });
      }
      const trimmed = input.reason.trim();
      if (trimmed.length < 3 || trimmed.length > 300) {
        throw validation('Lý do hủy phải từ 3 đến 300 ký tự.', { reason: 'Lý do hủy phải từ 3 đến 300 ký tự.' });
      }

      return this._transitionProvider({
        providerId,
        actorUserId,
        id,
        to: 'cancelled',
        action: 'booking_cancel_provider',
        buildFields: () => ({
          cancelledAt: clock().toISOString(),
          cancelledBy: 'provider',
          cancelReason: trimmed
        })
      });
    },

    async assignVet(providerId, actorUserId, id, input = {}) {
      await this._requireActiveFacility(providerId);
      const b = await models.bookings.getByIdForProvider(id, providerId);
      if (!b) throw notFound('Không tìm thấy lịch hẹn này.');

      if (!['pending', 'confirmed'].includes(b.status)) {
        throw conflict('Chỉ có thể gán bác sĩ cho lịch hẹn đang chờ hoặc đã xác nhận.', undefined, 'invalid_transition');
      }

      const vetId = input && input.vetId !== undefined ? input.vetId : undefined;
      if (vetId !== null && (typeof vetId !== 'string' || !isUuid(vetId))) {
        throw validation('Bác sĩ không hợp lệ.', { vetId: 'Bác sĩ không hợp lệ.' });
      }

      if (vetId !== null) {
        const validVet = await models.bookings.isActiveVetOfProvider(vetId, providerId);
        if (!validVet) {
          throw validation('Bác sĩ không thuộc cơ sở hoặc chưa được kích hoạt.', { vetId: 'Bác sĩ không thuộc cơ sở hoặc chưa được kích hoạt.' });
        }
      }

      if (b.vet && b.vet.id !== vetId) {
        const hasMr = await models.bookings.hasMedicalRecordForBooking(id, b.vet.id);
        if (hasMr) {
          throw conflict('Bác sĩ hiện tại đã ghi bệnh án cho lịch hẹn này, không thể đổi.', undefined, 'already_recorded');
        }
      }

      const updated = await models.bookings.transition(null, id, {
        from: b.status,
        to: b.status,
        fields: { vetId }
      });
      if (!updated) {
        throw conflict('Trạng thái lịch hẹn đã thay đổi, vui lòng tải lại.', undefined, 'invalid_transition');
      }

      if (models.audit && typeof models.audit.log === 'function') {
        await models.audit.log({
          actorUserId,
          action: 'booking_assign_vet',
          targetType: 'booking',
          targetId: id,
          detail: null
        });
      }

      return models.bookings.getByIdForProvider(id, providerId);
    }
  };
}

module.exports = { createBookingService };
