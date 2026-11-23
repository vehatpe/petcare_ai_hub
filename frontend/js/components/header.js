/**
 * PetCare AI Hub - Header & Mobile Drawer
 * Fills <div data-auth-slot="header"> with guest or signed-in controls and builds
 * the mobile drawer from the desktop <nav class="main-nav"> so both always match.
 */
(function () {
  'use strict';

  const DASHBOARD_BY_ROLE = { customer: 'customer-dashboard.html' };
  const ROLE_LABEL = { customer: 'Chủ nuôi', provider: 'Đối tác dịch vụ', vet: 'Bác sĩ thú y', admin: 'Quản trị viên' };

  const esc = Fmt.esc;
  const url = (file) => AuthService.pageUrl(file);

  function guestMarkup() {
    return `
      <a href="${url('login.html')}" class="btn btn-outline btn-sm header-login">Đăng nhập</a>
      <a href="${url('register.html')}" class="btn btn-primary btn-sm">Đăng ký</a>`;
  }

  function userMarkup(user) {
    if (user.mustChangePassword) {
      return `
        <div class="account-menu">
          <button type="button" class="account-trigger" id="accountTrigger" aria-haspopup="menu" aria-expanded="false" aria-controls="accountPopover">
            <span class="account-avatar" aria-hidden="true">${esc(Fmt.initials(user.fullName))}</span>
            <span class="account-name">${esc(Fmt.firstName(user.fullName))}</span>
          </button>
          <div class="account-popover" id="accountPopover" role="menu" aria-labelledby="accountTrigger" hidden>
            <div class="account-who">
              <strong>${esc(user.fullName)}</strong>
              <span>${esc(user.email)}</span>
              <span class="account-role">${esc(ROLE_LABEL[user.role] || '')}</span>
            </div>
            <a role="menuitem" href="${url('change-password.html')}">Đổi mật khẩu</a>
            <button type="button" role="menuitem" class="account-logout" data-action="logout">Đăng xuất</button>
          </div>
        </div>`;
    }

    const dash = DASHBOARD_BY_ROLE[user.role];
    const cta = user.role === 'customer'
      ? `<a href="${url('booking.html')}" class="btn btn-primary btn-sm header-cta">Đặt lịch</a>`
      : '';
    return `
      ${cta}
      <div class="account-menu">
        <button type="button" class="account-trigger" id="accountTrigger" aria-haspopup="menu" aria-expanded="false" aria-controls="accountPopover">
          <span class="account-avatar" aria-hidden="true">${esc(Fmt.initials(user.fullName))}</span>
          <span class="account-name">${esc(Fmt.firstName(user.fullName))}</span>
        </button>
        <div class="account-popover" id="accountPopover" role="menu" aria-labelledby="accountTrigger" hidden>
          <div class="account-who">
            <strong>${esc(user.fullName)}</strong>
            <span>${esc(user.email)}</span>
            <span class="account-role">${esc(ROLE_LABEL[user.role] || '')}</span>
          </div>
          ${dash ? `<a role="menuitem" href="${url(dash)}">Bảng điều khiển</a>` : ''}
          ${user.role === 'admin' ? `<a role="menuitem" href="${url('admin-partners.html')}">Duyệt đối tác</a>` : ''}
          ${user.role === 'admin' ? `<a role="menuitem" href="${url('admin-users.html')}">Quản lý tài khoản</a>` : ''}
          ${user.role === 'provider' ? `<a role="menuitem" href="${url('provider-vets.html')}">Quản lý bác sĩ</a>` : ''}
          ${user.role === 'customer' ? `<a role="menuitem" href="${url('health-records.html')}">Sổ sức khỏe</a>` : ''}
          ${user.role === 'customer' ? `<a role="menuitem" href="${url('pet-profile.html')}">Thêm thú cưng</a>` : ''}
          <a role="menuitem" href="${url('change-password.html')}">Đổi mật khẩu</a>
          <button type="button" role="menuitem" class="account-logout" data-action="logout">Đăng xuất</button>
        </div>
      </div>`;
  }

  /* ---------- Role-aware main nav ---------- */
  function renderMainNav(user) {
    const nav = document.querySelector('.main-nav');
    if (!nav) return;

    // Cache initial markup for guest / customer so we can restore on logout/role change
    if (!nav._defaultNavHtml) {
      nav._defaultNavHtml = nav.innerHTML;
    }

    if (!user || user.role === 'customer') {
      nav.innerHTML = nav._defaultNavHtml;
      return;
    }

    if (user.mustChangePassword) {
      return;
    }

    const currentFile = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const isHome = currentFile === '' || currentFile === 'index.html';

    const items = [];
    items.push({
      href: AuthService.homeUrl(),
      text: 'Trang chủ',
      isActive: isHome
    });

    if (user.role === 'admin') {
      items.push({
        href: url('admin-partners.html'),
        text: 'Duyệt đối tác',
        isActive: currentFile === 'admin-partners.html'
      });
      items.push({
        href: url('admin-users.html'),
        text: 'Quản lý tài khoản',
        isActive: currentFile === 'admin-users.html'
      });
    } else if (user.role === 'provider') {
      items.push({
        href: url('provider-vets.html'),
        text: 'Quản lý bác sĩ',
        isActive: currentFile === 'provider-vets.html'
      });
    }

    nav.innerHTML = items.map((item) => {
      const cls = item.isActive ? 'nav-link active' : 'nav-link';
      const current = item.isActive ? ' aria-current="page"' : '';
      return `<a href="${esc(item.href)}" class="${cls}"${current}>${esc(item.text)}</a>`;
    }).join('\n        ');
  }

  function renderHeader() {
    const user = AuthService.currentUser();
    renderMainNav(user);
    buildDrawer();
    document.querySelectorAll('[data-auth-slot="header"]').forEach((slot) => {
      slot.innerHTML = user ? userMarkup(user) : guestMarkup();
    });
    applyAuthVisibility(user);
    renderFooterAuth(user);
    renderDrawerAuth(user);
  }

  function applyAuthVisibility(user) {
    document.querySelectorAll('[data-guest-only]').forEach((el) => {
      el.hidden = !!user;
    });
    document.querySelectorAll('[data-user-only]').forEach((el) => {
      el.hidden = !user;
    });
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      const allowedRoles = (el.getAttribute('data-role-only') || '').split(',').map((r) => r.trim());
      el.hidden = !user || !allowedRoles.includes(user.role);
    });
  }

  function renderFooterAuth(user) {
    // Hide booking footer links and bento booking section for staff roles (admin, provider, vet)
    const isStaff = user && user.role !== 'customer';

    // Bento booking card on landing page
    document.querySelectorAll('.bento2-booking').forEach((el) => {
      el.hidden = isStaff;
    });

    // Footer links to booking.html ("Đặt lịch" / "Đặt lịch khám")
    document.querySelectorAll('footer a[href*="booking.html"]').forEach((link) => {
      const parentLi = link.closest('li');
      if (parentLi) {
        parentLi.hidden = isStaff;
      } else {
        link.hidden = isStaff;
      }
    });

    document.querySelectorAll('[data-auth-slot="footer-account"]').forEach((slot) => {
      if (!user) {
        slot.innerHTML = `
          <li><a href="${url('login.html')}">Đăng nhập</a></li>
          <li><a href="${url('register.html')}">Đăng ký chủ nuôi</a></li>
          <li><a href="${url('register.html')}?role=provider">Đăng ký cơ sở dịch vụ</a></li>`;
      } else if (user.mustChangePassword) {
        slot.innerHTML = `
          <li><a href="${url('change-password.html')}">Đổi mật khẩu</a></li>
          <li><button type="button" class="btn-link" data-action="logout">Đăng xuất</button></li>`;
      } else {
        const dash = DASHBOARD_BY_ROLE[user.role] || (user.role === 'customer' ? 'customer-dashboard.html' : '');
        slot.innerHTML = `
          ${dash ? `<li><a href="${url(dash)}">Bảng điều khiển</a></li>` : ''}
          ${user.role === 'admin' ? `<li><a href="${url('admin-partners.html')}">Duyệt đối tác</a></li>` : ''}
          ${user.role === 'admin' ? `<li><a href="${url('admin-users.html')}">Quản lý tài khoản</a></li>` : ''}
          ${user.role === 'provider' ? `<li><a href="${url('provider-vets.html')}">Quản lý bác sĩ</a></li>` : ''}
          ${user.role === 'customer' ? `<li><a href="${url('health-records.html')}">Sổ sức khỏe</a></li>` : ''}
          <li><a href="${url('change-password.html')}">Đổi mật khẩu</a></li>
          <li><button type="button" class="btn-link" data-action="logout">Đăng xuất</button></li>`;
      }
    });
  }

  /* Delegated account popover event handling - attached once */
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('#accountTrigger');
    const pop = document.getElementById('accountPopover');
    if (trigger) {
      if (!pop) return;
      const isOpen = !pop.hidden;
      if (isOpen) {
        pop.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        pop.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        const first = pop.querySelector('[role="menuitem"]');
        if (first) first.focus();
      }
      return;
    }

    if (pop && !pop.hidden && !e.target.closest('.account-menu')) {
      pop.hidden = true;
      const trig = document.getElementById('accountTrigger');
      if (trig) trig.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    const pop = document.getElementById('accountPopover');
    if (!pop || pop.hidden) return;
    const trigger = document.getElementById('accountTrigger');
    const items = Array.from(pop.querySelectorAll('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement);

    if (e.key === 'Escape') {
      e.preventDefault();
      pop.hidden = true;
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) items[(i - 1 + items.length) % items.length].focus();
    }
  });

  document.addEventListener('focusout', (e) => {
    const pop = document.getElementById('accountPopover');
    if (pop && !pop.hidden && e.relatedTarget && !e.relatedTarget.closest('.account-menu')) {
      pop.hidden = true;
      const trig = document.getElementById('accountTrigger');
      if (trig) trig.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- Mobile drawer ---------- */
  function buildDrawer() {
    const nav = document.querySelector('.main-nav');
    const toggle = document.getElementById('mobileMenuToggle');
    if (!nav || !toggle) return;

    const old = document.getElementById('mobileDrawer');
    if (old) old.remove();

    const links = Array.from(nav.querySelectorAll('a')).map((a) => {
      const active = a.classList.contains('active') ? ' class="active" aria-current="page"' : '';
      return `<a href="${esc(a.getAttribute('href'))}"${active}>${esc(a.textContent.trim())}</a>`;
    }).join('');

    const drawer = document.createElement('div');
    drawer.className = 'mobile-drawer';
    drawer.id = 'mobileDrawer';
    drawer.innerHTML = `
      <div class="mobile-drawer-content" role="dialog" aria-modal="true" aria-label="Menu điều hướng">
        <div class="mobile-drawer-header">
          <span class="brand-logo">PetCare AI Hub</span>
          <button type="button" class="drawer-close" id="mobileDrawerClose" aria-label="Đóng menu">&times;</button>
        </div>
        <nav class="mobile-nav-links" aria-label="Điều hướng chính">${links}</nav>
        <div class="mobile-drawer-auth" data-drawer-auth></div>
      </div>`;
    document.body.appendChild(drawer);

    toggle.setAttribute('aria-controls', 'mobileDrawer');
    toggle.setAttribute('aria-expanded', 'false');

    const closeBtn = drawer.querySelector('#mobileDrawerClose');
    const setOpen = (isOpen) => {
      drawer.classList.toggle('active', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      document.body.classList.toggle('drawer-open', isOpen);
      if (isOpen) closeBtn.focus(); else toggle.focus();
    };

    toggle.addEventListener('click', () => setOpen(true));
    closeBtn.addEventListener('click', () => setOpen(false));
    drawer.addEventListener('click', (e) => { if (e.target === drawer) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('active')) setOpen(false);
    });
    window.matchMedia('(min-width: 861px)').addEventListener('change', (m) => {
      if (m.matches && drawer.classList.contains('active')) setOpen(false);
    });
  }

  function renderDrawerAuth(user) {
    const slot = document.querySelector('[data-drawer-auth]');
    if (!slot) return;
    if (!user) {
      slot.innerHTML = `
        <a href="${url('login.html')}" class="btn btn-outline">Đăng nhập</a>
        <a href="${url('register.html')}" class="btn btn-primary">Đăng ký</a>`;
      return;
    }
    if (user.mustChangePassword) {
      slot.innerHTML = `
        <div class="drawer-who"><strong>${esc(user.fullName)}</strong><span>${esc(user.email)}</span></div>
        <a href="${url('change-password.html')}" class="btn btn-secondary">Đổi mật khẩu</a>
        <button type="button" class="btn btn-outline" data-action="logout">Đăng xuất</button>`;
      return;
    }
    const dash = DASHBOARD_BY_ROLE[user.role];
    slot.innerHTML = `
      <div class="drawer-who"><strong>${esc(user.fullName)}</strong><span>${esc(user.email)}</span></div>
      ${dash ? `<a href="${url(dash)}" class="btn btn-secondary">Bảng điều khiển</a>` : ''}
      ${user.role === 'admin' ? `<a href="${url('admin-partners.html')}" class="btn btn-secondary">Duyệt đối tác</a>` : ''}
      ${user.role === 'provider' ? `<a href="${url('provider-vets.html')}" class="btn btn-secondary">Quản lý bác sĩ</a>` : ''}
      <a href="${url('change-password.html')}" class="btn btn-outline">Đổi mật khẩu</a>
      <button type="button" class="btn btn-outline" data-action="logout">Đăng xuất</button>`;
  }

  /* ---------- Logout (header + drawer) ---------- */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="logout"]')) return;
    AuthService.logout();
    window.location.href = AuthService.homeUrl();
  });

  window.addEventListener('petcare:auth-changed', renderHeader);

  renderHeader();
  // Re-validate the stored token once per page load; a revoked/expired one signs out (-> auth-changed).
  AuthService.refresh();
})();
