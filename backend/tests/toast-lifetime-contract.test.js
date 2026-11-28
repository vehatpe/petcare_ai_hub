'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOAST_JS = path.resolve(__dirname, '../../frontend/js/components/toast.js');

/** Minimal DOM: just enough for the real toast.js (classList, listeners, children, matches, remove). */
function createEnv() {
  class El {
    constructor(tag = 'DIV') {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.connected = false;
      this.hover = false;
      this.focusWithin = false;
      this.children = {};
      this.styleVars = {};
      this.attrs = {};
      this.listeners = new Map();
      this.classes = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => this.classes.add(x)),
        remove: (...c) => c.forEach((x) => this.classes.delete(x)),
        contains: (c) => this.classes.has(c)
      };
      this.style = { setProperty: (k, v) => { this.styleVars[k] = v; } };
    }
    set innerHTML(html) {
      this._html = String(html);
      this.children = {
        '.toast-title': new El(), '.toast-message': new El(),
        '.toast-close': new El('BUTTON'), '.toast-progress': new El()
      };
    }
    get innerHTML() { return this._html; }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector(sel) { return this.children[sel] || null; }
    appendChild(c) { c.connected = true; return c; }
    remove() { this.connected = false; }
    matches(sel) {
      if (sel === ':hover') return this.hover;
      if (sel === ':focus-within') return this.focusWithin;
      return false;
    }
    addEventListener(t, fn) {
      if (!this.listeners.has(t)) this.listeners.set(t, []);
      this.listeners.get(t).push(fn);
    }
    removeEventListener(t, fn) {
      this.listeners.set(t, (this.listeners.get(t) || []).filter((f) => f !== fn));
    }
    fire(t, ev = {}) {
      for (const fn of [...(this.listeners.get(t) || [])]) fn({ type: t, target: this, ...ev });
    }
  }

  const created = [];
  const document = {
    createElement: (tag) => { const e = new El(tag); created.push(e); return e; },
    body: { appendChild: (c) => { c.connected = true; return c; } }
  };
  // Timers come from the host so node:test's mock clock controls them (late-bound on purpose).
  const ctx = {
    document,
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    Date: { now: () => Date.now() }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(TOAST_JS, 'utf8'), ctx, { filename: TOAST_JS });
  const lastToast = () => [...created].reverse().find((e) => e.className.startsWith('toast-item'));
  return { ctx, lastToast };
}

function withClock(fn) {
  return async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    await fn(t);
  };
}

test('Toast stays up for its full default duration (4500 ms success/info, 6000 ms error/warning) and is only then removed', withClock((t) => {
  const { ctx, lastToast } = createEnv();

  ctx.Toast.success('Đã cập nhật ảnh thú cưng');
  const ok = lastToast();
  assert.equal(ok.styleVars['--toast-duration'], '4500ms');
  t.mock.timers.tick(4499);
  assert.equal(ok.classList.contains('is-leaving'), false, 'must not start leaving before 4500 ms');
  assert.equal(ok.connected, true);
  t.mock.timers.tick(1);
  assert.equal(ok.classList.contains('is-leaving'), true);
  assert.equal(ok.connected, true, 'leave animation still playing');
  t.mock.timers.tick(400);
  assert.equal(ok.connected, false);

  ctx.Toast.error('Lỗi');
  const err = lastToast();
  assert.equal(err.styleVars['--toast-duration'], '6000ms');
  t.mock.timers.tick(5999);
  assert.equal(err.classList.contains('is-leaving'), false);
  t.mock.timers.tick(1);
  assert.equal(err.classList.contains('is-leaving'), true);

  ctx.Toast.info('Xong');
  assert.equal(lastToast().styleVars['--toast-duration'], '4500ms');
  ctx.Toast.warning('Chú ý');
  assert.equal(lastToast().styleVars['--toast-duration'], '6000ms');

  ctx.Toast.show({ title: 'Tùy chỉnh', type: 'success', duration: 2000 });
  const custom = lastToast();
  assert.equal(custom.styleVars['--toast-duration'], '2000ms');
  t.mock.timers.tick(1999);
  assert.equal(custom.classList.contains('is-leaving'), false);
  t.mock.timers.tick(1);
  assert.equal(custom.classList.contains('is-leaving'), true);
}));

test('animationend bubbling up from a child (.toast-progress) never removes the toast; only its own animationend does', withClock((t) => {
  const { ctx, lastToast } = createEnv();
  ctx.Toast.info('Xóa ảnh');
  const toast = lastToast();
  const progress = toast.querySelector('.toast-progress');

  progress.fire('animationend');
  toast.fire('animationend', { target: progress }); // bubbled event as the browser delivers it
  assert.equal(toast.connected, true, 'child animationend before dismiss must not remove');
  assert.equal(toast.classList.contains('is-leaving'), false);

  toast.querySelector('.toast-close').fire('click'); // dismiss -> leaving
  assert.equal(toast.classList.contains('is-leaving'), true);
  toast.fire('animationend', { target: progress });
  assert.equal(toast.connected, true, 'child animationend while leaving must not remove');

  toast.fire('animationend', { target: toast });
  assert.equal(toast.connected, false, 'own leave animation removes it');
}));

test('Hover pauses the countdown and resumes with the remaining time; repeated resume events never leak a second timer', withClock((t) => {
  const { ctx, lastToast } = createEnv();
  ctx.Toast.show({ title: 'Hover', type: 'success', duration: 1000 });
  const toast = lastToast();

  t.mock.timers.tick(400);
  toast.hover = true;
  toast.fire('mouseenter');
  assert.equal(toast.classList.contains('is-paused'), true);
  t.mock.timers.tick(5000);
  assert.equal(toast.classList.contains('is-leaving'), false, 'paused toast must not dismiss');

  toast.hover = false;
  toast.fire('mouseleave');
  assert.equal(toast.classList.contains('is-paused'), false);
  t.mock.timers.tick(599);
  assert.equal(toast.classList.contains('is-leaving'), false, '600 ms were left, not the full 1000');
  t.mock.timers.tick(1);
  assert.equal(toast.classList.contains('is-leaving'), true);
}));

test('Duplicate resume events (mouseleave twice + focusout) do not leave an orphan timer that dismisses a paused toast', withClock((t) => {
  const { ctx, lastToast } = createEnv();
  ctx.Toast.show({ title: 'Leak', type: 'success', duration: 1500 });
  const toast = lastToast();

  t.mock.timers.tick(200);
  toast.hover = true;
  toast.fire('mouseenter'); // pause, ~1300 left
  t.mock.timers.tick(200);
  toast.hover = false;
  toast.fire('mouseleave');
  toast.fire('mouseleave');
  toast.fire('focusout');
  t.mock.timers.tick(0); // focusout schedules resume with setTimeout(0)
  t.mock.timers.tick(300);
  toast.hover = true;
  toast.fire('mouseenter'); // pause again
  t.mock.timers.tick(10000);
  assert.equal(toast.classList.contains('is-leaving'), false, 'an orphan timer dismissed a hovered toast');
  assert.equal(toast.connected, true);

  toast.hover = false;
  toast.fire('mouseleave');
  t.mock.timers.tick(1500);
  assert.equal(toast.classList.contains('is-leaving'), true, 'it still dismisses once the pointer leaves');
}));
