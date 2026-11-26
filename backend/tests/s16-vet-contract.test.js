'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { startTestApp } = require('./helpers/harness');

const vetBookingsJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/pages/vet-bookings.js'), 'utf8');
const vetBookingJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/pages/vet-booking.js'), 'utf8');
const headerJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/components/header.js'), 'utf8');
const landingJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/pages/landing.js'), 'utf8');

function createDom() {
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
      if (sel.startsWith('[name="')) {
        const name = sel.slice(7, -2);
        return getEl(name);
      }
      return null;
    }
    querySelectorAll() { return []; }
    closest() { return null; }
  }

  function getEl(id) {
    if (!els.has(id)) els.set(id, new El(id));
    return els.get(id);
  }

  const docListeners = new Map();
  const document = {
    documentElement: { dataset: {} },
    body: new El('body', 'BODY'),
    getElementById: getEl,
    querySelector: (s) => (s.startsWith('#') ? getEl(s.slice(1)) : null),
    querySelectorAll: () => [],
    addEventListener(t, fn) {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t).push(fn);
    },
    async fire(t, ev = {}) {
      for (const fn of docListeners.get(t) || []) await fn({ target: document.body, ...ev });
    }
  };
  return { document, getEl };
}

function runScript(code, extraCtx) {
  const ctx = vm.createContext({
    console,
    Intl,
    Date,
    URLSearchParams,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    ...extraCtx
  });
  ctx.window = ctx;
  vm.runInContext(code, ctx);
  return ctx;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

test('S16 static nav: header.js and landing.js expose vet-bookings.html for vet without mustChangePassword', () => {
  assert.match(headerJs, /user\.role === 'vet'/);
  assert.match(headerJs, /vet-bookings\.html/);
  assert.match(landingJs, /user\.role === 'vet' && !user\.mustChangePassword/);
  assert.match(landingJs, /pages\/vet-bookings\.html/);
});

test('S16 contract: vet-bookings.js & vet-booking.js with real app data', async () => {
  const { baseUrl, store, close } = await startTestApp({ rateLimit: { max: 500 } });
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
      name: 'Phòng khám Vet S16',
      area: 'Quận 1',
      status: 'active',
      isSample: false
    });
    store.users.push(
      { id: provUserId, email: 'prov-s16@example.com', passwordHash: hash, fullName: 'Quản lý S16', role: 'provider', status: 'active', providerId, mustChangePassword: false, tokenVersion: 0 },
      { id: vetId, email: 'vet-s16@example.com', passwordHash: hash, fullName: 'BS Thú Y S16', role: 'vet', status: 'active', providerId, mustChangePassword: false, tokenVersion: 0 },
      { id: custId, email: 'cust-s16@example.com', passwordHash: hash, fullName: 'Chủ Nuôi S16', role: 'customer', status: 'active', providerId: null, mustChangePassword: false, tokenVersion: 0 }
    );
    store.services.push({ id: serviceId, providerId, name: 'Khám tổng quát S16', priceVnd: 180000, isActive: true, slotCapacity: 3 });
    store.pets.push({ id: petId, ownerId: custId, name: 'Milo S16', species: 'dog', breed: 'Poodle', weightKg: 4.5, deletedAt: null });

    const login = async (email) => {
      const r = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Pass1234!' })
      });
      return (await r.json()).data.token;
    };

    const custToken = await login('cust-s16@example.com');
    const provToken = await login('prov-s16@example.com');
    const vetToken = await login('vet-s16@example.com');

    const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const createRes = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ petId, serviceId, date: futureDate, time: '10:00', notes: 'Bé ho nhẹ' })
    });
    const bookingId = (await createRes.json()).data.id;

    await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/confirm`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${provToken}` }
    });
    await fetch(`${baseUrl}/api/v1/bookings/${bookingId}/vet`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provToken}` },
      body: JSON.stringify({ vetId })
    });

    const apiFor = (token) => ({
      async get(p) {
        const r = await fetch(`${baseUrl}/api/v1${p}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        if (!r.ok) { const e = new Error(j.message); e.status = r.status; throw e; }
        return j.data;
      },
      async post(p, body) {
        const r = await fetch(`${baseUrl}/api/v1${p}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!r.ok) { const e = new Error(j.message); e.status = r.status; e.errors = j.errors; throw e; }
        return j.data;
      }
    });

    const Fmt = {
      esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      dateLong: (d) => String(d || ''),
      kg: (v) => `${v} kg`
    };
    const Panel = {
      async load(el, fn, render) {
        el.innerHTML = 'loading';
        const data = await fn();
        render(data);
        return data;
      }
    };

    // 1. Test vet-bookings.js
    const dom1 = createDom();
    const toasts1 = [];
    runScript(vetBookingsJs, {
      document: dom1.document,
      location: { search: '', replace() {} },
      AuthService: { requireRole: () => ({ id: vetId, role: 'vet', mustChangePassword: false }) },
      Api: apiFor(vetToken),
      Fmt,
      Panel,
      Toast: { show: (t) => toasts1.push(t) },
      BookingService: { STATUS: { confirmed: { label: 'Đã xác nhận', badge: 'badge-success' } } }
    });
    await dom1.document.fire('DOMContentLoaded');
    await flush();
    // Switch to "All" because booking is tomorrow
    await dom1.document.fire('click', { target: { closest: () => ({ dataset: { action: 'filter-all' } }) } });
    const listHtml = dom1.getEl('vetBookingsList').innerHTML;
    assert.match(listHtml, /Milo S16/);
    assert.match(listHtml, /Khám tổng quát S16/);
    assert.match(listHtml, /Chưa có bệnh án/);

    // 2. Test vet-booking.js (confirmed, no medical record yet -> shows form)
    const dom2 = createDom();
    const toasts2 = [];
    runScript(vetBookingJs, {
      document: dom2.document,
      location: { search: `?id=${bookingId}`, replace() {} },
      AuthService: { requireRole: () => ({ id: vetId, role: 'vet', mustChangePassword: false }) },
      Api: apiFor(vetToken),
      Fmt,
      Panel,
      Toast: { show: (t) => toasts2.push(t) },
      BookingService: { STATUS: { confirmed: { label: 'Đã xác nhận', badge: 'badge-success' } } }
    });
    await dom2.document.fire('DOMContentLoaded');
    await flush();
    const detailHtml1 = dom2.getEl('vetBookingRoot').innerHTML;
    assert.match(detailHtml1, /id="medicalRecordForm"/);
    assert.match(detailHtml1, /id="vaccinationForm"/);

    // 3. Test 404 not found
    const dom404 = createDom();
    runScript(vetBookingJs, {
      document: dom404.document,
      location: { search: `?id=${crypto.randomUUID()}`, replace() {} },
      AuthService: { requireRole: () => ({ id: vetId, role: 'vet', mustChangePassword: false }) },
      Api: apiFor(vetToken),
      Fmt,
      Panel,
      Toast: { show() {} },
      BookingService: { STATUS: {} }
    });
    await dom404.document.fire('DOMContentLoaded');
    await flush();
    assert.match(dom404.getEl('vetBookingRoot').innerHTML, /Không tìm thấy lịch/);

    // 4. Test petDeleted: true hides both forms
    const domDel = createDom();
    runScript(vetBookingJs, {
      document: domDel.document,
      location: { search: `?id=${bookingId}`, replace() {} },
      AuthService: { requireRole: () => ({ id: vetId, role: 'vet', mustChangePassword: false }) },
      Api: {
        get: async () => ({
          booking: { id: bookingId, status: 'confirmed', serviceName: 'Khám tổng quát S16', date: futureDate, time: '10:00' },
          pet: null,
          petDeleted: true,
          medicalRecords: [],
          vaccinations: [],
          weights: []
        })
      },
      Fmt,
      Panel,
      Toast: { show() {} },
      BookingService: { STATUS: { confirmed: { label: 'Đã xác nhận', badge: 'badge-success' } } }
    });
    await domDel.document.fire('DOMContentLoaded');
    await flush();
    const delHtml = domDel.getEl('vetBookingRoot').innerHTML;
    assert.match(delHtml, /Thú cưng đã bị xóa/);
    assert.doesNotMatch(delHtml, /id="medicalRecordForm"/);
    assert.doesNotMatch(delHtml, /id="vaccinationForm"/);
  } finally {
    await close();
  }
});
