/**
 * PetCare AI Hub - Booking Service
 * Bookings live in the database (/api/v1/bookings). A new booking is always "pending":
 * only the provider can confirm a slot.
 *
 * Exposed as window.BookingService
 */
(function () {
  'use strict';

  const STATUS = {
    pending: { label: 'Chờ xác nhận', badge: 'badge-warning' },
    confirmed: { label: 'Đã xác nhận', badge: 'badge-success' },
    completed: { label: 'Đã hoàn tất', badge: 'badge-mint' },
    cancelled: { label: 'Đã hủy', badge: 'badge-danger' },
    no_show: { label: 'Vắng mặt', badge: 'badge-danger' }
  };

  const BookingService = {
    STATUS,

    async list() {
      if (!AuthService.isLoggedIn()) return [];
      return Api.get('/bookings');
    },

    /** Throws ApiError; `err.errors` may carry { time } for slot conflicts. */
    create({ petId, serviceId, date, time, notes }) {
      if (!date || !time) throw new Error('Vui lòng chọn ngày và giờ hẹn.');
      return Api.post('/bookings', { petId, serviceId, date, time, notes: String(notes || '').trim().slice(0, 500) });
    },

    cancel(id, reason) {
      const body = reason ? { reason: String(reason).trim().slice(0, 300) } : {};
      return Api.patch('/bookings/' + encodeURIComponent(id) + '/cancel', body);
    }
  };

  window.BookingService = BookingService;
})();
