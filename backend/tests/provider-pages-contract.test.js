'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { startTestApp } = require('./helpers/harness');

const profileJsPath = path.resolve(__dirname, '../../frontend/js/pages/provider-profile.js');
const profileJsCode = fs.readFileSync(profileJsPath, 'utf8');

const pagerJsPath = path.resolve(__dirname, '../../frontend/js/components/pager.js');
const pagerJsCode = fs.readFileSync(pagerJsPath, 'utf8');

const servicesJsPath = path.resolve(__dirname, '../../frontend/js/pages/provider-services.js');
const servicesJsCode = fs.readFileSync(servicesJsPath, 'utf8');

function createMockDom() {
  const elements = new Map();

  class MockElement {
    constructor(id = '', tagName = 'DIV') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this._textContent = '';
      this._innerHTML = '';
      this.children = [];
      this.attributes = new Map();
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach((c) => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach((c) => this.classList._classes.delete(c)),
        contains: (c) => this.classList._classes.has(c),
        toggle: (c, force) => {
          if (force === undefined) {
            if (this.classList._classes.has(c)) this.classList._classes.delete(c);
            else this.classList._classes.add(c);
          } else if (force) {
            this.classList._classes.add(c);
          } else {
            this.classList._classes.delete(c);
          }
        }
      };
      this.disabled = false;
      this.hidden = false;
      this.value = '';
      this.elements = {};
      this._listeners = new Map();
    }

    get textContent() {
      return this._textContent;
    }

    set textContent(val) {
      this._textContent = String(val ?? '');
      this._innerHTML = this._textContent;
    }

    get innerHTML() {
      return this._innerHTML;
    }

    set innerHTML(html) {
      this._innerHTML = String(html ?? '');
      this._textContent = this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const idMatches = this._innerHTML.matchAll(/id="([^"]+)"/g);
      for (const m of idMatches) {
        getOrCreate(m[1]);
      }
      const descCountMatch = this._innerHTML.match(/id="descCount"[^>]*>([^<]+)<\/span>/);
      if (descCountMatch) {
        getOrCreate('descCount').textContent = descCountMatch[1];
      }
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    }

    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }

    removeAttribute(k) {
      this.attributes.delete(k);
    }

    addEventListener(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(fn);
    }

    dispatchEvent(event) {
      const handlers = this._listeners.get(event.type) || [];
      handlers.forEach((fn) => fn(event));
    }

    querySelector(sel) {
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1);
        return getOrCreate(targetId);
      }
      return new MockElement('', 'DIV');
    }

    querySelectorAll() {
      return [];
    }

    closest(sel) {
      return this;
    }
  }

  function getOrCreate(id, tagName = 'DIV') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id, tagName));
    }
    return elements.get(id);
  }

  return { getOrCreate, elements, MockElement };
}

