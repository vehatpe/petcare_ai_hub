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
    pending: { label: 'Chờ cơ sở xác nhận', badge: 'badge-warning' },
    confirmed: { label: 'Cơ sở đã xác nhận', badge: 'badge-success' },
    completed: { label: 'Đã hoàn tất', badge: 'badge-mint' },
    cancelled: { label: 'Đã hủy', badge: 'badge-danger' }
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

    cancel(id) {
      return Api.patch('/bookings/' + encodeURIComponent(id) + '/cancel');
    }
  };

  window.BookingService = BookingService;
})();
