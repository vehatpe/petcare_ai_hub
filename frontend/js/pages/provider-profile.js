/**
 * PetCare AI Hub - Provider Profile Page
 * Handles displaying provider profile, editing editable fields (address, phone, description, licenseNo, taxCode),
 * read-only display for name/area/type, character counting, and lock state handling (403/409).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'provider') return;

  const esc = Fmt.esc;
  const container = document.getElementById('profileContainer');

  const TYPE_LABEL = {
    clinic: 'Phòng khám / Bệnh viện thú y',
    spa: 'Spa & Cắt tỉa grooming',
    hotel: 'Khách sạn thú cưng',
    emergency: 'Cấp cứu thú y 24/7'
  };

  let currentProfile = null;
  let isLocked = false;
  let lockReason = '';

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach((p) => {
      p.hidden = true;
      p.textContent = '';
    });
    form.querySelectorAll('.is-invalid').forEach((el) => {
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
    });
  }

  function applyErrors(form, errors = {}) {
    Object.keys(errors).forEach((key) => {
      const input = form.elements[key];
      const errEl = form.querySelector(`#${key}-error`);
      if (input) {
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
      }
      if (errEl) {
        errEl.textContent = errors[key];
        errEl.hidden = false;
      }
    });
  }

  function renderProfile(profile) {
    currentProfile = profile;
    const typeText = TYPE_LABEL[profile.type] || profile.type || 'Chưa phân loại';
    const descLen = (profile.description || '').length;

    const lockBanner = isLocked ? `
      <div class="form-alert form-alert-error" role="alert" style="margin-bottom: 24px; padding: 16px; border-radius: var(--radius-card);">
        <strong>Cơ sở đang bị tạm khóa:</strong> ${esc(lockReason || 'Cơ sở hoặc tài khoản đang bị vô hiệu hóa. Bạn chỉ có thể xem thông tin, không thể chỉnh sửa.')}
      </div>` : '';

    container.innerHTML = `
      ${lockBanner}
      <div class="dash-grid" style="grid-template-columns: 1fr; max-width: 860px; margin: 0 auto;">
        <section class="dash-section" aria-labelledby="profileHeading">
          <div class="dash-section-head">
            <h2 id="profileHeading">Thông tin cơ sở dịch vụ</h2>
            <span class="badge ${profile.isActive ? 'badge-mint' : 'badge-danger'}">
              ${profile.isActive ? 'Đang hoạt động' : 'Đã khóa'}
            </span>
          </div>

          <!-- Thông tin do Admin quản lý (Chỉ đọc) -->
          <div style="background: var(--color-mint-light, #ecf9f9); border: 1px solid var(--border-hairline, #e2e8f0); border-radius: var(--radius-card, 16px); padding: 20px; margin-bottom: 28px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
              <h3 style="font-size: 1rem; margin: 0; color: var(--color-dark-forest);">Thông tin hệ thống</h3>
              <span class="text-muted" style="font-size: 0.8125rem;">(do quản trị viên quản lý)</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
              <div>
                <label style="font-size: 0.8125rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Tên cơ sở</label>
                <strong style="font-size: 1rem; color: var(--color-dark-forest);">${esc(profile.name || 'Chưa đặt tên')}</strong>
              </div>
              <div>
                <label style="font-size: 0.8125rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Loại hình</label>
                <span class="badge badge-mint">${esc(typeText)}</span>
              </div>
              <div>
                <label style="font-size: 0.8125rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Khu vực hoạt động</label>
                <strong style="font-size: 0.9375rem;">${esc(profile.area || 'Chưa cập nhật')}</strong>
              </div>
            </div>
          </div>

          <!-- Biểu mẫu cập nhật hồ sơ -->
          <form id="profileForm" novalidate>
            <div class="form-group">
              <label class="form-label" for="address">Địa chỉ cơ sở</label>
              <input class="form-control" id="address" name="address" type="text" maxlength="200"
                value="${esc(profile.address || '')}" placeholder="Ví dụ: 123 Nguyễn Thị Minh Khai, P. Bến Thành, Q. 1"
                aria-describedby="address-error" ${isLocked ? 'disabled' : ''}>
              <p class="field-error" id="address-error" hidden></p>
            </div>

            <div class="form-group">
              <label class="form-label" for="phone">Số điện thoại cơ sở</label>
              <input class="form-control" id="phone" name="phone" type="tel" inputmode="tel" maxlength="15"
                value="${esc(profile.phone || '')}" placeholder="Ví dụ: 0912 345 678"
                aria-describedby="phone-error" ${isLocked ? 'disabled' : ''}>
              <p class="field-error" id="phone-error" hidden></p>
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <label class="form-label" for="description">Mô tả giới thiệu cơ sở</label>
                <span id="descCount" style="font-size: 0.8125rem; color: var(--text-secondary);">${descLen}/500</span>
              </div>
              <textarea class="form-control" id="description" name="description" rows="4" maxlength="500"
                placeholder="Giới thiệu về cơ sở, đội ngũ, trang thiết bị và cam kết chất lượng…"
                aria-describedby="description-error" style="resize: vertical;" ${isLocked ? 'disabled' : ''}>${esc(profile.description || '')}</textarea>
              <p class="field-error" id="description-error" hidden></p>
            </div>

            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-hairline, #e2e8f0);">
              <h3 style="font-size: 1rem; margin-bottom: 8px; color: var(--color-dark-forest);">Thông tin pháp lý (tùy chọn)</h3>
              <p style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 16px;">
                Chỉ quản trị viên nhìn thấy để xác minh cơ sở; không hiển thị trên trang công khai.
              </p>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="licenseNo">Số giấy phép hành nghề</label>
                  <input class="form-control" id="licenseNo" name="licenseNo" type="text" maxlength="50"
                    value="${esc(profile.licenseNo || '')}" placeholder="Ví dụ: 123/CCCN-TY"
                    aria-describedby="licenseNo-error" ${isLocked ? 'disabled' : ''}>
                  <p class="field-error" id="licenseNo-error" hidden></p>
                </div>

                <div class="form-group">
                  <label class="form-label" for="taxCode">Mã số thuế</label>
                  <input class="form-control" id="taxCode" name="taxCode" type="text" maxlength="20"
                    value="${esc(profile.taxCode || '')}" placeholder="Ví dụ: 0101234567"
                    aria-describedby="taxCode-error" ${isLocked ? 'disabled' : ''}>
                  <p class="field-error" id="taxCode-error" hidden></p>
                </div>
              </div>
            </div>

            <div style="margin-top: 28px; display: flex; justify-content: flex-end; gap: 12px;">
              <button type="submit" class="btn btn-primary" id="saveProfileBtn" ${isLocked ? 'disabled' : ''}>
                Lưu thay đổi
              </button>
            </div>
          </form>
        </section>
      </div>`;

    attachFormEvents();
  }

  function attachFormEvents() {
    const form = document.getElementById('profileForm');
    if (!form || isLocked) return;

    const descInput = document.getElementById('description');
    const descCount = document.getElementById('descCount');
    if (descInput && descCount) {
      descInput.addEventListener('input', () => {
        descCount.textContent = `${descInput.value.length}/500`;
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);

      const saveBtn = document.getElementById('saveProfileBtn');
      saveBtn.disabled = true;
      saveBtn.classList.add('is-loading');

      const payload = {
        address: form.address.value.trim(),
        phone: form.phone.value.trim(),
        description: form.description.value.trim(),
        licenseNo: form.licenseNo.value.trim(),
        taxCode: form.taxCode.value.trim()
      };

      try {
        const res = await Api.put('/provider/profile', payload);
        Toast.show({ title: 'Thành công', message: 'Hồ sơ cơ sở đã được cập nhật thành công.', type: 'success' });
        if (res.data) {
          renderProfile(res.data);
        } else {
          loadProfile();
        }
      } catch (err) {
        if (err.status === 403 || err.status === 409) {
          isLocked = true;
          lockReason = err.message || 'Cơ sở đã bị tạm khóa.';
          renderProfile(currentProfile || {});
          Toast.show({ title: 'Cơ sở bị khóa', message: lockReason, type: 'danger' });
          return;
        }

        if (err.code === 'validation' && err.errors) {
          applyErrors(form, err.errors);
          Toast.show({ title: 'Dữ liệu chưa đúng', message: err.message || 'Vui lòng kiểm tra lại các trường được đánh dấu.', type: 'danger' });
        } else {
          Toast.show({ title: 'Lỗi cập nhật', message: err.message || 'Không thể lưu hồ sơ.', type: 'danger' });
        }
      } finally {
        if (!isLocked) {
          saveBtn.disabled = false;
          saveBtn.classList.remove('is-loading');
        }
      }
    });
  }

  async function loadProfile() {
    return Panel.load(container, async () => {
      try {
        const res = await Api.get('/provider/profile');
        isLocked = false;
        return res.data;
      } catch (err) {
        if (err.status === 403 || err.status === 409) {
          isLocked = true;
          lockReason = err.message || 'Cơ sở đã bị tạm khóa hoặc chưa được kích hoạt.';
          return {
            name: user.orgName || 'Cơ sở đối tác',
            type: user.orgType || '',
            area: user.orgArea || '',
            address: '',
            phone: '',
            description: '',
            licenseNo: '',
            taxCode: '',
            isActive: false
          };
        }
        throw err;
      }
    }, renderProfile, { loading: 'Đang tải hồ sơ cơ sở…' });
  }

  loadProfile();
});
