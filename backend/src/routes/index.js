'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { uuidParam } = require('../utils/http');

const mk = (name, deps) => require(`../controllers/${name}.controller`)(deps);

function createRouter({ services, mw, config }) {
  const r = express.Router();
  const c = {
    auth: mk('auth', services), catalog: mk('catalog', services), pet: mk('pet', services),
    health: mk('health', services), booking: mk('booking', services), dashboard: mk('dashboard', services), ai: mk('ai', services)
  };
  const { authenticate, requireRole } = mw;
  const customer = [authenticate, requireRole('customer')];

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.max, standardHeaders: true, legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ success: false, data: null, code: 'rate_limited', message: 'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.' })
  });
  r.post('/auth/register', limiter, c.auth.register);
  r.post('/auth/login', limiter, c.auth.login);
  r.get('/auth/me', limiter, authenticate, c.auth.me);

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
  r.post('/ai/chat', customer, c.ai.chat);
  return r;
}

module.exports = { createRouter };
