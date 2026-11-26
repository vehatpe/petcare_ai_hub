/**
 * PetCare AI Hub - Vet Booking Exam Page
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const user = AuthService.requireRole(['vet']);
    if (!user) return;
    if (user.mustChangePassword) {
      window.location.replace('change-password.html');
      return;
    }

    const esc = Fmt.esc;
    const rootEl = document.getElementById('vetBookingRoot');
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get('id');

    if (!bookingId) {
      renderNotFound();
      return;
    }

    function renderNotFound() {
      rootEl.innerHTML = `
        <section class="panel">
          <div class="panel-body">
            <div class="empty-state">
              <h3>Không tìm thấy lịch</h3>
              <p>Lịch khám không tồn tại hoặc không được phân công cho bạn.</p>
              <a class="btn btn-primary" href="vet-bookings.html">Quay lại danh sách</a>
            </div>
          </div>
        </section>`;
    }

    function todayVnIso() {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    }

    function statusMeta(status) {
      return (window.BookingService && BookingService.STATUS[status]) || {
        label: status || 'Chờ xử lý',
        badge: 'badge-warning'
      };
    }

    function renderPetProfile(pet, petDeleted) {
      if (petDeleted) {
        return `
          <div class="alert alert-warning" role="status">
            <strong>Thú cưng đã bị xóa</strong> — Không thể ghi nhận bệnh án hoặc tiêm chủng mới cho lịch này.
          </div>`;
      }
      if (!pet) {
        return '<p class="text-muted">Không có thông tin thú cưng.</p>';
      }
      return `
        <dl class="detail-grid">
          <div><dt>Tên thú cưng</dt><dd>${esc(pet.name)}</dd></div>
          <div><dt>Loài</dt><dd>${esc(pet.species || '—')}</dd></div>
          <div><dt>Giống</dt><dd>${esc(pet.breed || '—')}</dd></div>
          <div><dt>Cân nặng hiện tại</dt><dd>${pet.weightKg != null ? esc(Fmt.kg(pet.weightKg)) : '—'}</dd></div>
        </dl>`;
    }

    function renderMedicalHistory(records) {
      if (!records || !records.length) {
        return '<p class="text-muted">Chưa có lịch sử bệnh án.</p>';
      }
      return `
        <ul class="history-list">
          ${records.map((r) => `
            <li class="history-item">
              <p class="history-date">${esc(r.visitDate ? Fmt.dateLong(r.visitDate) : '')}</p>
              <p><strong>S:</strong> ${esc(r.subjective)}</p>
              <p><strong>O:</strong> ${esc(r.objective)}</p>
              <p><strong>A:</strong> ${esc(r.assessment)}</p>
              <p><strong>P:</strong> ${esc(r.plan)}</p>
            </li>`).join('')}
        </ul>`;
    }

    function renderVaccinationHistory(vaccinations) {
      if (!vaccinations || !vaccinations.length) {
        return '<p class="text-muted">Chưa có lịch sử tiêm chủng.</p>';
      }
      return `
        <ul class="history-list" id="vaccinationHistoryList">
          ${vaccinations.map((v) => `
            <li class="history-item">
              <p><strong>${esc(v.vaccineName)}</strong> · Ngày tiêm: ${esc(v.administeredOn ? Fmt.dateLong(v.administeredOn) : '')}</p>
              <p class="text-muted">
                ${v.nextDueOn ? `Nhắc lại: ${esc(Fmt.dateLong(v.nextDueOn))} · ` : ''}
                ${v.batchNo ? `Số lô: ${esc(v.batchNo)} · ` : ''}
                ${v.providerName ? `Cơ sở: ${esc(v.providerName)}` : ''}
              </p>
            </li>`).join('')}
        </ul>`;
    }

    function renderWeightHistory(weights) {
      if (!weights || !weights.length) {
        return '<p class="text-muted">Chưa có lịch sử cân nặng.</p>';
      }
      return `
        <ul class="history-list">
          ${weights.slice(0, 5).map((w) => `
            <li class="history-item">
              <span>${esc(w.recordedOn ? Fmt.dateLong(w.recordedOn) : '')}</span>:
              <strong>${esc(Fmt.kg(w.weightKg))}</strong>
            </li>`).join('')}
        </ul>`;
    }

    function renderMedicalRecordSection(booking, existingMr, petDeleted) {
      if (petDeleted) return '';

      if (existingMr) {
        return `
          <section class="panel" aria-label="Bệnh án đã ghi">
            <div class="panel-header"><h2>Bệnh án đã ghi (Chỉ đọc)</h2></div>
            <div class="panel-body">
              <p class="text-muted">Ngày khám: ${esc(existingMr.visitDate ? Fmt.dateLong(existingMr.visitDate) : '')}</p>
              <p><strong>Triệu chứng chủ nuôi mô tả (S):</strong> ${esc(existingMr.subjective)}</p>
              <p><strong>Khám lâm sàng (O):</strong> ${esc(existingMr.objective)}</p>
              <p><strong>Đánh giá (A):</strong> ${esc(existingMr.assessment)}</p>
              <p><strong>Kế hoạch (P):</strong> ${esc(existingMr.plan)}</p>
            </div>
          </section>`;
      }

      const canWrite = booking.status === 'confirmed' || booking.status === 'completed';
      if (!canWrite) {
        const reasonMap = {
          pending: 'Lịch hẹn đang chờ xác nhận nên chưa thể ghi bệnh án.',
          cancelled: 'Lịch hẹn đã hủy nên không thể ghi bệnh án.',
          no_show: 'Khách vắng mặt nên không thể ghi bệnh án.'
        };
        return `
          <section class="panel" aria-label="Ghi bệnh án">
            <div class="panel-header"><h2>Ghi bệnh án</h2></div>
            <div class="panel-body">
              <p class="text-muted">${esc(reasonMap[booking.status] || 'Trạng thái lịch hiện tại không cho phép ghi bệnh án.')}</p>
            </div>
          </section>`;
      }

      const fields = [
        { name: 'subjective', label: 'Triệu chứng chủ nuôi mô tả (S)' },
        { name: 'objective', label: 'Khám lâm sàng (O)' },
        { name: 'assessment', label: 'Đánh giá (A)' },
        { name: 'plan', label: 'Kế hoạch (P)' }
      ];

      return `
        <section class="panel" aria-label="Ghi bệnh án">
          <div class="panel-header"><h2>Ghi bệnh án</h2></div>
          <div class="panel-body">
            <form id="medicalRecordForm" novalidate>
              ${fields.map((f) => `
                <div class="form-group">
                  <label for="mr_${f.name}">${esc(f.label)} <span class="required">*</span></label>
                  <textarea id="mr_${f.name}" name="${f.name}" class="form-control" rows="3" maxlength="2000" required></textarea>
                  <div class="form-hint" id="mr_${f.name}_count">0 / 2000</div>
                  <div class="form-error" id="mr_${f.name}_err"></div>
                </div>`).join('')}
              <button type="submit" class="btn btn-primary" id="mrSubmitBtn">Lưu bệnh án</button>
            </form>
          </div>
        </section>`;
    }

    function renderVaccinationSection(booking, petDeleted) {
      if (petDeleted) return '';
      const canWrite = booking.status === 'confirmed' || booking.status === 'completed';
      if (!canWrite) return '';

      return `
        <section class="panel" aria-label="Ghi nhận tiêm chủng">
          <div class="panel-header"><h2>Ghi nhận tiêm chủng</h2></div>
          <div class="panel-body">
            <form id="vaccinationForm" novalidate>
              <div class="form-group">
                <label for="vac_vaccineName">Tên vắc-xin <span class="required">*</span></label>
                <input type="text" id="vac_vaccineName" name="vaccineName" class="form-control" maxlength="80" required>
                <div class="form-hint" id="vac_vaccineName_count">0 / 80</div>
                <div class="form-error" id="vac_vaccineName_err"></div>
              </div>
              <div class="form-group">
                <label for="vac_administeredOn">Ngày tiêm <span class="required">*</span></label>
                <input type="date" id="vac_administeredOn" name="administeredOn" class="form-control" value="${esc(todayVnIso())}" required>
                <div class="form-error" id="vac_administeredOn_err"></div>
              </div>
              <div class="form-group">
                <label for="vac_nextDueOn">Ngày tiêm nhắc lại (tùy chọn)</label>
                <input type="date" id="vac_nextDueOn" name="nextDueOn" class="form-control">
                <div class="form-error" id="vac_nextDueOn_err"></div>
              </div>
              <div class="form-group">
                <label for="vac_batchNo">Số lô (tùy chọn)</label>
                <input type="text" id="vac_batchNo" name="batchNo" class="form-control" maxlength="40">
                <div class="form-hint" id="vac_batchNo_count">0 / 40</div>
                <div class="form-error" id="vac_batchNo_err"></div>
              </div>
              <button type="submit" class="btn btn-outline" id="vacSubmitBtn">Thêm mũi tiêm</button>
            </form>
          </div>
        </section>`;
    }

    function bindCounters(form, names, maxMap) {
      names.forEach((name) => {
        const input = form.querySelector(`[name="${name}"]`);
        const countEl = form.querySelector(`#${form.id === 'medicalRecordForm' ? 'mr' : 'vac'}_${name}_count`);
        if (!input || !countEl) return;
        input.addEventListener('input', () => {
          countEl.textContent = `${input.value.length} / ${maxMap[name]}`;
        });
      });
    }

    function showFieldErrors(prefix, errors) {
      document.querySelectorAll(`[id^="${prefix}_"][id$="_err"]`).forEach((el) => {
        el.textContent = '';
      });
      if (!errors) return;
      Object.keys(errors).forEach((k) => {
        const errEl = document.getElementById(`${prefix}_${k}_err`);
        if (errEl) errEl.textContent = errors[k];
      });
    }

    function renderDetail(data) {
      const booking = data.booking || data;
      const pet = data.pet || null;
      const petDeleted = Boolean(data.petDeleted);
      const medicalRecords = Array.isArray(data.medicalRecords) ? data.medicalRecords : [];
      const vaccinations = Array.isArray(data.vaccinations) ? data.vaccinations : [];
      const weights = Array.isArray(data.weights) ? data.weights : [];
      const existingMr = data.medicalRecord || medicalRecords.find((m) => m.bookingId === booking.id) || null;
      const st = statusMeta(booking.status);

      rootEl.innerHTML = `
        <section class="panel" aria-label="Thông tin lịch hẹn">
          <div class="panel-header">
            <h2>${esc(booking.serviceName || 'Dịch vụ khám')}</h2>
            <span class="badge ${st.badge}">${esc(st.label)}</span>
          </div>
          <div class="panel-body">
            <p class="booking-meta">Ngày hẹn: ${esc(booking.date ? Fmt.dateLong(booking.date) : '')} lúc ${esc(booking.time || '')}</p>
            <p class="booking-meta">Chủ nuôi: ${esc(booking.ownerName || '—')}</p>
            ${booking.notes ? `<p class="booking-meta">Ghi chú: ${esc(booking.notes)}</p>` : ''}
          </div>
        </section>

        <section class="panel" aria-label="Hồ sơ thú cưng">
          <div class="panel-header"><h2>Hồ sơ thú cưng</h2></div>
          <div class="panel-body">${renderPetProfile(pet, petDeleted)}</div>
        </section>

        ${renderMedicalRecordSection(booking, existingMr, petDeleted)}
        ${renderVaccinationSection(booking, petDeleted)}

        <section class="panel" aria-label="Lịch sử tiêm chủng">
          <div class="panel-header"><h2>Lịch sử tiêm chủng</h2></div>
          <div class="panel-body" id="vaccinationHistoryBody">${renderVaccinationHistory(vaccinations)}</div>
        </section>

        <section class="panel" aria-label="Lịch sử bệnh án">
          <div class="panel-header"><h2>Lịch sử bệnh án</h2></div>
          <div class="panel-body">${renderMedicalHistory(medicalRecords)}</div>
        </section>

        <section class="panel" aria-label="Lịch sử cân nặng">
          <div class="panel-header"><h2>Lịch sử cân nặng</h2></div>
          <div class="panel-body">${renderWeightHistory(weights)}</div>
        </section>`;

      const mrForm = document.getElementById('medicalRecordForm');
      if (mrForm) {
        bindCounters(mrForm, ['subjective', 'objective', 'assessment', 'plan'], {
          subjective: 2000,
          objective: 2000,
          assessment: 2000,
          plan: 2000
        });

        mrForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = document.getElementById('mrSubmitBtn');
          btn.disabled = true;
          showFieldErrors('mr', null);

          const payload = {
            subjective: mrForm.subjective.value.trim(),
            objective: mrForm.objective.value.trim(),
            assessment: mrForm.assessment.value.trim(),
            plan: mrForm.plan.value.trim()
          };

          try {
            await Api.post(`/vet/bookings/${encodeURIComponent(bookingId)}/medical-record`, payload);
            Toast.show({ title: 'Đã lưu bệnh án', message: 'Bệnh án đã được ghi nhận.', type: 'success' });
            loadDetail();
          } catch (err) {
            btn.disabled = false;
            if (err && err.status === 422 && err.errors) {
              showFieldErrors('mr', err.errors);
              Toast.show({ title: 'Dữ liệu chưa hợp lệ', message: err.message, type: 'danger' });
              return;
            }
            if (err && err.status === 409) {
              Toast.show({ title: 'Không thể lưu bệnh án', message: err.message, type: 'warning' });
              loadDetail();
              return;
            }
            Toast.show({ title: 'Lỗi lưu bệnh án', message: (err && err.message) || 'Vui lòng thử lại.', type: 'danger' });
          }
        });
      }

      const vacForm = document.getElementById('vaccinationForm');
      if (vacForm) {
        bindCounters(vacForm, ['vaccineName', 'batchNo'], { vaccineName: 80, batchNo: 40 });
        vacForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = document.getElementById('vacSubmitBtn');
          btn.disabled = true;
          showFieldErrors('vac', null);

          const payload = {
            vaccineName: vacForm.vaccineName.value.trim(),
            administeredOn: vacForm.administeredOn.value,
            nextDueOn: vacForm.nextDueOn.value || null,
            batchNo: vacForm.batchNo.value.trim()
          };

          try {
            await Api.post(`/vet/bookings/${encodeURIComponent(bookingId)}/vaccinations`, payload);
            Toast.show({ title: 'Đã ghi mũi tiêm', message: 'Thông tin tiêm chủng đã được cập nhật.', type: 'success' });
            loadDetail();
          } catch (err) {
            btn.disabled = false;
            if (err && err.status === 422 && err.errors) {
              showFieldErrors('vac', err.errors);
              Toast.show({ title: 'Dữ liệu chưa hợp lệ', message: err.message, type: 'danger' });
              return;
            }
            Toast.show({ title: 'Lỗi ghi tiêm chủng', message: (err && err.message) || 'Vui lòng thử lại.', type: 'danger' });
          }
        });
      }
    }

    function loadDetail() {
      return Panel.load(
        rootEl,
        () => Api.get(`/vet/bookings/${encodeURIComponent(bookingId)}`),
        renderDetail,
        { loading: 'Đang tải hồ sơ khám…' }
      ).catch((err) => {
        if (err && err.status === 404) {
          renderNotFound();
        }
      });
    }

    loadDetail();
  });
})();
