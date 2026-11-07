/**
 * PetCare AI Hub - Motion engine
 *  - Scroll reveal (IntersectionObserver), one-shot per element
 *  - Auto stagger for containers marked [data-reveal-group]
 *  - Dynamic content: MutationObserver on <main> + PetCareMotion.refresh()
 *  - Auth pages: waits for body.auth-ready before revealing anything
 *  - AI launcher idle breathing (stops for good after the first open)
 *
 * Toast, dialog, wizard and typing-indicator behaviour live in their own
 * components (toast.js, dialog.js, booking-flow.js, ai-widget.js); their CSS
 * is in animations.css.
 *
 * Fail-open: the CSS only hides reveal targets while <html> has .js-motion.
 * motion-boot.js in each <head> adds it and removes it again if this file
 * never loads, so a script failure can not leave a blank page.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const prefersReduced = () => !!(reduceQuery && reduceQuery.matches);

  const REVEAL_SELECTOR = '.reveal-on-scroll, .reveal-scale';
  const STAGGER_STEPS = 4;
  const IDLE_KEY = 'petcare_ai_interacted';

  let io = null;
  let started = false;
  const grouped = new WeakSet();

  function reveal(el) {
    el.classList.add('is-visible');
    if (io) io.unobserve(el);
  }

  function onIntersect(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) reveal(entry.target);
    });
  }

  /** Give the children of [data-reveal-group] their reveal + stagger classes. */
  function applyGroups(scope) {
    scope.querySelectorAll('[data-reveal-group]').forEach((group) => {
      const variant = group.getAttribute('data-reveal-group') === 'scale' ? 'reveal-scale' : 'reveal-on-scroll';
      Array.from(group.children).forEach((child, i) => {
        if (grouped.has(child)) return;
        grouped.add(child);
        child.classList.add(variant, 'stagger-' + ((i % STAGGER_STEPS) + 1));
      });
    });
  }

  /** Observe every reveal target that is not visible yet. */
  function scan(scope) {
    const base = scope || document;
    applyGroups(base);
    base.querySelectorAll(REVEAL_SELECTOR).forEach((el) => {
      if (el.classList.contains('is-visible')) return;
      if (!io || prefersReduced()) { el.classList.add('is-visible'); return; }
      io.observe(el);
    });
  }

  /* ---------- AI launcher idle breathing ---------- */

  function readIdleDone() {
    try { return localStorage.getItem(IDLE_KEY) === 'true'; } catch (_) { return false; }
  }

  function writeIdleDone() {
    try { localStorage.setItem(IDLE_KEY, 'true'); } catch (_) { /* storage can be blocked */ }
  }

  function applyIdle() {
    const launcher = document.getElementById('aiWidgetLauncher');
    if (!launcher || prefersReduced()) return;
    if (!readIdleDone() && launcher.getAttribute('aria-expanded') !== 'true') {
      launcher.classList.add('is-idle');
    }
  }

  document.addEventListener('click', (e) => {
    const launcher = e.target.closest && e.target.closest('#aiWidgetLauncher');
    if (!launcher) return;
    launcher.classList.remove('is-idle');
    writeIdleDone();
  });

  /* ---------- Start-up ---------- */

  function start() {
    if (started) return;
    started = true;

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(onIntersect, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    }
    scan();
    applyIdle();

    // The AI widget is injected by main.js on DOMContentLoaded, which can run
    // after this deferred script, so also watch <body> for its arrival.
    document.addEventListener('DOMContentLoaded', applyIdle);
    new MutationObserver(() => {
      if (document.getElementById('aiWidgetLauncher')) { applyIdle(); }
    }).observe(document.body, { childList: true });

    // Content rendered later by page scripts (service list, pet list, bookings...)
    const main = document.querySelector('main') || document.body;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(main); applyIdle(); });
    }).observe(main, { childList: true, subtree: true });
  }

  /** Pages behind the auth guard stay hidden until auth-ready, so wait for it. */
  function whenReady() {
    const body = document.body;
    const gated = body.hasAttribute('data-page-auth') && !body.classList.contains('auth-ready');
    if (!gated) { start(); return; }
    const waiter = new MutationObserver(() => {
      if (body.classList.contains('auth-ready')) { waiter.disconnect(); start(); }
    });
    waiter.observe(body, { attributes: true, attributeFilter: ['class'] });
  }

  window.PetCareMotion = {
    /** Call after rendering new reveal targets if the observer should not wait. */
    refresh() { if (started) { scan(); applyIdle(); } }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', whenReady);
  else whenReady();
})();
