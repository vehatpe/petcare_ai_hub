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

  await t.test('Role links: admin and provider see actionable links on landing page', () => {
    // Admin
    const envAdmin = setupTestEnvironment({ currentUser: { fullName: 'Admin User', role: 'admin' } });
    envAdmin.triggerDomContentLoaded();
    const adminHero = envAdmin.dom.getElementById('heroActions').innerHTML;
    assert.match(adminHero, /pages\/admin-partners\.html/);
    assert.match(adminHero, /Duyệt đối tác/);
    const adminPcard = envAdmin.dom.getElementById('pcardContent').innerHTML;
    assert.match(adminPcard, /pages\/admin-partners\.html/);

    // Provider
    const envProvider = setupTestEnvironment({ currentUser: { fullName: 'Phòng khám PetCare', role: 'provider' } });
    envProvider.triggerDomContentLoaded();
    const providerHero = envProvider.dom.getElementById('heroActions').innerHTML;
    assert.match(providerHero, /pages\/provider-vets\.html/);
    assert.match(providerHero, /Quản lý bác sĩ/);
    const providerPcard = envProvider.dom.getElementById('pcardContent').innerHTML;
    assert.match(providerPcard, /pages\/provider-vets\.html/);

    // Vet: does not have extra link
    const envVet = setupTestEnvironment({ currentUser: { fullName: 'BS. Tiến', role: 'vet' } });
    envVet.triggerDomContentLoaded();
    const vetHero = envVet.dom.getElementById('heroActions').innerHTML;
    assert.doesNotMatch(vetHero, /admin-partners\.html/);
    assert.doesNotMatch(vetHero, /provider-vets\.html/);
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

  await t.test('header.js: role-aware main-nav dynamic rendering', async (subTest) => {
    const headerJsPath = path.resolve(__dirname, '../../frontend/js/components/header.js');
    const headerJsCode = fs.readFileSync(headerJsPath, 'utf8');

    function createHeaderDom(pathname = '/pages/booking.html') {
      const elements = new Map();

      class MockNode {
        constructor(id = '', tagName = 'div', className = '') {
          this.id = id;
          this.tagName = tagName.toUpperCase();
          this.className = className;
          this._innerHTML = '';
          this.attributes = new Map();
          this.hidden = false;
        }

        get innerHTML() {
          return this._innerHTML;
        }

        set innerHTML(val) {
          this._innerHTML = String(val ?? '');
        }

        get textContent() {
          return this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        classList = {
          contains: (cls) => this.className.split(/\s+/).includes(cls),
          toggle: (cls, force) => {
            const set = new Set(this.className.split(/\s+/).filter(Boolean));
            if (force === undefined) {
              if (set.has(cls)) set.delete(cls); else set.add(cls);
            } else if (force) {
              set.add(cls);
            } else {
              set.delete(cls);
            }
            this.className = Array.from(set).join(' ');
          }
        };

        setAttribute(k, v) { this.attributes.set(k, String(v)); }
        getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
        removeAttribute(k) { this.attributes.delete(k); }
        addEventListener() {}
        focus() {}

        querySelector(sel) {
          if (sel === '#mobileDrawerClose') return new MockNode('mobileDrawerClose', 'button');
          return null;
        }

        querySelectorAll(sel) {
          if (sel === 'a') {
            const links = [];
            const re = /<a\s+([^>]*?)>(.*?)<\/a>/gi;
            let match;
            while ((match = re.exec(this._innerHTML)) !== null) {
              const node = new MockNode('', 'a');
              const attrs = match[1];
              const hrefMatch = /href="([^"]*)"/.exec(attrs);
              const classMatch = /class="([^"]*)"/.exec(attrs);
              if (hrefMatch) node.setAttribute('href', hrefMatch[1]);
              if (classMatch) node.className = classMatch[1];
              node.innerHTML = match[2];
              links.push(node);
            }
            return links;
          }
          return [];
        }

        remove() {}
      }

      const mainNav = new MockNode('', 'nav', 'main-nav');
      mainNav.innerHTML = `
        <a href="../index.html" class="nav-link">Trang chủ</a>
        <a href="services.html" class="nav-link">Dịch vụ Thú cưng</a>
        <a href="providers.html" class="nav-link">Cơ sở & Phòng khám</a>
        <a href="booking.html" class="nav-link active" aria-current="page">Đặt lịch hẹn</a>
        <a href="ai-assistant.html" class="nav-link">Trợ lý AI</a>
      `;

      const mobileToggle = new MockNode('mobileMenuToggle', 'button', 'mobile-menu-toggle');
      const headerAccount = new MockNode('', 'div', 'header-account');
      headerAccount.setAttribute('data-auth-slot', 'header');

      const body = new MockNode('', 'body');
      body.appendChild = () => {};

      const doc = {
        querySelector(sel) {
          if (sel === '.main-nav') return mainNav;
          if (sel === '#mobileMenuToggle') return mobileToggle;
          if (sel === '[data-drawer-auth]') return new MockNode('', 'div');
          return null;
        },
        querySelectorAll(sel) {
          if (sel === '[data-auth-slot="header"]') return [headerAccount];
          if (sel === '[data-guest-only]' || sel === '[data-user-only]' || sel === '[data-role-only]') return [];
          if (sel === '[data-auth-slot="footer-account"]') return [];
          return [];
        },
        getElementById(id) {
          if (id === 'mobileMenuToggle') return mobileToggle;
          return null;
        },
        createElement(tag) { return new MockNode('', tag); },
        addEventListener() {},
        body
      };

      return { doc, mainNav, pathname };
    }

    function runHeaderInVm(user, pathname = '/pages/booking.html') {
      const { doc, mainNav } = createHeaderDom(pathname);
      const inPages = /\/pages\/[^/]*$/.test(pathname);

      const ctx = vm.createContext({
        window: {
          location: {
            pathname,
            search: '',
            href: pathname
          },
          addEventListener() {},
          matchMedia: () => ({ addEventListener() {}, matches: false })
        },
        document: doc,
        Fmt: {
          esc: (s) => String(s ?? ''),
          initials: (s) => (s ? s.slice(0, 2) : ''),
          firstName: (s) => (s ? s.split(' ').pop() : '')
        },
        AuthService: {
          currentUser: () => user,
          pageUrl: (file) => (inPages ? '' : 'pages/') + file,
          homeUrl: () => (inPages ? '../index.html' : 'index.html'),
          refresh: () => {}
        }
      });

      vm.runInContext(headerJsCode, ctx);
      return mainNav;
    }

    await subTest.test('admin -> có Duyệt đối tác, không có Đặt lịch hẹn hay Trợ lý AI', () => {
      const nav = runHeaderInVm({ fullName: 'Admin User', role: 'admin' }, '/pages/booking.html');
      const text = nav.textContent;
      assert.ok(text.includes('Duyệt đối tác'), 'admin nav must include Duyệt đối tác');
      assert.ok(text.includes('Trang chủ'), 'admin nav must include Trang chủ');
      assert.equal(text.includes('Đặt lịch hẹn'), false, 'admin nav must not include Đặt lịch hẹn');
      assert.equal(text.includes('Trợ lý AI'), false, 'admin nav must not include Trợ lý AI');
      assert.equal(text.includes('Dịch vụ Thú cưng'), false, 'admin nav must not include Dịch vụ Thú cưng');
    });

    await subTest.test('provider -> có Quản lý bác sĩ, không có Đặt lịch hẹn', () => {
      const nav = runHeaderInVm({ fullName: 'Clinic Owner', role: 'provider' }, '/pages/booking.html');
      const text = nav.textContent;
      assert.ok(text.includes('Quản lý bác sĩ'), 'provider nav must include Quản lý bác sĩ');
      assert.ok(text.includes('Trang chủ'), 'provider nav must include Trang chủ');
      assert.equal(text.includes('Đặt lịch hẹn'), false, 'provider nav must not include Đặt lịch hẹn');
      assert.equal(text.includes('Duyệt đối tác'), false, 'provider nav must not include Duyệt đối tác');
    });

    await subTest.test('vet -> chỉ có Trang chủ', () => {
      const nav = runHeaderInVm({ fullName: 'Dr. Vet', role: 'vet' }, '/pages/booking.html');
      const text = nav.textContent;
      assert.ok(text.includes('Trang chủ'), 'vet nav must include Trang chủ');
      assert.equal(text.includes('Đặt lịch hẹn'), false, 'vet nav must not include Đặt lịch hẹn');
      assert.equal(text.includes('Duyệt đối tác'), false, 'vet nav must not include Duyệt đối tác');
      assert.equal(text.includes('Quản lý bác sĩ'), false, 'vet nav must not include Quản lý bác sĩ');
    });

    await subTest.test('customer và guest -> giữ nguyên nav mặc định', () => {
      const navGuest = runHeaderInVm(null, '/pages/booking.html');
      assert.ok(navGuest.textContent.includes('Đặt lịch hẹn'), 'guest keeps original nav');
      assert.ok(navGuest.textContent.includes('Trợ lý AI'), 'guest keeps original nav');

      const navCust = runHeaderInVm({ fullName: 'Customer A', role: 'customer' }, '/pages/booking.html');
      assert.ok(navCust.textContent.includes('Đặt lịch hẹn'), 'customer keeps original nav');
      assert.ok(navCust.textContent.includes('Trợ lý AI'), 'customer keeps original nav');
    });

    await subTest.test('mustChangePassword -> không dựng thêm gì ngoài nav tối thiểu', () => {
      const nav = runHeaderInVm({ fullName: 'Vet Temp', role: 'vet', mustChangePassword: true }, '/pages/change-password.html');
      // Không bị đổi thành role nav, giữ nguyên hoặc không thêm nav admin/provider
      assert.equal(nav.textContent.includes('Duyệt đối tác'), false);
      assert.equal(nav.textContent.includes('Quản lý bác sĩ'), false);
    });

    await subTest.test('đánh dấu active đúng theo pathname hiện tại', () => {
      const navAdmin = runHeaderInVm({ fullName: 'Admin User', role: 'admin' }, '/pages/admin-partners.html');
      assert.ok(navAdmin.innerHTML.includes('class="nav-link active" aria-current="page">Duyệt đối tác</a>'), 'admin-partners.html is marked active');
    });
  });

  await t.test('landing.css anti-flicker block covers all four hero/pcard elements', () => {
    const landingCssPath = path.resolve(__dirname, '../../frontend/css/landing.css');
    const landingCssContent = fs.readFileSync(landingCssPath, 'utf8');

    // Locate the anti-flicker rule block
    const ruleMatch = landingCssContent.match(/html\[data-auth="user"\]:not\(\[data-auth-ready\]\)[\s\S]*?\{[\s\S]*?visibility:\s*hidden;[\s\S]*?\}/);
    assert.ok(ruleMatch, 'Anti-flicker CSS rule block must exist in landing.css');

    const blockText = ruleMatch[0];
    assert.ok(blockText.includes('#heroTitle'), 'Anti-flicker block must include #heroTitle');
    assert.ok(blockText.includes('#heroSub'), 'Anti-flicker block must include #heroSub');
    assert.ok(blockText.includes('#heroActions'), 'Anti-flicker block must include #heroActions');
    assert.ok(blockText.includes('#pcardContent'), 'Anti-flicker block must include #pcardContent');
  });
});
