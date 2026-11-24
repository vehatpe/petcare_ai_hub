/**
 * PetCare AI Hub - Admin Partner Approval Page
 * Allows administrators to list pending providers, approve (with area input if missing),
 * or reject (mandatory reason <= 200 chars).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'admin') return;

  const esc = Fmt.esc;
  const listEl = document.getElementById('partnerListContainer');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const partnerTotalEl = document.getElementById('partnerTotal');
  const refreshBtn = document.getElementById('refreshBtn');

  const PAGE_SIZE = 20;
  let partners = [];
  let currentOffset = 0;
  let currentTotal = 0;
  let isLoadingMore = false;

  const TYPE_LABEL = {
    clinic: 'Phòng khám',
    spa: 'Spa & Grooming',
    hotel: 'Khách sạn thú cưng',
    emergency: 'Cấp cứu thú y'
  };

  /**
   * Prompts admin for area when missing, or rejection reason.
   * Returns a promise resolving to the user string, or null if cancelled.
   */
  function promptInput({ title, text, inputLabel, placeholder, defaultValue = '', maxLength = 100, isTextarea = false, confirmLabel = 'Xác nhận', danger = false }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'pc-dialog';
      dlg.setAttribute('aria-labelledby', 'promptDlgTitle');

      const inputHtml = isTextarea
        ? `<textarea id="promptDlgInput" class="form-control" rows="3" maxlength="${maxLength}" placeholder="${esc(placeholder)}" style="width: 100%; resize: vertical; margin-top: 8px;"></textarea>`
        : `<input type="text" id="promptDlgInput" class="form-control" maxlength="${maxLength}" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" style="width: 100%; margin-top: 8px;">`;

      dlg.innerHTML = `
        <div class="pc-dialog-body">
          <h2 id="promptDlgTitle"></h2>
          <p id="promptDlgText"></p>
          <div style="margin: 16px 0;">
            <label for="promptDlgInput" style="font-weight: 600; font-size: 0.875rem;">${esc(inputLabel)}</label>
            ${inputHtml}
            <p id="promptDlgError" class="field-error" style="color: var(--color-danger-text); font-size: 0.8125rem; margin-top: 4px;" hidden></p>
          </div>
          <div class="pc-dialog-actions pc-dialog-actions-row">
            <button type="button" class="btn btn-outline" data-prompt-act="cancel">Hủy</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-prompt-act="ok"></button>
          </div>
        </div>`;

      dlg.querySelector('#promptDlgTitle').textContent = title;
      dlg.querySelector('#promptDlgText').textContent = text;
      dlg.querySelector('[data-prompt-act="ok"]').textContent = confirmLabel;

      let result = null;
      let closing = false;

      const requestClose = () => {
        if (closing) return;
        closing = true;
        dlg.classList.add('is-closing');
        const finish = () => { if (dlg.open) dlg.close(); };
        dlg.addEventListener('animationend', (e) => { if (e.target === dlg) finish(); }, { once: true });
        setTimeout(finish, 320);
      };

      dlg.addEventListener('click', (e) => {
        const act = e.target.getAttribute && e.target.getAttribute('data-prompt-act');
        if (act === 'ok') {
          const val = (dlg.querySelector('#promptDlgInput').value || '').trim();
          const errEl = dlg.querySelector('#promptDlgError');
          if (!val) {
            errEl.textContent = 'Vui lòng không để trống ô này.';
            errEl.hidden = false;
            return;
          }
          if (maxLength && val.length > maxLength) {
            errEl.textContent = `Tối đa ${maxLength} ký tự.`;
            errEl.hidden = false;
            return;
          }
          result = val;
          requestClose();
        } else if (act === 'cancel' || e.target === dlg) {
          requestClose();
        }
      });

      dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
      dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });

      document.body.appendChild(dlg);
      dlg.showModal();
      const inputEl = dlg.querySelector('#promptDlgInput');
      inputEl.focus();
    });
  }

  function partnerCard(p) {
    const typeText = TYPE_LABEL[p.orgType] || p.orgType || 'Chưa phân loại';
    const areaText = p.orgArea || 'Chưa cập nhật khu vực';
    const regDate = p.createdAt ? Fmt.dateShort(p.createdAt.slice(0, 10)) : 'Chưa rõ';

    let legalHtml = '';
    if (p.licenseNo || p.taxCode) {
      const parts = [];
      if (p.licenseNo) parts.push(`<strong>Số GP:</strong> ${esc(p.licenseNo)}`);
      if (p.taxCode) parts.push(`<strong>MST:</strong> ${esc(p.taxCode)}`);
      legalHtml = `<p class="pet-summary" style="font-size: 0.8125rem; color: var(--color-dark-forest); margin-bottom: 4px;">
        <span class="badge" style="background: var(--color-mint-light, #ecf9f9); color: var(--color-dark-forest); margin-right: 6px;">Pháp lý</span> ${parts.join(' · ')}
      </p>`;
    } else {
      legalHtml = `<p class="pet-summary" style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 4px;">
        <span class="badge" style="background: var(--color-cream-soft, #f7f9f5); color: var(--text-secondary); margin-right: 6px;">Chưa cung cấp thông tin pháp lý</span>
      </p>`;
    }

    return `
      <li class="pet-row" data-partner-id="${esc(p.id)}">
        <div class="pet-avatar" aria-hidden="true" style="font-size: 1.25rem; font-weight: 700; background: var(--color-mint-light, #eaf5e9); color: var(--color-dark-forest);">
          ${esc(Fmt.initials(p.orgName || p.fullName))}
        </div>
        <div class="pet-main">
          <h3 class="pet-name" style="margin-bottom: 4px;">${esc(p.orgName || 'Chưa đặt tên cơ sở')}</h3>
          <p class="pet-summary" style="margin-bottom: 6px;">
            <strong>Người đại diện:</strong> ${esc(p.fullName)} ·
            <strong>Loại:</strong> <span class="badge badge-mint">${esc(typeText)}</span> ·
            <strong>Khu vực:</strong> ${esc(areaText)}
          </p>
          ${legalHtml}
          <p class="pet-summary" style="font-size: 0.8125rem; color: var(--text-secondary);">
            <strong>Email:</strong> ${esc(p.email)} ·
            <strong>SĐT:</strong> ${esc(p.phone)} ·
            <strong>Ngày đăng ký:</strong> ${esc(regDate)}
          </p>
        </div>
        <div class="pet-actions" style="align-items: center;">
          <button type="button" class="btn btn-primary btn-sm" data-action="approve" data-id="${esc(p.id)}" data-has-area="${p.orgArea ? '1' : '0'}" data-name="${esc(p.orgName || p.fullName)}">Duyệt</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="reject" data-id="${esc(p.id)}" data-name="${esc(p.orgName || p.fullName)}">Từ chối</button>
        </div>
      </li>`;
  }

  function renderList() {
    partnerTotalEl.textContent = String(currentTotal);

    if (partners.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>Không có đối tác nào đang chờ duyệt</h3>
          <p>Tất cả các cơ sở đăng ký đã được phê duyệt hoặc từ chối xử lý.</p>
        </div>`;
      loadMoreWrap.hidden = true;
      return;
    }

    listEl.innerHTML = `
      <ul class="pet-list" style="list-style: none; padding: 0; margin: 0;">
        ${partners.map(partnerCard).join('')}
      </ul>`;

    // Phân trang
    if (partners.length < currentTotal) {
      loadMoreWrap.hidden = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = `Tải thêm (còn ${currentTotal - partners.length} đối tác)`;
    } else {
      loadMoreWrap.hidden = true;
    }
  }

  async function loadInitial() {
    currentOffset = 0;
    return Panel.load(listEl, async () => {
      const res = await Api.get('/admin/users', { status: 'pending', role: 'provider', limit: PAGE_SIZE, offset: 0 });
      partners = res.users || [];
      currentTotal = (res.meta && res.meta.total) || partners.length;
      currentOffset = partners.length;
      return res;
    }, renderList, { loading: 'Đang tải danh sách đối tác chờ duyệt…' });
  }

  async function loadMore() {
    if (isLoadingMore) return;
    isLoadingMore = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Đang tải thêm…';

    try {
      const res = await Api.get('/admin/users', { status: 'pending', role: 'provider', limit: PAGE_SIZE, offset: currentOffset });
      const nextBatch = res.users || [];
      partners = partners.concat(nextBatch);
      currentTotal = (res.meta && res.meta.total) || currentTotal;
      currentOffset += nextBatch.length;
      renderList();
    } catch (err) {
      Toast.show({ title: 'Lỗi tải thêm', message: err.message || 'Không thể tải thêm đối tác.', type: 'danger' });
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Thử lại tải thêm';
    } finally {
      isLoadingMore = false;
    }
  }

  /* Delegated actions: Approve / Reject / Retry / Refresh */
  document.addEventListener('click', async (e) => {
    // 1. Thử lại khi Panel.load lỗi qua data-action="retry-partners"
    const retryBtn = e.target.closest('[data-action="retry-partners"]');
    if (retryBtn) {
      loadInitial();
      return;
    }

    // 2. Nút Duyệt
    const approveBtn = e.target.closest('[data-action="approve"]');
    if (approveBtn) {
      const id = approveBtn.getAttribute('data-id');
      const hasArea = approveBtn.getAttribute('data-has-area') === '1';
      const name = approveBtn.getAttribute('data-name');

      let area = null;
      if (!hasArea) {
        area = await promptInput({
          title: 'Nhập khu vực cơ sở',
          text: `Cơ sở "${name}" chưa có thông tin khu vực/quận huyện. Vui lòng nhập trước khi phê duyệt:`,
          inputLabel: 'Khu vực hoạt động (quận/huyện, tỉnh/thành phố)',
          placeholder: 'Ví dụ: Quận 1, TP. Hồ Chí Minh',
          maxLength: 100,
          confirmLabel: 'Xác nhận & Duyệt'
        });
        if (!area) return; // Người dùng bấm Hủy
      } else {
        const confirmed = await Dialog.confirm({
          title: 'Phê duyệt đối tác',
          text: `Bạn có chắc chắn muốn phê duyệt cho cơ sở "${name}" tham gia hệ thống?`,
          confirmLabel: 'Phê duyệt',
          cancelLabel: 'Hủy'
        });
        if (!confirmed) return;
      }

      // Khóa nút trong lúc gửi để tránh bấm đôi
      approveBtn.disabled = true;
      const rejectBtn = approveBtn.parentElement.querySelector('[data-action="reject"]');
      if (rejectBtn) rejectBtn.disabled = true;

      try {
        const payload = area ? { area } : {};
        await Api.post(`/admin/users/${encodeURIComponent(id)}/approve`, payload);
        Toast.show({ title: 'Thành công', message: `Đã phê duyệt đối tác "${name}".`, type: 'success' });
        await loadInitial();
      } catch (err) {
        if (err.status === 409) {
          Toast.show({ title: 'Thông báo', message: 'Đối tác này đã được xử lý bởi quản trị viên khác.', type: 'warning' });
          await loadInitial();
        } else {
          Toast.show({ title: 'Lỗi duyệt đối tác', message: err.message || 'Không thể duyệt đối tác.', type: 'danger' });
          approveBtn.disabled = false;
          if (rejectBtn) rejectBtn.disabled = false;
        }
      }
      return;
    }

    // 3. Nút Từ chối
    const rejectBtn = e.target.closest('[data-action="reject"]');
    if (rejectBtn) {
      const id = rejectBtn.getAttribute('data-id');
      const name = rejectBtn.getAttribute('data-name');

      const reason = await promptInput({
        title: 'Từ chối đối tác',
        text: `Vui lòng nhập lý do từ chối hồ sơ của cơ sở "${name}" (tối đa 200 ký tự):`,
        inputLabel: 'Lý do từ chối',
        placeholder: 'Ví dụ: Thiếu giấy phép kinh doanh thú y hợp lệ',
        maxLength: 200,
        isTextarea: true,
        confirmLabel: 'Từ chối đối tác',
        danger: true
      });
      if (!reason) return; // Người dùng bấm Hủy

      rejectBtn.disabled = true;
      const approveBtn = rejectBtn.parentElement.querySelector('[data-action="approve"]');
      if (approveBtn) approveBtn.disabled = true;

      try {
        await Api.post(`/admin/users/${encodeURIComponent(id)}/reject`, { reason });
        Toast.show({ title: 'Đã từ chối', message: `Đã từ chối đối tác "${name}".`, type: 'info' });
        await loadInitial();
      } catch (err) {
        if (err.status === 409) {
          Toast.show({ title: 'Thông báo', message: 'Đối tác này đã được xử lý bởi quản trị viên khác.', type: 'warning' });
          await loadInitial();
        } else {
          Toast.show({ title: 'Lỗi từ chối đối tác', message: err.message || 'Không thể từ chối đối tác.', type: 'danger' });
          rejectBtn.disabled = false;
          if (approveBtn) approveBtn.disabled = false;
        }
      }
      return;
    }
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMore);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadInitial);
  }

  loadInitial();
});
