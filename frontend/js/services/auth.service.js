/**
 * PetCare AI Hub - Auth Service
 * Talks to /api/v1/auth. The server is the source of truth: it hashes passwords (bcrypt),
 * issues the JWT and enforces roles. This file keeps fast client-side validation for
 * friendlier messages, the cached session, and the "next" redirect whitelist.
 *
 * Exposed as window.AuthService
 */
(function () {
  'use strict';

  const NEXT_PATTERN = /^[a-z][a-z-]*\.html(?:\?[A-Za-z0-9=&%._-]*)?$/;
  const PROVIDER_TYPES = ['clinic', 'spa', 'hotel', 'emergency'];

  class AuthError extends Error {
    constructor(code, message, errors = {}) {
      super(message);
      this.name = 'AuthError';
      this.code = code;
      this.errors = errors; // { fieldName: message }
    }
  }

  /* ---------- Paths (works from / and /pages/) ---------- */
  const inPagesDir = /\/pages\/[^/]*$/.test(window.location.pathname);
  const pageUrl = (name) => (inPagesDir ? '' : 'pages/') + name;
  const homeUrl = () => (inPagesDir ? '../index.html' : 'index.html');

  /** Accepts "booking.html?x=1", "pages/booking.html", "../pages/booking.html"; rejects everything else. */
  function safeNext(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/^(?:\.\.\/|\.\/)+/, '').replace(/^pages\//, '');
    return NEXT_PATTERN.test(cleaned) ? cleaned : null;
  }

  function currentAsNext() {
    if (!inPagesDir) return null;
    const file = window.location.pathname.split('/').pop();
    return safeNext(file + window.location.search);
  }

  /* ---------- Validation (mirrors the server; the server is still authoritative) ---------- */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^(?:\+?84|0)(?:3|5|7|8|9)\d{8}$/;

  function normalizePhone(raw) {
    const compact = String(raw || '').replace(/[\s.\-()]/g, '');
    if (!PHONE_RE.test(compact)) return null;
    return compact.replace(/^\+?84/, '0');
  }

  const validators = {
    email: (v) => EMAIL_RE.test(String(v || '').trim()),
    phone: (v) => normalizePhone(v) !== null,
    passwordChecks(v) {
      const value = String(v || '');
      return { length: value.length >= 8, mix: /[A-Za-zÀ-ỹ]/.test(value) && /\d/.test(value) };
    }
  };

  /** Turns an ApiError into an AuthError the forms already know how to display. */
  function toAuthError(err) {
    if (err instanceof ApiError) return new AuthError(err.code, err.message, err.errors);
    return err;
  }

  const AuthService = {
    AuthError,
    validators,
    normalizePhone,
    PROVIDER_TYPES,
    pageUrl,
    homeUrl,
    safeNext,
    currentAsNext,

    /** Cached user from the stored session (synchronous). Call refresh() to re-check with the server. */
    currentUser() {
      const s = Api.session.get();
      return s ? s.user : null;
    },

    isLoggedIn() {
      return this.currentUser() !== null;
    },

    /** Validates the stored token with the server; signs out locally if it is no longer valid. */
    async refresh() {
      if (!this.isLoggedIn()) return null;
      try {
        const data = await Api.get('/auth/me');
        Api.session.updateUser(data.user);
        return data.user;
      } catch (err) {
        if (err.status === 401) Api.session.clear();
        return null; // network errors keep the cached session
      }
    },

    async register(input) {
      const data = {
        role: input.role === 'provider' ? 'provider' : 'customer',
        fullName: String(input.fullName || '').trim().replace(/\s+/g, ' '),
        email: String(input.email || '').trim().toLowerCase(),
        phone: normalizePhone(input.phone),
        password: String(input.password || ''),
        orgName: String(input.orgName || '').trim(),
        orgType: String(input.orgType || ''),
        orgArea: String(input.orgArea || '').trim(),
        licenseNo: input.licenseNo !== undefined && input.licenseNo !== null ? String(input.licenseNo).trim() : null,
        taxCode: input.taxCode !== undefined && input.taxCode !== null ? String(input.taxCode).trim() : null
      };

      const errors = {};
      if (data.fullName.length < 2) errors.fullName = 'Vui lòng nhập họ và tên (ít nhất 2 ký tự).';
      if (!validators.email(data.email)) errors.email = 'Email chưa đúng định dạng, ví dụ: ten@gmail.com.';
      if (!data.phone) errors.phone = 'Số điện thoại Việt Nam gồm 10 số, ví dụ: 0912 345 678.';
      const pw = validators.passwordChecks(data.password);
      if (!pw.length || !pw.mix) errors.password = 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.';
      if (data.role === 'provider') {
        if (data.orgName.length < 2) errors.orgName = 'Vui lòng nhập tên cơ sở.';
        if (!PROVIDER_TYPES.includes(data.orgType)) errors.orgType = 'Vui lòng chọn loại hình cơ sở.';
        if (!data.orgArea) errors.orgArea = 'Vui lòng nhập khu vực hoạt động của cơ sở.';
        else if (data.orgArea.length > 100) errors.orgArea = 'Khu vực tối đa 100 ký tự.';

        if (data.licenseNo) {
          if (data.licenseNo.length > 50) errors.licenseNo = 'Số giấy phép hành nghề tối đa 50 ký tự.';
          else if (!/^[A-Za-z0-9\s/.\-]+$/.test(data.licenseNo)) errors.licenseNo = 'Số giấy phép chỉ gồm chữ, số, khoảng trắng và các ký tự / - .';
        }
        if (data.taxCode) {
          const compactTax = data.taxCode.replace(/[\s\-]/g, '');
          if (!/^\d{10}$|^\d{13}$/.test(compactTax)) errors.taxCode = 'Mã số thuế phải gồm 10 hoặc 13 chữ số.';
        }
      }
      if (Object.keys(errors).length) {
        throw new AuthError('validation', 'Vui lòng kiểm tra lại các trường được đánh dấu.', errors);
      }

      try {
        const res = await Api.post('/auth/register', data, { auth: false });
        if (res.token) Api.session.set({ token: res.token, user: res.user }, input.remember !== false);
        return res.user;
      } catch (err) {
        throw toAuthError(err);
      }
    },

    async login({ identifier, password, remember }) {
      const id = String(identifier || '').trim();
      const pw = String(password || '');
      const errors = {};
      if (!id) errors.identifier = 'Vui lòng nhập email hoặc số điện thoại.';
      if (!pw) errors.password = 'Vui lòng nhập mật khẩu.';
      if (Object.keys(errors).length) throw new AuthError('validation', 'Vui lòng nhập đủ thông tin đăng nhập.', errors);

      try {
        const res = await Api.post('/auth/login', { identifier: id, password: pw, remember: Boolean(remember) }, { auth: false });
        Api.session.set({ token: res.token, user: res.user }, Boolean(remember));
        return res.user;
      } catch (err) {
        throw toAuthError(err);
      }
    },

    logout() {
      Api.session.clear();
    },

    async changePassword({ currentPassword, newPassword, confirmPassword }) {
      const cur = String(currentPassword || '');
      const nextPw = String(newPassword || '');
      const confirm = String(confirmPassword || '');
      const errors = {};

      if (!cur) errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
      const pwCheck = validators.passwordChecks(nextPw);
      if (!pwCheck.length || !pwCheck.mix || nextPw.length > 72) {
        errors.newPassword = 'Mật khẩu mới cần ít nhất 8 ký tự, gồm cả chữ và số (tối đa 72 ký tự).';
      } else if (cur && cur === nextPw) {
        errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
      }
      if (!confirm) {
        errors.confirmPassword = 'Vui lòng xác nhận mật khẩu mới.';
      } else if (nextPw && confirm !== nextPw) {
        errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
      }

      if (Object.keys(errors).length) {
        throw new AuthError('validation', 'Vui lòng kiểm tra lại thông tin đổi mật khẩu.', errors);
      }

      try {
        const res = await Api.post('/auth/change-password', { currentPassword: cur, newPassword: nextPw });
        if (res.token) {
          Api.session.updateToken(res.token);
        }
        if (res.user) {
          Api.session.updateUser(res.user);
        }
        return res.user;
      } catch (err) {
        throw toAuthError(err);
      }
    }
  };

  window.AuthService = AuthService;
})();
