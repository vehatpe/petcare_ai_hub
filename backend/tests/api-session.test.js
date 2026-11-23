'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiConfigPath = path.resolve(__dirname, '../../frontend/js/config/api.config.js');
const apiConfigCode = fs.readFileSync(apiConfigPath, 'utf8');

function createMockEnvironment(options = {}) {
  const store = {
    session: new Map(),
    local: new Map()
  };

  function createStorage(map) {
    return {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); },
      clear() { map.clear(); }
    };
  }

  const listeners = new Map();
  let authChangedEventCount = 0;

  const windowObj = {
    location: {
      protocol: 'http:',
      pathname: options.pathname || '/index.html',
      href: options.href || 'http://localhost:3000/index.html',
      replace(url) {
        this.replacedTo = url;
      }
    },
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(cb);
    },
    removeEventListener(type, cb) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((fn) => fn !== cb));
    },
    dispatchEvent(event) {
      if (event && event.type === 'petcare:auth-changed') {
        authChangedEventCount++;
      }
      const handlers = listeners.get(event.type) || [];
      for (const h of handlers) h(event);
      return true;
    }
  };

  class MockCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const context = {
    window: windowObj,
    sessionStorage: createStorage(store.session),
    localStorage: createStorage(store.local),
    CustomEvent: MockCustomEvent,
    URLSearchParams,
    fetch: options.fetch || (() => {}),
    console
  };

  vm.createContext(context);
  vm.runInContext(apiConfigCode, context);

  return {
    Api: context.window.Api,
    window: context.window,
    getEventCount: () => authChangedEventCount,
    resetCount: () => { authChangedEventCount = 0; }
  };
}

