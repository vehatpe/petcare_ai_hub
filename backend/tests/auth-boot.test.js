'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const authBootJsPath = path.resolve(__dirname, '../../frontend/js/components/auth-boot.js');
const authBootJsCode = fs.readFileSync(authBootJsPath, 'utf8');

function createStorage(map = new Map(), throwOnAccess = false) {
  if (throwOnAccess) {
    return {
      getItem() { throw new Error('Storage access blocked'); },
      setItem() { throw new Error('Storage access blocked'); },
      removeItem() { throw new Error('Storage access blocked'); }
    };
  }
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function runAuthBoot({ sessionMap = new Map(), localMap = new Map(), throwSession = false, throwLocal = false } = {}) {
  const documentElement = {
    dataset: {}
  };

  const documentObj = {
    documentElement
  };

  const timerCallbacks = [];
  const fakeSetTimeout = (cb, delay) => {
    timerCallbacks.push({ cb, delay });
    return timerCallbacks.length;
  };

  const context = {
    document: documentObj,
    window: {
      sessionStorage: createStorage(sessionMap, throwSession),
      localStorage: createStorage(localMap, throwLocal)
    },
    setTimeout: fakeSetTimeout,
    console
  };

  vm.createContext(context);
  vm.runInContext(authBootJsCode, context);

  return {
    documentElement,
    timerCallbacks,
    runTimers: () => {
      for (const t of timerCallbacks) {
        t.cb();
      }
    }
  };
}

test('auth-boot.js in <head>', async (t) => {
  await t.test('phiên trong sessionStorage -> đặt auth="user"', () => {
    const sMap = new Map();
    sMap.set('petcare_session', JSON.stringify({ token: 'tok_123', user: { id: 'u1', role: 'customer' } }));
    const env = runAuthBoot({ sessionMap: sMap });
    assert.equal(env.documentElement.dataset.auth, 'user');
    assert.equal(env.documentElement.dataset.authReady, undefined);
  });

  await t.test('phiên trong localStorage -> đặt auth="user"', () => {
    const lMap = new Map();
    lMap.set('petcare_session', JSON.stringify({ token: 'tok_456', user: { id: 'u2', role: 'customer' } }));
    const env = runAuthBoot({ localMap: lMap });
    assert.equal(env.documentElement.dataset.auth, 'user');
    assert.equal(env.documentElement.dataset.authReady, undefined);
  });

  await t.test('không có phiên -> không đặt gì', () => {
    const env = runAuthBoot();
    assert.equal(env.documentElement.dataset.auth, undefined);
    assert.equal(env.documentElement.dataset.authReady, undefined);
  });

  await t.test('JSON hỏng hoặc thiếu token/user -> không đặt gì, không ném lỗi', () => {
    const badJsons = [
      'not a json',
      JSON.stringify({ token: 'tok_only' }),
      JSON.stringify({ user: { id: 'u1' } }),
      JSON.stringify(null),
      ''
    ];
    for (const val of badJsons) {
      const sMap = new Map();
      sMap.set('petcare_session', val);
      const env = runAuthBoot({ sessionMap: sMap });
      assert.equal(env.documentElement.dataset.auth, undefined);
    }
  });

  await t.test('storage ném lỗi -> không đặt gì, không ném lỗi', () => {
    assert.doesNotThrow(() => {
      const env = runAuthBoot({ throwSession: true, throwLocal: true });
      assert.equal(env.documentElement.dataset.auth, undefined);
    });
  });

  await t.test('sau ~3 giây (dùng timer giả) -> authReady được đặt', () => {
    const env = runAuthBoot();
    assert.equal(env.documentElement.dataset.authReady, undefined);
    assert.ok(env.timerCallbacks.length > 0);
    assert.equal(env.timerCallbacks[0].delay, 3000);

    env.runTimers();
    assert.equal(env.documentElement.dataset.authReady, '1');
  });
});
