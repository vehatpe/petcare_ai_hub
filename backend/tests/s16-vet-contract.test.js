'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { startTestApp } = require('./helpers/harness');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const PAGES_DIR = path.join(FRONTEND_DIR, 'pages');

function extractPageScripts(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const dir = path.dirname(htmlFile);
  const out = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('//') || src.includes('motion')) continue;
    out.push(path.resolve(dir, src.split('?')[0]));
  }
  return out;
}

function createDom(bodyAuth = 'vet') {
  const els = new Map();
  class El {
    constructor(id = '', tag = 'DIV') {
      this.id = id;
      this.tagName = tag.toUpperCase();
      this._html = '';
      this._text = '';
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.dataset = {};
      this.attrs = new Map();
      this._listeners = new Map();
      this.children = [];
      this.style = {};
      this.classList = {
        _s: new Set(),
        add: (...c) => c.forEach((x) => this.classList._s.add(x)),
        remove: (...c) => c.forEach((x) => this.classList._s.delete(x)),
        toggle: (c, f) => (f ? this.classList._s.add(c) : this.classList._s.delete(c)),
        contains: (c) => this.classList._s.has(c)
      };
    }
    set innerHTML(v) { this._html = String(v ?? ''); }
    get innerHTML() { return this._html; }
    set textContent(v) { this._text = String(v ?? ''); this._html = this._text; }
    get textContent() { return this._text; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    appendChild(c) { this.children.push(c); return c; }
    remove() {}
    focus() {}
    addEventListener(t, fn) {
      if (!this._listeners.has(t)) this._listeners.set(t, []);
      this._listeners.get(t).push(fn);
    }
    async dispatch(t, ev = {}) {
      const list = this._listeners.get(t) || [];
      for (const fn of list) await fn({ preventDefault() {}, target: this, ...ev });
    }
    querySelector(sel) {
      if (sel.startsWith('#')) return getEl(sel.slice(1));
      if (sel.startsWith('[name="')) return getEl(sel.slice(7, -2));
      return null;
    }
    querySelectorAll() { return []; }
    closest() { return null; }
  }

  function getEl(id) {
    if (!els.has(id)) els.set(id, new El(id));
    return els.get(id);
  }

  const body = new El('body', 'BODY');
  body.dataset.pageAuth = bodyAuth;
  const docListeners = new Map();
  const document = {
    documentElement: { dataset: {}, classList: body.classList },
    body,
    readyState: 'loading',
    createElement: (tag) => new El('', tag),
    getElementById: getEl,
    querySelector: (s) => (s.startsWith('#') ? getEl(s.slice(1)) : null),
    querySelectorAll: () => [],
    addEventListener(t, fn) {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t).push(fn);
    },
    async fire(t, ev = {}) {
      for (const fn of docListeners.get(t) || []) await fn({ target: body, ...ev });
    }
  };
  return { document, getEl };
}

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

