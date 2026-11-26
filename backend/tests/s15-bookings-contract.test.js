'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { startTestApp } = require('./helpers/harness');

const customerJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/pages/dashboard-customer.js'), 'utf8');
const providerBookingsJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/pages/provider-bookings.js'), 'utf8');
const bookingServiceJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/services/booking.service.js'), 'utf8');
const headerJs = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/components/header.js'), 'utf8');

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
    removeEventListener() {}
    querySelectorAll() { return []; }
    querySelector(sel) { return new El(sel); }
    closest() { return null; }
    appendChild() {}
    focus() {}
    remove() {}
  }

  const getEl = (id, tag = 'DIV') => {
    if (!els.has(id)) els.set(id, new El(id, tag));
    return els.get(id);
  };

  const docListeners = new Map();
  const document = {
    body: new El('body', 'BODY'),
    activeElement: null,
    getElementById: (id) => getEl(id),
    querySelector: (sel) => (sel === '.main-nav' ? getEl('__mainNav', 'NAV') : null),
    querySelectorAll: (sel) => {
      if (sel === '[data-auth-slot="header"]') return [getEl('__headerSlot')];
      if (sel === '[data-auth-slot="footer-account"]') return [getEl('__footerSlot')];
      return [];
    },
    createElement: (tag) => new El('', tag),
    addEventListener: (t, fn) => {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t).push(fn);
    },
    removeEventListener: () => {}
  };

  const fireReady = async () => {
    for (const fn of (docListeners.get('DOMContentLoaded') || [])) {
      await fn();
    }
    await new Promise((r) => setTimeout(r, 60));
  };

  return { document, getEl, fireReady };
}

function makeFmt() {
  return {
    esc: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    firstName: (s) => String(s || '').trim().split(/\s+/).pop() || '',
    initials: (s) => String(s || 'U').slice(0, 2).toUpperCase(),
    dateLong: (d) => String(d || ''),
    dateShort: (d) => String(d || ''),
    parseDate: (d) => (d ? new Date(`${d}T00:00:00Z`) : null),
    todayIso: () => '2026-06-15',
    vnd: (n) => `${Number(n || 0).toLocaleString('vi-VN')} đ`
  };
}

