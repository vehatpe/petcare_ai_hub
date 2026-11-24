/**
 * PetCare AI Hub - Provider Services Management Page
 * Handles listing services with pagination (limit 20 + load more), options from API (categories/labels/limits),
 * add & edit dialog (with discard confirmation), disable (hide) & enable dialog,
 * empty state, and facility lock handling (403/409).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'provider') return;

  const esc = Fmt.esc;
  const listEl = document.getElementById('serviceListContainer');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const totalEl = document.getElementById('serviceTotal');
  const refreshBtn = document.getElementById('refreshServicesBtn');
  const openAddBtn = document.getElementById('openAddServiceBtn');
  const alertBox = document.getElementById('serviceAlertBox');

  const PAGE_SIZE = 20;
  let services = [];
  let currentOffset = 0;
  let currentTotal = 0;
  let isLoadingMore = false;
  let serviceOptions = null; // populated from API data.options
  let isLocked = false;
  let lockReason = '';

  const CATEGORY_NAMES = {
    medical: 'Y tế & Khám bệnh',
    grooming: 'Spa & Làm đẹp',
    hotel: 'Khách sạn thú cưng',
    emergency: 'Cấp cứu 24/7'
  };

  function setLockState(locked, reason = '') {
    isLocked = locked;
    lockReason = reason;
    if (locked) {
      if (openAddBtn) openAddBtn.disabled = true;
      alertBox.hidden = false;
      alertBox.className = 'form-alert form-alert-error';
      alertBox.innerHTML = `<strong>Cơ sở đang bị tạm khóa:</strong> ${esc(reason || 'Cơ sở hoặc tài khoản đang bị vô hiệu hóa. Các thao tác thêm, sửa, ẩn/hiện dịch vụ bị vô hiệu.')}`;
    } else {
      if (openAddBtn) openAddBtn.disabled = false;
      alertBox.hidden = true;
      alertBox.innerHTML = '';
    }
  }

  function serviceRow(s) {
    const catName = CATEGORY_NAMES[s.category] || s.category;
    const statusBadge = s.isActive
      ? '<span class="badge badge-mint">Đang hiển thị</span>'
      : '<span class="badge" style="background: var(--color-cream-soft, #f7f9f5); color: var(--text-secondary);">Đã ẩn</span>';

    const actionButtons = isLocked
      ? `<button type="button" class="btn btn-outline btn-sm" disabled>Sửa</button>`
      : `
        <button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${esc(s.id)}">Sửa</button>
        ${s.isActive
          ? `<button type="button" class="btn btn-outline btn-sm" data-action="toggle-status" data-id="${esc(s.id)}" data-active="1" style="color: var(--color-danger-text, #c53030);">Ẩn</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-action="toggle-status" data-id="${esc(s.id)}" data-active="0">Hiện</button>`
        }`;

    return `
      <li class="pet-row" data-service-id="${esc(s.id)}" style="${!s.isActive ? 'opacity: 0.75; background: #fafafa;' : ''}">
        <div class="pet-avatar" aria-hidden="true" style="font-size: 1.125rem; font-weight: 700; background: ${s.isActive ? 'var(--color-mint-light, #ecf9f9)' : '#eee'}; color: var(--color-dark-forest);">
          ${esc(Fmt.initials(s.name))}
        </div>
        <div class="pet-main">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
            <h3 class="pet-name" style="margin: 0;">${esc(s.name)}</h3>
            ${statusBadge}
          </div>
          <p class="pet-summary" style="margin-bottom: 4px;">
            <strong>Danh mục:</strong> <span class="badge badge-mint">${esc(catName)}</span>
            ${s.categoryLabel ? ` · <span>${esc(s.categoryLabel)}</span>` : ''}
          </p>
          <p class="pet-summary" style="margin-bottom: 4px;">
            <strong>Giá niêm yết:</strong> <span style="font-weight: 700; color: var(--color-dark-forest);">${Fmt.vnd(s.priceVnd)}</span> / ${esc(s.unit)} ·
            <strong>Sức chứa:</strong> ${esc(s.slotCapacity)} bé / khung giờ
          </p>
          ${s.description ? `<p class="pet-summary" style="font-size: 0.8125rem; color: var(--text-secondary); margin: 0;">${esc(s.description)}</p>` : ''}
        </div>
        <div class="pet-actions" style="align-items: center; gap: 8px;">
          ${actionButtons}
        </div>
      </li>`;
  }

  function renderList() {
    totalEl.textContent = String(currentTotal);

    if (services.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 48px 16px;">
          <h3 style="font-size: 1.125rem; margin-bottom: 8px;">Cơ sở chưa có dịch vụ nào</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">Hãy thêm dịch vụ đầu tiên để khách hàng có thể tìm kiếm và đặt lịch tại cơ sở của bạn.</p>
          <button type="button" class="btn btn-primary" data-action="add-first" ${isLocked ? 'disabled' : ''}>+ Thêm dịch vụ đầu tiên</button>
        </div>`;
      loadMoreWrap.hidden = true;
      return;
    }

    listEl.innerHTML = `
      <ul class="pet-list" style="list-style: none; padding: 0; margin: 0;">
        ${services.map(serviceRow).join('')}
      </ul>`;

    if (services.length < currentTotal) {
      loadMoreWrap.hidden = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = `Tải thêm (còn ${currentTotal - services.length} dịch vụ)`;
    } else {
      loadMoreWrap.hidden = true;
    }
  }

  async function loadInitial() {
    currentOffset = 0;
    return Panel.load(listEl, async () => {
      try {
        const res = await Api.get('/provider/services', { limit: PAGE_SIZE, offset: 0 });
        setLockState(false);
        services = res.data?.services || [];
        serviceOptions = res.data?.options || null;
        currentTotal = (res.data?.meta && res.data.meta.total) ?? services.length;
        currentOffset = services.length;
        return res;
      } catch (err) {
        if (err.status === 403 || err.status === 409) {
          setLockState(true, err.message);
          services = [];
          currentTotal = 0;
          return { data: { services: [], meta: { total: 0 } } };
        }
        throw err;
      }
    }, renderList, { loading: 'Đang tải danh sách dịch vụ…' });
  }

  async function loadMore() {
    if (isLoadingMore) return;
    isLoadingMore = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Đang tải thêm…';

    try {
      const res = await Api.get('/provider/services', { limit: PAGE_SIZE, offset: currentOffset });
      const nextBatch = res.data?.services || [];
      services = services.concat(nextBatch);
      currentTotal = (res.data?.meta && res.data.meta.total) ?? currentTotal;
      currentOffset += nextBatch.length;
      renderList();
    } catch (err) {
      if (err.status === 403 || err.status === 409) {
        setLockState(true, err.message);
      }
      Toast.show({ title: 'Lỗi tải thêm', message: err.message || 'Không thể tải thêm dịch vụ.', type: 'danger' });
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Thử lại tải thêm';
    } finally {
      isLoadingMore = false;
    }
  }

  /**
   * Dialog thêm/sửa dịch vụ
   */
  function openServiceModal(service = null) {
    if (isLocked) {
      Toast.show({ title: 'Thao tác bị khóa', message: lockReason || 'Cơ sở đang bị khóa.', type: 'danger' });
      return;
    }

    const isEdit = Boolean(service && service.id);
    const dlg = document.createElement('dialog');
    dlg.className = 'pc-dialog';
    dlg.style.maxWidth = '600px';
    dlg.style.width = '90%';
    dlg.setAttribute('aria-labelledby', 'serviceDlgTitle');

    const categories = (serviceOptions && serviceOptions.categories) || [
      { id: 'medical', labels: ['Khám & điều trị', 'Tiêm chủng', 'Phòng bệnh', 'Phẫu thuật'] },
      { id: 'grooming', labels: ['Spa & làm đẹp', 'Cắt tỉa lông', 'Tắm & vệ sinh'] },
      { id: 'hotel', labels: ['Lưu trú', 'Trông giữ theo giờ'] },
      { id: 'emergency', labels: ['Cấp cứu 24/7', 'Hồi sức cấp cứu'] }
    ];

    const currentCatId = service?.category || categories[0]?.id || 'medical';
    const currentCatDef = categories.find((c) => c.id === currentCatId) || categories[0];
    const currentLabel = service?.categoryLabel || (currentCatDef && currentCatDef.labels[0]) || '';

    const catOptionsHtml = categories.map((c) => `
      <option value="${esc(c.id)}" ${c.id === currentCatId ? 'selected' : ''}>
        ${esc(CATEGORY_NAMES[c.id] || c.id)}
      </option>
    `).join('');

    const labelOptionsHtml = (currentCatDef?.labels || []).map((lbl) => `
      <option value="${esc(lbl)}" ${lbl === currentLabel ? 'selected' : ''}>
        ${esc(lbl)}
      </option>
    `).join('');

    dlg.innerHTML = `
      <div class="pc-dialog-body" style="padding: 24px;">
        <h2 id="serviceDlgTitle" style="margin-bottom: 8px;">${isEdit ? 'Chỉnh sửa dịch vụ' : 'Thêm dịch vụ mới'}</h2>
        <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 20px;">
          ${isEdit ? 'Cập nhật thông tin chi tiết dịch vụ của bạn.' : 'Khai báo dịch vụ, đơn giá niêm yết và số lượt có thể phục vụ trong mỗi khung giờ.'}
        </p>

        <form id="serviceModalForm" novalidate>
          <div class="form-group">
            <label class="form-label" for="svcName">Tên dịch vụ <span class="text-danger">*</span></label>
            <input class="form-control" id="svcName" name="name" type="text" maxlength="200" required
              value="${esc(service?.name || '')}" placeholder="Ví dụ: Khám tổng quát & tư vấn dinh dưỡng" aria-describedby="svcName-error">
            <p class="field-error" id="svcName-error" hidden></p>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="svcCategory">Danh mục dịch vụ <span class="text-danger">*</span></label>
              <select class="form-control" id="svcCategory" name="category" aria-describedby="svcCategory-error">
                ${catOptionsHtml}
              </select>
              <p class="field-error" id="svcCategory-error" hidden></p>
            </div>

            <div class="form-group">
              <label class="form-label" for="svcCategoryLabel">Nhãn phân loại</label>
              <select class="form-control" id="svcCategoryLabel" name="categoryLabel" aria-describedby="svcCategoryLabel-error">
                ${labelOptionsHtml}
              </select>
              <p class="field-error" id="svcCategoryLabel-error" hidden></p>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="svcPrice">Giá dịch vụ (VND) <span class="text-danger">*</span></label>
              <input class="form-control" id="svcPrice" name="priceVnd" type="number" min="0" max="100000000" step="1000" required
                value="${service ? esc(service.priceVnd) : ''}" placeholder="Ví dụ: 150000" aria-describedby="svcPrice-error">
              <p class="field-error" id="svcPrice-error" hidden></p>
            </div>

            <div class="form-group">
              <label class="form-label" for="svcUnit">Đơn vị tính <span class="text-danger">*</span></label>
              <input class="form-control" id="svcUnit" name="unit" type="text" maxlength="30" required
                value="${esc(service?.unit || 'lần khám')}" placeholder="Ví dụ: lần khám, ngày, liệu trình" aria-describedby="svcUnit-error">
              <p class="field-error" id="svcUnit-error" hidden></p>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="svcCapacity">Sức chứa mỗi khung giờ <span class="text-danger">*</span></label>
            <input class="form-control" id="svcCapacity" name="slotCapacity" type="number" min="1" max="50" step="1" required
              value="${service ? esc(service.slotCapacity) : '3'}" placeholder="Số bé có thể tiếp nhận cùng lúc (1-50)" aria-describedby="svcCapacity-hint svcCapacity-error">
            <p class="field-hint" id="svcCapacity-hint" style="font-size: 0.8125rem; color: var(--text-secondary); margin-top: 4px;">
              Số lượng lịch hẹn tối đa mà cơ sở có thể nhận cho dịch vụ này trong cùng 1 khung giờ.
            </p>
            <p class="field-error" id="svcCapacity-error" hidden></p>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <label class="form-label" for="svcDescription">Mô tả chi tiết dịch vụ</label>
              <span id="svcDescCount" style="font-size: 0.8125rem; color: var(--text-secondary);">${(service?.description || '').length}/500</span>
            </div>
            <textarea class="form-control" id="svcDescription" name="description" rows="3" maxlength="500"
              placeholder="Quy trình, đối tượng phù hợp, lưu ý trước khi mang bé đến…" aria-describedby="svcDescription-error" style="resize: vertical;">${esc(service?.description || '')}</textarea>
            <p class="field-error" id="svcDescription-error" hidden></p>
          </div>

          <div class="pc-dialog-actions pc-dialog-actions-row" style="margin-top: 24px;">
            <button type="button" class="btn btn-outline" data-dlg-action="cancel">Hủy</button>
            <button type="submit" class="btn btn-primary" id="saveSvcBtn">${isEdit ? 'Lưu thay đổi' : 'Tạo dịch vụ'}</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(dlg);
    dlg.showModal();

    const form = dlg.querySelector('#serviceModalForm');
    const catSelect = dlg.querySelector('#svcCategory');
    const labelSelect = dlg.querySelector('#svcCategoryLabel');
    const descTextarea = dlg.querySelector('#svcDescription');
    const descCount = dlg.querySelector('#svcDescCount');

    // Initial snapshot to check dirty state on cancel
    const initialValues = {
      name: form.name.value,
      category: form.category.value,
      categoryLabel: form.categoryLabel.value,
      priceVnd: form.priceVnd.value,
      unit: form.unit.value,
      slotCapacity: form.slotCapacity.value,
      description: form.description.value
    };

    function isDirty() {
      return form.name.value !== initialValues.name ||
             form.category.value !== initialValues.category ||
             form.categoryLabel.value !== initialValues.categoryLabel ||
             form.priceVnd.value !== initialValues.priceVnd ||
             form.unit.value !== initialValues.unit ||
             form.slotCapacity.value !== initialValues.slotCapacity ||
             form.description.value !== initialValues.description;
    }

    // Dynamic category label update
    catSelect.addEventListener('change', () => {
      const selectedCat = categories.find((c) => c.id === catSelect.value);
      if (selectedCat) {
        labelSelect.innerHTML = selectedCat.labels.map((lbl) => `
          <option value="${esc(lbl)}">${esc(lbl)}</option>
        `).join('');
      } else {
        labelSelect.innerHTML = '';
      }
    });

    if (descTextarea && descCount) {
      descTextarea.addEventListener('input', () => {
        descCount.textContent = `${descTextarea.value.length}/500`;
      });
    }

    let closing = false;
    const requestClose = (force = false) => {
      if (closing) return;
      if (!force && isDirty()) {
        const confirmDiscard = window.confirm('Bạn có thay đổi chưa lưu. Bạn có chắc muốn hủy bỏ?');
        if (!confirmDiscard) return;
      }
      closing = true;
      dlg.classList.add('is-closing');
      const finish = () => { if (dlg.open) dlg.close(); };
      dlg.addEventListener('animationend', (e) => { if (e.target === dlg) finish(); }, { once: true });
      setTimeout(finish, 320);
    };

    dlg.addEventListener('click', (e) => {
      if (e.target.getAttribute('data-dlg-action') === 'cancel') {
        requestClose(false);
      } else if (e.target === dlg) {
        requestClose(false);
      }
    });

    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose(false);
    });

    dlg.addEventListener('close', () => dlg.remove());

    // Submit handler
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Clear previous errors
      dlg.querySelectorAll('.field-error').forEach((p) => { p.hidden = true; p.textContent = ''; });
      dlg.querySelectorAll('.is-invalid').forEach((el) => { el.classList.remove('is-invalid'); });

      const saveBtn = dlg.querySelector('#saveSvcBtn');
      saveBtn.disabled = true;
      saveBtn.classList.add('is-loading');

      const payload = {
        name: form.name.value.trim(),
        category: form.category.value,
        categoryLabel: form.categoryLabel.value,
        priceVnd: Number(form.priceVnd.value),
        unit: form.unit.value.trim(),
        slotCapacity: Number(form.slotCapacity.value),
        description: form.description.value.trim()
      };

      try {
        if (isEdit) {
          const res = await Api.put(`/provider/services/${encodeURIComponent(service.id)}`, payload);
          Toast.show({ title: 'Thành công', message: 'Đã cập nhật dịch vụ.', type: 'success' });
        } else {
          const res = await Api.post('/provider/services', payload);
          Toast.show({ title: 'Thành công', message: 'Đã tạo dịch vụ mới.', type: 'success' });
        }
        requestClose(true);
        loadInitial();
      } catch (err) {
        if (err.status === 403 || err.status === 409) {
          if (err.code === 'conflict' && !err.errors) {
            // Lỗi khóa cơ sở hoặc đạt giới hạn tối đa
            setLockState(true, err.message);
            Toast.show({ title: 'Không thể thực hiện', message: err.message, type: 'danger' });
            requestClose(true);
            return;
          }
        }

        if (err.code === 'validation' && err.errors) {
          const fieldMap = {
            name: 'svcName',
            category: 'svcCategory',
            categoryLabel: 'svcCategoryLabel',
            priceVnd: 'svcPrice',
            unit: 'svcUnit',
            slotCapacity: 'svcCapacity',
            description: 'svcDescription'
          };
          Object.keys(err.errors).forEach((k) => {
            const elId = fieldMap[k];
            if (elId) {
              const inp = dlg.querySelector(`#${elId}`);
              const errEl = dlg.querySelector(`#${elId}-error`);
              if (inp) inp.classList.add('is-invalid');
              if (errEl) {
                errEl.textContent = err.errors[k];
                errEl.hidden = false;
              }
            }
          });
          Toast.show({ title: 'Dữ liệu chưa đúng', message: err.message || 'Vui lòng kiểm tra lại các trường được đánh dấu.', type: 'danger' });
        } else {
          Toast.show({ title: 'Lỗi', message: err.message || 'Không thể lưu dịch vụ.', type: 'danger' });
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.classList.remove('is-loading');
      }
    });
  }

  /**
   * Dialog xác nhận Ẩn / Hiện dịch vụ
   */
  function confirmToggleStatus(service, activate) {
    if (isLocked) {
      Toast.show({ title: 'Thao tác bị khóa', message: lockReason || 'Cơ sở đang bị khóa.', type: 'danger' });
      return;
    }

    const dlg = document.createElement('dialog');
    dlg.className = 'pc-dialog';
    dlg.setAttribute('aria-labelledby', 'toggleDlgTitle');

    const title = activate ? 'Hiển thị lại dịch vụ' : 'Ẩn dịch vụ';
    const text = activate
      ? `Dịch vụ <strong>${esc(service.name)}</strong> sẽ được hiển thị công khai trở lại và tiếp nhận lịch hẹn mới.`
      : `Dịch vụ sẽ không còn hiển thị và không nhận lịch mới; các lịch đã đặt vẫn giữ nguyên. Bạn có chắc muốn ẩn <strong>${esc(service.name)}</strong>?`;

    const btnClass = activate ? 'btn-primary' : 'btn-danger';
    const btnLabel = activate ? 'Hiển thị lại' : 'Xác nhận ẩn';

    dlg.innerHTML = `
      <div class="pc-dialog-body" style="padding: 24px;">
        <h2 id="toggleDlgTitle" style="margin-bottom: 8px;">${title}</h2>
        <p style="margin-bottom: 20px; line-height: 1.5;">${text}</p>
        <div class="pc-dialog-actions pc-dialog-actions-row">
          <button type="button" class="btn btn-outline" data-action="cancel">Hủy</button>
          <button type="button" class="btn ${btnClass}" data-action="confirm">${btnLabel}</button>
        </div>
      </div>`;

    document.body.appendChild(dlg);
    dlg.showModal();

    let closing = false;
    const requestClose = () => {
      if (closing) return;
      closing = true;
      dlg.classList.add('is-closing');
      const finish = () => { if (dlg.open) dlg.close(); };
      dlg.addEventListener('animationend', (e) => { if (e.target === dlg) finish(); }, { once: true });
      setTimeout(finish, 320);
    };

    dlg.addEventListener('click', async (e) => {
      const act = e.target.getAttribute('data-action');
      if (act === 'cancel' || e.target === dlg) {
        requestClose();
      } else if (act === 'confirm') {
        const btn = e.target;
        btn.disabled = true;
        btn.classList.add('is-loading');
        try {
          const endpoint = activate
            ? `/provider/services/${encodeURIComponent(service.id)}/enable`
            : `/provider/services/${encodeURIComponent(service.id)}/disable`;
          await Api.post(endpoint);
          Toast.show({
            title: 'Thành công',
            message: activate ? 'Đã kích hoạt lại dịch vụ.' : 'Đã ẩn dịch vụ thành công.',
            type: 'success'
          });
          requestClose();
          loadInitial();
        } catch (err) {
          if (err.status === 403 || err.status === 409) {
            setLockState(true, err.message);
          }
          Toast.show({ title: 'Lỗi', message: err.message || 'Không thể thực hiện thao tác.', type: 'danger' });
          btn.disabled = false;
          btn.classList.remove('is-loading');
        }
      }
    });

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
    dlg.addEventListener('close', () => dlg.remove());
  }

  // Delegated events on list
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');

    if (action === 'add-first') {
      openServiceModal(null);
      return;
    }

    const row = btn.closest('li[data-service-id]');
    if (!row) return;
    const serviceId = row.getAttribute('data-service-id');
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;

    if (action === 'edit') {
      openServiceModal(service);
    } else if (action === 'toggle-status') {
      const currentlyActive = btn.getAttribute('data-active') === '1';
      confirmToggleStatus(service, !currentlyActive);
    }
  });

  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => openServiceModal(null));
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadInitial());
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadMore());
  }

  loadInitial();
});
