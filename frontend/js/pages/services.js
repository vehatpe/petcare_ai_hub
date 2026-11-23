/**
 * PetCare AI Hub - Services ledger
 * Rows, categories and prices come from /api/v1/services. Filters are built from the categories
 * that actually exist; ?type= or ?service= pre-selects a category.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const ledger = document.getElementById('servicesLedger');
  if (!ledger) return;
  const esc = Fmt.esc;
  const filtersEl = document.getElementById('categoryFilters');
  const sort = document.getElementById('sortSelect');
  const count = document.getElementById('servicesCount');
  const note = document.getElementById('sampleNote');
  const AUTH_REASON = 'Đặt lịch gắn với hồ sơ thú cưng của bạn nên cần có tài khoản. Đăng ký miễn phí chỉ mất một phút.';

  let services = [];
  const active = new Set();

  function row(s) {
    const user = AuthService.currentUser();
    const isStaff = Boolean(user && user.role !== 'customer');
    const emergency = s.category === 'emergency';
    const actionHtml = isStaff
      ? ''
      : `<div class="ledger-action">
          <a class="btn btn-primary btn-sm" data-auth-required="${esc(AUTH_REASON)}" href="booking.html?service=${encodeURIComponent(s.id)}">Đặt lịch</a>
        </div>`;

    return `
      <article class="ledger-row">
        <div class="ledger-cat"><span class="ledger-cat-label">${esc(s.categoryLabel)}</span></div>
        <div class="ledger-main">
          <h3 class="ledger-title">${esc(s.name)}</h3>
          ${s.description ? `<p class="ledger-desc">${esc(s.description)}</p>` : ''}
          <p class="ledger-provider">${esc(Catalog.providerLabel(s))}</p>
          ${emergency ? '<p class="ledger-warn">Đặt lịch không phải kênh khẩn cấp. Nếu bé đang nguy kịch, hãy đưa bé đến cơ sở thú y gần nhất ngay.</p>' : ''}
        </div>
        <div class="ledger-price"><strong>${esc(Fmt.vnd(s.priceVnd))}</strong><span>/ ${esc(s.unit)}</span></div>
        ${actionHtml}
      </article>`;
  }

  function apply() {
    let shown = services.filter((s) => !active.size || active.has(s.category));
    if (sort.value !== 'default') {
      const dir = sort.value === 'asc' ? 1 : -1;
      shown = shown.slice().sort((a, b) => (a.priceVnd - b.priceVnd) * dir);
    }
    ledger.innerHTML = shown.map(row).join('');
    count.innerHTML = shown.length
      ? `Hiển thị <strong>${shown.length} dịch vụ</strong>`
      : (services.length ? 'Không có dịch vụ nào khớp bộ lọc. Hãy bỏ bớt lựa chọn.' : 'Chưa có dịch vụ nào trong danh mục.');
  }

  function buildFilters() {
    const cats = [];
    services.forEach((s) => { if (!cats.some((c) => c.id === s.category)) cats.push({ id: s.category, label: s.categoryLabel }); });
    filtersEl.innerHTML = cats.map((c) => `<label class="filter-checkbox-label"><input type="checkbox" value="${esc(c.id)}"${active.has(c.id) ? ' checked' : ''}> ${esc(c.label)}</label>`).join('');
  }

  filtersEl.addEventListener('change', (e) => {
    if (e.target.checked) active.add(e.target.value); else active.delete(e.target.value);
    apply();
  });
  sort.addEventListener('change', apply);
  document.getElementById('resetFilters').addEventListener('click', () => {
    active.clear();
    sort.value = 'default';
    buildFilters();
    apply();
  });

  const params = new URLSearchParams(window.location.search);
  const preset = params.get('type') || params.get('service');
  if (preset) active.add(preset);

  Panel.load(ledger, () => Catalog.services(), (list) => {
    services = list;
    if (![...active].every((c) => services.some((s) => s.category === c))) active.clear(); // unknown preset
    const text = Catalog.sampleNotice(services);
    note.textContent = text;
    note.hidden = !text;
    buildFilters();
    apply();
  }, { loading: 'Đang tải danh mục dịch vụ…' });
});
