'use strict';
const { notFound, validation } = require('../utils/errors');
const { TIME_SLOTS } = require('../utils/validators');
const { isValidYmd } = require('../utils/time');
const { nowInTz } = require('../utils/time');

const CATEGORIES = ['medical', 'grooming', 'hotel', 'emergency'];

const publicService = ({ slotCapacity, ...rest }) => rest; // eslint-disable-line no-unused-vars

function createCatalogService({ models, config, clock = () => new Date() }) {
  return {
    listProviders: () => models.catalog.listProviders(),

    async listServices(query = {}) {
      const category = typeof query.category === 'string' ? query.category : '';
      if (category && !CATEGORIES.includes(category)) throw validation('Danh mục không hợp lệ.', { category: 'Danh mục không hợp lệ.' });
      const rows = await models.catalog.listServices({
        category: category || null,
        providerId: typeof query.providerId === 'string' && query.providerId ? query.providerId : null,
        q: typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : null
      });
      return rows.map(publicService);
    },

    async getService(id) {
      const s = await models.catalog.getService(String(id));
      if (!s) throw notFound('Không tìm thấy dịch vụ này.');
      return publicService(s);
    },

    async slots(serviceId, date) {
      const s = await models.catalog.getService(String(serviceId));
      if (!s) throw notFound('Không tìm thấy dịch vụ này.');
      const now = nowInTz(clock(), config.timezone);
      if (!isValidYmd(date)) throw validation('Vui lòng chọn ngày hợp lệ (YYYY-MM-DD).', { date: 'Ngày chưa hợp lệ.' });
      if (date < now.date) throw validation('Không thể xem khung giờ của ngày đã qua.', { date: 'Ngày đã qua.' });
      const counts = await models.bookings.countBySlot(s.id, date);
      return TIME_SLOTS.map((time) => ({
        time,
        available: (counts[time] || 0) < s.slotCapacity && !(date === now.date && time <= now.time)
      }));
    }
  };
}

module.exports = { createCatalogService };
