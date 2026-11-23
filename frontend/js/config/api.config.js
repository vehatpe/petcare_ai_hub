/**
 * PetCare AI Hub - API client
 * Base URL: same-origin `/api/v1` when served over http(s) (the backend serves this folder),
 * otherwise http://localhost:3000/api/v1 (e.g. when index.html is opened from disk).
 * Override with window.PETCARE_API_BASE before this script loads.
 *
 * Exposed as window.Api (request helpers + session store) and window.ApiError.
 */
(function () {
  'use strict';

  const SESSION_KEY = 'petcare_session';
  // Static dev servers (VS Code Live Server 5500/5501) do not host the API: send calls to the backend on :3000.
  const STATIC_DEV_PORTS = ['5500', '5501'];
  function defaultBase() {
    const loc = window.location;
    if (!/^https?:$/.test(loc.protocol)) return 'http://localhost:3000/api/v1';
    if (STATIC_DEV_PORTS.indexOf(String(loc.port)) !== -1) return `${loc.protocol}//${loc.hostname}:3000/api/v1`;
    return '/api/v1';
  }
  const BASE = (window.PETCARE_API_BASE || defaultBase()).replace(/\/$/, '');

  class ApiError extends Error {
    constructor(status, code, message, errors) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code || 'error';
      this.errors = errors || {};
    }
  }

  /* ---------- Session store: { token, user } ---------- */
  function readFrom(store) {
    try {
      const raw = store.getItem(SESSION_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && parsed.token && parsed.user ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  const session = {
    get() {
      return readFrom(sessionStorage) || readFrom(localStorage);
    },
    set(value, remember) {
      this.clear(true);
      try {
        (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(value));
      } catch (_) { /* storage blocked: the session lasts for this page only */ }
      notify();
    },
    /** Update the cached user without changing where the session is stored. */
    updateUser(user) {
      const current = this.get();
      if (!current) return;
      if (JSON.stringify(current.user) === JSON.stringify(user)) return;
      const store = readFrom(sessionStorage) ? sessionStorage : localStorage;
      try { store.setItem(SESSION_KEY, JSON.stringify({ token: current.token, user })); } catch (_) { /* ignore */ }
      notify();
    },
    /** Update the cached token without changing where the session is stored. */
    updateToken(token) {
      const current = this.get();
      if (!current || !token) return;
      if (current.token === token) return;
      const store = readFrom(sessionStorage) ? sessionStorage : localStorage;
      try { store.setItem(SESSION_KEY, JSON.stringify({ token, user: current.user })); } catch (_) { /* ignore */ }
      notify();
    },
    clear(silent) {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
      try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
      if (!silent) notify();
    }
  };

  function notify() {
    window.dispatchEvent(new CustomEvent('petcare:auth-changed'));
  }

  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY) notify(); // login/logout in another tab
  });

  /* ---------- Requests ---------- */
  async function request(method, path, { body, query, auth = true } = {}) {
    let url = BASE + path;
    if (query) {
      const qs = new URLSearchParams();
      Object.keys(query).forEach((k) => { if (query[k] !== undefined && query[k] !== null && query[k] !== '') qs.set(k, query[k]); });
      const text = qs.toString();
      if (text) url += '?' + text;
    }

    const headers = { Accept: 'application/json' };
    const current = session.get();
    if (auth && current) headers.Authorization = 'Bearer ' + current.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (_) {
      throw new ApiError(0, 'network', 'Không kết nối được tới máy chủ. Hãy kiểm tra mạng rồi thử lại.');
    }

    let payload = null;
    try { payload = await res.json(); } catch (_) { /* handled below */ }

    if (!res.ok || !payload || payload.success === false) {
      const err = new ApiError(
        res.status,
        payload && payload.code,
        (payload && payload.message) || 'Máy chủ phản hồi không hợp lệ. Vui lòng thử lại sau.',
        payload && payload.errors
      );
      // An expired or revoked token: drop the session so every page falls back to the signed-out state.
      if (res.status === 401 && (err.code === 'unauthenticated' || err.code === 'token_revoked') && current) session.clear();

      // Mandatory change password gate: redirect to change-password.html when not already on that page.
      if (res.status === 403 && err.code === 'must_change_password') {
        if (current && current.user && !current.user.mustChangePassword) {
          session.updateUser({ ...current.user, mustChangePassword: true });
        }
        const pathname = (window.location && window.location.pathname) || '';
        const isChangePasswordPage = /(?:^|\/)change-password\.html(?:$|\?)/.test(pathname);
        if (!isChangePasswordPage) {
          const inPagesDir = /\/pages\/[^/]*$/.test(pathname);
          const target = inPagesDir ? 'change-password.html' : 'pages/change-password.html';
          if (window.location && typeof window.location.replace === 'function') {
            window.location.replace(target);
          } else if (window.location) {
            window.location.href = target;
          }
        }
      }

      throw err;
    }
    return payload.data;
  }

  window.ApiError = ApiError;
  window.Api = {
    BASE,
    session,
    get: (path, query, opts) => request('GET', path, { ...opts, query }),
    post: (path, body, opts) => request('POST', path, { ...opts, body: body === undefined ? {} : body }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body: body === undefined ? {} : body }),
    del: (path, opts) => request('DELETE', path, opts)
  };
})();
