/**
 * PetCare AI Hub - Change Password page controller
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const form = document.getElementById('changePasswordForm');
  if (!form) return;

  const alertBox = document.getElementById('formAlert');
  const submitBtn = document.getElementById('submitBtn');
  const mandatoryNotice = document.getElementById('mandatoryNotice');
  const pwInput = document.getElementById('newPassword');
  const checks = document.querySelectorAll('#password-checks [data-check]');

  const currentUser = AuthService.currentUser();
  if (currentUser && currentUser.mustChangePassword && mandatoryNotice) {
    mandatoryNotice.hidden = false;
  }

  /* ---------- Helpers ---------- */
  function setFieldError(name, message) {
    const input = document.getElementById(name);
    const err = document.getElementById(`${name}-error`);
    if (!input || !err) return;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = message;
      err.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
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
    alertBox.hidden = true;
  }

  function showAlert(message, kind = 'error') {
    alertBox.className = `form-alert form-alert-${kind}`;
    alertBox.textContent = message;
    alertBox.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    alertBox.hidden = false;
  }

  function applyErrors(errors) {
    const names = Object.keys(errors);
    names.forEach((n) => setFieldError(n, errors[n]));
    const first = names.map((n) => document.getElementById(n)).find(Boolean);
    if (first) first.focus();
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle('is-loading', busy);
  }

  function resolveLandingPage(user) {
    if (!user) return '../index.html';
    if (user.role === 'customer') return 'customer-dashboard.html';
    // Đối với provider/vet/admin (chưa có dashboard riêng ở C1) chuyển về trang chủ hoặc landing phù hợp
    return '../index.html';
  }

  // Clear a field's error on input
  document.querySelectorAll('.form-control').forEach((el) => {
    el.addEventListener('input', () => setFieldError(el.id, ''));
  });

  // Password strength checklist on new password
  if (pwInput && checks.length) {
    pwInput.addEventListener('input', () => {
      const state = AuthService.validators.passwordChecks(pwInput.value);
      checks.forEach((li) => {
        const met = state[li.dataset.check];
        li.classList.toggle('is-met', met);
        li.firstElementChild.textContent = met ? '✓' : '○';
      });
    });
  }

  // Show / hide password
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ẩn' : 'Hiện';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    setBusy(true);

    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    const confirmPassword = form.confirmPassword.value;

    try {
      const updatedUser = await AuthService.changePassword({
        currentPassword,
        newPassword,
        confirmPassword
      });

      setBusy(false);
      Toast.success('Đổi mật khẩu thành công!');

      const wrap = document.getElementById('changePasswordWrap');
      const landing = resolveLandingPage(updatedUser);

      if (wrap) {
        wrap.innerHTML = `
          <div class="auth-done">
            <h1>Đổi mật khẩu thành công</h1>
            <p>Mật khẩu tài khoản của bạn đã được cập nhật thành công và an toàn.</p>
            <a class="btn btn-primary" href="${landing}">Tiếp tục</a>
          </div>`;
      } else {
        setTimeout(() => {
          window.location.href = landing;
        }, 1200);
      }
    } catch (err) {
      setBusy(false);
      if (err.code === 'validation') {
        if (err.errors) {
          applyErrors(err.errors);
        }
        showAlert(err.message || 'Vui lòng kiểm tra lại thông tin đổi mật khẩu.');
        alertBox.focus();
      } else {
        showAlert(err.message || 'Đã xảy ra lỗi khi đổi mật khẩu. Vui lòng thử lại.');
        alertBox.focus();
      }
    }
  });
});
