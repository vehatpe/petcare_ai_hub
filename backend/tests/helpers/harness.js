'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { createApp } = require('../../src/app');
const { loadConfig } = require('../../src/config');
const { createFakeModels } = require('./fake-models');

/** Starts the real Express app (fake models, injectable clock/AI) on an ephemeral port. */
async function startTestApp({ now = '2026-06-10T03:00:00Z', ai, storageService, env = {} } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', BCRYPT_COST: '4', AUTH_RATE_LIMIT_MAX: '1000',
    SERVE_FRONTEND: 'false', RAG_MIN_SCORE: '0.6', RAG_TOP_K: '3', RAG_CACHE_TTL_MS: '0', ...env
  });
  const { models, testHelpers } = createFakeModels();
  testHelpers.seedCatalog();
  const clock = { current: new Date(now) };
  const aiImpl = ai || { embed: async () => { throw new Error('no ai'); }, generate: async () => { throw new Error('no ai'); } };
  const app = createApp({ models, config, ai: aiImpl, storageService, clock: () => clock.current, logger: { error() {}, warn() {} } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;

  async function call(method, path, { token, body, raw, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
    });
    const json = await res.json();
    return { status: res.status, body: json, data: json.data, headers: res.headers, message: json.message };
  }
  let n = 0;
  async function registerCustomer(over = {}) {
    n += 1;
    const r = await call('POST', '/auth/register', { body: {
      role: 'customer', fullName: `Khách ${n}`, email: `user${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}`, password: 'matkhau123', ...over } });
    return { token: r.data.token, user: r.data.user, res: r };
  }
  const validPet = (over = {}) => ({ name: 'Bơ', species: 'dog', sex: 'male', birthDate: '2024-01-15', ...over });
  async function createPet(token, over) { return (await call('POST', '/pets', { token, body: validPet(over) })).data; }
  async function loginStaff(role) {
    n += 1;
    const id = crypto.randomUUID();
    const email = `${role}-${n}@clinic.vn`;
    const phone = `091${String(n).padStart(7, '0')}`;
    await testHelpers.addStaff(role, { id, email, phone, passwordHash: bcrypt.hashSync('matkhau123', 4) });
    const r = await call('POST', '/auth/login', { body: { identifier: email, password: 'matkhau123' } });
    return { token: r.data.token, user: r.data.user };
  }
  return { call, baseUrl: base, registerCustomer, createPet, validPet, loginStaff, clock, testHelpers, models, config, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startTestApp };
