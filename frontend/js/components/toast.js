/**
 * PetCare AI Hub - Reusable Toast Notification System
 */

/** Visible time (ms) when the caller does not pass `duration`. Errors and warnings stay longer. */
const TOAST_DEFAULT_DURATION = { success: 4500, info: 4500, warning: 6000, danger: 6000 };

const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show({ title = 'Thông báo', message = '', type = 'info', duration } = {}) {
    this.init();
    if (!(Number.isFinite(duration) && duration > 0)) {
      duration = TOAST_DEFAULT_DURATION[type] || TOAST_DEFAULT_DURATION.info;
    }

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    
    // Icon based on type
    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1E824C" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else {
      iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#163300" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.setAttribute('role', type === 'danger' ? 'alert' : 'status');
    toast.style.setProperty('--toast-duration', duration + 'ms');
    toast.innerHTML = `
      <div aria-hidden="true">${iconSvg}</div>
      <div class="toast-body">
        <div class="toast-title"></div>
        <div class="toast-message"></div>
      </div>
      <button type="button" class="toast-close" aria-label="Đóng thông báo">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <div class="toast-progress" aria-hidden="true"></div>
    `;
    // Text is inserted as text, never as HTML (titles/messages can contain user-entered names).
    toast.querySelector('.toast-title').textContent = title;
    toast.querySelector('.toast-message').textContent = message;

    this.container.appendChild(toast);
    this.schedule(toast, duration);
  },

  /**
   * Auto-dismiss timer that pauses while the toast is hovered or holds focus
   * (WCAG 2.2.1) and resumes with the time that was left, in step with the
   * countdown bar (its animation-play-state is paused by .is-paused).
   */
  schedule(toast, duration) {
    let remaining = duration;
    let startedAt = Date.now();
    let timer = null;
    let closing = false;

    const dismiss = () => {
      if (closing) return;
      closing = true;
      clearTimeout(timer);
      toast.classList.add('is-leaving');
      // animationend bubbles: only the toast's own leave animation may remove it,
      // never the countdown bar's (.toast-progress) or any other child's.
      const onEnd = (e) => {
        if (e.target !== toast) return;
        toast.removeEventListener('animationend', onEnd);
        toast.remove();
      };
      toast.addEventListener('animationend', onEnd);
      setTimeout(() => toast.remove(), 400); // fallback when animations are disabled
    };

    const run = () => {
      clearTimeout(timer); // never leave a second timer running
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
    };

    const pause = () => {
      if (closing || toast.classList.contains('is-paused')) return;
      toast.classList.add('is-paused');
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };

    const resume = () => {
      if (closing || !toast.classList.contains('is-paused')) return;
      if (toast.matches(':hover') || toast.matches(':focus-within')) return;
      toast.classList.remove('is-paused');
      run();
    };

    toast.addEventListener('mouseenter', pause);
    toast.addEventListener('mouseleave', resume);
    toast.addEventListener('focusin', pause);
    toast.addEventListener('focusout', () => setTimeout(resume, 0));
    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    run();
  },

  success(title, message = '') {
    this.show({ title, message, type: 'success' });
  },

  error(title, message = '') {
    this.show({ title, message, type: 'danger' });
  },

  info(title, message = '') {
    this.show({ title, message, type: 'info' });
  },

  warning(title, message = '') {
    this.show({ title, message, type: 'warning' });
  }
};

window.Toast = Toast;
