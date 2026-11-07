'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ dashboardService }) => ({
  customer: wrap(async (req, res) => ok(res, await dashboardService.customer(req.user.id)))
});
