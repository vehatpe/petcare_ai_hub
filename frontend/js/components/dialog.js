/**
 * PetCare AI Hub - Confirm Dialog (native <dialog>, focus handled by the browser)
 * Dialog.confirm({ title, text, confirmLabel, danger }) -> Promise<boolean>
 */
(function () {
  'use strict';

  const Dialog = {
    confirm({ title, text, confirmLabel = 'Xác nhận', cancelLabel = 'Giữ lại', danger = false }) {
      return new Promise((resolve) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'pc-dialog';
        dlg.setAttribute('aria-labelledby', 'confirmTitle');
        dlg.setAttribute('aria-describedby', 'confirmText');
        dlg.innerHTML = `
          <div class="pc-dialog-body">
            <h2 id="confirmTitle"></h2>
            <p id="confirmText"></p>
            <div class="pc-dialog-actions pc-dialog-actions-row">
              <button type="button" class="btn btn-outline" data-act="cancel"></button>
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok"></button>
            </div>
          </div>`;
        dlg.querySelector('#confirmTitle').textContent = title;
        dlg.querySelector('#confirmText').textContent = text;
        dlg.querySelector('[data-act="cancel"]').textContent = cancelLabel;
        dlg.querySelector('[data-act="ok"]').textContent = confirmLabel;

        let result = false;
        let closing = false;

        // Play the exit animation (.is-closing), then really close the dialog.
        const requestClose = () => {
          if (closing) return;
          closing = true;
          dlg.classList.add('is-closing');
          const finish = () => { if (dlg.open) dlg.close(); };
          dlg.addEventListener('animationend', (e) => { if (e.target === dlg) finish(); }, { once: true });
          setTimeout(finish, 320); // fallback when animations are disabled
        };

        dlg.addEventListener('click', (e) => {
          const act = e.target.getAttribute && e.target.getAttribute('data-act');
          if (act === 'ok') { result = true; requestClose(); }
          else if (act === 'cancel' || e.target === dlg) requestClose();
        });
        // Esc must follow the same exit path instead of closing instantly
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
        dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });

        document.body.appendChild(dlg);
        dlg.showModal();
        dlg.querySelector('[data-act="cancel"]').focus(); // safe default for destructive actions
      });
    }
  };

  window.Dialog = Dialog;
})();