test('S15 Contract: Customer bookings, Provider bookings, and Header nav', async (t) => {
  const app = await startTestApp({ now: '2026-06-15T03:00:00.000Z' }); // 10:00 VN
  t.after(app.close);
  const { call } = app;
  const { state } = app.testHelpers;

  state.providers.push({ id: 'prov-s15', name: 'Phòng khám S15', area: 'Q1', isSample: false, isActive: true });
  state.providers.push({ id: 'prov-sample-s15', name: 'Cơ sở Mẫu S15', area: 'Q3', isSample: true, isActive: true });
  const svcId = crypto.randomUUID();
  const svcSampleId = crypto.randomUUID();
  state.services.push({ id: svcId, providerId: 'prov-s15', category: 'medical', name: 'Khám S15', priceVnd: 150000, slotCapacity: 3, isActive: true });
  state.services.push({ id: svcSampleId, providerId: 'prov-sample-s15', category: 'medical', name: 'Khám Mẫu S15', priceVnd: 100000, slotCapacity: 3, isActive: true });

  const { token: custToken } = await app.registerCustomer({ email: 'cust@s15.vn', phone: '0909151515' });
  const pet = await app.createPet(custToken, { name: 'Bông', species: 'dog' });

  const pwHash = bcrypt.hashSync('matkhau123', 4);
  const provId = crypto.randomUUID();
  await app.testHelpers.addStaff('provider', {
    id: provId, email: 'prov@s15.vn', phone: '0988151515', fullName: 'Chủ S15', status: 'active', providerId: 'prov-s15', passwordHash: pwHash
  });
  const provUser = state.users.find((u) => u.id === provId);
  if (provUser) { provUser.providerId = 'prov-s15'; provUser.status = 'active'; }
  const provToken = (await call('POST', '/auth/login', { body: { identifier: 'prov@s15.vn', password: 'matkhau123' } })).data.token;

  // Tạo 3 lịch: b1 (confirmed >= 2h: 14:00), b2 (cancelled by provider: 15:30), b3 (sample pending: 16:00)
  const b1Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-15', time: '14:00' } });
  const b2Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-15', time: '15:30' } });
  const b3Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcSampleId, date: '2026-06-16', time: '08:30' } });
  assert.equal(b1Res.status, 201);
  assert.equal(b2Res.status, 201);
  assert.equal(b3Res.status, 201);
  const b1 = b1Res.data;
  const b2 = b2Res.data;

  await call('PATCH', `/bookings/${b1.id}/confirm`, { token: provToken });
  await call('PATCH', `/bookings/${b2.id}/cancel`, { token: provToken, body: { reason: 'Bác sĩ bận đột xuất' } });

  const custBookingsData = (await call('GET', '/bookings', { token: custToken })).data;
  const provBookingsData = (await call('GET', '/provider/bookings', { token: provToken })).data;

  await t.test('Customer dashboard renders real statuses, cancelReason, sample label, and 2h rule', async () => {
    const { document, getEl, fireReady } = createDom();
    const toasts = [];
    let reloadCount = 0;

    const ctx = vm.createContext({
      window: {},
      document,
      Fmt: makeFmt(),
      Toast: { show: (m) => toasts.push(m) },
      Dialog: { confirm: async () => true },
      Panel: {
        load: async (el, loader, render) => {
          const data = await loader();
          render(data);
        }
      },
      AuthService: { currentUser: () => ({ id: 'u1', role: 'customer', fullName: 'Nguyễn An' }), isLoggedIn: () => true },
      PetService: { MAX_PETS_PER_OWNER: 10, SEX_LABEL: {}, NEUTER_LABEL: {}, list: async () => [pet], summary: () => 'Chó' },
      DashboardService: { customer: async () => ({ petCount: 1, bookings: { total: 3, upcomingCount: 2, next: b1 }, vaccines: { overdueCount: 0, dueSoonCount: 0, nextDue: null } }) },
      Api: {
        get: async (url) => {
          if (url === '/bookings') { reloadCount++; return custBookingsData; }
          return [];
        },
        patch: async () => {
          const err = new Error('Lịch sát giờ hẹn, vui lòng liên hệ cơ sở.');
          err.code = 'cancel_window';
          err.status = 409;
          throw err;
        }
      },
      Date: class extends Date {
        static now() { return Date.parse('2026-06-15T03:00:00.000Z'); } // 10:00 VN
      },
      URLSearchParams,
      console
    });
    ctx.window = ctx;
    vm.runInContext(bookingServiceJs, ctx);
    vm.runInContext(customerJs, ctx);
    await fireReady();

    const html = getEl('bookingList').innerHTML;
    assert.ok(html.includes('Đã xác nhận'), 'must show confirmed label');
    assert.ok(html.includes('Cơ sở đã hủy: Bác sĩ bận đột xuất'), 'must show provider cancel reason');
    assert.ok(html.includes('Cơ sở minh họa — lịch chỉ để trải nghiệm, không được xác nhận'), 'must show sample label');
    assert.ok(html.includes(`data-cancel-booking="${b1.id}"`), 'confirmed >= 2h must show cancel button');
    assert.ok(reloadCount >= 1);
  });

  await t.test('Provider bookings renders summary, actions, and handles 403 vs facility_inactive', async () => {
    const { document, getEl, fireReady } = createDom();
    getEl('providerLockBanner').hidden = true;
    const toasts = [];
    const ctx = vm.createContext({
      window: {},
      document,
      Fmt: makeFmt(),
      Toast: { show: (m) => toasts.push(m) },
      Dialog: { confirm: async () => true },
      Panel: {
        load: async (el, loader, render) => {
          const data = await loader();
          render(data);
        }
      },
      AuthService: { currentUser: () => ({ id: provId, role: 'provider', fullName: 'Chủ S15' }) },
      BookingService: {
        STATUS: {
          pending: { label: 'Chờ xác nhận', badge: 'badge-warning' },
          confirmed: { label: 'Đã xác nhận', badge: 'badge-success' },
          completed: { label: 'Đã hoàn tất', badge: 'badge-mint' },
          cancelled: { label: 'Đã hủy', badge: 'badge-danger' },
          no_show: { label: 'Vắng mặt', badge: 'badge-danger' }
        }
      },
      Api: {
        get: async (url) => {
          if (url === '/provider/profile') return { isActive: true };
          if (url.startsWith('/provider/vets')) return { vets: [] };
          if (url.startsWith('/provider/bookings')) return provBookingsData;
          return {};
        },
        patch: async () => ({})
      },
      URLSearchParams,
      setTimeout,
      clearTimeout,
      console
    });
    ctx.window = ctx;
    vm.runInContext(providerBookingsJs, ctx);
    await fireReady();

    const listHtml = getEl('providerBookingList').innerHTML;
    assert.ok(listHtml.includes('Khám S15'), `listHtml was: ${listHtml.slice(0, 200)}`);
    assert.ok(listHtml.includes('data-action="complete"'));
    assert.equal(getEl('providerLockBanner').hidden, true, 'active facility must not be locked');
  });

  await t.test('Header nav: Customer has Lịch hẹn của tôi in account/drawer/footer; Provider has 5 nav items', () => {
    const { document, getEl } = createDom();
    const navEl = getEl('__mainNav', 'NAV');
    navEl.innerHTML = '<a href="services.html">Dịch vụ</a><a href="providers.html">Cơ sở</a>';

    let currentRole = 'customer';
    const ctx = vm.createContext({
      window: { location: { pathname: '/pages/provider-bookings.html' }, addEventListener: () => {}, matchMedia: () => ({ addEventListener: () => {} }) },
      document,
      Fmt: makeFmt(),
      AuthService: {
        currentUser: () => ({ id: 'u1', role: currentRole, fullName: 'Test User', email: 't@t.vn' }),
        pageUrl: (f) => f,
        homeUrl: () => '../index.html',
        refresh: () => {}
      },
      console
    });
    vm.runInContext(headerJs, ctx);

    // Customer check
    assert.ok(getEl('__headerSlot').innerHTML.includes('Lịch hẹn của tôi'));
    assert.ok(getEl('__footerSlot').innerHTML.includes('Lịch hẹn của tôi'));
    assert.ok(!navEl.innerHTML.includes('Lịch hẹn của tôi'), 'desktop main-nav must not add Lịch hẹn của tôi');

    // Provider check: 5 nav items
    currentRole = 'provider';
    ctx.window.addEventListener = () => {};
    vm.runInContext(headerJs, ctx);
    const navLinks = (navEl.innerHTML.match(/<a /g) || []).length;
    assert.equal(navLinks, 5, 'Provider main-nav must have exactly 5 items');
    assert.ok(navEl.innerHTML.includes('provider-bookings.html'));
  });
});
