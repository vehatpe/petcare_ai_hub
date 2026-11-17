'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const landingJsPath = path.resolve(__dirname, '../../frontend/js/pages/landing.js');
const landingJsCode = fs.readFileSync(landingJsPath, 'utf8');

function createSimpleDom() {
  const elements = new Map();

  class MockElement {
    constructor(id = '', tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this._textContent = '';
      this._innerHTML = '';
      this.children = [];
      this.attributes = new Map();
      this.hidden = false;
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
      // Very simple parser for testing data-action and text content
      this._textContent = this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

    querySelector(sel) {
      if (sel === '[data-action="reload-profile"]') {
        if (this._innerHTML.includes('data-action="reload-profile"')) {
          return new MockElement('', 'button');
        }
      }
      return null;
    }
  }

  function getOrCreate(id) {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id));
    }
    return elements.get(id);
  }

  // Pre-seed known landing page element IDs
  const knownIds = [
    'heroTitle', 'heroSub', 'heroActions', 'pcardContent',
    'pcardTag', 'pcardAvatar', 'pcardName', 'pcardSpecs',
    'pcardFacts', 'pcardWeight', 'pcardVax', 'pcardBooking',
    'pcardCta', 'ctaBannerTitle', 'ctaBannerSub', 'ctaBannerActions',
    'landingLedger', 'landingSampleNote'
  ];
  for (const id of knownIds) {
    getOrCreate(id);
  }

  return {
    getElementById: (id) => getOrCreate(id),
    getOrCreate,
    elements
  };
}

function setupTestEnvironment({ currentUser = null, petListImpl = async () => [] } = {}) {
  const dom = createSimpleDom();
  const listeners = new Map();
  const docListeners = new Map();

  let activeUser = currentUser;

  const AuthService = {
    currentUser: () => activeUser,
    isLoggedIn: () => Boolean(activeUser)
  };

  const Fmt = {
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    firstName: (fullName) => {
      const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    },
    todayIso: () => '2026-11-17',
    dateShort: (d) => d,
    vnd: (n) => `${n} đ`,
    kg: (k) => `${k} kg`
  };

  let listCallCount = 0;
  const PetService = {
    summary: (p) => `${p.species || 'Chó'} · ${p.breed || 'Poodle'}`,
    list: async () => {
      listCallCount++;
      return petListImpl();
    }
  };

  const HealthService = {
    get: async () => ({ vaccineSummary: { total: 0, upToDate: 0, overdue: 0, dueSoon: 0 } })
  };

  const BookingService = {
    list: async () => []
  };

  const Catalog = {
    services: async () => [],
    sampleNotice: () => ''
  };

  const Panel = {
    load: async (el, loader, render) => {
      try {
        const d = await loader();
        render(d);
      } catch (_) {}
    }
  };

  const windowObj = {
    addEventListener: (type, cb) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(cb);
    },
    dispatchEvent: (ev) => {
      const handlers = listeners.get(ev.type) || [];
      for (const h of handlers) h(ev);
    }
  };

  const documentElement = {
    dataset: {}
  };

  const documentObj = {
    documentElement,
    getElementById: (id) => dom.getElementById(id),
    addEventListener: (type, cb) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(cb);
    },
    dispatchEvent: (ev) => {
      const handlers = docListeners.get(ev.type) || [];
      for (const h of handlers) h(ev);
    }
  };

  const context = {
    window: windowObj,
    document: documentObj,
    AuthService,
    PetService,
    HealthService,
    BookingService,
    Catalog,
    Panel,
    Fmt,
    console
  };

  vm.createContext(context);
  vm.runInContext(landingJsCode, context);

  return {
    dom,
    documentElement,
    context,
    AuthService,
    PetService,
    getListCallCount: () => listCallCount,
    setUser: (u) => { activeUser = u; },
    triggerDomContentLoaded: () => {
      const dclHandlers = docListeners.get('DOMContentLoaded') || [];
      for (const h of dclHandlers) h();
    },
    triggerAuthChanged: () => {
      const authHandlers = listeners.get('petcare:auth-changed') || [];
      for (const h of authHandlers) h();
    },
    clickReloadProfile: () => {
      const clickHandlers = docListeners.get('click') || [];
      let defaultPrevented = false;
      const fakeEvent = {
        target: {
          closest: (sel) => (sel === '[data-action="reload-profile"]' ? {} : null)
        },
        preventDefault: () => { defaultPrevented = true; }
      };
      for (const h of clickHandlers) h(fakeEvent);
      return defaultPrevented;
    }
  };
}

