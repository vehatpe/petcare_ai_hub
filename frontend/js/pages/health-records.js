/**
 * PetCare AI Hub - Health records (Sổ sức khỏe)
 * Everything shown comes from GET /health-records. Nothing is assumed:
 *  - the weight chart is drawn only when the API says weightChart.canRender (>= 2 points);
 *  - vaccine status and the progress ring come from server-computed counts;
 *  - owner-entered rows are labelled as such until a clinic records them.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const user = AuthService.currentUser();
  if (!user || user.role !== 'customer') return;

  const esc = Fmt.esc;
  const toolbar = document.getElementById('healthToolbar');
  const body = document.getElementById('healthBody');
  const params = new URLSearchParams(window.location.search);
  let pets = [];
  let petId = null;

  /* ---------- Weight chart (SVG, only with >= 2 real points) ---------- */
  function weightChart(points) {
    const W = 640, H = 220, L = 44, R = 16, T = 16, B = 32;
    const xs = points.map((p) => Fmt.parseDate(p.measuredOn).getTime());
    const ys = points.map((p) => p.weightKg);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = Math.max((maxY - minY) * 0.2, 0.2);
    minY -= pad; maxY += pad;
    const x = (t) => L + (maxX === minX ? 0 : ((t - minX) / (maxX - minX)) * (W - L - R));
    const y = (v) => T + (1 - (v - minY) / (maxY - minY)) * (H - T - B);
    const pts = points.map((p, i) => [x(xs[i]), y(ys[i])]);
    const line = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
    const ticks = [minY + pad, (minY + maxY) / 2, maxY - pad];
    return `
      <svg class="weight-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ cân nặng ${points.length} lần đo, từ ${Fmt.dateShort(points[0].measuredOn)} đến ${Fmt.dateShort(points[points.length - 1].measuredOn)}">
        ${ticks.map((v) => `<line class="weight-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="weight-tick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(Fmt.kg(v))}</text>`).join('')}
        <path class="weight-line" pathLength="1" d="${line}"/>
        ${pts.map((q, i) => `<circle class="weight-dot" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="4"><title>${esc(Fmt.kg(ys[i]))}, ${esc(Fmt.dateShort(points[i].measuredOn))}</title></circle>`).join('')}
        <text class="weight-tick" x="${L}" y="${H - 8}">${esc(Fmt.dateShort(points[0].measuredOn))}</text>
        <text class="weight-tick" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(Fmt.dateShort(points[points.length - 1].measuredOn))}</text>
      </svg>`;
  }

  /* ---------- Vaccine ring (only when total > 0) ---------- */
  function ring(sum) {
    const frac = sum.total ? sum.upToDate / sum.total : 0;
    return `
      <div class="ring" role="img" aria-label="${sum.upToDate} trên ${sum.total} loại vắc-xin còn hạn hoặc đã ghi nhận">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle class="ring-track" cx="22" cy="22" r="18"/>
          <circle class="ring-value" cx="22" cy="22" r="18" pathLength="1" data-offset="${(1 - frac).toFixed(3)}"/>
        </svg>
        <span class="ring-label"><strong>${sum.upToDate}/${sum.total}</strong></span>
      </div>`;
  }

  /* ---------- Sections ---------- */
  function weightSection(d) {
    const latest = d.weights[d.weights.length - 1];
    const form = `
      <form class="inline-form" id="weightForm" novalidate>
        <div class="form-group"><label class="form-label" for="wKg">Cân nặng (kg)</label>
          <input class="form-control" id="wKg" name="weightKg" type="number" inputmode="decimal" step="0.001" min="0.005" max="150" required></div>
        <div class="form-group"><label class="form-label" for="wDate">Ngày đo</label>
          <input class="form-control" id="wDate" name="measuredOn" type="date" max="${Fmt.todayIso()}" value="${Fmt.todayIso()}" required></div>
        <button class="btn btn-primary btn-sm" type="submit">Lưu số đo</button>
        <p class="field-error" id="weightError" role="alert" hidden></p>
      </form>`;

    let chart;
    if (d.weightChart.canRender) {
      chart = weightChart(d.weights);
    } else {
      chart = `
        <div class="empty-state">
          <h3>Chưa đủ dữ liệu để vẽ biểu đồ</h3>
          <p>${latest
            ? `Mới có ${d.weightChart.count} lần đo (${esc(Fmt.kg(latest.weightKg))}, ${esc(Fmt.dateShort(latest.measuredOn))}). Cần ít nhất 2 lần đo để thấy xu hướng.`
            : 'Chưa có lần đo nào. Cần ít nhất 2 lần đo để thấy xu hướng cân nặng.'}</p>
          <button type="button" class="btn btn-primary" data-focus-weight>Cập nhật cân nặng hôm nay</button>
        </div>`;
    }

    const rows = d.weights.slice().reverse().map((w) => `
      <li><span>${esc(Fmt.dateShort(w.measuredOn))}</span><strong>${esc(Fmt.kg(w.weightKg))}</strong>
        <button type="button" class="btn btn-ghost btn-sm" data-del-weight="${esc(w.id)}" aria-label="Xóa số đo ${esc(Fmt.kg(w.weightKg))} ngày ${esc(Fmt.dateShort(w.measuredOn))}">Xóa</button></li>`).join('');

    return `
      <section class="health-card" aria-labelledby="hWeight">
        <h2 id="hWeight">Cân nặng</h2>
        ${chart}
        ${form}
        ${rows ? `<ul class="record-list weight-list">${rows}</ul>` : ''}
      </section>`;
  }

  function vaccineSection(d) {
    const sum = d.vaccineSummary;
    const items = d.vaccinations.map((v) => {
      const st = HealthService.VACCINE_STATUS[v.status] || HealthService.VACCINE_STATUS.recorded;
      const origin = v.source === 'clinic' ? 'Do cơ sở ghi nhận' : 'Do bạn tự nhập, chưa được cơ sở xác nhận';
      return `
        <li class="vax-item">
          <div>
            <p class="vax-name">${esc(v.vaccineName)}</p>
            <p class="vax-meta">Tiêm ${esc(Fmt.dateShort(v.administeredOn))}${v.nextDueOn ? ` · mũi tiếp theo ${esc(Fmt.dateShort(v.nextDueOn))}` : ''}${v.providerName ? ` · ${esc(v.providerName)}` : ''}${v.batchNo ? ` · lô ${esc(v.batchNo)}` : ''}</p>
            <p class="vax-origin">${esc(origin)}</p>
          </div>
          <div class="vax-side">
            <span class="badge ${st.badge}">${esc(st.label)}</span>
            ${v.source === 'owner' ? `<button type="button" class="btn btn-ghost btn-sm" data-del-vax="${esc(v.id)}" aria-label="Xóa bản ghi ${esc(v.vaccineName)}">Xóa</button>` : ''}
          </div>
        </li>`;
    }).join('');

    const attention = sum.overdue + sum.dueSoon;
    const summary = sum.total
      ? `<div class="vax-summary">${ring(sum)}<div>
           <p><strong>${sum.upToDate}</strong> trên <strong>${sum.total}</strong> loại vắc-xin còn hạn hoặc đã ghi nhận.</p>
           ${attention ? `<p class="vax-attn">${sum.overdue ? `${sum.overdue} quá hạn` : ''}${sum.overdue && sum.dueSoon ? ', ' : ''}${sum.dueSoon ? `${sum.dueSoon} sắp đến hạn` : ''}${sum.nextDue ? `. Gần nhất: ${esc(sum.nextDue.vaccineName)}, hạn ${esc(Fmt.dateShort(sum.nextDue.dueOn))}` : ''}.</p>` : ''}
         </div></div>`
      : '';

    return `
      <section class="health-card" aria-labelledby="hVax">
        <h2 id="hVax">Tiêm chủng</h2>
        ${summary}
        ${items ? `<ul class="record-list">${items}</ul>` : `<div class="empty-state"><h3>Chưa có mũi tiêm nào được ghi nhận</h3><p>Hệ thống không kết luận tình trạng tiêm chủng khi chưa có dữ liệu. Hãy thêm mũi tiêm từ sổ tiêm giấy của bé.</p></div>`}
        <details class="add-details">
          <summary class="btn btn-outline btn-sm">Thêm mũi tiêm</summary>
          <form class="inline-form" id="vaxForm" novalidate>
            <div class="form-group"><label class="form-label" for="vName">Tên vắc-xin</label><input class="form-control" id="vName" name="vaccineName" maxlength="100" required></div>
            <div class="form-group"><label class="form-label" for="vDate">Ngày tiêm</label><input class="form-control" id="vDate" name="administeredOn" type="date" max="${Fmt.todayIso()}" required></div>
            <div class="form-group"><label class="form-label" for="vNext">Hạn mũi tiếp theo <span class="optional">(nếu có)</span></label><input class="form-control" id="vNext" name="nextDueOn" type="date"></div>
            <div class="form-group"><label class="form-label" for="vProv">Nơi tiêm <span class="optional">(nếu có)</span></label><input class="form-control" id="vProv" name="providerName" maxlength="120"></div>
            <button class="btn btn-primary btn-sm" type="submit">Lưu</button>
            <p class="field-error" id="vaxError" role="alert" hidden></p>
          </form>
        </details>
      </section>`;
  }

  function recordsSection(d) {
    const items = d.medicalRecords.map((r) => `
      <li class="mr-item">
        <p class="mr-head"><strong>${esc(Fmt.dateLong(r.visitDate))}</strong>${r.vetName ? ` · ${esc(r.vetName)}` : ''}</p>
        <dl class="mr-soap">
          <div><dt>Triệu chứng ghi nhận</dt><dd>${esc(r.subjective || '')}</dd></div>
          <div><dt>Khám lâm sàng</dt><dd>${esc(r.objective || '')}</dd></div>
          <div><dt>Đánh giá</dt><dd>${esc(r.assessment || '')}</dd></div>
          <div><dt>Hướng xử trí</dt><dd>${esc(r.plan || '')}</dd></div>
        </dl>
      </li>`).join('');
    const mrTotal = (d.medicalRecordsMeta && d.medicalRecordsMeta.total) ?? d.medicalRecords.length;
    const moreMrHtml = d.medicalRecords.length < mrTotal
      ? `<div class="pager"><span class="pager-info">Đã hiển thị ${esc(String(d.medicalRecords.length))} / ${esc(String(mrTotal))}</span><button type="button" class="btn btn-outline btn-sm" data-action="load-more-mr">Tải thêm bệnh án</button></div>`
      : '';
    return `
      <section class="health-card" aria-labelledby="hMr">
        <h2 id="hMr">Bệnh án</h2>
        ${items ? `<ul class="record-list">${items}</ul>${moreMrHtml}` : '<div class="empty-state"><h3>Chưa có bệnh án</h3><p>Bệnh án chỉ do bác sĩ thú y ghi sau khi khám. Bạn không thể tự nhập mục này.</p></div>'}
      </section>`;
  }

  /* ---------- Load ---------- */
  function showError(el, id, msg) {
    const e = document.getElementById(id);
    e.textContent = msg;
    e.hidden = !msg;
  }

  function render(d) {
    body.innerHTML = weightSection(d) + vaccineSection(d) + recordsSection(d);

    body.querySelectorAll('[data-offset]').forEach((el) => el.style.setProperty('--ring-offset', el.dataset.offset));
    body.querySelector('[data-focus-weight]')?.addEventListener('click', () => document.getElementById('wKg').focus());
    body.querySelector('[data-action="load-more-mr"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Đang tải…';
      try {
        const nextPage = ((d.medicalRecordsMeta && d.medicalRecordsMeta.page) || 1) + 1;
        const limit = (d.medicalRecordsMeta && d.medicalRecordsMeta.limit) || 10;
        const { data, meta } = await Api.get('/pets/' + encodeURIComponent(d.pet.id) + '/medical-records', { page: nextPage, limit }, { withMeta: true });
        d.medicalRecords = d.medicalRecords.concat((data && data.items) || []);
        d.medicalRecordsMeta = meta || { ...d.medicalRecordsMeta, page: nextPage };
        render(d);
      } catch (err) {
        Toast.show({ title: 'Chưa tải thêm được', message: err.message || 'Không tải thêm được bệnh án.', type: 'danger' });
        btn.disabled = false;
        btn.textContent = 'Tải thêm bệnh án';
      }
    });

    document.getElementById('weightForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const kg = Number(f.weightKg.value);
      if (!(kg >= 0.005 && kg <= 150)) { showError(f, 'weightError', 'Cân nặng cần trong khoảng 0,005 – 150 kg.'); return; }
      try {
        await HealthService.addWeight(petId, { weightKg: kg, measuredOn: f.measuredOn.value });
        Toast.show({ title: 'Đã lưu cân nặng', message: `${Fmt.kg(kg)}`, type: 'success' });
        load();
      } catch (err) { showError(f, 'weightError', (err.errors && Object.values(err.errors)[0]) || err.message); }
    });

    document.getElementById('vaxForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.vaccineName.value.trim() || !f.administeredOn.value) { showError(f, 'vaxError', 'Vui lòng nhập tên vắc-xin và ngày tiêm.'); return; }
      try {
        await HealthService.addVaccination(petId, {
          vaccineName: f.vaccineName.value.trim(), administeredOn: f.administeredOn.value,
          nextDueOn: f.nextDueOn.value || undefined, providerName: f.providerName.value.trim() || undefined
        });
        Toast.show({ title: 'Đã ghi nhận mũi tiêm', message: f.vaccineName.value.trim(), type: 'success' });
        load();
      } catch (err) { showError(f, 'vaxError', (err.errors && Object.values(err.errors)[0]) || err.message); }
    });
  }

  body.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-del-weight]');
    const v = e.target.closest('[data-del-vax]');
    if (!w && !v) return;
    const ok = await Dialog.confirm({
      title: w ? 'Xóa số đo này?' : 'Xóa bản ghi tiêm chủng này?',
      text: 'Thao tác này không thể hoàn tác.', confirmLabel: 'Xóa', cancelLabel: 'Giữ lại', danger: true
    });
    if (!ok) return;
    try {
      if (w) await HealthService.removeWeight(petId, w.dataset.delWeight);
      else await HealthService.removeVaccination(petId, v.dataset.delVax);
      load();
    } catch (err) { Toast.show({ title: 'Chưa xóa được', message: err.message, type: 'danger' }); }
  });

  function load() {
    return Panel.load(body, () => HealthService.get(petId), render, { loading: 'Đang tải sổ sức khỏe…' });
  }

  function renderToolbar() {
    const pet = pets.find((p) => p.id === petId);
    document.getElementById('healthTitle').textContent = `Sổ sức khỏe của ${pet.name}`;
    document.title = `Sổ sức khỏe ${pet.name} - PetCare AI Hub`;
    toolbar.innerHTML = `
      ${pets.length > 1 ? `<label class="visually-hidden" for="petPick">Chọn thú cưng</label>
        <select class="form-control health-pet-select" id="petPick">${pets.map((p) => `<option value="${esc(p.id)}"${p.id === petId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : `<p class="health-pet-name">${esc(PetService.summary(pet))}</p>`}
      <a class="btn btn-secondary btn-sm" href="ai-assistant.html?pet=${encodeURIComponent(petId)}">Hỏi AI về bé</a>
      <a class="btn btn-outline btn-sm" href="booking.html?pet=${encodeURIComponent(petId)}">Đặt lịch</a>`;
    document.getElementById('petPick')?.addEventListener('change', (e) => {
      petId = e.target.value;
      history.replaceState(null, '', `?pet=${encodeURIComponent(petId)}`);
      renderToolbar();
      load();
    });
  }

  Panel.load(body, () => PetService.list(), (list) => {
    pets = list;
    if (!pets.length) {
      body.innerHTML = '<div class="empty-state"><h3>Chưa có hồ sơ thú cưng</h3><p>Sổ sức khỏe gắn với từng bé. Hãy thêm thú cưng trước.</p><a class="btn btn-primary" href="pet-profile.html?next=health-records.html">Thêm thú cưng</a></div>';
      return;
    }
    petId = (pets.find((p) => p.id === params.get('pet')) || pets[0]).id;
    renderToolbar();
    load();
  }, { loading: 'Đang tải…' });
});
