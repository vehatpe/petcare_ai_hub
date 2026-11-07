'use strict';
const { wrap, ok } = require('../utils/http');

module.exports = ({ catalogService }) => ({
  providers: wrap(async (req, res) => ok(res, await catalogService.listProviders())),
  services: wrap(async (req, res) => ok(res, await catalogService.listServices(req.query))),
  service: wrap(async (req, res) => ok(res, await catalogService.getService(req.params.id))),
  slots: wrap(async (req, res) => ok(res, await catalogService.slots(req.params.id, req.query.date)))
});
