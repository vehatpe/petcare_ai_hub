/**
 * PetCare AI Hub - Login & Register page controller
 * Handles both pages: detects #loginForm / #registerForm.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const next = AuthService.safeNext(params.get('next'));
  const afterAuth = () => next || 'customer-dashboard.html';

  // Already signed in -> no reason to show the form.
  if (AuthService.isLoggedIn()) {
    window.location.replace(afterAuth());
    return;
  }

  // Keep the post-login destination when switching between login <-> register.
  document.querySelectorAll('[data-keep-next]').forEach((a) => {
    if (next) a.href += `?next=${encodeURIComponent(next)}`;
  });

  const alertBox = document.getElementById('formAlert');
  const submitBtn = document.getElementById('submitBtn');

  /* ---------- Shared helpers ---------- */
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

  function clearErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    form.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; el.textContent = ''; });
    alertBox.hidden = true;
  }

  function showAlert(message, kind = 'error') {
    alertBox.className = `form-alert form-alert-${kind}`;
    alertBox.textContent = message;
    alertBox.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    alertBox.hidden = false;
  }

  function applyErrors(form, errors) {
    const names = Object.keys(errors);
    names.forEach((n) => setFieldError(n, errors[n]));
    const first = names.map((n) => document.getElementById(n)).find(Boolean);
    if (first) first.focus();
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle('is-loading', busy);
  }

  // Clear a field's error as soon as the user edits it.
  document.querySelectorAll('.form-control').forEach((el) => {
    el.addEventListener('input', () => setFieldError(el.id, ''));
  });

  // Show / hide password
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ẩn' : 'Hiện';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  /* ---------- Login ---------- */
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(loginForm);
      setBusy(true);
      try {
        await AuthService.login({
          identifier: loginForm.identifier.value,
          password: loginForm.password.value,
          remember: loginForm.remember.checked
        });
        window.location.href = afterAuth();
      } catch (err) {
        setBusy(false);
        if (err.code === 'validation') {
          applyErrors(loginForm, err.errors);
        } else {
          showAlert(err.message, err.code === 'pending' ? 'info' : 'error');
          alertBox.focus();
        }
      }
    });
  }

  /* ---------- Register ---------- */
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    const partnerFields = document.getElementById('partnerFields');
    const pwInput = document.getElementById('password');
    const checks = document.querySelectorAll('#password-checks [data-check]');
    const selectedRole = () => registerForm.querySelector('input[name="role"]:checked').value;

    if (params.get('role') === 'provider') {
      registerForm.querySelector('input[name="role"][value="provider"]').checked = true;
      partnerFields.hidden = false;
    }

    registerForm.querySelectorAll('input[name="role"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        partnerFields.hidden = selectedRole() !== 'provider';
      });
    });

    pwInput.addEventListener('input', () => {
      const state = AuthService.validators.passwordChecks(pwInput.value);
      checks.forEach((li) => {
        const met = state[li.dataset.check];
        li.classList.toggle('is-met', met);
        li.firstElementChild.textContent = met ? '✓' : '○';
      });
    });

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(registerForm);
      setBusy(true);
      const role = selectedRole();
      try {
        const user = await AuthService.register({
          role,
          fullName: registerForm.fullName.value,
          email: registerForm.email.value,
          phone: registerForm.phone.value,
          password: registerForm.password.value,
          orgName: registerForm.orgName.value,
          orgType: registerForm.orgType.value
        });

        if (user.status === 'active') {
          // New owners have no pets yet: send them to the pet form first,
          // unless they were headed somewhere specific.
          const target = next || 'pet-profile.html?welcome=1';
          window.location.href = target;
          return;
        }

        document.getElementById('registerWrap').innerHTML = `
          <div class="auth-done">
            <h1>Đã gửi hồ sơ đối tác</h1>
            <p>Cảm ơn <strong>${Fmt.esc(user.orgName)}</strong>. Quản trị viên sẽ xem xét và liên hệ qua email <strong>${Fmt.esc(user.email)}</strong> hoặc số điện thoại bạn đã cung cấp. Bạn chưa thể đăng nhập cho tới khi hồ sơ được phê duyệt.</p>
            <a class="btn btn-primary" href="../index.html">Về trang chủ</a>
          </div>`;
      } catch (err) {
        setBusy(false);
        if (err.code === 'validation' || err.code === 'duplicate') {
          applyErrors(registerForm, err.errors);
        } else {
          showAlert(err.message);
          alertBox.focus();
        }
      }
    });
  }
});