function runHtmlScripts(htmlPath, { dom, storage, locationSearch = '', fetchImpl }) {
  const scripts = extractPageScripts(htmlPath);
  const location = {
    hostname: 'localhost',
    protocol: 'http:',
    port: '3000',
    pathname: `/pages/${path.basename(htmlPath)}`,
    search: locationSearch,
    href: `http://localhost:3000/pages/${path.basename(htmlPath)}${locationSearch}`,
    replace() {}
  };
  const winListeners = new Map();
  const ctx = vm.createContext({
    console,
    Intl,
    Date,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    document: dom.document,
    localStorage: storage,
    sessionStorage: storage,
    location,
    history: { replaceState() {}, pushState() {} },
    navigator: { userAgent: 'node-vm' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    scrollTo() {},
    addEventListener(t, fn) {
      if (!winListeners.has(t)) winListeners.set(t, []);
      winListeners.get(t).push(fn);
    },
    removeEventListener(t, fn) {
      const list = winListeners.get(t);
      if (list) winListeners.set(t, list.filter((f) => f !== fn));
    },
    dispatchEvent(ev) {
      const list = winListeners.get(ev?.type) || [];
      list.forEach((fn) => fn(ev));
      return true;
    },
    fetch: fetchImpl
  });
  ctx.window = ctx;
  ctx.self = ctx;
  for (const scriptPath of scripts) {
    const code = fs.readFileSync(scriptPath, 'utf8');
    vm.runInContext(code, ctx, { filename: scriptPath });
  }
  return ctx;
}

const flush = () => new Promise((r) => setTimeout(r, 30));

test('S16.1 contract: real HTML script chain for vet-bookings.js & vet-booking.js', async () => {
  const app = await startTestApp({ rateLimit: { max: 500 } });
  const { call, close, testHelpers: { state: store } } = app;
  try {
    const providerId = crypto.randomUUID();
    const provUserId = crypto.randomUUID();
    const vetId = crypto.randomUUID();
    const custId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    const petId = crypto.randomUUID();
    const hash = bcrypt.hashSync('Pass1234!', 4);

    store.providers.push({
      id: providerId,
      name: 'Phòng khám Vet S16.1',
      area: 'Quận 1',
      status: 'active',
      isActive: true,
      isSample: false
    });
    store.users.push(
      { id: provUserId, email: 'prov-s161@example.com', passwordHash: hash, fullName: 'Quản lý S16.1', role: 'provider', status: 'active', providerId, mustChangePassword: false, tokenVersion: 0 },
      { id: vetId, email: 'vet-s161@example.com', passwordHash: hash, fullName: 'BS Thú Y S16.1', role: 'vet', status: 'active', providerId, mustChangePassword: false, tokenVersion: 0 },
      { id: custId, email: 'cust-s161@example.com', passwordHash: hash, fullName: 'Nguyễn Văn Chủ', role: 'customer', status: 'active', providerId: null, mustChangePassword: false, tokenVersion: 0 }
    );
    store.services.push({ id: serviceId, providerId, category: 'medical', name: 'Khám tổng quát S16.1', priceVnd: 180000, isActive: true, slotCapacity: 3 });
    store.pets.push({ id: petId, ownerId: custId, name: 'Milo S16.1', species: 'dog', breed: 'Poodle', weightKg: 4.5, deletedAt: null });

    const login = async (identifier) => {
      const r = await call('POST', '/auth/login', { body: { identifier, password: 'Pass1234!' } });
      assert.equal(r.status, 200, `Login failed for ${identifier}: ${r.message}`);
      return r.data;
    };

    const custAuth = await login('cust-s161@example.com');
    const provAuth = await login('prov-s161@example.com');
    const vetAuth = await login('vet-s161@example.com');

    const wRes = await call('POST', `/pets/${petId}/weights`, {
      token: custAuth.token,
      body: { weightKg: 4.5 }
    });
    assert.equal(wRes.status, 201, `Create weight failed: ${wRes.message}`);

    const futureDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(Date.now() + 86400000));

    const createRes = await call('POST', '/bookings', {
      token: custAuth.token,
      body: { petId, serviceId, date: futureDate, time: '14:00', notes: 'Bé ho nhẹ' }
    });
    assert.equal(createRes.status, 201, `Create booking failed: ${createRes.message}`);
    const bookingId = createRes.data.id;

    const confirmRes = await call('PATCH', `/bookings/${bookingId}/confirm`, { token: provAuth.token });
    assert.equal(confirmRes.status, 200, `Confirm failed: ${confirmRes.message}`);
    const vetRes = await call('PATCH', `/bookings/${bookingId}/vet`, { token: provAuth.token, body: { vetId } });
    assert.equal(vetRes.status, 200, `Assign vet failed: ${vetRes.message}`);

    const requestedUrls = [];
    const makeFetch = (tokenOverride) => async (url, opts = {}) => {
      requestedUrls.push(String(url));
      const idx = String(url).indexOf('/api/v1');
      const apiPath = idx >= 0 ? String(url).slice(idx + 7) : String(url);
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const r = await call(method, apiPath, { token: tokenOverride || vetAuth.token, body });
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: () => 'application/json' },
        json: async () => r.body
      };
    };

    const vetStorage = () => createStorage({
      petcare_token: vetAuth.token,
      petcare_user: JSON.stringify(vetAuth.user)
    });

    // 1. vet-bookings.html real scripts
    const dom1 = createDom('vet');
    runHtmlScripts(path.join(PAGES_DIR, 'vet-bookings.html'), {
      dom: dom1,
      storage: vetStorage(),
      fetchImpl: makeFetch()
    });
    await dom1.document.fire('DOMContentLoaded');
    await flush();

    // Switch to "All" so tomorrow's booking is included
    await dom1.document.fire('click', { target: { closest: () => ({ dataset: { action: 'filter-all' } }) } });
    await flush();

    const listHtml = dom1.getEl('vetBookingsList').innerHTML;
    assert.match(listHtml, /Milo S16\.1/);
    assert.match(listHtml, /Khám tổng quát S16\.1/);
    assert.match(listHtml, /Nguyễn Văn Chủ/);
    assert.match(listHtml, /Chưa có bệnh án/);
    assert.ok(requestedUrls.some((u) => u.includes('/vet/bookings?from=') && u.includes('to=')));

    // 2. vet-booking.html real scripts (confirmed, no medical record yet)
    const dom2 = createDom('vet');
    runHtmlScripts(path.join(PAGES_DIR, 'vet-booking.html'), {
      dom: dom2,
      storage: vetStorage(),
      locationSearch: `?id=${bookingId}`,
      fetchImpl: makeFetch()
    });
    await dom2.document.fire('DOMContentLoaded');
    await flush();

    const detailHtml = dom2.getEl('vetBookingRoot').innerHTML;
    assert.match(detailHtml, /id="medicalRecordForm"/);
    assert.match(detailHtml, /id="vaccinationForm"/);
    assert.match(detailHtml, /4[.,]5\s*kg/);
  } finally {
    await close();
  }
});
