/**
 * PetCare AI Hub - Landing page
 *  - Profile card: guests see the empty structure (labelled); a signed-in owner with pets sees the
 *    first pet with real weight / vaccine summary / next booking from the API.
 *  - Services ledger: first rows of /api/v1/services.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const esc = Fmt.esc;
  const AUTH_REASON = 'Đặt lịch gắn với hồ sơ thú cưng của bạn nên cần có tài khoản. Đăng ký miễn phí chỉ mất một phút.';
  const $ = (id) => document.getElementById(id);

  /* ---------- Profile card ---------- */
  async function fillProfileCard() {
    const user = AuthService.currentUser();
    if (!user || user.role !== 'customer') return;
    let pet;
    try {
      pet = (await PetService.list())[0];
    } catch (_) { return; } // keep the labelled empty structure
    if (!pet) return;

    $('pcardTag').textContent = 'Hồ sơ của bạn';
    const avatar = $('pcardAvatar');
    avatar.textContent = '';
    if (pet.photo) {
      const img = document.createElement('img');
      img.src = pet.photo;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = pet.name.charAt(0).toUpperCase();
    }
    $('pcardName').textContent = pet.name;
    $('pcardSpecs').textContent = PetService.summary(pet);
    $('pcardWeight').textContent = pet.weightKg ? Fmt.kg(pet.weightKg) : 'Chưa có';
    const cta = $('pcardCta');
    cta.textContent = 'Mở sổ sức khỏe';
    cta.href = `pages/health-records.html?pet=${encodeURIComponent(pet.id)}`;
    cta.removeAttribute('data-auth-required');

    try {
      const [health, bookings] = await Promise.all([HealthService.get(pet.id), BookingService.list()]);
      const v = health.vaccineSummary;
      $('pcardVax').textContent = !v.total ? 'Chưa ghi nhận mũi tiêm nào'
        : v.overdue ? `${v.overdue} quá hạn · ${v.upToDate}/${v.total} còn hạn`
        : v.dueSoon ? `${v.dueSoon} sắp đến hạn · ${v.upToDate}/${v.total} còn hạn`
        : `${v.upToDate}/${v.total} loại còn hạn hoặc đã ghi nhận`;
      const today = Fmt.todayIso();
      const next = bookings.filter((b) => b.petId === pet.id && (b.status === 'pending' || b.status === 'confirmed') && b.date >= today)[0];
      $('pcardBooking').textContent = next ? `${next.serviceName}, ${Fmt.dateShort(next.date)} ${next.time}` : 'Chưa có';
    } catch (_) {
      $('pcardVax').textContent = 'Chưa tải được';
      $('pcardBooking').textContent = 'Chưa tải được';
    }
  }

  /* ---------- Services ledger ---------- */
  function row(s) {
    return `
      <article class="ledger-row">
        <div class="ledger-cat"><span class="ledger-cat-label">${esc(s.categoryLabel)}</span></div>
        <div class="ledger-main">
          <h3 class="ledger-title">${esc(s.name)}</h3>
          ${s.description ? `<p class="ledger-desc">${esc(s.description)}</p>` : ''}
          <p class="ledger-provider">${esc(Catalog.providerLabel(s))}</p>
        </div>
        <div class="ledger-price"><strong>${esc(Fmt.vnd(s.priceVnd))}</strong><span>/ ${esc(s.unit)}</span></div>
        <div class="ledger-action"><a class="btn btn-primary btn-sm" data-auth-required="${esc(AUTH_REASON)}" href="pages/booking.html?service=${encodeURIComponent(s.id)}">Đặt lịch</a></div>
      </article>`;
  }

  Panel.load($('landingLedger'), () => Catalog.services(), (list) => {
    const note = $('landingSampleNote');
    const text = Catalog.sampleNotice(list);
    note.textContent = text;
    note.hidden = !text;
    const shown = list.slice(0, 5);
    $('landingLedger').innerHTML = shown.length ? shown.map(row).join('') : '<div class="empty-state"><h3>Chưa có dịch vụ nào</h3><p>Danh mục sẽ hiển thị khi có cơ sở đăng ký dịch vụ.</p></div>';
  }, { loading: 'Đang tải dịch vụ…' });

  fillProfileCard();
  window.addEventListener('petcare:auth-changed', () => window.location.reload());
});
