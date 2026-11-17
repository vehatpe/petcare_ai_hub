'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startTestApp } = require('./helpers/harness');
const { SPECIES, SPECIES_IDS } = require('../src/utils/species');

test('every supported species can be created; unknown species -> 422', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { token } = await app.registerCustomer();
  for (const id of SPECIES_IDS) {
    const r = await app.call('POST', '/pets', { token, body: app.validPet({ name: `Pet-${id}`, species: id }) });
    assert.equal(r.status, 201, `species ${id}`);
    assert.equal(r.data.species, id);
  }
  const bad = await app.call('POST', '/pets', { token, body: app.validPet({ species: 'dragon' }) });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.errors.species, 'Vui lòng chọn loài.');
});

test('weight 0.045 kg is stored and read back; out-of-range is rejected', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { token } = await app.registerCustomer();
  const ok = await app.call('POST', '/pets', { token, body: app.validPet({ species: 'hamster', weightKg: 0.045 }) });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.weightKg, 0.045);
  const comma = await app.call('POST', '/pets', { token, body: app.validPet({ species: 'bird', weightKg: '0,045' }) });
  assert.equal(comma.data.weightKg, 0.045);
  const got = await app.call('GET', `/pets/${ok.data.id}`, { token });
  assert.equal(got.data.weightKg, 0.045);
  for (const w of [0.004, 0, -1, 150.1, 'abc']) {
    const r = await app.call('POST', '/pets', { token, body: app.validPet({ weightKg: w }) });
    assert.equal(r.status, 422, `weight ${w}`);
    assert.equal(r.body.errors.weightKg, 'Cân nặng cần trong khoảng 0,005 – 150 kg.');
  }
});

test('contract: frontend PetService.SPECIES matches backend utils/species.js', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/services/pet.service.js'), 'utf8');
  const win = { crypto: {} };
  vm.runInNewContext(code, { window: win, AuthService: {}, Api: {}, console });
  const fe = win.PetService.SPECIES;
  assert.deepEqual(Array.from(fe, (s) => s.id), SPECIES.map((s) => s.id));
  assert.deepEqual(Array.from(fe, (s) => s.label), SPECIES.map((s) => s.label));
  for (const s of fe) assert.ok(Array.isArray(win.PetService.BREEDS[s.id]), `BREEDS.${s.id}`);
});

test('contract: Fmt.kg shows grams below 1 kg', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/utils/format.js'), 'utf8');
  const win = { crypto: {} };
  vm.runInNewContext(code, { window: win, Intl, console });
  const Fmt = win.Fmt;
  assert.equal(Fmt.kg(0.045), '45 g');
  assert.equal(Fmt.kg(0.9996), '1 kg');
  assert.equal(Fmt.kg(11.2), '11,2 kg');
  assert.equal(Fmt.kg(0.005), '5 g');
});

test('migration 003 is re-runnable (idempotent guards) and keeps data', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../database/migrations/003_Expand_Pet_Species_And_Weight.sql'), 'utf8');
  assert.equal((sql.match(/IF EXISTS \(SELECT 1 FROM sys\.check_constraints/g) || []).length, 2);
  assert.equal((sql.match(/IF NOT EXISTS \(SELECT 1 FROM sys\.check_constraints/g) || []).length, 2);
  assert.match(sql, /ALTER COLUMN Species VARCHAR\(12\) NOT NULL/);
  assert.match(sql, /DECIMAL\(7,3\)/);
  for (const id of SPECIES_IDS) assert.ok(sql.includes(`'${id}'`), id);
  assert.doesNotMatch(sql, /\bDELETE\b|\bTRUNCATE\b|DROP TABLE/i);
});

test('API responses declare charset=utf-8 and Vietnamese text round-trips', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const r = await app.call('GET', '/services');
  assert.match(r.headers.get('content-type') || '', /charset=utf-8/i);
  const { token } = await app.registerCustomer();
  const p = await app.call('POST', '/pets', { token, body: app.validPet({ name: 'Bánh Bao Đậu', species: 'rabbit' }) });
  assert.equal(p.data.name, 'Bánh Bao Đậu');
});

test('dev: Live Server (5500) is allowed by CORS and frontend targets API on :3000', async (t) => {
  const { loadConfig } = require('../src/config');
  assert.match(loadConfig({ NODE_ENV: 'test' }).corsOrigin, /127\.0\.0\.1:5500/);
  assert.equal(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) + 'Zq9' }).corsOrigin, '');
  const code = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/config/api.config.js'), 'utf8');
  const calls = [];
  for (const [loc, want] of [
    [{ protocol: 'http:', hostname: '127.0.0.1', port: '5500' }, 'http://127.0.0.1:3000/api/v1/ping'],
    [{ protocol: 'http:', hostname: 'localhost', port: '3000' }, '/api/v1/ping'],
    [{ protocol: 'file:', hostname: '', port: '' }, 'http://localhost:3000/api/v1/ping']
  ]) {
    const win = { location: loc, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    const st = { getItem: () => null, setItem() {}, removeItem() {} };
    const fetchStub = async (u) => { calls.push([want, u]); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data: {} }), text: async () => '{}' }; };
    vm.runInNewContext(code, { window: win, localStorage: st, sessionStorage: st, CustomEvent: function () {}, fetch: fetchStub, console, setTimeout, clearTimeout, AbortController, URLSearchParams });
    await win.Api.get('/ping').catch(() => {});
  }
  assert.equal(calls.length, 3);
  for (const [want, got] of calls) assert.equal(got, want);
});
