/**
 * PetCare AI Hub - Health records (weights, vaccinations, medical records)
 * Everything is computed by the API from the database; this file only fetches and posts.
 *
 * Exposed as window.HealthService
 */
(function () {
  'use strict';

  const path = (petId, tail) => '/pets/' + encodeURIComponent(petId) + tail;

  const HealthService = {
    /** Aggregate for one pet: weights, weightChart.canRender, vaccinations, vaccineSummary, medicalRecords. */
    get(petId) {
      return Api.get('/health-records', { petId });
    },
    addWeight(petId, { weightKg, measuredOn }) {
      return Api.post(path(petId, '/weights'), { weightKg: Number(weightKg), measuredOn: measuredOn || undefined });
    },
    removeWeight(petId, metricId) {
      return Api.del(path(petId, '/weights/' + encodeURIComponent(metricId)));
    },
    addVaccination(petId, input) {
      return Api.post(path(petId, '/vaccinations'), input);
    },
    removeVaccination(petId, id) {
      return Api.del(path(petId, '/vaccinations/' + encodeURIComponent(id)));
    },
    VACCINE_STATUS: {
      ok: { label: 'Còn hạn', badge: 'badge-success', mark: '✓' },
      'due-soon': { label: 'Sắp đến hạn', badge: 'badge-warning', mark: '!' },
      overdue: { label: 'Quá hạn', badge: 'badge-danger', mark: '×' },
      recorded: { label: 'Đã ghi nhận', badge: 'badge-mint', mark: '•' }
    }
  };

  window.HealthService = HealthService;
})();