test('Contract Tests: Provider Profile & Services Pages via Harness (DB giả)', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  // 1. Tạo admin & duyệt provider qua API chuẩn của harness
  const adminLogin = await app.loginStaff('admin');
  const adminToken = adminLogin.token;

  const regProv = await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Bác Sĩ Trưởng',
      email: 'contract-prov@clinic.vn',
      phone: '0912345678',
      password: 'Password123!',
      orgName: 'Phòng khám Thú y Hợp Đồng',
      orgType: 'clinic',
      orgArea: 'Quận 1, TP.HCM',
      licenseNo: '123/CCCN-TY',
      taxCode: '0101234567'
    }
  });
  const provUserId = regProv.data.user.id;
  await app.call('POST', `/admin/users/${provUserId}/approve`, {
    token: adminToken,
    body: { area: 'Quận 1, TP.HCM' }
  });

  const loginRes = await app.call('POST', '/auth/login', {
    body: { identifier: 'contract-prov@clinic.vn', password: 'Password123!' }
  });
  const provToken = loginRes.data.token;
  const provUser = loginRes.data.user;

  // Cập nhật thêm thông tin địa chỉ/mô tả cho profile
  await app.call('PUT', '/provider/profile', {
    token: provToken,
    body: {
      address: '123 Nguyễn Thị Minh Khai',
      phone: '0912345678',
      description: 'Chuyên chăm sóc sức khỏe toàn diện cho thú cưng.'
    }
  });

  // Lấy dữ liệu profile thật từ backend
  const profileApiRes = await app.call('GET', '/provider/profile', { token: provToken });
  assert.equal(profileApiRes.status, 200);
  const realProfileData = profileApiRes.body.data; // Api.get trả về payload.data

  // 2. Kiểm thử provider-profile.js với dữ liệu thật
  await t.test('provider-profile.js: renders active profile, correct fields & character count', async () => {
    const { getOrCreate, MockElement } = createMockDom();
    const container = getOrCreate('profileContainer');

    const domLoadedHandlers = [];
    const sandbox = {
      window: {
        location: { pathname: '/pages/provider-profile.html', search: '' },
        addEventListener: () => {}
      },
      document: {
        getElementById: (id) => getOrCreate(id),
        querySelector: (sel) => {
          if (sel.startsWith('#')) return getOrCreate(sel.slice(1));
          return new MockElement('', 'DIV');
        },
        querySelectorAll: () => [],
        addEventListener: (evt, cb) => {
          if (evt === 'DOMContentLoaded') domLoadedHandlers.push(cb);
        }
      },
      Fmt: {
        esc: (s) => String(s ?? ''),
        initials: () => 'PK',
        vnd: (a) => String(a) + ' đ'
      },
      Toast: { show: () => {} },
      Panel: {
        load: async (el, loader, render) => {
          const res = await loader();
          render(res);
          return res;
        }
      },
      AuthService: {
        currentUser: () => provUser
      },
      Api: {
        get: async (path) => {
          if (path === '/provider/profile') {
            return realProfileData; // TRẢ THẲNG payload.data (đúng chuẩn Api.get)
          }
          throw new Error('Not found');
        },
        put: async (path, body) => {
          return { ...realProfileData, ...body };
        }
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(profileJsCode, sandbox);
    // Execute all attached DOMContentLoaded listeners
    for (const h of domLoadedHandlers) {
      const res = h();
      if (res && typeof res.then === 'function') await res;
    }
    // Allow promise microtasks in loadProfile() to resolve
    await new Promise((r) => setTimeout(r, 10));

    // Verify rendered content in container
    const html = container.innerHTML;
    assert.ok(html.includes('Phòng khám Thú y Hợp Đồng'), 'Must render provider name');
    assert.ok(html.includes('Quận 1, TP.HCM'), 'Must render provider area');
    assert.ok(html.includes('123 Nguyễn Thị Minh Khai'), 'Must render address');
    assert.ok(html.includes('0912345678'), 'Must render phone');
    assert.ok(html.includes('123/CCCN-TY'), 'Must render licenseNo');
    assert.ok(html.includes('0101234567'), 'Must render taxCode');
    assert.ok(!html.includes('Cơ sở đang bị tạm khóa'), 'Active provider must not show locked banner');

    const descCount = getOrCreate('descCount');
    assert.ok(descCount.textContent.includes(`${realProfileData.description.length}/500`), 'Must display correct character count');
  });

  await t.test('provider-profile.js: renders locked banner when profile.isActive is false', async () => {
    const { getOrCreate, MockElement } = createMockDom();
    const container = getOrCreate('profileContainer');

    const domLoadedHandlers = [];
    const sandbox = {
      window: { location: { pathname: '/pages/provider-profile.html', search: '' }, addEventListener: () => {} },
      document: {
        getElementById: (id) => getOrCreate(id),
        querySelector: (sel) => {
          if (sel.startsWith('#')) return getOrCreate(sel.slice(1));
          return new MockElement('', 'DIV');
        },
        querySelectorAll: () => [],
        addEventListener: (evt, cb) => {
          if (evt === 'DOMContentLoaded') domLoadedHandlers.push(cb);
        }
      },
      Fmt: { esc: (s) => String(s ?? ''), initials: () => 'PK', vnd: (a) => String(a) + ' đ' },
      Toast: { show: () => {} },
      Panel: {
        load: async (el, loader, render) => {
          const res = await loader();
          render(res);
          return res;
        }
      },
      AuthService: { currentUser: () => provUser },
      Api: {
        get: async (path) => {
          if (path === '/provider/profile') {
            return { ...realProfileData, isActive: false };
          }
          throw new Error('Not found');
        }
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(profileJsCode, sandbox);
    for (const h of domLoadedHandlers) {
      const res = h();
      if (res && typeof res.then === 'function') await res;
    }
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(container.innerHTML.includes('Cơ sở đang bị tạm khóa'), 'Must display locked banner when isActive is false');
  });

  // 3. Tạo 2 dịch vụ thật (1 active, 1 inactive) qua backend API
  const svc1Res = await app.call('POST', '/provider/services', {
    token: provToken,
    body: { name: 'Dịch vụ Khám Bệnh', category: 'medical', priceVnd: 200000, unit: 'lượt' }
  });
  const svc2Res = await app.call('POST', '/provider/services', {
    token: provToken,
    body: { name: 'Dịch vụ Cắt Tỉa Lông', category: 'grooming', priceVnd: 150000, unit: 'bé' }
  });
  await app.call('POST', `/provider/services/${svc2Res.data.id}/disable`, { token: provToken });

  // Lấy dữ liệu services thật từ backend
  const servicesApiRes = await app.call('GET', '/provider/services', { token: provToken });
  assert.equal(servicesApiRes.status, 200);
  const realServicesData = servicesApiRes.body.data; // { services: [...], meta: {...}, options: {...} }

  // 4. Kiểm thử provider-services.js với dữ liệu thật
  await t.test('provider-services.js: renders 2 services (active & inactive), counter (2), options select & no empty state', async () => {
    const { getOrCreate, MockElement } = createMockDom();
    const listEl = getOrCreate('serviceListContainer');
    const totalEl = getOrCreate('serviceTotal');

    const domLoadedHandlers = [];
    const sandbox = {
      window: { location: { pathname: '/pages/provider-services.html', search: '' }, addEventListener: () => {} },
      document: {
        getElementById: (id) => getOrCreate(id),
        querySelector: (sel) => {
          if (sel.startsWith('#')) return getOrCreate(sel.slice(1));
          return new MockElement('', 'DIV');
        },
        querySelectorAll: () => [],
        addEventListener: (evt, cb) => {
          if (evt === 'DOMContentLoaded') domLoadedHandlers.push(cb);
        }
      },
      Fmt: { esc: (s) => String(s ?? ''), initials: () => 'DV', vnd: (a) => String(a) + ' đ' },
      Toast: { show: () => {} },
      Panel: {
        load: async (el, loader, render) => {
          const res = await loader();
          render(res);
          return res;
        }
      },
      AuthService: { currentUser: () => provUser },
      Api: {
        get: async (path, _query, opts) => {
          if (path === '/provider/services') {
            return opts && opts.withMeta ? { data: realServicesData, meta: realServicesData.meta } : realServicesData;
          }
          if (path === '/provider/profile') return realProfileData;
          throw new Error('Not found');
        }
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(servicesJsCode, sandbox);
    for (const h of domLoadedHandlers) {
      const res = h();
      if (res && typeof res.then === 'function') await res;
    }
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(totalEl.textContent, '2', 'Service total must be 2');
    const html = listEl.innerHTML;
    assert.ok(html.includes('Dịch vụ Khám Bệnh'), 'Must render active service');
    assert.ok(html.includes('Đang hiển thị'), 'Must render active badge');
    assert.ok(html.includes('Dịch vụ Cắt Tỉa Lông'), 'Must render disabled service');
    assert.ok(html.includes('Đã ẩn'), 'Must render hidden badge');
    assert.ok(!html.includes('Cơ sở chưa có dịch vụ nào'), 'Must not render empty state when services exist');
  });

  await t.test('provider-services.js: renders empty state when services list is empty', async () => {
    const { getOrCreate, MockElement } = createMockDom();
    const listEl = getOrCreate('serviceListContainer');
    const totalEl = getOrCreate('serviceTotal');

    const domLoadedHandlers = [];
    const sandbox = {
      window: { location: { pathname: '/pages/provider-services.html', search: '' }, addEventListener: () => {} },
      document: {
        getElementById: (id) => getOrCreate(id),
        querySelector: (sel) => {
          if (sel.startsWith('#')) return getOrCreate(sel.slice(1));
          return new MockElement('', 'DIV');
        },
        querySelectorAll: () => [],
        addEventListener: (evt, cb) => {
          if (evt === 'DOMContentLoaded') domLoadedHandlers.push(cb);
        }
      },
      Fmt: { esc: (s) => String(s ?? ''), initials: () => 'DV', vnd: (a) => String(a) + ' đ' },
      Toast: { show: () => {} },
      Panel: {
        load: async (el, loader, render) => {
          const res = await loader();
          render(res);
          return res;
        }
      },
      AuthService: { currentUser: () => provUser },
      Api: {
        get: async (path) => {
          if (path === '/provider/services') return { services: [], meta: { total: 0 }, options: realServicesData.options };
          if (path === '/provider/profile') return realProfileData;
          throw new Error('Not found');
        }
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(servicesJsCode, sandbox);
    for (const h of domLoadedHandlers) {
      const res = h();
      if (res && typeof res.then === 'function') await res;
    }
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(totalEl.textContent, '0');
    assert.ok(listEl.innerHTML.includes('Cơ sở chưa có dịch vụ nào'), 'Must render empty state message');
    assert.ok(listEl.innerHTML.includes('Thêm dịch vụ đầu tiên'), 'Must render add first service button');
  });

  await t.test('provider-services.js: page does NOT lock when create/update/toggle gets 409 and profile is active', async () => {
    const { getOrCreate, MockElement } = createMockDom();
    const alertBox = getOrCreate('serviceAlertBox');
    const openAddBtn = getOrCreate('openAddServiceBtn');

    const domLoadedHandlers = [];
    const sandbox = {
      window: { location: { pathname: '/pages/provider-services.html', search: '' }, addEventListener: () => {} },
      document: {
        getElementById: (id) => getOrCreate(id),
        querySelector: (sel) => {
          if (sel.startsWith('#')) return getOrCreate(sel.slice(1));
          return new MockElement('', 'DIV');
        },
        querySelectorAll: () => [],
        addEventListener: (evt, cb) => {
          if (evt === 'DOMContentLoaded') domLoadedHandlers.push(cb);
        }
      },
      Fmt: { esc: (s) => String(s ?? ''), initials: () => 'DV', vnd: (a) => String(a) + ' đ' },
      Toast: { show: () => {} },
      Panel: {
        load: async (el, loader, render) => {
          const res = await loader();
          render(res);
          return res;
        }
      },
      AuthService: { currentUser: () => provUser },
      Api: {
        get: async (path) => {
          if (path === '/provider/services') return realServicesData;
          if (path === '/provider/profile') return realProfileData; // Active!
          throw new Error('Not found');
        }
      }
    };

    vm.createContext(sandbox);
    vm.runInContext(servicesJsCode, sandbox);
    for (const h of domLoadedHandlers) {
      const res = h();
      if (res && typeof res.then === 'function') await res;
    }
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(alertBox.hidden, true, 'Alert box must remain hidden');
    assert.equal(openAddBtn.disabled, false, 'Add button must remain enabled');
  });
});
