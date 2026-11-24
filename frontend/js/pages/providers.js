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
    const user = AuthService.currentUser();
    const isStaff = Boolean(user && user.role !== 'customer');
    const mine = services.filter((s) => s.providerId === p.id);
    const actionHtml = (!isStaff && mine.length)
      ? `<a class="btn btn-primary btn-sm" data-auth-required="${esc(AUTH_REASON)}" href="booking.html?provider=${encodeURIComponent(p.id)}">Đặt lịch tại đây</a>`
      : '';

    const metaParts = [];
    if (Catalog.TYPE_LABEL[p.type]) metaParts.push(Catalog.TYPE_LABEL[p.type]);
    if (p.area) metaParts.push(p.area);

    const contactParts = [];
    if (p.address) contactParts.push(`<span>📍 ${esc(p.address)}</span>`);
    if (p.phone) contactParts.push(`<span>📞 ${esc(p.phone)}</span>`);

    return `
      <article class="provider-row">
        <div class="provider-row-head">
          <h2 class="provider-row-name">${esc(p.name)}</h2>
          <p class="provider-row-meta">${metaParts.map(esc).join(' · ')}</p>
          ${contactParts.length ? `<p class="provider-row-contact" style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 4px;">${contactParts.join(' · ')}</p>` : ''}
          ${p.description ? `<p class="provider-row-desc" style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 6px; line-height: 1.4;">${esc(p.description)}</p>` : ''}
        </div>
        ${mine.length
          ? `<ul class="provider-services">${mine.map((s) => `<li><span>${esc(s.name)}</span><span class="provider-services-price">${esc(Fmt.vnd(s.priceVnd))} / ${esc(s.unit)}</span></li>`).join('')}</ul>`
          : '<p class="provider-row-empty">Cơ sở chưa đăng dịch vụ nào.</p>'}
        ${actionHtml}
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
