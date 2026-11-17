/**
 * PetCare AI Hub - Shared formatting & safety helpers
 * Exposed as window.Fmt
 */
(function () {
  'use strict';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  const Fmt = {
    /** Escape untrusted text before it is placed into innerHTML. */
    esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
    },

    vnd(amount) {
      return new Intl.NumberFormat('vi-VN').format(amount) + ' đ';
    },

    /** "2026-11-05" -> "Thứ Năm, 05/11/2026" */
    dateLong(isoDate) {
      const d = Fmt.parseDate(isoDate);
      if (!d) return '';
      const weekday = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][d.getDay()];
      return `${weekday}, ${Fmt.dateShort(isoDate)}`;
    },

    dateShort(isoDate) {
      const d = Fmt.parseDate(isoDate);
      if (!d) return '';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${d.getFullYear()}`;
    },

    /** Parse YYYY-MM-DD as a local date (avoids UTC off-by-one). */
    parseDate(isoDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    },

    todayIso() {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${mm}-${dd}`;
    },

    initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    },

    /** Vietnamese given name = last word of the full name. */
    firstName(fullName) {
      const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    },

    /**
     * Safe rich text for chat bubbles (AI output is untrusted): escapes everything first, then
     * supports **bold**, *italic*, "- " / "1. " list lines and line breaks.
     */
    richText(value) {
      const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
      const inline = (t) => Fmt.esc(t)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
      const out = [];
      let list = null;
      const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
      lines.forEach((raw) => {
        const line = raw.trim();
        const bullet = /^[-•]\s+(.*)$/.exec(line);
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
        if (bullet || numbered) {
          const type = bullet ? 'ul' : 'ol';
          if (list !== type) { close(); out.push(`<${type} class="chat-list">`); list = type; }
          out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
        } else {
          close();
          if (line) out.push(`<p>${inline(line)}</p>`);
        }
      });
      close();
      return out.join('');
    },

    /** "2026-11-06T03:10:00Z" -> "2026-11-06" */
    isoDay(value) {
      return String(value || '').slice(0, 10);
    },

    /** 11.2 -> "11,2 kg", 0.045 -> "45 g" */
    kg(value) {
      if (value === null || value === undefined || value === '') return '';
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) return '';
      if (n < 1) {
        const grams = Math.max(1, Math.round(n * 1000));
        if (grams < 1000) return `${grams} g`;
      }
      return String(Math.round(n * 1000) / 1000).replace('.', ',') + ' kg';
    },

    randomId(prefix = '') {
      const bytes = new Uint8Array(6);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      const body = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
      return prefix + body;
    }
  };

  window.Fmt = Fmt;
})();
