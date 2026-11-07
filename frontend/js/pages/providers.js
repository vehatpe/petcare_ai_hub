/**
 * PetCare AI Hub - Providers directory
 * Shows only what the API returns: name, area, type and the services each provider offers.
 * No addresses, opening hours, photos or ratings are displayed until they exist in the database.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const listEl = document.getElementById('providersList');
  if (!listEl) return;
  const esc = Fmt.esc;
  const note = document.getElementById('sampleNote');
  const AUTH_REASON = 'Đặt lịch gắn với hồ sơ thú cưng của bạn nên cần có tài khoản. Đăng ký miễn phí chỉ mất một phút.';

  function card(p, services) {
    const mine = services.filter((s) => s.providerId === p.id);
    return `
      <article class="provider-row">
        <div class="provider-row-head">
          <h2 class="provider-row-name">${esc(p.name)}</h2>
          <p class="provider-row-meta">${esc(Catalog.TYPE_LABEL[p.type] || '')}${p.area ? ` · ${esc(p.area)}` : ''}</p>
        </div>
        ${mine.length
          ? `<ul class="provider-services">${mine.map((s) => `<li><span>${esc(s.name)}</span><span class="provider-services-price">${esc(Fmt.vnd(s.priceVnd))} / ${esc(s.unit)}</span></li>`).join('')}</ul>`
          : '<p class="provider-row-empty">Chưa đăng dịch vụ nào.</p>'}
        ${mine.length ? `<a class="btn btn-primary btn-sm" data-auth-required="${esc(AUTH_REASON)}" href="booking.html?provider=${encodeURIComponent(p.id)}">Đặt lịch tại đây</a>` : ''}
      </article>`;
  }

  Panel.load(listEl, () => Promise.all([Catalog.providers(), Catalog.services()]), ([providers, services]) => {
    const text = Catalog.sampleNotice(providers);
    note.textContent = text;
    note.hidden = !text;
    listEl.innerHTML = providers.length
      ? providers.map((p) => card(p, services)).join('')
      : '<div class="empty-state"><h3>Chưa có cơ sở nào</h3><p>Danh bạ sẽ hiển thị khi có cơ sở đăng ký dịch vụ.</p></div>';
  }, { loading: 'Đang tải danh sách cơ sở…' });
});
