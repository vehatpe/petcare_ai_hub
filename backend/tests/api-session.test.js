'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiConfigPath = path.resolve(__dirname, '../../frontend/js/config/api.config.js');
const apiConfigCode = fs.readFileSync(apiConfigPath, 'utf8');

function createMockEnvironment() {
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
    location: { protocol: 'http:' },
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
    fetch: () => {},
    console
  };

  vm.createContext(context);
  vm.runInContext(apiConfigCode, context);

  return {
    Api: context.window.Api,
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
});
