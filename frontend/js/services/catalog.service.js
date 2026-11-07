/**
 * PetCare AI Hub - Service & Provider Catalog (read-only, public)
 * Data comes from /api/v1/providers and /api/v1/services. Rows flagged isSample are
 * illustrative placeholders; pages must show Catalog.sampleNotice(items) when any appear.
 *
 * Exposed as window.Catalog
 */
(function () {
  'use strict';

  const CATEGORY_LABEL = { medical: 'Khám & điều trị', grooming: 'Spa & làm đẹp', hotel: 'Lưu trú', emergency: 'Cấp cứu' };
  const TYPE_LABEL = { clinic: 'Phòng khám', spa: 'Spa & Grooming', hotel: 'Khách sạn thú cưng', emergency: 'Cấp cứu thú y' };
  const cache = {};

  function once(key, load) {
    if (!cache[key]) {
      cache[key] = load().catch((err) => { delete cache[key]; throw err; });
    }
    return cache[key];
  }

  const Catalog = {
    CATEGORY_LABEL,
    TYPE_LABEL,

    providers() {
      return once('providers', () => Api.get('/providers', null, { auth: false }));
    },

    services(params) {
      const key = 'services:' + JSON.stringify(params || {});
      return once(key, () => Api.get('/services', params, { auth: false }));
    },

    async service(id) {
      if (!id) return null;
      try {
        return await Api.get('/services/' + encodeURIComponent(id), null, { auth: false });
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    /** [{ time, available }] for one service on one day (YYYY-MM-DD). Never cached: availability changes. */
    slots(serviceId, date) {
      return Api.get('/services/' + encodeURIComponent(serviceId) + '/slots', { date }, { auth: false });
    },

    /** Text to show next to a list when it contains illustrative rows; '' otherwise. */
    sampleNotice(items) {
      return (items || []).some((i) => i.isSample)
        ? 'Tên cơ sở, dịch vụ và giá trong bản thử nghiệm là dữ liệu minh họa, chưa phải thông tin thật của cơ sở.'
        : '';
    },

    providerLabel(service) {
      return service.providerArea ? `${service.providerName} (${service.providerArea})` : service.providerName;
    }
  };

  window.Catalog = Catalog;
})();
