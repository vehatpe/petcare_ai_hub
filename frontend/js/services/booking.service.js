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

    async list(params = {}) {
      if (!AuthService.isLoggedIn()) {
        return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };
      }
      const { data, meta } = await Api.get('/bookings', params, { withMeta: true });
      const items = (data && data.items) || [];
      return {
        items,
        meta: meta || { page: 1, limit: 20, total: items.length, totalPages: 1 }
      };
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
