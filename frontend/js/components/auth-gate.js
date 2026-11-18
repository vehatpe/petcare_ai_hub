/**
 * PetCare AI Hub - Auth Gate
 *
 * Three jobs, all driven by markup so pages stay declarative:
 *  1. <a data-auth-required="reason">   -> guests get a sign-in dialog instead of navigating.
 *  2. <body data-page-auth="customer">  -> page-level guard (redirects to login with ?next=).
 *  3. AuthGate.panelHtml(...)           -> inline "sign in to continue" panel for pages
 *                                          that stay visible to guests (booking, AI assistant).
 *
 * Exposed as window.AuthGate
 */
(function () {
  'use strict';

  const DEFAULT_REASON = 'Tính năng này gắn với hồ sơ thú cưng của bạn nên cần có tài khoản.';
  let dialog = null;

  function withNext(file, next) {
    const base = AuthService.pageUrl(file);
    return next ? `${base}?next=${encodeURIComponent(next)}` : base;
  }

  const AuthGate = {
    loginUrl: (next) => withNext('login.html', next),
    registerUrl: (next) => withNext('register.html', next),

    /** Opens the modal that sends guests to login / register. */
    prompt({ reason, next } = {}) {
      if (!dialog) {
        dialog = document.createElement('dialog');
        dialog.className = 'pc-dialog';
        dialog.setAttribute('aria-labelledby', 'gateTitle');
        dialog.setAttribute('aria-describedby', 'gateText');
        dialog.innerHTML = `
          <form method="dialog" class="pc-dialog-close-form">
            <button class="pc-dialog-close" aria-label="Đóng hộp thoại">&times;</button>
          </form>
          <div class="pc-dialog-body">
            <h2 id="gateTitle">Đăng nhập để tiếp tục</h2>
            <p id="gateText"></p>
            <div class="pc-dialog-actions">
              <a class="btn btn-primary" data-gate="login">Đăng nhập</a>
              <a class="btn btn-outline" data-gate="register">Tạo tài khoản miễn phí</a>
            </div>
          </div>`;
        dialog.addEventListener('click', (e) => {
          if (e.target === dialog) dialog.close(); // click on backdrop
        });
        document.body.appendChild(dialog);
      }
      dialog.querySelector('#gateText').textContent = reason || DEFAULT_REASON;
      dialog.querySelector('[data-gate="login"]').href = this.loginUrl(next);
      dialog.querySelector('[data-gate="register"]').href = this.registerUrl(next);
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('[data-gate="login"]').focus();
    },

    /** Static HTML for an inline gate panel (all inputs are developer-supplied strings). */
    panelHtml({ title, text, next }) {
      return `
        <div class="gate-panel" role="region" aria-label="${Fmt.esc(title)}">
          <h2 class="gate-panel-title">${Fmt.esc(title)}</h2>
          <p class="gate-panel-text">${Fmt.esc(text)}</p>
          <div class="gate-panel-actions">
            <a class="btn btn-primary" href="${this.loginUrl(next)}">Đăng nhập</a>
            <a class="btn btn-outline" href="${this.registerUrl(next)}">Tạo tài khoản miễn phí</a>
          </div>
        </div>`;
    }
  };

  /* 1. Intercept guarded links for guests */
  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('a[data-auth-required]');
    if (!link || AuthService.isLoggedIn()) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    AuthGate.prompt({
      reason: link.getAttribute('data-auth-required') || DEFAULT_REASON,
      next: AuthService.safeNext(link.getAttribute('href'))
    });
  });

  /* 2. Page-level guard */
  const required = document.body && document.body.getAttribute('data-page-auth');
  if (required) {
    const user = AuthService.currentUser();
    if (!user) {
      window.location.replace(AuthGate.loginUrl(AuthService.currentAsNext()));
    } else if (required === 'authenticated') {
      // Cho phép mọi người dùng đã đăng nhập bất kể vai trò (customer/provider/vet/admin)
      document.body.classList.add('auth-ready');
    } else if (user.role !== required) {
      window.location.replace(AuthService.homeUrl());
    } else {
      document.body.classList.add('auth-ready');
    }
  }

  /* Session cleared elsewhere (expired token, other tab): leave guarded pages. */
  window.addEventListener('petcare:auth-changed', () => {
    if (required && !AuthService.currentUser()) window.location.replace(AuthGate.loginUrl(AuthService.currentAsNext()));
  });

  window.AuthGate = AuthGate;
})();
