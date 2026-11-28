/**
 * PetCare AI Hub - Provider Bookings Management Page
 * Manages facility bookings: filter by status, date range, vet, search;
 * confirm, cancel (required reason 3-300 chars), complete, no-show, assign vet.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'provider') return;

  const esc = Fmt.esc;
  const lockBanner = document.getElementById('providerLockBanner');
  const summaryEl = document.getElementById('bookingSummaryStrip');
  const listEl = document.getElementById('providerBookingList');
  const statusTabs = document.getElementById('statusTabs');
  const fromInput = document.getElementById('filterFromDate');
  const toInput = document.getElementById('filterToDate');
  const vetSelect = document.getElementById('filterVet');
  const searchInput = document.getElementById('filterSearch');
  const refreshBtn = document.getElementById('refreshBookingsBtn');

  const today = Fmt.todayIso();
  if (fromInput && !fromInput.value) fromInput.value = today;
  if (toInput && !toInput.value) toInput.value = today;

  let isLocked = false;
  let activeStatus = '';
  let activeVets = [];
  let bookings = [];
  let searchTimer = null;

  function setLockState(locked, reason = '') {
    isLocked = locked;
    if (!lockBanner) return;
    if (locked) {
      lockBanner.hidden = false;
      lockBanner.innerHTML = `<strong>Cơ sở đang ở chế độ chỉ đọc:</strong> ${esc(reason || 'Cơ sở đang bị tạm khóa. Các thao tác cập nhật lịch hẹn tạm thời bị vô hiệu.')}`;
    } else {
      lockBanner.hidden = true;
      lockBanner.innerHTML = '';
    }
  }

  function renderSummary(summary) {
    if (!summaryEl) return;
    const s = summary || {};
    const pending = s.pending || 0;
    const confirmed = s.confirmed || 0;
    const completed = s.completed || 0;
    const cancelled = s.cancelled || 0;
    const noShow = s.no_show || 0;
    const total = pending + confirmed + completed + cancelled + noShow;
    summaryEl.innerHTML = `
      <div class="today-fact"><span class="today-label">Tổng lịch</span><strong>${esc(total)}</strong></div>
      <div class="today-fact"><span class="today-label">Chờ xác nhận</span><strong>${esc(pending)}</strong></div>
      <div class="today-fact"><span class="today-label">Đã xác nhận</span><strong>${esc(confirmed)}</strong></div>
      <div class="today-fact"><span class="today-label">Đã hoàn tất</span><strong>${esc(completed)}</strong></div>
      <div class="today-fact"><span class="today-label">Đã hủy</span><strong>${esc(cancelled)}</strong></div>
      <div class="today-fact"><span class="today-label">Vắng mặt</span><strong>${esc(noShow)}</strong></div>`;
  }

  function renderVetOptions() {
    if (!vetSelect) return;
    const current = vetSelect.value;
    vetSelect.innerHTML = `<option value="">Tất cả bác sĩ</option>` +
      activeVets.map((v) => `<option value="${esc(v.id)}">${esc(v.fullName)}</option>`).join('');
    if (current) vetSelect.value = current;
  }

  function buildActions(b) {
    if (isLocked) return '<span class="booking-meta">Chỉ đọc</span>';
    const btns = [];
    if (b.status === 'pending') {
      btns.push(`<button type="button" class="btn btn-primary btn-sm" data-action="confirm" data-id="${esc(b.id)}">Xác nhận</button>`);
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-action="assign-vet" data-id="${esc(b.id)}">Gán bác sĩ</button>`);
      btns.push(`<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="${esc(b.id)}">Từ chối</button>`);
    } else if (b.status === 'confirmed') {
      btns.push(`<button type="button" class="btn btn-primary btn-sm" data-action="complete" data-id="${esc(b.id)}">Hoàn tất</button>`);
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-action="assign-vet" data-id="${esc(b.id)}">Gán bác sĩ</button>`);
      btns.push(`<button type="button" class="btn btn-outline btn-sm" data-action="no-show" data-id="${esc(b.id)}">Vắng mặt</button>`);
      btns.push(`<button type="button" class="btn btn-danger btn-sm" data-action="cancel" data-id="${esc(b.id)}">Hủy lịch</button>`);
    }
    return btns.join(' ');
  }

  function bookingRow(b) {
    const st = (window.BookingService && BookingService.STATUS[b.status]) || { label: b.status, badge: 'badge-mint' };
    const vetText = b.vet && b.vet.name ? esc(b.vet.name) : 'Chưa gán';
    const phoneHtml = b.customerPhone
      ? `<a href="tel:${esc(b.customerPhone)}" class="btn btn-ghost btn-sm">${esc(b.customerPhone)}</a>`
      : '<span>Chưa có SĐT</span>';

    return `
      <li class="pet-row" data-booking-id="${esc(b.id)}">
        <div class="pet-main">
          <div class="booking-foot">
            <strong>${esc(b.time)}</strong> · <span>${esc(Fmt.dateShort(b.date))}</span>
            <span class="badge ${st.badge}">${esc(st.label)}</span>
            <span class="booking-code">Mã ${esc(b.code || b.id)}</span>
          </div>
          <h3 class="pet-name">${esc(b.serviceName)} — ${esc(Fmt.vnd(b.priceVnd))}</h3>
          <p class="pet-summary"><strong>Thú cưng:</strong> ${esc(b.petName)} · <strong>Bác sĩ:</strong> ${vetText}</p>
          <p class="pet-summary"><strong>Khách hàng:</strong> ${esc(b.customerName || 'Khách')} · ${phoneHtml}</p>
          ${b.cancelReason ? `<p class="pet-summary"><strong>Lý do hủy:</strong> ${esc(b.cancelReason)}</p>` : ''}
        </div>
        <div class="pet-actions">
          ${buildActions(b)}
        </div>
      </li>`;
  }

  function renderList() {
    if (!bookings.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>Không có lịch hẹn phù hợp</h3>
          <p>Thử đổi bộ lọc ngày, trạng thái hoặc từ khóa tìm kiếm để xem các lịch hẹn khác.</p>
        </div>`;
      return;
    }
    listEl.innerHTML = `<ul class="pet-list">${bookings.map(bookingRow).join('')}</ul>${Pager.render(currentMeta)}`;
    Pager.bind(listEl, (nextPage) => loadBookings(nextPage));
  }

  let currentPage = 1;
  let currentMeta = { page: 1, limit: 20, total: 0, totalPages: 1 };

  async function loadBookings(page = currentPage) {
    currentPage = Math.max(1, Number(page) || 1);
    const params = new URLSearchParams();
    if (activeStatus) params.set('status', activeStatus);
    if (fromInput && fromInput.value) params.set('from', fromInput.value);
    if (toInput && toInput.value) params.set('to', toInput.value);
    if (vetSelect && vetSelect.value) params.set('vetId', vetSelect.value);
    if (searchInput && searchInput.value.trim()) params.set('q', searchInput.value.trim());
    params.set('page', String(currentPage));
    params.set('limit', '20');

    const qs = params.toString();
    await Panel.load(
      listEl,
      () => Api.get(`/provider/bookings?${qs}`, undefined, { withMeta: true }),
      ({ data, meta }) => {
        bookings = Array.isArray(data?.bookings) ? data.bookings : (Array.isArray(data?.items) ? data.items : []);
        currentMeta = meta || { page: currentPage, limit: 20, total: bookings.length, totalPages: 1 };
        renderSummary(data?.summary);
        renderList();
      },
      { loading: 'Đang tải danh sách lịch hẹn…' }
    );
  }

  async function loadInitial() {
    try {
      const profile = await Api.get('/provider/profile');
      if (profile && profile.isActive === false) {
        setLockState(true, 'Cơ sở đang bị tạm khóa bởi quản trị viên.');
      }
    } catch (_) { /* ignore profile check error */ }

    try {
      const vetsRes = await Api.get('/provider/vets/options');
      activeVets = Array.isArray(vetsRes?.vets) ? vetsRes.vets : [];
      renderVetOptions();
    } catch (_) {
      activeVets = [];
    }

    await loadBookings();
  }

  function openReasonModal(title, confirmLabel) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';
      backdrop.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="provCancelTitle">
          <div class="dialog-header">
            <h3 id="provCancelTitle">${esc(title)}</h3>
            <button type="button" class="dialog-close" aria-label="Đóng hộp thoại" data-modal-close>&times;</button>
          </div>
          <p>Vui lòng nhập lý do hủy (3–300 ký tự) để thông báo cho khách hàng.</p>
          <div class="form-group">
            <label for="provCancelReason">Lý do hủy <span aria-hidden="true">*</span></label>
            <textarea id="provCancelReason" class="form-control" rows="3" maxlength="300" required></textarea>
            <div class="form-hint" id="provCancelErr"></div>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" data-modal-cancel>Đóng</button>
            <button type="button" class="btn btn-danger" data-modal-confirm>${esc(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.classList.add('dialog-open');
      document.body.appendChild(backdrop);

      const input = backdrop.querySelector('#provCancelReason');
      const errEl = backdrop.querySelector('#provCancelErr');
      const closeBtn = backdrop.querySelector('[data-modal-close]');
      const cancelBtn = backdrop.querySelector('[data-modal-cancel]');
      const confirmBtn = backdrop.querySelector('[data-modal-confirm]');
      input.focus();

      const close = (val) => {
        document.removeEventListener('keydown', onKey);
        document.body.classList.remove('dialog-open');
        backdrop.remove();
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      };
      document.addEventListener('keydown', onKey);
      if (closeBtn) closeBtn.addEventListener('click', () => close(null));
      cancelBtn.addEventListener('click', () => close(null));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      confirmBtn.addEventListener('click', () => {
        const val = input.value.trim();
        if (val.length < 3 || val.length > 300) {
          errEl.textContent = 'Lý do hủy phải từ 3 đến 300 ký tự.';
          input.focus();
          return;
        }
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        close(val);
      });
    });
  }

  function openAssignVetModal(booking) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';
      const currentVetId = booking.vet && booking.vet.id ? booking.vet.id : '';
      const bodyHtml = activeVets.length
        ? `<div class="form-group">
             <label for="assignVetSelect">Chọn bác sĩ phụ trách</label>
             <select id="assignVetSelect" class="form-control">
               ${activeVets.map((v) => `<option value="${esc(v.id)}"${v.id === currentVetId ? ' selected' : ''}>${esc(v.fullName)}</option>`).join('')}
             </select>
           </div>`
        : `<p>Cơ sở chưa có bác sĩ đang hoạt động. <a href="provider-vets.html">Thêm bác sĩ ngay</a>.</p>`;

      backdrop.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="assignVetTitle">
          <div class="dialog-header">
            <h3 id="assignVetTitle">Gán bác sĩ cho lịch hẹn</h3>
            <button type="button" class="dialog-close" aria-label="Đóng hộp thoại" data-modal-close>&times;</button>
          </div>
          ${bodyHtml}
          <div class="dialog-actions">
            <button type="button" class="btn btn-outline" data-modal-cancel>Đóng</button>
            ${activeVets.length ? '<button type="button" class="btn btn-primary" data-modal-confirm>Lưu</button>' : ''}
          </div>
        </div>`;
      document.body.classList.add('dialog-open');
      document.body.appendChild(backdrop);

      const closeBtn = backdrop.querySelector('[data-modal-close]');
      const cancelBtn = backdrop.querySelector('[data-modal-cancel]');
      const confirmBtn = backdrop.querySelector('[data-modal-confirm]');
      const selectEl = backdrop.querySelector('#assignVetSelect');
      (selectEl || cancelBtn).focus();

      const close = (val) => {
        document.removeEventListener('keydown', onKey);
        document.body.classList.remove('dialog-open');
        backdrop.remove();
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(null);
        }
      };
      document.addEventListener('keydown', onKey);
      if (closeBtn) closeBtn.addEventListener('click', () => close(null));
      cancelBtn.addEventListener('click', () => close(null));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      if (confirmBtn && selectEl) {
        confirmBtn.addEventListener('click', () => {
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          close(selectEl.value);
        });
      }
    });
  }

  async function runAction(btn, fn) {
    btn.disabled = true;
    try {
      await fn();
      await loadBookings();
    } catch (err) {
      if (err && err.code === 'facility_inactive') {
        setLockState(true, err.message);
      }
      Toast.show({ title: 'Không thể cập nhật lịch hẹn', message: err.message || 'Vui lòng thử lại.', type: 'danger' });
      await loadBookings();
    } finally {
      btn.disabled = false;
    }
  }

  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || isLocked) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const booking = bookings.find((b) => b.id === id);

    if (action === 'confirm') {
      await runAction(btn, async () => {
        await Api.patch(`/bookings/${encodeURIComponent(id)}/confirm`, {});
        Toast.show({ title: 'Đã xác nhận', message: 'Lịch hẹn đã được xác nhận.', type: 'success' });
      });
    } else if (action === 'complete') {
      await runAction(btn, async () => {
        await Api.patch(`/bookings/${encodeURIComponent(id)}/complete`, {});
        Toast.show({ title: 'Đã hoàn tất', message: 'Lịch hẹn đã chuyển sang hoàn tất.', type: 'success' });
      });
    } else if (action === 'no-show') {
      const ok = await Dialog.confirm({
        title: 'Đánh dấu khách vắng mặt?',
        text: 'Trạng thái vắng mặt không thể hoàn tác sau khi lưu.',
        confirmLabel: 'Xác nhận vắng mặt',
        cancelLabel: 'Quay lại',
        danger: true
      });
      if (!ok) return;
      await runAction(btn, async () => {
        await Api.patch(`/bookings/${encodeURIComponent(id)}/no-show`, {});
        Toast.show({ title: 'Đã cập nhật', message: 'Đã đánh dấu khách vắng mặt.', type: 'success' });
      });
    } else if (action === 'cancel') {
      const reason = await openReasonModal('Hủy / từ chối lịch hẹn', 'Xác nhận hủy');
      if (!reason) return;
      await runAction(btn, async () => {
        await Api.patch(`/bookings/${encodeURIComponent(id)}/cancel`, { reason });
        Toast.show({ title: 'Đã hủy lịch hẹn', message: 'Khách hàng sẽ thấy lý do hủy.', type: 'success' });
      });
    } else if (action === 'assign-vet' && booking) {
      const vetId = await openAssignVetModal(booking);
      if (!vetId) return;
      await runAction(btn, async () => {
        await Api.patch(`/bookings/${encodeURIComponent(id)}/vet`, { vetId });
        Toast.show({ title: 'Đã gán bác sĩ', message: 'Đã cập nhật bác sĩ phụ trách.', type: 'success' });
      });
    }
  });

  if (statusTabs) {
    statusTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-status]');
      if (!tab) return;
      activeStatus = tab.dataset.status || '';
      statusTabs.querySelectorAll('[data-status]').forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.className = `btn btn-sm ${on ? 'btn-primary' : 'btn-outline'}`;
      });
      loadBookings();
    });
  }

  [fromInput, toInput, vetSelect].forEach((el) => {
    if (el) el.addEventListener('change', loadBookings);
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadBookings, 300);
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', loadBookings);

  loadInitial();
});
