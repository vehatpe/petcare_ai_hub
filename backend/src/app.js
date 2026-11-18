'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { createAuth } = require('./middlewares/auth');
const { notFoundHandler, createErrorHandler } = require('./middlewares/error');
const { createRouter } = require('./routes');
const { createAuthService } = require('./services/auth.service');
const { createCatalogService } = require('./services/catalog.service');
const { createPetService } = require('./services/pet.service');
const { createHealthService } = require('./services/health.service');
const { createBookingService } = require('./services/booking.service');
const { createDashboardService } = require('./services/dashboard.service');
const { createAiRagService } = require('./services/ai-rag.service');
const { createAdminService } = require('./services/admin.service');

/**
 * @param {{models:object, config:object, ai:{embed:Function, generate:Function}, clock?:()=>Date, logger?:object}} deps
 */
function createApp({ models, config, ai, clock = () => new Date(), logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  if (config.corsOrigin) {
    app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  }
  app.use(express.json({ limit: '600kb' }));

  const deps = { models, config, clock };
  const services = {
    authService: createAuthService(deps),
    catalogService: createCatalogService(deps),
    petService: createPetService(deps),
    healthService: createHealthService(deps),
    bookingService: createBookingService(deps),
    dashboardService: createDashboardService(deps),
    aiRagService: createAiRagService({ ...deps, ai }),
    adminService: createAdminService(deps)
  };
  const mw = createAuth({ models, config });

  app.use('/api/v1', createRouter({ services, mw, config, models }));
  app.use('/api', notFoundHandler);

  if (config.serveFrontend) {
    const dir = path.resolve(__dirname, '../../frontend');
    app.use(express.static(dir));
  }
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  app.app_services = services;
  return app;
}

module.exports = { createApp };
