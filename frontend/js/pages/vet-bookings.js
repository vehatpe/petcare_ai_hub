/**
 * PetCare AI Hub - Vet Bookings List Page
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const user = AuthService.requireRole(['vet']);
    if (!user) return;
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

    let allItems = [];
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

    function applyFilters() {
      const status = statusEl.value;
      const from = fromEl.value;
      const to = toEl.value;
      const q = (searchEl.value || '').trim().toLowerCase();

      const filtered = allItems.filter((b) => {
        if (status && b.status !== status) return false;
        if (from && b.date < from) return false;
        if (to && b.date > to) return false;
        if (q) {
          const hay = [b.petName, b.petSpecies, b.serviceName, b.ownerName, b.code]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      renderList(filtered);
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
      const ownerInfo = b.ownerName ? `Chủ nuôi: ${esc(b.ownerName)}` : '';
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

    function renderList(items) {
      if (!items.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <h3>Chưa có lịch khám</h3>
            <p>Chưa có lịch nào được gán cho bạn — liên hệ quản lý cơ sở</p>
          </div>`;
        return;
      }
      listEl.innerHTML = `<ul class="booking-list">${items.map(renderItem).join('')}</ul>`;
    }

    function loadBookings() {
      updateQuickButtons();
      return Panel.load(
        listEl,
        () => Api.get('/vet/bookings'),
        (data) => {
          allItems = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
          applyFilters();
        },
        { loading: 'Đang tải lịch khám…' }
      );
    }

    filterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      updateQuickButtons();
      applyFilters();
    });

    statusEl.addEventListener('change', applyFilters);
    searchEl.addEventListener('input', applyFilters);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'filter-today') {
        const t = todayVnIso();
        fromEl.value = t;
        toEl.value = t;
        updateQuickButtons();
        applyFilters();
      } else if (action === 'filter-all') {
        fromEl.value = '';
        toEl.value = '';
        updateQuickButtons();
        applyFilters();
      }
    });

    loadBookings();
  });
})();
