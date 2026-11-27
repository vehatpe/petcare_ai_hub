/**
 * PetCare AI Hub - Vet Bookings List Page
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const user = AuthService.currentUser();
    if (!user || user.role !== 'vet') return;
    if (user.mustChangePassword) {
      window.location.replace('change-password.html');
      return;
    }

    const esc = Fmt.esc;
    const listEl = document.getElementById('vetBookingsList');
    const filterForm = document.getElementById('vetFilterForm');
    const statusEl = document.getElementById('statusFilter');
    const fromEl = document.getElementById('fromDateFilter');
    const toEl = document.getElementById('toDateFilter');
    const searchEl = document.getElementById('searchFilter');
    const todayBtn = document.getElementById('quickTodayBtn');
    const allBtn = document.getElementById('quickAllBtn');

    function todayVnIso() {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    }

    let searchTimer = null;
    const today = todayVnIso();
    fromEl.value = today;
    toEl.value = today;

    function updateQuickButtons() {
      const t = todayVnIso();
      const isToday = fromEl.value === t && toEl.value === t;
      todayBtn.classList.toggle('btn-primary', isToday);
      todayBtn.classList.toggle('btn-outline', !isToday);
      const isAll = !fromEl.value && !toEl.value;
      allBtn.classList.toggle('btn-primary', isAll);
      allBtn.classList.toggle('btn-ghost', !isAll);
    }

    function buildQuery() {
      const qs = new URLSearchParams();
      if (statusEl.value) qs.set('status', statusEl.value);
      if (fromEl.value) qs.set('from', fromEl.value);
      if (toEl.value) qs.set('to', toEl.value);
      const q = (searchEl.value || '').trim();
      if (q) qs.set('q', q);
      const s = qs.toString();
      return s ? `?${s}` : '';
    }

    function renderItem(b) {
      const st = (window.BookingService && BookingService.STATUS[b.status]) || {
        label: b.status || 'Chờ xử lý',
        badge: 'badge-warning'
      };
      const mrBadge = b.hasMedicalRecord
        ? '<span class="badge badge-success">Đã có bệnh án</span>'
        : '<span class="badge badge-warning">Chưa có bệnh án</span>';

      const petInfo = b.petSpecies ? `${esc(b.petName)} (${esc(b.petSpecies)})` : esc(b.petName || 'Thú cưng');
      const ownerInfo = b.customerName ? `Chủ nuôi: ${esc(b.customerName)}` : '';
      const dateStr = b.date ? Fmt.dateLong(b.date) : '';
      const timeStr = b.time ? `lúc ${esc(b.time)}` : '';

      return `
        <li class="booking-item">
          <div>
            <p class="booking-title">
              <a href="vet-booking.html?id=${encodeURIComponent(b.id)}">${esc(b.serviceName || 'Dịch vụ khám')}</a>
            </p>
            <p class="booking-meta">${esc(dateStr)} ${timeStr}</p>
            <p class="booking-meta">${petInfo}${ownerInfo ? ` · ${ownerInfo}` : ''}</p>
            <div class="booking-foot">
              <span class="badge ${st.badge}">${esc(st.label)}</span>
              ${mrBadge}
              <a class="btn btn-outline btn-sm" href="vet-booking.html?id=${encodeURIComponent(b.id)}">Mở hồ sơ khám</a>
            </div>
          </div>
        </li>`;
    }

    let currentPage = 1;
    let currentMeta = { page: 1, limit: 20, total: 0, totalPages: 1 };

    function renderList(res) {
      const data = res && res.data ? res.data : res;
      const meta = res && res.meta ? res.meta : null;
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      currentMeta = meta || { page: currentPage, limit: 20, total: items.length, totalPages: 1 };
      if (!items.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <h3>Chưa có lịch khám</h3>
            <p>Chưa có lịch nào được gán cho bạn — liên hệ quản lý cơ sở</p>
          </div>`;
        return;
      }
      listEl.innerHTML = `<ul class="booking-list">${items.map(renderItem).join('')}</ul>${Pager.render(currentMeta)}`;
      Pager.bind(listEl, (nextPage) => loadBookings(nextPage));
    }

    function loadBookings(page = 1) {
      currentPage = Math.max(1, Number(page) || 1);
      updateQuickButtons();
      return Panel.load(
        listEl,
        () => Api.get(`/vet/bookings${buildQuery()}`, { page: currentPage, limit: 20 }, { withMeta: true }),
        renderList,
        { loading: 'Đang tải lịch khám…' }
      );
    }

    filterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      loadBookings(1);
    });

    statusEl.addEventListener('change', () => loadBookings(1));
    fromEl.addEventListener('change', () => loadBookings(1));
    toEl.addEventListener('change', () => loadBookings(1));
    searchEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadBookings(1), 300);
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'filter-today') {
        const t = todayVnIso();
        fromEl.value = t;
        toEl.value = t;
        loadBookings();
      } else if (action === 'filter-all') {
        fromEl.value = '';
        toEl.value = '';
        loadBookings();
      }
    });

    loadBookings();
  });
})();
