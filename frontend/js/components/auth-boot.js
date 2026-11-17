/**
 * Runs in <head> of index.html (blocking, tiny): detects an existing user session
 * before first paint to prevent hero flicker from guest defaults.
 * If landing.js takes too long or fails to load, a fallback timer ensures visibility.
 */
(function (d) {
  'use strict';
  var KEY = 'petcare_session';

  function hasValidSession(storage) {
    try {
      if (!storage) return false;
      var raw = storage.getItem(KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return Boolean(data && data.token && data.user);
    } catch (_) {
      return false;
    }
  }

  try {
    var hasSession = false;
    try {
      hasSession = hasValidSession(window.sessionStorage);
    } catch (_) {}

    if (!hasSession) {
      try {
        hasSession = hasValidSession(window.localStorage);
      } catch (_) {}
    }

    if (hasSession) {
      d.dataset.auth = 'user';
    }
  } catch (_) {}

  // Safety net: ensure visibility is unblocked even if landing.js fails or hangs
  setTimeout(function () {
    if (!d.dataset.authReady) {
      d.dataset.authReady = '1';
    }
  }, 3000);
})(document.documentElement);
