'use strict';
const express = require('express');
const { createRateLimiters } = require('../middlewares/rate-limiters');
const { uuidParam } = require('../utils/http');

const mk = (name, deps) => require(`../controllers/${name}.controller`)(deps);

function createRouter({ services, mw, config, models }) {
  const r = express.Router();
  const c = {
    auth: mk('auth', services), catalog: mk('catalog', services), pet: mk('pet', services),
    health: mk('health', services), booking: mk('booking', services), dashboard: mk('dashboard', services), ai: mk('ai', services),
    admin: mk('admin', services), provider: mk('provider', services)
  };
  const { authenticate, requireRole } = mw;
  const customer = [authenticate, requireRole('customer')];
  const admin = [authenticate, requireRole('admin')];
  const providerOrAdmin = [authenticate, requireRole('provider', 'admin')];

  const { authLimiter, meLimiter, aiLimiter, changePasswordLimiter } = createRateLimiters(config);

  // Health check endpoint (public, reports DB connectivity)
  r.get('/health', async (req, res) => {
    try {
      const dbOk = models?.ping ? await models.ping() : true;
      if (!dbOk) {
        return res.status(503).json({ success: false, data: { status: 'down', database: 'disconnected' }, message: 'Hệ thống đang gặp sự cố.' });
      }
      return res.status(200).json({ success: true, data: { status: 'ok', database: 'connected' }, message: 'Hệ thống hoạt động bình thường.' });
    } catch (_) {
      return res.status(503).json({ success: false, data: { status: 'down', database: 'disconnected' }, message: 'Hệ thống đang gặp sự cố.' });
    }
  });

  r.post('/auth/register', authLimiter, c.auth.register);
  r.post('/auth/login', authLimiter, c.auth.login);
  r.get('/auth/me', meLimiter, authenticate, c.auth.me);
  r.post('/auth/change-password', authenticate, changePasswordLimiter, c.auth.changePassword);

  r.get('/providers', c.catalog.providers);
  r.get('/services', c.catalog.services);
  r.get('/services/:id', c.catalog.service);
  r.get('/services/:id/slots', c.catalog.slots);

  r.get('/pets', customer, c.pet.list);
  r.post('/pets', customer, c.pet.create);
  r.get('/pets/:id', customer, uuidParam('id'), c.pet.get);
  r.put('/pets/:id', customer, uuidParam('id'), c.pet.update);
  r.delete('/pets/:id', customer, uuidParam('id'), c.pet.remove);

  r.get('/health-records', customer, c.health.aggregate);
  r.post('/pets/:id/weights', customer, uuidParam('id'), c.health.addWeight);
  r.delete('/pets/:id/weights/:metricId', customer, uuidParam('id'), uuidParam('metricId'), c.health.deleteWeight);
  r.post('/pets/:id/vaccinations', customer, uuidParam('id'), c.health.addVaccination);
  r.delete('/pets/:id/vaccinations/:vaccinationId', customer, uuidParam('id'), uuidParam('vaccinationId'), c.health.deleteVaccination);
  r.post('/pets/:id/medical-records', authenticate, requireRole('vet', 'admin'), uuidParam('id'), c.health.addMedicalRecord);

  r.get('/bookings', customer, c.booking.list);
  r.post('/bookings', customer, c.booking.create);
  r.patch('/bookings/:id/cancel', customer, uuidParam('id'), c.booking.cancel);

  r.get('/dashboard/customer', customer, c.dashboard.customer);
  r.post('/ai/chat', customer, aiLimiter, c.ai.chat);

  r.get('/admin/users', admin, c.admin.listUsers);
  r.post('/admin/users/:id/approve', admin, uuidParam('id'), c.admin.approve);
  r.post('/admin/users/:id/reject', admin, uuidParam('id'), c.admin.reject);
  r.post('/admin/users/:id/disable', admin, uuidParam('id'), c.admin.disable);
  r.post('/admin/users/:id/enable', admin, uuidParam('id'), c.admin.enable);

  r.post('/provider/vets', providerOrAdmin, c.provider.createVet);
  r.get('/provider/vets', providerOrAdmin, c.provider.listVets);
  r.post('/provider/vets/:id/disable', providerOrAdmin, uuidParam('id'), c.provider.disableVet);
  r.post('/provider/vets/:id/enable', providerOrAdmin, uuidParam('id'), c.provider.enableVet);
  return r;
}

module.exports = { createRouter };
