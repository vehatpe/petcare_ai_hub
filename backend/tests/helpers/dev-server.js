'use strict';
/**
 * DEV/TEST ONLY. Runs the real Express app against IN-MEMORY fake models (the same test double the
 * unit tests use) and serves ../frontend same-origin, so the UI can be exercised without SQL Server.
 * Data is lost on exit. It is NOT a substitute for testing against SQL Server 2022 + Gemini.
 * Usage: node tests/helpers/dev-server.js [port]
 */
const { createApp } = require('../../src/app');
const { loadConfig } = require('../../src/config');
const { createFakeModels } = require('./fake-models');

const port = Number(process.argv[2] || 3000);
const config = loadConfig({
  NODE_ENV: 'test', JWT_SECRET: 'dev-only-secret-dev-only-secret-123456', BCRYPT_COST: '4', AUTH_RATE_LIMIT_MAX: '1000',
  SERVE_FRONTEND: 'true', PORT: String(port)
});
const { models, testHelpers } = createFakeModels();
testHelpers.seedCatalog();
const ai = { embed: async () => { throw new Error('AI not configured (dev server)'); }, generate: async () => { throw new Error('AI not configured (dev server)'); } };
createApp({ models, config, ai, logger: { error() {} } }).listen(port, () => console.log(`DEV server (fake in-memory data) http://localhost:${port}`));
