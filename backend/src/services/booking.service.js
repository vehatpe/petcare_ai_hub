'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict } = require('../utils/errors');
const { validateBooking } = require('../utils/validators');
const { nowInTz } = require('../utils/time');
const { assertTransition, minutesUntil, TERMINAL_STATUSES } = require('../utils/booking-state');

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
    list: (ownerId) => models.bookings.listByOwner(ownerId),

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

    async cancel(ownerId, id, input = {}) {
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
    }
  };
}

module.exports = { createBookingService };
