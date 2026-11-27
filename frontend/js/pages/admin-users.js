/**
 * PetCare AI Hub - Admin User Management Page
 * Allows administrators to list, filter, search, disable and enable system users.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'admin') return;

  const esc = Fmt.esc;
  const listEl = document.getElementById('userListContainer');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const userTotalEl = document.getElementById('userTotal');
  const refreshBtn = document.getElementById('refreshBtn');
  const searchInput = document.getElementById('searchInput');
  const roleFilter = document.getElementById('roleFilter');
  const statusFilter = document.getElementById('statusFilter');

  const PAGE_SIZE = 20;
  let users = [];
  let currentPage = 1;
  let currentTotal = 0;
  let currentMeta = { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };
  let searchTimeout = null;

  const ROLE_LABEL = {
    customer: 'Chủ nuôi',
    provider: 'Đối tác',
    vet: 'Bác sĩ',
    admin: 'Quản trị'
  };

  const STATUS_LABEL = {
    active: 'Hoạt động',
    pending: 'Chờ duyệt',
    disabled: 'Đã khóa',
    rejected: 'Bị từ chối'
  };

  const STATUS_BADGE = {
    active: 'badge-success',
    pending: 'badge-warning',
    disabled: 'badge-danger',
    rejected: 'badge-dark'
  };

  function promptDisableUser(targetUser) {
    return new Promise((resolve) => {
      const isProvider = targetUser.role === 'provider';
      const warningText = isProvider
        ? 'Cảnh báo: Khóa tài khoản đối tác sẽ đồng thời khóa tất cả các bác sĩ trực thuộc cơ sở này và tạm dừng cơ sở trên hệ thống.'
        : 'Bạn có chắc chắn muốn khóa tài khoản này? Người dùng sẽ không thể tiếp tục đăng nhập.';

      const dlg = document.createElement('dialog');
      dlg.className = 'pc-dialog';
      dlg.setAttribute('aria-labelledby', 'disableDlgTitle');

      dlg.innerHTML = `
        <div class="pc-dialog-body">
          <h2 id="disableDlgTitle">Khóa tài khoản</h2>
          <p id="disableDlgText"></p>
          <div style="margin: 16px 0;">
            <label for="disableDlgReason" style="font-weight: 600; font-size: 0.875rem;">Lý do khóa (tùy chọn):</label>
            <textarea id="disableDlgReason" class="form-control" rows="3" maxlength="200" placeholder="Nhập lý do khóa tài khoản…" style="width: 100%; resize: vertical; margin-top: 8px;"></textarea>
          </div>
          <div class="pc-dialog-actions pc-dialog-actions-row">
            <button type="button" class="btn btn-outline" data-act="cancel">Hủy</button>
            <button type="button" class="btn btn-danger" data-act="confirm">Xác nhận khóa</button>
          </div>
        </div>`;

      dlg.querySelector('#disableDlgText').textContent = warningText;

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
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'confirm') {
          const reason = (dlg.querySelector('#disableDlgReason').value || '').trim();
          requestClose();
          dlg.addEventListener('close', () => {
            dlg.remove();
            resolve({ confirmed: true, reason });
          }, { once: true });
        } else if (act === 'cancel' || e.target === dlg) {
          requestClose();
          dlg.addEventListener('close', () => {
            dlg.remove();
            resolve({ confirmed: false });
          }, { once: true });
        }
      });

      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        requestClose();
        dlg.addEventListener('close', () => {
          dlg.remove();
          resolve({ confirmed: false });
        }, { once: true });
      });

      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') {
        dlg.showModal();
      } else {
        dlg.setAttribute('open', '');
      }
    });
  }

  function renderUserCard(u) {
    const isSelf = String(u.id).toLowerCase() === String(user.id).toLowerCase();
    const roleText = ROLE_LABEL[u.role] || u.role;
    const statusText = STATUS_LABEL[u.status] || u.status;
    const badgeClass = STATUS_BADGE[u.status] || 'badge-warning';
    const createdAtText = u.createdAt ? Fmt.dateShort(u.createdAt) : '—';

    let facilityInfo = '';
    if (u.role === 'provider' && u.orgName) {
      facilityInfo = `<p class="pet-summary"><strong>Cơ sở:</strong> ${esc(u.orgName)} (${esc(u.orgArea || 'Chưa có khu vực')})</p>`;
    } else if (u.role === 'vet' && u.providerId) {
      facilityInfo = `<p class="pet-summary"><strong>Mã cơ sở:</strong> ${esc(u.providerId)}</p>`;
    }

    let actionButtons = '';
    if (!isSelf) {
      if (u.status === 'active') {
        actionButtons = `<button type="button" class="btn btn-outline-danger btn-sm" data-action="disable" data-user-id="${esc(u.id)}" data-user-role="${esc(u.role)}">Khóa</button>`;
      } else if (u.status === 'disabled') {
        actionButtons = `<button type="button" class="btn btn-outline btn-sm" data-action="enable" data-user-id="${esc(u.id)}" data-user-role="${esc(u.role)}">Mở khóa</button>`;
      } else if (u.status === 'pending') {
        actionButtons = `<a href="admin-partners.html" class="btn btn-outline btn-sm">Xử lý ở Duyệt đối tác</a>`;
      } else if (u.status === 'rejected') {
        actionButtons = `<span class="pet-summary">${u.rejectReason ? 'Lý do: ' + esc(u.rejectReason) : 'Đã bị từ chối'}</span>`;
      }
    } else {
      actionButtons = `<span class="badge badge-dark">Tài khoản của bạn</span>`;
    }

    return `
      <li class="pet-row" data-id="${esc(u.id)}">
        <div class="pet-avatar" aria-hidden="true" style="font-size: 1.25rem; font-weight: 700; background: var(--color-mint-light, #eaf5e9); color: var(--color-dark-forest);">
          ${esc(Fmt.initials(u.fullName))}
        </div>
        <div class="pet-main">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
            <h3 class="pet-name" style="margin: 0;">${esc(u.fullName)}</h3>
            <span class="badge badge-mint">${esc(roleText)}</span>
            <span class="badge ${badgeClass}">${esc(statusText)}</span>
          </div>
          <p class="pet-summary" style="margin-bottom: 4px;">
            <strong>Email:</strong> ${esc(u.email)} ·
            <strong>SĐT:</strong> ${esc(u.phone)} ·
            <strong>Tạo ngày:</strong> ${esc(createdAtText)}
          </p>
          ${facilityInfo}
        </div>
        <div class="pet-actions" style="align-items: center;">
          ${actionButtons}
        </div>
      </li>`;
  }

  function getFilterQuery() {
    const q = (searchInput.value || '').trim();
    const role = roleFilter.value || undefined;
    const status = statusFilter.value || undefined;
    return {
      ...(q ? { q } : {}),
      ...(role ? { role } : {}),
      ...(status ? { status } : {})
    };
  }

  function updateUiState() {
    userTotalEl.textContent = String(currentTotal);
    if (!users.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>Không tìm thấy người dùng</h3>
          <p>Không có tài khoản nào phù hợp với bộ lọc hiện tại.</p>
        </div>`;
      loadMoreWrap.hidden = true;
      return;
    }

    listEl.innerHTML = `
      <ul class="pet-list" style="list-style: none; padding: 0; margin: 0;">
        ${users.map(renderUserCard).join('')}
      </ul>`;
    const pagerHtml = Pager.render(currentMeta);
    loadMoreWrap.innerHTML = pagerHtml;
    loadMoreWrap.hidden = !pagerHtml;
  }

  async function loadPage(page = 1) {
    currentPage = Math.max(1, Number(page) || 1);
    return Panel.load(
      listEl,
      async () => {
        const query = {
          limit: PAGE_SIZE,
          page: currentPage,
          ...getFilterQuery()
        };
        const { data, meta } = await Api.get('/admin/users', query, { withMeta: true });
        const list = (data && data.users) || [];
        if (currentPage > 1 && list.length === 0) {
          return loadPage(currentPage - 1);
        }
        users = list;
        currentMeta = meta || { page: currentPage, limit: PAGE_SIZE, total: users.length, totalPages: 1 };
        currentTotal = currentMeta.total ?? users.length;
        return data;
      },
      () => {
        updateUiState();
      },
      { loading: 'Đang tải danh sách tài khoản…' }
    );
  }

  function loadInitial() {
    return loadPage(1);
  }

  // Action delegation
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;

    const action = btn.getAttribute('data-action');
    const targetUserId = btn.getAttribute('data-user-id');
    const targetUserRole = btn.getAttribute('data-user-role');
    const targetUser = users.find((u) => u.id === targetUserId);
    if (!targetUser) return;

    if (action === 'disable') {
      const confirmResult = await promptDisableUser(targetUser);
      if (!confirmResult.confirmed) return;

      btn.disabled = true;
      try {
        await Api.post(`/admin/users/${targetUserId}/disable`, {
          reason: confirmResult.reason || undefined
        });
        Toast.show(`Đã khóa tài khoản ${targetUser.fullName}.`, 'success');
        loadInitial();
      } catch (err) {
        Toast.show(err.message || 'Khóa tài khoản thất bại.', 'error');
        btn.disabled = false;
      }
    } else if (action === 'enable') {
      const confirmNotice = targetUserRole === 'provider'
        ? `Mở khóa cơ sở đối tác ${targetUser.fullName}? Lưu ý: Các bác sĩ trực thuộc phải được mở khóa riêng.`
        : `Mở khóa tài khoản ${targetUser.fullName}?`;

      const ok = await Dialog.confirm({
        title: 'Mở khóa tài khoản',
        text: confirmNotice,
        confirmLabel: 'Mở khóa',
        danger: false
      });
      if (!ok) return;

      btn.disabled = true;
      try {
        await Api.post(`/admin/users/${targetUserId}/enable`);
        Toast.show(`Đã mở khóa tài khoản ${targetUser.fullName}.`, 'success');
        loadInitial();
      } catch (err) {
        Toast.show(err.message || 'Mở khóa tài khoản thất bại.', 'error');
        btn.disabled = false;
      }
    }
  });

  // Filter events
  roleFilter.addEventListener('change', () => loadInitial());
  statusFilter.addEventListener('change', () => loadInitial());
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadInitial();
    }, 300);
  });

  refreshBtn.addEventListener('click', () => loadInitial());
  Pager.bind(loadMoreWrap, (nextPage) => loadPage(nextPage));

  loadInitial();
});
