/**
 * PetCare AI Hub - Customer dashboard
 * Every number here is computed by the API from the signed-in owner's own rows
 * (/dashboard/customer, /pets, /bookings). A fresh account sees empty states, never sample data.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'customer') return; // auth-gate.js handles the redirect

  const esc = Fmt.esc;
  const todayEl = document.getElementById('todayStrip');
  const petListEl = document.getElementById('petList');
  const bookingListEl = document.getElementById('bookingList');
  let pets = [];

  /* ---------- One-time flash message from the pet form ---------- */
  try {
    const raw = sessionStorage.getItem('petcare_flash');
    if (raw) {
      sessionStorage.removeItem('petcare_flash');
      const flash = JSON.parse(raw);
      Toast.show({ title: flash.title, message: flash.message, type: 'success' });
    }
  } catch (_) { /* ignore */ }

  document.getElementById('greeting').textContent = `Xin chào, ${Fmt.firstName(user.fullName)}`;
  document.title = 'Bảng điều khiển - PetCare AI Hub';

  /* ---------- Today strip: three facts, all from /dashboard/customer ---------- */
  function renderToday(d) {
    const next = d.bookings.next;
    const v = d.vaccines;

    const bookingFact = next
      ? `<strong>${esc(next.serviceName)}</strong><span>${esc(next.petName)} · ${esc(Fmt.dateLong(next.date))} lúc ${esc(next.time)}</span>`
      : '<strong>Chưa có lịch sắp tới</strong><span><a href="booking.html">Đặt lịch cho bé</a></span>';

    let vaccineFact;
    if (v.nextDue) {
      const overdue = v.overdueCount > 0;
      vaccineFact = `<strong>${esc(v.nextDue.vaccineName)}${overdue ? ' · quá hạn' : ''}</strong>
        <span>${esc(v.nextDue.petName)} · hạn ${esc(Fmt.dateShort(v.nextDue.dueOn))}${v.overdueCount + v.dueSoonCount > 1 ? ` · còn ${v.overdueCount + v.dueSoonCount - 1} mũi khác cần chú ý` : ''}</span>`;
    } else {
      vaccineFact = `<strong>Chưa có lịch nhắc tiêm</strong><span>${d.petCount ? 'Ghi nhận mũi tiêm trong sổ sức khỏe của bé.' : 'Thêm thú cưng để bắt đầu sổ sức khỏe.'}</span>`;
    }

    todayEl.innerHTML = `
      <div class="today-fact"><h2 class="today-label">Lịch hẹn tiếp theo</h2>${bookingFact}</div>
      <div class="today-fact${v.overdueCount ? ' is-alert' : ''}"><h2 class="today-label">Tiêm chủng</h2>${vaccineFact}</div>
      <div class="today-fact"><h2 class="today-label">Thú cưng</h2><strong>${d.petCount} / ${PetService.MAX_PETS_PER_OWNER} hồ sơ</strong><span>${d.bookings.upcomingCount} lịch hẹn sắp tới · ${d.bookings.total} lịch đã đặt</span></div>`;
  }

  /* ---------- Pets ---------- */
  function petRow(pet) {
    const avatar = pet.photo ? `<img src="${esc(pet.photo)}" alt="">` : esc(pet.name.charAt(0).toUpperCase());
    const extras = [
      pet.sex ? `<span class="badge badge-mint">${esc(PetService.SEX_LABEL[pet.sex])}</span>` : '',
      pet.neutered && pet.neutered !== 'unknown' ? `<span class="badge badge-cream">${esc(PetService.NEUTER_LABEL[pet.neutered])}</span>` : '',
      pet.conditions ? '<span class="badge badge-warning">Có lưu ý sức khỏe</span>' : ''
    ].join('');
    const id = encodeURIComponent(pet.id);

    return `
      <li class="pet-row" data-pet-id="${esc(pet.id)}">
        <div class="pet-avatar" aria-hidden="true">${avatar}</div>
        <div class="pet-main">
          <h3 class="pet-name">${esc(pet.name)}</h3>
          <p class="pet-summary">${esc(PetService.summary(pet))}</p>
          ${extras ? `<div class="pet-extra">${extras}</div>` : ''}
        </div>
        <div class="pet-actions">
          <a class="btn btn-primary btn-sm" href="health-records.html?pet=${id}">Sổ sức khỏe</a>
          <a class="btn btn-secondary btn-sm" href="booking.html?pet=${id}">Đặt lịch</a>
          <a class="btn btn-secondary btn-sm" href="ai-assistant.html?pet=${id}">Hỏi AI</a>
          <details class="row-menu">
            <summary class="btn btn-ghost btn-sm" aria-label="Thêm tùy chọn cho ${esc(pet.name)}">Khác</summary>
            <div class="row-menu-list">
              <a href="pet-profile.html?id=${id}">Sửa hồ sơ</a>
              <button type="button" class="row-menu-danger" data-delete-pet="${esc(pet.id)}">Xóa hồ sơ</button>
            </div>
          </details>
        </div>
      </li>`;
  }

  function renderPets(list) {
    pets = list;
    const addBtn = document.getElementById('addPetBtn');
    addBtn.hidden = list.length === 0 || list.length >= PetService.MAX_PETS_PER_OWNER;

    if (!list.length) {
      petListEl.innerHTML = `
        <div class="empty-state">
          <h3>Bắt đầu bằng hồ sơ của bé</h3>
          <p>Khai báo tên, loài, giống, ngày sinh và cân nặng. Hồ sơ này dùng để đặt lịch, theo dõi tiêm chủng và để Trợ lý AI trả lời đúng với bé.</p>
          <ol class="empty-steps">
            <li><strong>Thêm thú cưng</strong> (khoảng một phút)</li>
            <li>Đặt lịch hoặc ghi nhận mũi tiêm</li>
            <li>Hỏi Trợ lý AI khi cần tham khảo</li>
          </ol>
          <a class="btn btn-primary" href="pet-profile.html">Thêm thú cưng đầu tiên</a>
        </div>`;
      return;
    }
    petListEl.innerHTML = `<ul class="pet-list" data-reveal-group>${list.map(petRow).join('')}</ul>`;
  }

  petListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-pet]');
    if (!btn) return;
    const pet = pets.find((p) => p.id === btn.dataset.deletePet);
    if (!pet) return;
    const ok = await Dialog.confirm({
      title: `Xóa hồ sơ ${pet.name}?`,
      text: 'Hồ sơ cùng cân nặng, tiêm chủng và bệnh án của bé sẽ bị xóa. Các lịch hẹn đã đặt vẫn được giữ lại.',
      confirmLabel: 'Xóa hồ sơ',
      cancelLabel: 'Giữ lại',
      danger: true
    });
    if (!ok) return;
    try {
      await PetService.remove(pet.id);
      Toast.show({ title: 'Đã xóa hồ sơ', message: `Hồ sơ của ${pet.name} đã được xóa.`, type: 'success' });
      loadAll();
    } catch (err) {
      Toast.show({ title: 'Chưa xóa được hồ sơ', message: err.message, type: 'danger' });
    }
  });

  /* ---------- Bookings ---------- */
  function bookingItem(b) {
    const d = Fmt.parseDate(b.date);
    const status = BookingService.STATUS[b.status] || BookingService.STATUS.pending;
    const cancelled = b.status === 'cancelled';
    const closed = cancelled || b.status === 'completed';
    const past = b.date < Fmt.todayIso();
    const day = d ? String(d.getDate()).padStart(2, '0') : '--';
    const month = d ? `Th${d.getMonth() + 1}` : '';

    return `
      <li class="booking-item${cancelled ? ' is-cancelled' : ''}">
        <div class="booking-date" aria-hidden="true"><strong>${day}</strong><span>${month}</span></div>
        <div>
          <p class="booking-title">${esc(b.serviceName)}</p>
          <p class="booking-meta">${esc(b.petName)} · ${esc(Fmt.dateLong(b.date))} lúc ${esc(b.time)}</p>
          <p class="booking-meta">${esc(b.providerName)}</p>
          <div class="booking-foot">
            <span class="badge ${status.badge}">${esc(past && !closed ? 'Đã qua ngày hẹn' : status.label)}</span>
            <span class="booking-code">Mã ${esc(b.code || b.id)}</span>
            ${!closed && !past ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel-booking="${esc(b.id)}">Hủy lịch</button>` : ''}
          </div>
        </div>
      </li>`;
  }

  let bookingState = { items: [], page: 1, total: 0, loadingMore: false };

  function renderBookings() {
    const list = bookingState.items;
    document.getElementById('newBookingBtn').hidden = list.length === 0;
    if (!list.length) {
      const hasPets = pets.length > 0;
      bookingListEl.innerHTML = `
        <div class="empty-state">
          <h3>Chưa có lịch hẹn nào</h3>
          <p>${hasPets ? 'Chọn dịch vụ, ngày và giờ phù hợp cho bé chỉ trong 4 bước.' : 'Bạn cần có ít nhất một hồ sơ thú cưng trước khi đặt lịch.'}</p>
          <a class="btn ${hasPets ? 'btn-primary' : 'btn-outline'}" href="${hasPets ? 'booking.html' : 'pet-profile.html'}">${hasPets ? 'Đặt lịch đầu tiên' : 'Thêm thú cưng trước'}</a>
        </div>`;
      return;
    }
    const hasMore = list.length < bookingState.total;
    const moreHtml = hasMore
      ? `<div class="pager"><span class="pager-info">Đã hiển thị ${esc(String(list.length))} / ${esc(String(bookingState.total))}</span><button type="button" class="btn btn-outline btn-sm" data-action="load-more-bookings">Tải thêm lịch hẹn</button></div>`
      : '';
    bookingListEl.innerHTML = `<ul class="booking-list" data-reveal-group>${list.map(bookingItem).join('')}</ul>${moreHtml}`;
  }

  bookingListEl.addEventListener('click', async (e) => {
    const moreBtn = e.target.closest('[data-action="load-more-bookings"]');
    if (moreBtn) {
      if (bookingState.loadingMore) return;
      bookingState.loadingMore = true;
      moreBtn.disabled = true;
      moreBtn.textContent = 'Đang tải…';
      try {
        const nextPage = bookingState.page + 1;
        const res = await BookingService.list({ scope: 'all', page: nextPage, limit: 20 });
        bookingState.items = bookingState.items.concat(res.items || []);
        bookingState.page = nextPage;
        bookingState.total = (res.meta && res.meta.total) ?? bookingState.total;
        renderBookings();
      } catch (err) {
        Toast.show({ title: 'Chưa tải thêm được', message: err.message || 'Không tải thêm được lịch hẹn.', type: 'danger' });
        moreBtn.disabled = false;
        moreBtn.textContent = 'Tải thêm lịch hẹn';
      } finally {
        bookingState.loadingMore = false;
      }
      return;
    }

    const btn = e.target.closest('[data-cancel-booking]');
    if (!btn) return;
    const ok = await Dialog.confirm({
      title: 'Hủy lịch hẹn này?',
      text: 'Lịch hẹn sẽ được đánh dấu là đã hủy. Bạn có thể đặt lịch mới bất cứ lúc nào.',
      confirmLabel: 'Hủy lịch',
      cancelLabel: 'Giữ lịch',
      danger: true
    });
    if (!ok) return;
    try {
      await BookingService.cancel(btn.dataset.cancelBooking);
      Toast.show({ title: 'Đã hủy lịch hẹn', message: 'Lịch hẹn đã được đánh dấu là đã hủy.', type: 'success' });
      loadAll();
    } catch (err) {
      Toast.show({ title: 'Chưa hủy được lịch', message: err.message, type: 'danger' });
    }
  });

  /* ---------- Load ---------- */
  function loadAll() {
    // Pets load first so the bookings empty state knows whether the owner has any.
    Panel.load(petListEl, () => PetService.list(), renderPets, { loading: 'Đang tải hồ sơ thú cưng…' })
      .then(() => Panel.load(bookingListEl, async () => {
        const res = await BookingService.list({ scope: 'all', page: 1, limit: 20 });
        bookingState = { items: res.items || [], page: 1, total: (res.meta && res.meta.total) ?? 0, loadingMore: false };
        return res;
      }, renderBookings, { loading: 'Đang tải lịch hẹn…' }));
    Panel.load(todayEl, () => DashboardService.customer(), renderToday, { loading: 'Đang tổng hợp…' });
  }

  loadAll();
});
