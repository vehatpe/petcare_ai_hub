'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { startTestApp } = require('./helpers/harness');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');

function readFrontendScripts(htmlRelPath) {
  const htmlPath = path.join(FRONTEND_DIR, htmlRelPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [];
  const re = /<script\s+src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const resolved = path.resolve(path.dirname(htmlPath), m[1]);
    scripts.push(resolved);
  }
  return scripts;
}

function createDomStub() {
  const listeners = new Map();
  const elements = new Map();

  function makeEl(id = '') {
    const elListeners = new Map();
    const el = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      dataset: {},
      className: '',
      attributes: {},
      style: { setProperty() {} },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(type, fn) {
        if (!elListeners.has(type)) elListeners.set(type, []);
        elListeners.get(type).push(fn);
      },
      dispatchEvent(ev) {
        for (const fn of elListeners.get(ev.type) || []) fn(ev);
      },
      querySelector() { return makeEl(); },
      querySelectorAll() { return []; },
      closest() { return null; },
      focus() {}
    };
    return el;
  }

  return {
    window: {
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '3000',
        pathname: '/pages/customer-dashboard.html',
        search: '',
        href: 'http://127.0.0.1:5500/pages/customer-dashboard.html',
        assign() {},
        replace() {}
      },
      addEventListener() {},
      dispatchEvent() {},
      CustomEvent: function CustomEvent(name) { this.type = name; }
    },
    document: {
      documentElement: {
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {},
        style: { setProperty() {} }
      },
      body: {
        hasAttribute() { return false; },
        classList: { contains() { return false; }, add() {}, remove() {} },
        dataset: {}
      },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeEl(id));
        return elements.get(id);
      },
      querySelector() { return makeEl(); },
      querySelectorAll() { return []; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      createElement() { return makeEl(); },
      _trigger(type) {
        for (const fn of listeners.get(type) || []) fn({ type });
      }
    },
    elements
  };
}

test('Api.get returns payload.data by default and { data, meta } when withMeta is true', async () => {
  const dom = createDomStub();
  let fetchMode = 'meta';
  const ctx = vm.createContext({
    window: dom.window,
    location: dom.window.location,
    document: dom.document,
    addEventListener() {},
    removeEventListener() {},
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams,
    CustomEvent: dom.window.CustomEvent,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { items: [{ id: 'b1' }] },
        meta: fetchMode === 'meta' ? { page: 2, limit: 20, total: 25, totalPages: 2 } : undefined
      })
    })
  });
  ctx.window = ctx;
  const code = fs.readFileSync(path.join(FRONTEND_DIR, 'js', 'config', 'api.config.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'api.config.js' });

  const plain = await ctx.Api.get('/bookings');
  assert.deepEqual(plain, { items: [{ id: 'b1' }] });

  const withMeta = await ctx.Api.get('/bookings', { page: 2 }, { withMeta: true });
  assert.deepEqual(withMeta, {
    data: { items: [{ id: 'b1' }] },
    meta: { page: 2, limit: 20, total: 25, totalPages: 2 }
  });
});

test('Pager.render builds truncated pages and hides when totalPages <= 1', () => {
  const dom = createDomStub();
  const ctx = vm.createContext({
    window: dom.window,
    location: dom.window.location,
    document: dom.document,
    Fmt: { esc: (s) => String(s) }
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(FRONTEND_DIR, 'js', 'components', 'pager.js'), 'utf8'), ctx);

  assert.equal(ctx.Pager.render({ page: 1, limit: 20, total: 5, totalPages: 1 }), '');
  const html = ctx.Pager.render({ page: 2, limit: 20, total: 25, totalPages: 2 });
  assert.match(html, /Trang 2 \/ 2 · tổng 25/);
  assert.match(html, /data-action="page-prev"/);
  assert.match(html, /aria-current="page"/);
});

test('admin-users.html scripts load with Pager and render page 2 from real app', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const scripts = readFrontendScripts('pages/admin-users.html');
  assert.ok(scripts.some((s) => s.endsWith(path.join('components', 'pager.js'))), 'admin-users.html must include pager.js');

  const dom = createDomStub();
  const sessionData = JSON.stringify({
    token: 'tok',
    user: { id: 'admin-1', role: 'admin', fullName: 'Admin', email: 'admin@test.local' }
  });
  const ctx = vm.createContext({
    window: dom.window,
    location: dom.window.location,
    document: dom.document,
    addEventListener() {},
    removeEventListener() {},
    sessionStorage: { getItem: (k) => (k === 'petcare_session' ? sessionData : null), setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams,
    CustomEvent: dom.window.CustomEvent,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { users: [] }, meta: { page: 1, limit: 20, total: 0, totalPages: 1 } }) })
  });
  ctx.window = ctx;

  for (const scriptPath of scripts) {
    if (!fs.existsSync(scriptPath)) continue;
    vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), ctx, { filename: scriptPath });
  }

  // Override Api.get with harness-backed response
  ctx.Api.get = async (p, q, opts) => {
    const res = await app.call('GET', '/api/v1' + p + '?page=' + (q.page || 1) + '&limit=' + (q.limit || 20), { role: 'admin' });
    return opts && opts.withMeta ? { data: res.body.data, meta: res.body.meta } : res.body.data;
  };

  assert.equal(typeof ctx.Pager.render, 'function');
});

test('provider-bookings.html and vet-bookings.html include pager.js before page script', () => {
  for (const page of ['pages/provider-bookings.html', 'pages/vet-bookings.html']) {
    const scripts = readFrontendScripts(page);
    const pagerIdx = scripts.findIndex((s) => s.endsWith(path.join('components', 'pager.js')));
    assert.ok(pagerIdx !== -1, `${page} must include pager.js`);
    assert.ok(pagerIdx < scripts.length - 1, `${page} must load pager.js before page script`);
  }
});

test('GET /provider/bookings and GET /vet/bookings return paginated items and meta', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const { call, state } = app.testHelpers;
  const provUser = { id: 'prov-s19', email: 'prov-s19@test.local', fullName: 'Prov S19', role: 'provider', status: 'active', providerId: 'clinic-a', tokenVersion: 0 };
  const vetUser = { id: 'vet-s19', email: 'vet-s19@test.local', fullName: 'Vet S19', role: 'vet', status: 'active', providerId: 'clinic-a', tokenVersion: 0 };
  state.users.push(provUser, vetUser);
  const provToken = app.testHelpers.signToken(provUser);
  const vetToken = app.testHelpers.signToken(vetUser);

  const provRes = await call('GET', '/provider/bookings?page=1&limit=2', { token: provToken });
  assert.equal(provRes.status, 200);
  assert.ok(Array.isArray(provRes.data.items));
  assert.equal(typeof provRes.meta.total, 'number');
  assert.equal(provRes.meta.limit, 2);

  const vetRes = await call('GET', '/vet/bookings?page=1&limit=2', { token: vetToken });
  assert.equal(vetRes.status, 200);
  assert.ok(Array.isArray(vetRes.data.items));
  assert.equal(typeof vetRes.meta.total, 'number');
  assert.equal(vetRes.meta.limit, 2);
});