test('Api.session event notifications on set, clear, and updateUser', async (t) => {
  await t.test('set() fires exactly 1 event', () => {
    const env = createMockEnvironment();
    assert.equal(env.getEventCount(), 0);

    env.Api.session.set({ token: 'tok_1', user: { id: 'u1', name: 'User 1' } }, false);
    assert.equal(env.getEventCount(), 1);
  });

  await t.test('updateUser with unchanged data fires 0 events and does not notify', () => {
    const env = createMockEnvironment();
    env.Api.session.set({ token: 'tok_1', user: { id: 'u1', name: 'User 1' } }, false);
    assert.equal(env.getEventCount(), 1);

    env.resetCount();
    env.Api.session.updateUser({ id: 'u1', name: 'User 1' });
    assert.equal(env.getEventCount(), 0, 'No event should be fired when user data is identical');
  });

  await t.test('updateUser with changed data fires exactly 1 event', () => {
    const env = createMockEnvironment();
    env.Api.session.set({ token: 'tok_1', user: { id: 'u1', name: 'User 1' } }, false);
    assert.equal(env.getEventCount(), 1);

    env.resetCount();
    env.Api.session.updateUser({ id: 'u1', name: 'User 1 Updated' });
    assert.equal(env.getEventCount(), 1, 'Exactly 1 event should be fired when user data changes');
    assert.equal(env.Api.session.get().user.name, 'User 1 Updated');
  });

  await t.test('clear() fires exactly 1 event, clear(true) fires 0 events', () => {
    const env = createMockEnvironment();
    env.Api.session.set({ token: 'tok_1', user: { id: 'u1', name: 'User 1' } }, false);
    env.resetCount();

    env.Api.session.clear(true);
    assert.equal(env.getEventCount(), 0, 'Silent clear should not fire event');

    env.Api.session.set({ token: 'tok_1', user: { id: 'u1', name: 'User 1' } }, false);
    env.resetCount();

    env.Api.session.clear();
    assert.equal(env.getEventCount(), 1, 'Normal clear should fire exactly 1 event');
  });

  await t.test('403 must_change_password redirects to change-password.html and sets user.mustChangePassword=true', async () => {
    let mockFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        code: 'must_change_password',
        message: 'Bạn phải đổi mật khẩu lần đầu trước khi tiếp tục sử dụng hệ thống.'
      })
    });

    // 1. Từ trang trong /pages/ (ví dụ customer-dashboard.html)
    const envInPages = createMockEnvironment({
      pathname: '/pages/customer-dashboard.html',
      fetch: mockFetch
    });
    envInPages.Api.session.set({ token: 'tok_vet', user: { id: 'u_vet', role: 'vet', mustChangePassword: false } });

    await assert.rejects(
      async () => envInPages.Api.get('/provider/vets'),
      (err) => err.status === 403 && err.code === 'must_change_password'
    );
    assert.equal(envInPages.Api.session.get().user.mustChangePassword, true);
    assert.equal(envInPages.window.location.replacedTo, 'change-password.html');

    // 2. Từ trang ngoài / (ví dụ /index.html)
    const envAtRoot = createMockEnvironment({
      pathname: '/index.html',
      fetch: mockFetch
    });
    envAtRoot.Api.session.set({ token: 'tok_vet', user: { id: 'u_vet', role: 'vet', mustChangePassword: false } });

    await assert.rejects(
      async () => envAtRoot.Api.get('/pets'),
      (err) => err.status === 403 && err.code === 'must_change_password'
    );
    assert.equal(envAtRoot.Api.session.get().user.mustChangePassword, true);
    assert.equal(envAtRoot.window.location.replacedTo, 'pages/change-password.html');

    // 3. Đang ở chính trang change-password.html thì KHÔNG gọi redirect
    const envOnSamePage = createMockEnvironment({
      pathname: '/pages/change-password.html',
      fetch: mockFetch
    });
    envOnSamePage.Api.session.set({ token: 'tok_vet', user: { id: 'u_vet', role: 'vet', mustChangePassword: false } });

    await assert.rejects(
      async () => envOnSamePage.Api.post('/auth/change-password', {}),
      (err) => err.status === 403 && err.code === 'must_change_password'
    );
    assert.equal(envOnSamePage.window.location.replacedTo, undefined);
  });

  await t.test('updateToken updates cached token and preserves storage location (localStorage vs sessionStorage)', () => {
    // 1. In sessionStorage (remember=false)
    const envSession = createMockEnvironment();
    envSession.Api.session.set({ token: 'tok_old_session', user: { id: 'u1' } }, false);
    envSession.resetCount();
    envSession.Api.session.updateToken('tok_new_session');
    assert.equal(envSession.Api.session.get().token, 'tok_new_session');
    assert.equal(envSession.Api.session.get().user.id, 'u1');
    assert.equal(envSession.getEventCount(), 1, 'updateToken should fire event');

    // 2. In localStorage (remember=true)
    const envLocal = createMockEnvironment();
    envLocal.Api.session.set({ token: 'tok_old_local', user: { id: 'u2' } }, true);
    envLocal.resetCount();
    envLocal.Api.session.updateToken('tok_new_local');
    assert.equal(envLocal.Api.session.get().token, 'tok_new_local');
    assert.equal(envLocal.Api.session.get().user.id, 'u2');
    assert.equal(envLocal.getEventCount(), 1);

    // 3. Unchanged token fires 0 events
    envLocal.resetCount();
    envLocal.Api.session.updateToken('tok_new_local');
    assert.equal(envLocal.getEventCount(), 0);
  });

  await t.test('401 token_revoked clears session', async () => {
    const mockRevokedFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        code: 'token_revoked',
        message: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.'
      })
    });
    const env = createMockEnvironment({ fetch: mockRevokedFetch });
    env.Api.session.set({ token: 'revoked_tok', user: { id: 'u3' } });
    assert.ok(env.Api.session.get());

    await assert.rejects(
      async () => env.Api.get('/auth/me'),
      (err) => err.status === 401 && err.code === 'token_revoked'
    );
    assert.equal(env.Api.session.get(), null, 'Session must be cleared on 401 token_revoked');
  });
});