test('Landing page states: loading, error, empty, with pets', async (t) => {
  await t.test('Guest sees guest hero and guest profile card structure', () => {
    const env = setupTestEnvironment({ currentUser: null });
    env.triggerDomContentLoaded();

    const heroTitle = env.dom.getElementById('heroTitle').textContent;
    assert.match(heroTitle, /Hồ sơ sức khỏe, lịch hẹn và Trợ lý AI cho từng bé/);
    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.match(pcardHtml, /Cấu trúc hồ sơ, chưa có dữ liệu/);
  });

  await t.test('Customer loading state: shows skeleton/loading, does NOT show guest content', async () => {
    let resolveList;
    const pendingPromise = new Promise((resolve) => {
      resolveList = resolve;
    });

    const user = { fullName: 'Nguyễn Văn An', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: () => pendingPromise
    });

    env.triggerDomContentLoaded();

    // While awaiting petListImpl:
    const heroTitle = env.dom.getElementById('heroTitle').textContent;
    assert.equal(heroTitle, 'Xin chào, An.');
    const heroSub = env.dom.getElementById('heroSub').textContent;
    assert.match(heroSub, /Đang tải thông tin/);
    const heroActions = env.dom.getElementById('heroActions').innerHTML;
    assert.doesNotMatch(heroActions, /Tạo hồ sơ cho bé/);
    assert.match(heroActions, /Mở bảng điều khiển/);

    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.doesNotMatch(pcardHtml, /Cấu trúc hồ sơ, chưa có dữ liệu/);
    assert.match(pcardHtml, /Đang tải/);

    // Resolve promise to clean up
    resolveList([]);
    await pendingPromise;
  });

  await t.test('Customer error state: shows reload button, does NOT say "chưa có hồ sơ"', async () => {
    const user = { fullName: 'Nguyễn Văn An', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: async () => {
        throw new Error('Network error');
      }
    });

    env.triggerDomContentLoaded();
    await new Promise((r) => setImmediate(r));

    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.match(pcardHtml, /data-action="reload-profile"/);
    assert.match(pcardHtml, /Không tải được hồ sơ/);
    assert.doesNotMatch(pcardHtml, /chưa có hồ sơ/i);

    const heroTitle = env.dom.getElementById('heroTitle').textContent;
    assert.equal(heroTitle, 'Xin chào, An.');
    const heroActions = env.dom.getElementById('heroActions').innerHTML;
    assert.match(heroActions, /Mở bảng điều khiển/);
  });

  await t.test('"Thử lại" button calls PetService.list again', async () => {
    let callCount = 0;
    const user = { fullName: 'Trần Thị Bình', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: async () => {
        callCount++;
        if (callCount === 1) throw new Error('API down');
        return [{ id: 'p1', name: 'Miu', species: 'cat' }];
      }
    });

    env.triggerDomContentLoaded();
    await new Promise((r) => setImmediate(r));
    assert.equal(callCount, 1);

    // Click retry
    const prevented = env.clickReloadProfile();
    assert.equal(prevented, true);
    await new Promise((r) => setImmediate(r));

    assert.equal(callCount, 2);
    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.match(pcardHtml, /Miu/);
  });

  await t.test('Truly empty state (0 pets): displays "Bạn chưa có hồ sơ thú cưng"', async () => {
    const user = { fullName: 'Lê Văn Cường', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: async () => []
    });

    env.triggerDomContentLoaded();
    await new Promise((r) => setImmediate(r));

    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.match(pcardHtml, /Bạn chưa có hồ sơ thú cưng/);
    assert.match(pcardHtml, /Thêm bé đầu tiên/);
  });

  await t.test('With pets: displays pet name and info', async () => {
    const user = { fullName: 'Phạm Minh Đức', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: async () => [{ id: 'pet-1', name: 'Bé Lu', species: 'dog', weightKg: 5.2 }]
    });

    env.triggerDomContentLoaded();
    await new Promise((r) => setImmediate(r));

    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.match(pcardHtml, /Bé Lu/);
    assert.match(pcardHtml, /5\.2 kg/);
  });

  await t.test('Stale result dropped if user logs out while loading', async () => {
    let resolveList;
    const pendingPromise = new Promise((resolve) => {
      resolveList = resolve;
    });

    const user = { fullName: 'Hoàng Lan', role: 'customer' };
    const env = setupTestEnvironment({
      currentUser: user,
      petListImpl: () => pendingPromise
    });

    env.triggerDomContentLoaded();

    // User logs out while request is in flight
    env.setUser(null);
    env.triggerAuthChanged();

    // Now resolve the in-flight list with pet data
    resolveList([{ id: 'pet-99', name: 'GhostPet', species: 'cat' }]);
    await pendingPromise;
    await new Promise((r) => setImmediate(r));

    // The card should reflect the guest state, NOT GhostPet
    const pcardHtml = env.dom.getElementById('pcardContent').innerHTML;
    assert.doesNotMatch(pcardHtml, /GhostPet/);
    assert.match(pcardHtml, /Cấu trúc hồ sơ, chưa có dữ liệu/);
  });

  await t.test('landing.js sets authReady in all branches', async (subTest) => {
    await subTest.test('nhánh khách -> authReady được đặt', () => {
      const env = setupTestEnvironment({ currentUser: null });
      env.triggerDomContentLoaded();
      assert.equal(env.documentElement.dataset.authReady, '1');
    });

    await subTest.test('nhánh vai trò khác -> authReady được đặt', () => {
      const env = setupTestEnvironment({ currentUser: { fullName: 'Dr. John', role: 'vet' } });
      env.triggerDomContentLoaded();
      assert.equal(env.documentElement.dataset.authReady, '1');
    });

    await subTest.test('nhánh đang tải -> authReady được đặt ngay khi render loading', () => {
      const pendingPromise = new Promise(() => {});
      const env = setupTestEnvironment({
        currentUser: { fullName: 'Nguyễn Văn An', role: 'customer' },
        petListImpl: () => pendingPromise
      });
      env.triggerDomContentLoaded();
      assert.equal(env.documentElement.dataset.authReady, '1');
    });

    await subTest.test('nhánh lỗi API -> authReady được đặt', async () => {
      const env = setupTestEnvironment({
        currentUser: { fullName: 'Nguyễn Văn An', role: 'customer' },
        petListImpl: async () => { throw new Error('fail'); }
      });
      env.triggerDomContentLoaded();
      await new Promise((r) => setImmediate(r));
      assert.equal(env.documentElement.dataset.authReady, '1');
    });

    await subTest.test('nhánh trống -> authReady được đặt', async () => {
      const env = setupTestEnvironment({
        currentUser: { fullName: 'Nguyễn Văn An', role: 'customer' },
        petListImpl: async () => []
      });
      env.triggerDomContentLoaded();
      await new Promise((r) => setImmediate(r));
      assert.equal(env.documentElement.dataset.authReady, '1');
    });

    await subTest.test('nhánh có bé -> authReady được đặt', async () => {
      const env = setupTestEnvironment({
        currentUser: { fullName: 'Nguyễn Văn An', role: 'customer' },
        petListImpl: async () => [{ id: 'p1', name: 'Miu', species: 'cat' }]
      });
      env.triggerDomContentLoaded();
      await new Promise((r) => setImmediate(r));
      assert.equal(env.documentElement.dataset.authReady, '1');
    });
  });
});
