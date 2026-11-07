/**
 * PetCare AI Hub - Interactive 4-step booking wizard
 *
 * Requires a signed-in owner. Pets, services, slots and bookings all come from the API;
 * capacity and clash checks are decided by the server (409 -> shown to the user).
 * Query params: ?pet=<id> ?service=<id> ?provider=<id>
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const gateEl = document.getElementById('bookingGate');
  const appEl = document.getElementById('bookingApp');
  const user = AuthService.currentUser();

  /* ---------- Gate: guests and non-owners cannot book ---------- */
  if (!user || user.role !== 'customer') {
    gateEl.innerHTML = AuthGate.panelHtml(user
      ? { title: 'Chỉ chủ nuôi mới đặt lịch được', text: 'Tài khoản hiện tại không phải tài khoản chủ nuôi. Hãy đăng nhập bằng tài khoản chủ nuôi để đặt lịch cho thú cưng.', next: null }
      : { title: 'Đăng nhập để đặt lịch', text: 'Lịch hẹn gắn với hồ sơ thú cưng của bạn. Đăng nhập hoặc tạo tài khoản miễn phí, khai báo bé cưng rồi đặt lịch trong 4 bước.', next: AuthService.currentAsNext() });
    gateEl.hidden = false;
    return;
  }
  appEl.hidden = false;

  const esc = Fmt.esc;
  const params = new URLSearchParams(window.location.search);
  let pets = [];
  let services = [];
  let providerFilter = params.get('provider') || null;
  const serviceById = (id) => services.find((x) => x.id === id) || null;
  const petById = (id) => pets.find((x) => x.id === id) || null;
  let slots = [];          // [{time, available}] for state.serviceId + state.date
  let slotsState = 'idle'; // idle | loading | error | ready
  let slotsToken = 0;      // ignore out-of-order responses

  const state = { step: 1, petId: null, serviceId: null, date: Fmt.todayIso(), time: null, notes: '' };

  const stepperItems = document.querySelectorAll('.stepper-item');
  const panes = document.querySelectorAll('.wizard-step-pane');
  const btnNext = document.getElementById('bookingNextBtn');
  const btnPrev = document.getElementById('bookingPrevBtn');
  const msg = document.getElementById('wizardMessage');
  const card = document.getElementById('bookingWizardCard');

  const NEXT_LABEL = {
    1: 'Tiếp tục: Chọn dịch vụ →',
    2: 'Tiếp tục: Chọn ngày giờ →',
    3: 'Tiếp tục: Xem lại →',
    4: 'Gửi yêu cầu đặt lịch'
  };

  /* ---------- Step 1: pets ---------- */
  function renderPets() {
    const wrap = document.getElementById('petChoices');
    if (!pets.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <h3>Bạn chưa có hồ sơ thú cưng</h3>
          <p>Hãy khai báo thông tin cơ bản của bé trước khi đặt lịch. Chỉ mất khoảng một phút.</p>
          <a class="btn btn-primary" href="pet-profile.html?next=booking.html">Thêm thú cưng</a>
        </div>`;
      btnNext.hidden = true;
      return;
    }

    const preset = params.get('pet');
    if (pets.some((p) => p.id === preset)) state.petId = preset;
    else if (pets.length === 1) state.petId = pets[0].id;

    wrap.innerHTML = `<div class="selection-cards-grid" role="radiogroup" aria-label="Chọn thú cưng">${pets.map((p) => `
      <label class="selectable-item-card pet-pick${p.id === state.petId ? ' selected' : ''}">
        <input type="radio" name="pet" value="${esc(p.id)}"${p.id === state.petId ? ' checked' : ''}>
        <span class="pet-pick-head">
          <span class="pet-avatar pet-avatar-sm" aria-hidden="true">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(p.name.charAt(0).toUpperCase())}</span>
          <span>
            <strong class="pick-title">${esc(p.name)}</strong>
            <span class="pick-sub">${esc(PetService.summary(p))}</span>
          </span>
        </span>
        ${p.conditions ? '<span class="badge badge-warning pick-flag">Có lưu ý sức khỏe</span>' : ''}
      </label>`).join('')}
      <a class="selectable-item-card pet-pick pet-pick-add" href="pet-profile.html?next=booking.html">+ Thêm thú cưng khác</a>
    </div>`;
  }

  /* ---------- Step 2: services ---------- */
  function renderServices() {
    document.getElementById('serviceLead').textContent = Catalog.sampleNotice(services);

    const note = document.getElementById('providerFilterNote');
    let list = services;
    if (providerFilter) {
      list = list.filter((x) => x.providerId === providerFilter);
      if (list.length) {
        note.innerHTML = `Đang hiển thị dịch vụ của <strong>${esc(list[0].providerName)}</strong>. <a href="booking.html">Xem tất cả dịch vụ</a>`;
        note.hidden = false;
      } else {
        providerFilter = null; // unknown provider id: show everything
        list = services;
      }
    }

    const preset = params.get('service');
    if (!state.serviceId && list.some((x) => x.id === preset)) state.serviceId = preset;

    const wrap = document.getElementById('serviceChoices');
    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state"><h3>Chưa có dịch vụ nào</h3><p>Danh mục dịch vụ hiện đang trống. Vui lòng quay lại sau.</p></div>';
      return;
    }
    const badge = { medical: 'badge-lime', grooming: 'badge-mint', hotel: 'badge-cream', emergency: 'badge-warning' };
    wrap.innerHTML = list.map((x) => `
      <label class="selectable-item-card service-pick${x.id === state.serviceId ? ' selected' : ''}">
        <input type="radio" name="service" value="${esc(x.id)}"${x.id === state.serviceId ? ' checked' : ''}>
        <span class="badge ${badge[x.category] || 'badge-mint'} pick-badge">${esc(x.categoryLabel)}</span>
        <strong class="pick-title">${esc(x.name)}</strong>
        <span class="pick-sub">${esc(Catalog.providerLabel(x))}</span>
        <span class="pick-price">${esc(Fmt.vnd(x.priceVnd))} <small>/ ${esc(x.unit)}</small></span>
      </label>`).join('');
  }

  /* ---------- Step 3: date & time ---------- */
  const dateInput = document.getElementById('bookingDateInput');
  dateInput.min = Fmt.todayIso();
  dateInput.value = state.date;

  function slotLabel(t) {
    const h = Number(t.split(':')[0]);
    return `${t} ${h < 12 ? 'Sáng' : h < 18 ? 'Chiều' : 'Tối'}`;
  }

  const slotsEl = document.getElementById('timeSlots');

  function paintSlots() {
    if (slotsState === 'loading') { slotsEl.innerHTML = '<p class="panel-loading" role="status">Đang kiểm tra khung giờ còn trống…</p>'; return; }
    if (slotsState === 'error') {
      slotsEl.innerHTML = '<div class="panel-error" role="alert"><p>Không tải được khung giờ.</p><button type="button" class="btn btn-outline btn-sm" data-slots-retry>Thử lại</button></div>';
      return;
    }
    if (!slots.length) { slotsEl.innerHTML = '<p class="form-hint">Dịch vụ này chưa mở khung giờ cho ngày đã chọn.</p>'; return; }
    if (state.time && !slots.some((t) => t.time === state.time && t.available)) state.time = null;
    const anyFree = slots.some((t) => t.available);
    slotsEl.innerHTML = slots.map((t) => `
      <label class="time-slot-chip${t.time === state.time ? ' selected' : ''}${t.available ? '' : ' is-disabled'}">
        <input type="radio" name="time" value="${esc(t.time)}" class="visually-hidden"${t.time === state.time ? ' checked' : ''}${t.available ? '' : ' disabled'}>
        ${esc(slotLabel(t.time))}${t.available ? '' : ' <span class="slot-note">· kín</span>'}
      </label>`).join('') + (anyFree ? '' : '<p class="form-hint">Ngày này đã kín chỗ hoặc đã qua giờ. Vui lòng chọn ngày khác.</p>');
  }

  async function loadSlots() {
    if (!state.serviceId || !state.date) return;
    const token = ++slotsToken;
    slotsState = 'loading';
    paintSlots();
    try {
      const data = await Catalog.slots(state.serviceId, state.date);
      if (token !== slotsToken) return;
      slots = data;
      slotsState = 'ready';
    } catch (err) {
      if (token !== slotsToken) return;
      slots = [];
      slotsState = 'error';
    }
    paintSlots();
  }

  slotsEl.addEventListener('click', (e) => { if (e.target.closest('[data-slots-retry]')) loadSlots(); });

  /* ---------- Step 4: summary ---------- */
  function renderSummary() {
    const pet = petById(state.petId);
    const service = serviceById(state.serviceId);
    document.getElementById('summaryPet').textContent = pet ? `${pet.name} (${PetService.summary(pet)})` : '';
    document.getElementById('summaryService').textContent = service ? service.name : '';
    document.getElementById('summaryProvider').textContent = service ? Catalog.providerLabel(service) : '';
    document.getElementById('summaryDateTime').textContent = `${Fmt.dateLong(state.date)} lúc ${state.time}`;
    document.getElementById('summaryTotal').textContent = service ? `${Fmt.vnd(service.priceVnd)} / ${service.unit}` : '';
  }

  /* ---------- Navigation ---------- */
  function showMessage(text) {
    msg.textContent = text || '';
    msg.hidden = !text;
  }

  function validate(step) {
    if (step === 1 && !state.petId) return 'Vui lòng chọn thú cưng cần đặt lịch.';
    if (step === 2 && !state.serviceId) return 'Vui lòng chọn một dịch vụ.';
    if (step === 3) {
      if (!state.date || state.date < Fmt.todayIso()) return 'Vui lòng chọn ngày từ hôm nay trở đi.';
      if (!state.time) return 'Vui lòng chọn một khung giờ.';
    }
    return '';
  }

  function goToStep(n, { focus = true } = {}) {
    const previous = state.step;
    state.step = n;
    showMessage('');
    stepperItems.forEach((item, i) => {
      const idx = i + 1;
      item.classList.toggle('completed', idx < n);
      item.classList.toggle('active', idx === n);
      if (idx === n) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    });
    // Only the entering step animates, sliding in from the side it is coming from
    const slide = n > previous ? 'slide-in-right' : 'slide-in-left';
    panes.forEach((p) => {
      const isTarget = p.id === `stepPane${n}`;
      p.classList.remove('slide-in-right', 'slide-in-left');
      p.classList.toggle('active', isTarget);
      if (isTarget && n !== previous) p.classList.add(slide);
    });

    btnPrev.hidden = n === 1;
    btnNext.textContent = NEXT_LABEL[n];
    if (n === 3) loadSlots();
    if (n === 4) renderSummary();

    const heading = document.querySelector(`#stepPane${n} .wizard-title`);
    if (focus && heading) heading.focus();
  }

  async function submitBooking() {
    btnNext.disabled = true;
    btnNext.classList.add('is-loading');
    try {
      const booking = await BookingService.create({
        petId: state.petId, serviceId: state.serviceId, date: state.date, time: state.time, notes: state.notes
      });
      showConfirmation(booking);
    } catch (err) {
      if (err.status === 409 || (err.errors && err.errors.time)) {
        // Someone else took the slot, or this pet already has a booking then: go back to pick another.
        state.time = null;
        goToStep(3);
        showMessage((err.errors && err.errors.time) || err.message);
      } else {
        showMessage(err.message || 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
      }
      btnNext.disabled = false;
      btnNext.classList.remove('is-loading');
    }
  }

  function showConfirmation(b) {
    card.innerHTML = `
      <div class="booking-done" role="status">
        <h2 tabindex="-1" id="doneTitle">Đã ghi nhận yêu cầu đặt lịch</h2>
        <p>Mã lịch hẹn <strong>${esc(b.code || b.id)}</strong> cho <strong>${esc(b.petName)}</strong> tại <strong>${esc(b.providerName)}</strong>, ${esc(Fmt.dateLong(b.date))} lúc <strong>${esc(b.time)}</strong>.</p>
        <p>Trạng thái hiện tại: <strong>${esc(BookingService.STATUS[b.status].label)}</strong>. Cơ sở sẽ xác nhận lại với bạn qua số điện thoại đã đăng ký.</p>
        <div class="booking-done-actions">
          <a href="customer-dashboard.html" class="btn btn-primary">Xem lịch hẹn của tôi</a>
          <a href="booking.html" class="btn btn-outline">Đặt thêm lịch</a>
        </div>
      </div>`;
    document.getElementById('doneTitle').focus();
    Toast.show({ title: 'Đã ghi nhận yêu cầu', message: `Mã lịch hẹn: ${b.code || b.id}`, type: 'success', duration: 5000 });
  }

  btnNext.addEventListener('click', () => {
    const problem = validate(state.step);
    if (problem) { showMessage(problem); return; }
    if (state.step < 4) goToStep(state.step + 1);
    else submitBooking();
  });
  btnPrev.addEventListener('click', () => { if (state.step > 1) goToStep(state.step - 1); });

  /* ---------- Input wiring (delegated; radios are real inputs) ---------- */
  card.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'pet') state.petId = t.value;
    else if (t.name === 'service') { state.serviceId = t.value; state.time = null; }
    else if (t.name === 'time') state.time = t.value;
    else if (t.name === 'date') {
      state.date = t.value;
      state.time = null;
      loadSlots();
    }
    if (t.type === 'radio') {
      card.querySelectorAll(`input[name="${t.name}"]`).forEach((r) => r.closest('label').classList.toggle('selected', r.checked));
    }
    showMessage('');
  });
  card.addEventListener('input', (e) => { if (e.target.name === 'notes') state.notes = e.target.value; });
  card.addEventListener('submit', (e) => e.preventDefault());

  /* ---------- Init ---------- */
  goToStep(1, { focus: false });
  const loadingEl = document.getElementById('petChoices');
  loadingEl.innerHTML = '<p class="panel-loading" role="status">Đang tải dữ liệu…</p>';
  btnNext.disabled = true;

  Promise.all([PetService.list(), Catalog.services()])
    .then(([petList, serviceList]) => {
      pets = petList;
      services = serviceList;
      renderPets();
      renderServices();
      btnNext.disabled = pets.length === 0;
    })
    .catch((err) => {
      loadingEl.innerHTML = `<div class="panel-error" role="alert"><p>${esc(err.message || 'Không tải được dữ liệu.')}</p><button type="button" class="btn btn-outline btn-sm" onclick="location.reload()">Thử lại</button></div>`;
    });
});
