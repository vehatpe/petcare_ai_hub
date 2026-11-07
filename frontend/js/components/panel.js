/**
 * PetCare AI Hub - Async panel helper
 * Panel.load(el, loader, render) shows a loading line, then the rendered result,
 * or an error message with a retry button (never an endless spinner).
 *
 * Exposed as window.Panel
 */
(function () {
  'use strict';

  const Panel = {
    async load(el, loader, render, { loading = 'Đang tải…' } = {}) {
      el.setAttribute('aria-busy', 'true');
      el.innerHTML = `<p class="panel-loading" role="status">${Fmt.esc(loading)}</p>`;
      try {
        const data = await loader();
        el.innerHTML = '';
        render(data);
        return data;
      } catch (err) {
        el.innerHTML = `
          <div class="panel-error" role="alert">
            <p>${Fmt.esc(err.message || 'Không tải được dữ liệu.')}</p>
            <button type="button" class="btn btn-outline btn-sm" data-panel-retry>Thử lại</button>
          </div>`;
        el.querySelector('[data-panel-retry]').addEventListener('click', () => Panel.load(el, loader, render, { loading }));
        return null;
      } finally {
        el.removeAttribute('aria-busy');
      }
    }
  };

  window.Panel = Panel;
})();
