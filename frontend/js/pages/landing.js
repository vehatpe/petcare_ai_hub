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

  let renderVersion = 0;

  async function renderForAuth() {
    const thisVersion = ++renderVersion;
    const user = AuthService.currentUser();

    // 1. Guest state
    if (!user) {
      $('heroTitle').textContent = 'Hồ sơ sức khỏe, lịch hẹn và Trợ lý AI cho từng bé.';
      $('heroSub').textContent = 'Lưu cân nặng, mũi tiêm và bệnh án của thú cưng ở một nơi. Đặt lịch với cơ sở thú y trong bốn bước và hỏi Trợ lý AI khi cần tham khảo.';
      $('heroActions').innerHTML = `
        <a href="pages/pet-profile.html" class="btn btn-primary btn-lg" id="heroPrimaryBtn" data-auth-required="Hồ sơ thú cưng gắn với tài khoản của bạn nên cần đăng nhập. Đăng ký miễn phí chỉ mất một phút.">Tạo hồ sơ cho bé</a>
        <a href="pages/services.html" class="btn btn-outline btn-lg" id="heroSecondaryBtn">Xem dịch vụ</a>`;

      $('pcardContent').innerHTML = `
        <p class="pcard-tag" id="pcardTag">Cấu trúc hồ sơ, chưa có dữ liệu</p>
        <div class="pcard-head">
          <div class="pet-avatar" id="pcardAvatar" aria-hidden="true">?</div>
          <div>
            <h2 class="pcard-name" id="pcardName">Tên thú cưng</h2>
            <p class="pcard-specs" id="pcardSpecs">Loài · giống · tuổi</p>
          </div>
        </div>
        <dl class="pcard-facts" id="pcardFacts">
          <div><dt>Cân nặng gần nhất</dt><dd id="pcardWeight">Chưa có</dd></div>
          <div><dt>Tiêm chủng</dt><dd id="pcardVax">Chưa có dữ liệu</dd></div>
          <div><dt>Lịch hẹn sắp tới</dt><dd id="pcardBooking">Chưa có</dd></div>
        </dl>
        <a href="pages/pet-profile.html" class="btn btn-secondary btn-sm" id="pcardCta" data-auth-required="Hồ sơ thú cưng gắn với tài khoản của bạn nên cần đăng nhập. Đăng ký miễn phí chỉ mất một phút.">Tạo hồ sơ cho bé</a>`;

      $('ctaBannerTitle').textContent = 'Bắt đầu với hồ sơ của bé.';
      $('ctaBannerSub').textContent = 'Đăng ký miễn phí, khai báo thú cưng và bạn có thể đặt lịch hoặc hỏi Trợ lý AI ngay.';
      $('ctaBannerActions').innerHTML = `
        <a href="pages/register.html" class="btn btn-primary btn-lg">Tạo tài khoản</a>
        <a href="pages/login.html" class="btn btn-outline-white btn-lg">Đăng nhập</a>`;
      return;
    }

    // 2. Non-customer roles: provider / vet / admin
    if (user.role !== 'customer') {
      const firstName = Fmt.firstName(user.fullName);
      $('heroTitle').textContent = `Xin chào, ${firstName}.`;
      $('heroSub').textContent = 'Bảng điều khiển cho vai trò này đang được xây dựng.';
      $('heroActions').innerHTML = `
        <a href="pages/services.html" class="btn btn-outline btn-lg" id="heroSecondaryBtn">Xem dịch vụ</a>`;

      $('pcardContent').innerHTML = `
        <div class="empty-state pcard-empty">
          <p class="pcard-tag">Bảng điều khiển vai trò</p>
          <h3>Bảng điều khiển đang được xây dựng</h3>
          <p>Hệ thống cho vai trò ${esc(user.role)} sẽ sớm ra mắt.</p>
          <a href="pages/services.html" class="btn btn-outline btn-sm">Xem dịch vụ</a>
        </div>`;

      $('ctaBannerTitle').textContent = 'Khám phá dịch vụ & cơ sở đối tác.';
      $('ctaBannerSub').textContent = 'Tham khảo các gói chăm sóc y tế, spa và lưu trú đang hoạt động trên hệ thống.';
      $('ctaBannerActions').innerHTML = `
        <a href="pages/services.html" class="btn btn-primary btn-lg">Xem dịch vụ</a>
        <a href="pages/providers.html" class="btn btn-outline-white btn-lg">Cơ sở & phòng khám</a>`;
      return;
    }

    // 3. Customer role
    const firstName = Fmt.firstName(user.fullName);
    $('ctaBannerTitle').textContent = 'Tiếp tục với hồ sơ của bé.';
    $('ctaBannerSub').textContent = 'Theo dõi cân nặng, lịch tiêm chủng và đặt lịch hẹn bất cứ khi nào bạn cần.';
    $('ctaBannerActions').innerHTML = `
      <a href="pages/customer-dashboard.html" class="btn btn-primary btn-lg">Mở bảng điều khiển</a>
      <a href="pages/booking.html" class="btn btn-outline-white btn-lg">Đặt lịch</a>`;

    // Fetch pets
    let pets = [];
    try {
      pets = await PetService.list();
    } catch (_) {
      pets = [];
    }

    // Drop stale response if another auth change triggered during await
    if (thisVersion !== renderVersion) return;

    if (!pets || pets.length === 0) {
      // Chủ nuôi chưa có bé
      $('heroTitle').textContent = `Xin chào, ${firstName}.`;
      $('heroSub').textContent = 'Thêm hồ sơ thú cưng đầu tiên của bạn để theo dõi cân nặng, mũi tiêm và đặt lịch khám nhanh chóng.';
      $('heroActions').innerHTML = `
        <a href="pages/pet-profile.html" class="btn btn-primary btn-lg" id="heroPrimaryBtn">Thêm bé đầu tiên</a>
        <a href="pages/services.html" class="btn btn-outline btn-lg" id="heroSecondaryBtn">Xem dịch vụ</a>`;

      $('pcardContent').innerHTML = `
        <div class="empty-state pcard-empty">
          <p class="pcard-tag">Hồ sơ thú cưng</p>
          <h3>Bạn chưa có hồ sơ thú cưng</h3>
          <p>Tạo hồ sơ cho bé để theo dõi sức khỏe và đặt lịch khám dễ dàng.</p>
          <a href="pages/pet-profile.html" class="btn btn-primary btn-sm">Thêm bé đầu tiên</a>
        </div>`;
      return;
    }

    // Đã có bé
    const pet = pets[0];
    $('heroTitle').textContent = `Xin chào, ${firstName}.`;
    $('heroSub').textContent = `Hồ sơ của bé ${pet.name} và các dịch vụ thú y sẵn sàng hỗ trợ bạn.`;
    $('heroActions').innerHTML = `
      <a href="pages/booking.html?pet=${encodeURIComponent(pet.id)}" class="btn btn-primary btn-lg" id="heroPrimaryBtn">Đặt lịch cho ${esc(pet.name)}</a>
      <a href="pages/health-records.html?pet=${encodeURIComponent(pet.id)}" class="btn btn-outline btn-lg" id="heroSecondaryBtn">Mở sổ sức khỏe</a>`;

    const avatarHtml = pet.photo
      ? `<img src="${esc(pet.photo)}" alt="">`
      : esc(pet.name.charAt(0).toUpperCase());

    $('pcardContent').innerHTML = `
      <p class="pcard-tag" id="pcardTag">Hồ sơ của bạn</p>
      <div class="pcard-head">
        <div class="pet-avatar" id="pcardAvatar" aria-hidden="true">${avatarHtml}</div>
        <div>
          <h2 class="pcard-name" id="pcardName">${esc(pet.name)}</h2>
          <p class="pcard-specs" id="pcardSpecs">${esc(PetService.summary(pet))}</p>
        </div>
      </div>
      <dl class="pcard-facts" id="pcardFacts">
        <div><dt>Cân nặng gần nhất</dt><dd id="pcardWeight">${pet.weightKg ? esc(Fmt.kg(pet.weightKg)) : 'Chưa có'}</dd></div>
        <div><dt>Tiêm chủng</dt><dd id="pcardVax">Đang tải…</dd></div>
        <div><dt>Lịch hẹn sắp tới</dt><dd id="pcardBooking">Đang tải…</dd></div>
      </dl>
      <a href="pages/health-records.html?pet=${encodeURIComponent(pet.id)}" class="btn btn-secondary btn-sm" id="pcardCta">Mở sổ sức khỏe</a>`;

    try {
      const [health, bookings] = await Promise.all([HealthService.get(pet.id), BookingService.list()]);
      if (thisVersion !== renderVersion) return;
      const v = health.vaccineSummary;
      const vaxEl = $('pcardVax');
      if (vaxEl) {
        vaxEl.textContent = !v.total ? 'Chưa ghi nhận mũi tiêm nào'
          : v.overdue ? `${v.overdue} quá hạn · ${v.upToDate}/${v.total} còn hạn`
          : v.dueSoon ? `${v.dueSoon} sắp đến hạn · ${v.upToDate}/${v.total} còn hạn`
          : `${v.upToDate}/${v.total} loại còn hạn hoặc đã ghi nhận`;
      }
      const today = Fmt.todayIso();
      const next = bookings.filter((b) => b.petId === pet.id && (b.status === 'pending' || b.status === 'confirmed') && b.date >= today)[0];
      const bookEl = $('pcardBooking');
      if (bookEl) {
        bookEl.textContent = next ? `${next.serviceName}, ${Fmt.dateShort(next.date)} ${next.time}` : 'Chưa có';
      }
    } catch (_) {
      if (thisVersion !== renderVersion) return;
      const vaxEl = $('pcardVax');
      const bookEl = $('pcardBooking');
      if (vaxEl) vaxEl.textContent = 'Chưa tải được';
      if (bookEl) bookEl.textContent = 'Chưa tải được';
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

  renderForAuth();
  window.addEventListener('petcare:auth-changed', renderForAuth);
});
