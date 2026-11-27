/**
 * PetCare AI Hub - Pagination component
 * Exposed as window.Pager
 */
(function () {
  'use strict';

  function buildPages(page, totalPages) {
    if (totalPages <= 7) {
      const list = [];
      for (let i = 1; i <= totalPages; i += 1) list.push(i);
      return list;
    }
    const set = new Set([1, totalPages, page - 1, page, page + 1]);
    const sorted = Array.from(set).filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < sorted.length; i += 1) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('...');
      out.push(sorted[i]);
    }
    return out;
  }

  function render(meta) {
    if (!meta || !meta.totalPages || meta.totalPages <= 1) return '';
    const page = Number(meta.page) || 1;
    const totalPages = Number(meta.totalPages) || 1;
    const total = Number(meta.total) || 0;
    const prevDisabled = page <= 1;
    const nextDisabled = page >= totalPages;

    const pagesHtml = buildPages(page, totalPages).map((item) => {
      if (item === '...') {
        return '<span class="pager-ellipsis" aria-hidden="true">…</span>';
      }
      const isCurrent = item === page;
      return `<button type="button" class="btn btn-sm pager-btn${isCurrent ? ' is-active' : ''}" data-action="page-goto" data-page="${Fmt.esc(String(item))}"${isCurrent ? ' aria-current="page"' : ''}>${Fmt.esc(String(item))}</button>`;
    }).join('');

    return `
      <nav class="pager" aria-label="Phân trang">
        <div class="pager-controls">
          <button type="button" class="btn btn-outline btn-sm pager-btn pager-prev" data-action="page-prev" data-page="${Fmt.esc(String(page - 1))}"${prevDisabled ? ' disabled aria-disabled="true"' : ''}>Trước</button>
          <span class="pager-pages">${pagesHtml}</span>
          <button type="button" class="btn btn-outline btn-sm pager-btn pager-next" data-action="page-next" data-page="${Fmt.esc(String(page + 1))}"${nextDisabled ? ' disabled aria-disabled="true"' : ''}>Sau</button>
        </div>
        <div class="pager-info">Trang ${Fmt.esc(String(page))} / ${Fmt.esc(String(totalPages))} · tổng ${Fmt.esc(String(total))}</div>
      </nav>
    `;
  }

  function bind(container, onChange) {
    if (!container || container.dataset.pagerBound === '1') return;
    container.dataset.pagerBound = '1';
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="page-prev"], [data-action="page-next"], [data-action="page-goto"]');
      if (!btn || btn.disabled) return;
      const nextPage = Number(btn.getAttribute('data-page'));
      if (Number.isInteger(nextPage) && nextPage >= 1 && typeof onChange === 'function') {
        onChange(nextPage);
      }
    });
  }

  window.Pager = { render, bind };
})();
