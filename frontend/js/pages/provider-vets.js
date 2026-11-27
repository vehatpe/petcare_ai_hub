/**
 * PetCare AI Hub - Provider Vets Management Page
 * Allows providers to view their vets list, toggle active/disabled status,
 * and create a new vet (revealing a one-time temporary password).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'provider') return;

  const esc = Fmt.esc;
  const listEl = document.getElementById('vetListContainer');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const vetTotalEl = document.getElementById('vetTotal');
  const refreshBtn = document.getElementById('refreshVetsBtn');

  // Form & Temp password elements
  const form = document.getElementById('createVetForm');
  const formAlert = document.getElementById('formAlert');
  const submitBtn = document.getElementById('submitVetBtn');
  const tempPasswordBox = document.getElementById('tempPasswordBox');
  const createdVetName = document.getElementById('createdVetName');
  const createdVetEmail = document.getElementById('createdVetEmail');
  const tempPasswordDisplay = document.getElementById('tempPasswordDisplay');
  const copyPasswordBtn = document.getElementById('copyPasswordBtn');
  const closeTempPasswordBtn = document.getElementById('closeTempPasswordBtn');

  const PAGE_SIZE = 20;
  let vets = [];
  let currentPage = 1;
  let currentTotal = 0;
  let currentMeta = { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

  // In-memory single-use reference for password copying (never written to storage or console)
  let activeTempPassword = null;

  function setFieldError(field, message) {
    const input = form.querySelector(`[name="${field}"]`);
    const err = document.getElementById(`${field}-error`);
    if (!err) return;
    if (message) {
      if (input) input.setAttribute('aria-invalid', 'true');
      err.textContent = message;
      err.hidden = false;
    } else {
      if (input) input.removeAttribute('aria-invalid');
      err.textContent = '';
      err.hidden = true;
    }
  }

  function clearErrors() {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    formAlert.hidden = true;
    formAlert.textContent = '';
  }

  function showFormAlert(message, kind = 'error') {
    formAlert.className = `form-alert form-alert-${kind}`;
    formAlert.textContent = message;
    formAlert.hidden = false;
    formAlert.focus();
  }

  function vetRow(v) {
    const isActive = v.status === 'active';
    const statusBadge = isActive
      ? '<span class="badge badge-success">Đang hoạt động</span>'
      : '<span class="badge badge-danger">Đã khóa</span>';

    const actionBtn = isActive
      ? `<button type="button" class="btn btn-outline btn-sm" data-action="disable-vet" data-id="${esc(v.id)}" data-name="${esc(v.fullName)}">Khóa tài khoản</button>`
      : `<button type="button" class="btn btn-secondary btn-sm" data-action="enable-vet" data-id="${esc(v.id)}" data-name="${esc(v.fullName)}">Mở khóa</button>`;

    const regDate = v.createdAt ? Fmt.dateShort(v.createdAt.slice(0, 10)) : 'Chưa rõ';

    return `
      <li class="pet-row" data-vet-id="${esc(v.id)}">
        <div class="pet-avatar" aria-hidden="true" style="font-size: 1.25rem; font-weight: 700; background: var(--color-mint-light, #eaf5e9); color: var(--color-dark-forest);">
          ${esc(Fmt.initials(v.fullName))}
        </div>
        <div class="pet-main">
          <h3 class="pet-name" style="margin-bottom: 4px;">
            ${esc(v.fullName)} ${statusBadge}
          </h3>
          <p class="pet-summary" style="margin-bottom: 6px;">
            <strong>Email:</strong> ${esc(v.email)} ·
            <strong>SĐT:</strong> ${esc(v.phone)}
          </p>
          <p class="pet-summary" style="font-size: 0.8125rem; color: var(--text-secondary);">
            <strong>Ngày tham gia:</strong> ${esc(regDate)}
            ${v.mustChangePassword ? ' · <span class="badge badge-warning">Cần đổi mật khẩu</span>' : ''}
          </p>
        </div>
        <div class="pet-actions" style="align-items: center;">
          ${actionBtn}
        </div>
      </li>`;
  }

  function renderList() {
    vetTotalEl.textContent = String(currentTotal);

    if (vets.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>Chưa có bác sĩ nào trong cơ sở</h3>
          <p>Hãy dùng biểu mẫu bên cạnh để thêm bác sĩ thú y đầu tiên cho phòng khám của bạn.</p>
        </div>`;
      loadMoreWrap.hidden = true;
      return;
    }

    listEl.innerHTML = `
      <ul class="pet-list" style="list-style: none; padding: 0; margin: 0;">
        ${vets.map(vetRow).join('')}
      </ul>`;

    const pagerHtml = Pager.render(currentMeta);
    loadMoreWrap.innerHTML = pagerHtml;
    loadMoreWrap.hidden = !pagerHtml;
  }

  async function loadPage(page = 1) {
    currentPage = Math.max(1, Number(page) || 1);
    return Panel.load(listEl, async () => {
      const { data, meta } = await Api.get('/provider/vets', { limit: PAGE_SIZE, page: currentPage }, { withMeta: true });
      const list = (data && data.vets) || [];
      if (currentPage > 1 && list.length === 0) {
        return loadPage(currentPage - 1);
      }
      vets = list;
      currentMeta = meta || { page: currentPage, limit: PAGE_SIZE, total: vets.length, totalPages: 1 };
      currentTotal = currentMeta.total ?? vets.length;
      return data;
    }, renderList, { loading: 'Đang tải danh sách bác sĩ…' });
  }

  function loadInitial() {
    return loadPage(1);
  }

  /* Form submission for creating vet */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const fullName = (form.fullName.value || '').trim();
    const email = (form.email.value || '').trim();
    const rawPhone = (form.phone.value || '').trim();
    const phone = AuthService.normalizePhone(rawPhone);

    let hasClientError = false;
    if (!fullName) {
      setFieldError('fullName', 'Vui lòng nhập họ tên bác sĩ.');
      hasClientError = true;
    }
    if (!email || !AuthService.validators.email(email)) {
      setFieldError('email', 'Email không hợp lệ.');
      hasClientError = true;
    }
    if (!phone) {
      setFieldError('phone', 'Số điện thoại không hợp lệ (10 chữ số, ví dụ 0912345678).');
      hasClientError = true;
    }

    if (hasClientError) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang tạo tài khoản…';

    try {
      const res = await Api.post('/provider/vets', { fullName, email, phone });
      const vet = res.vet || {};
      const tempPassword = res.tempPassword;

      form.reset();
      Toast.show({ title: 'Thành công', message: `Đã tạo tài khoản cho bác sĩ ${vet.fullName || fullName}.`, type: 'success' });

      // Hiển thị mật khẩu tạm duy nhất một lần
      activeTempPassword = tempPassword;
      createdVetName.textContent = vet.fullName || fullName;
      createdVetEmail.textContent = vet.email || email;
      tempPasswordDisplay.textContent = tempPassword;
      tempPasswordBox.hidden = false;
      tempPasswordBox.scrollIntoView({ behavior: 'smooth', block: 'start' });

      await loadInitial();
    } catch (err) {
      if (err.errors) {
        if (err.errors.fullName) setFieldError('fullName', err.errors.fullName);
        if (err.errors.email) setFieldError('email', err.errors.email);
        if (err.errors.phone) setFieldError('phone', err.errors.phone);
      }
      showFormAlert(err.message || 'Không thể tạo tài khoản bác sĩ.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Tạo tài khoản bác sĩ';
    }
  });

  // Sao chép mật khẩu tạm
  copyPasswordBtn.addEventListener('click', async () => {
    if (!activeTempPassword) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(activeTempPassword);
      } else {
        // Fallback using textarea selection
        const ta = document.createElement('textarea');
        ta.value = activeTempPassword;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      Toast.show({ title: 'Đã sao chép', message: 'Mật khẩu tạm đã được chép vào bộ nhớ tạm.', type: 'info' });
    } catch (_) {
      Toast.show({ title: 'Không thể sao chép', message: 'Hãy chọn và sao chép thủ công chuỗi mật khẩu.', type: 'warning' });
    }
  });

  // Đóng khung mật khẩu tạm
  closeTempPasswordBtn.addEventListener('click', () => {
    tempPasswordBox.hidden = true;
    activeTempPassword = null;
    tempPasswordDisplay.textContent = '';
    createdVetName.textContent = '';
    createdVetEmail.textContent = '';
  });

  /* Delegated actions: Disable / Enable / Retry */
  document.addEventListener('click', async (e) => {
    // 1. Thử lại khi Panel.load lỗi
    const retryBtn = e.target.closest('[data-action="retry-vets"]');
    if (retryBtn) {
      loadInitial();
      return;
    }

    // 2. Khóa bác sĩ
    const disableBtn = e.target.closest('[data-action="disable-vet"]');
    if (disableBtn) {
      const id = disableBtn.getAttribute('data-id');
      const name = disableBtn.getAttribute('data-name');

      const confirmed = await Dialog.confirm({
        title: 'Khóa tài khoản bác sĩ',
        text: `Bạn có chắc chắn muốn khóa tài khoản của bác sĩ "${name}"? Bác sĩ này sẽ không thể đăng nhập hoặc thao tác cho đến khi được mở khóa.`,
        confirmLabel: 'Khóa tài khoản',
        cancelLabel: 'Giữ lại',
        danger: true
      });
      if (!confirmed) return;

      disableBtn.disabled = true;
      try {
        await Api.post(`/provider/vets/${encodeURIComponent(id)}/disable`);
        Toast.show({ title: 'Đã khóa', message: `Đã khóa tài khoản bác sĩ "${name}".`, type: 'info' });
        await loadInitial();
      } catch (err) {
        Toast.show({ title: 'Lỗi', message: err.message || 'Không thể khóa tài khoản bác sĩ.', type: 'danger' });
        disableBtn.disabled = false;
      }
      return;
    }

    // 3. Mở khóa bác sĩ
    const enableBtn = e.target.closest('[data-action="enable-vet"]');
    if (enableBtn) {
      const id = enableBtn.getAttribute('data-id');
      const name = enableBtn.getAttribute('data-name');

      const confirmed = await Dialog.confirm({
        title: 'Mở khóa tài khoản bác sĩ',
        text: `Mở lại quyền truy cập cho bác sĩ "${name}"?`,
        confirmLabel: 'Mở khóa',
        cancelLabel: 'Hủy'
      });
      if (!confirmed) return;

      enableBtn.disabled = true;
      try {
        await Api.post(`/provider/vets/${encodeURIComponent(id)}/enable`);
        Toast.show({ title: 'Thành công', message: `Đã mở khóa tài khoản bác sĩ "${name}".`, type: 'success' });
        await loadInitial();
      } catch (err) {
        Toast.show({ title: 'Lỗi', message: err.message || 'Không thể mở khóa tài khoản bác sĩ.', type: 'danger' });
        enableBtn.disabled = false;
      }
      return;
    }
  });

  Pager.bind(loadMoreWrap, (nextPage) => loadPage(nextPage));

  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadInitial);
  }

  loadInitial();
});
