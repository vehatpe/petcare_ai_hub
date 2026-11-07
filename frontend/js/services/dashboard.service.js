/**
 * PetCare AI Hub - Dashboard numbers (computed by the API from the owner's own rows)
 * Exposed as window.DashboardService
 */
(function () {
  'use strict';
  window.DashboardService = {
    customer() {
      return Api.get('/dashboard/customer');
    }
  };
})();
