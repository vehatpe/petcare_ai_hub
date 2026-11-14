/**
 * PetCare AI Hub - Pet profile form (create / edit)
 * ?id=<petId> edits an existing pet, otherwise creates a new one.
 * ?next=<page> returns there after saving (e.g. the booking flow).
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const form = document.getElementById('petForm');
  if (!form || !AuthService.isLoggedIn()) return; // guard in auth-gate.js is already redirecting

  const params = new URLSearchParams(window.location.search);
  const editId = params.get('id');
  const next = AuthService.safeNext(params.get('next'));
  const returnUrl = next || 'customer-dashboard.html';

  const alertBox = document.getElementById('formAlert');
  const submitBtn = document.getElementById('submitBtn');
  const breedList = document.getElementById('breedOptions');
  const photoInput = document.getElementById('photoInput');
  const photoRemove = document.getElementById('photoRemove');
  const photoError = document.getElementById('photo-error');

  let photo = null;
  let editing = null;

  document.getElementById('cancelLink').href = returnUrl;
  form.birthDate.max = Fmt.todayIso();

  /* ---------- Species options ---------- */
  function renderSpeciesOptions() {
    const container = document.getElementById('speciesSegmented');
    if (!container) return;
    container.innerHTML = PetService.SPECIES.map((s) => `
      <label><input type="radio" name="species" value="${Fmt.esc(s.id)}"><span>${Fmt.esc(s.label)}</span></label>
    `).join('');
    container.querySelectorAll('input[name="species"]').forEach((r) => r.addEventListener('change', () => {
      syncBreeds();
      renderPreview();
    }));
  }

  /* ---------- Breed suggestions follow the species ---------- */
  function syncBreeds() {
    const species = form.elements.species.value;
    breedList.innerHTML = '';
    (PetService.BREEDS[species] || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b;
      breedList.appendChild(opt);
    });
  }

  /* ---------- Live preview ---------- */
  function renderPreview() {
    const name = form.elements.name.value.trim();
    const avatar = document.getElementById('previewAvatar');
    const nameEl = document.getElementById('previewName');

    avatar.textContent = '';
    if (photo) {
      const img = document.createElement('img');
      img.src = photo;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
    }

    nameEl.textContent = name || 'Tên của bé';
    nameEl.classList.toggle('is-placeholder', !name);

    const parts = [];
    const species = form.elements.species.value;
    if (species) parts.push(PetService.speciesLabel(species));
    if (form.breed.value.trim()) parts.push(form.breed.value.trim());
    const age = PetService.ageLabel(form.birthDate.value);
    if (age) parts.push(age);
    if (form.weightKg.value) parts.push(String(form.weightKg.value).replace('.', ',') + ' kg');
    document.getElementById('previewSummary').textContent = parts.length ? parts.join(' · ') : 'Loài · giống · tuổi · cân nặng';

    photoRemove.hidden = !photo;
  }

  /* ---------- Errors ---------- */
  function controlFor(name) {
    const el = form.elements[name];
    return el && el.length !== undefined && el.tagName !== 'SELECT' ? el[0] : el; // radio group -> first radio
  }

  function setFieldError(name, message) {
    const err = document.getElementById(`${name}-error`);
    const control = controlFor(name);
    if (!err) return;
    err.textContent = message || '';
    err.hidden = !message;
    if (control && control.type !== 'radio') {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  function clearErrors() {
    form.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    alertBox.hidden = true;
  }

  function showErrors(errors) {
    const names = Object.keys(errors);
    names.forEach((n) => setFieldError(n, errors[n]));
    const first = names.map(controlFor).find(Boolean);
    if (first) first.focus();
  }

  /* ---------- Photo upload (resized to 320px square) ---------- */
  function toAvatar(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không đọc được ảnh này. Vui lòng chọn tệp JPG, PNG hoặc WebP.'));
      };
      img.src = url;
    });
  }

  document.getElementById('photoPick').addEventListener('click', () => photoInput.click());
  photoRemove.addEventListener('click', () => { photo = null; photoInput.value = ''; renderPreview(); });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    photoError.hidden = true;
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Vui lòng chọn một tệp ảnh.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Ảnh lớn hơn 8 MB, vui lòng chọn ảnh nhỏ hơn.');
      photo = await toAvatar(file);
      renderPreview();
    } catch (err) {
      photoError.textContent = err.message;
      photoError.hidden = false;
    }
  });

  alertBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reload"]')) {
      e.preventDefault();
      location.reload();
    }
  });

  /* ---------- Wiring ---------- */
  form.addEventListener('input', (e) => {
    if (e.target.name) setFieldError(e.target.name, '');
    renderPreview();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    submitBtn.disabled = true;
    submitBtn.classList.add('is-loading');

    try {
      const saved = await PetService.save({
        id: editing ? editing.id : undefined,
        name: form.elements.name.value,
        species: form.elements.species.value,
        breed: form.breed.value,
        sex: form.elements.sex.value,
        birthDate: form.birthDate.value,
        weightKg: form.weightKg.value,
        color: form.color.value,
        neutered: form.neutered.value,
        conditions: form.conditions.value,
        microchip: form.microchip.value,
        photo
      });
      try {
        sessionStorage.setItem('petcare_flash', JSON.stringify({
          title: editing ? 'Đã cập nhật hồ sơ' : 'Đã thêm thú cưng',
          message: `Hồ sơ của ${saved.name} đã được lưu.`
        }));
      } catch (_) { /* flash message is optional */ }
      window.location.href = returnUrl;
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-loading');
      if (err.errors) {
        showErrors(err.errors);
      } else {
        alertBox.className = 'form-alert form-alert-error';
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        alertBox.focus();
      }
    }
  });

  /* ---------- Edit mode (async: the pet comes from the API) ---------- */
  function showBlocked(kind, html) {
    form.hidden = true;
    alertBox.className = `form-alert form-alert-${kind}`;
    alertBox.innerHTML = html;
    alertBox.hidden = false;
  }

  async function init() {
    renderSpeciesOptions();
    form.setAttribute('aria-busy', 'true');
    try {
      if (editId) {
        editing = await PetService.get(editId);
        if (!editing) {
          showBlocked('error', 'Không tìm thấy hồ sơ thú cưng này. <a href="customer-dashboard.html"><strong>Quay lại bảng điều khiển</strong></a>');
          return;
        }
        document.title = `Sửa hồ sơ ${editing.name} - PetCare AI Hub`;
        document.getElementById('pageTitle').textContent = `Sửa hồ sơ ${editing.name}`;
        submitBtn.textContent = 'Lưu thay đổi';
        ['name', 'breed', 'birthDate', 'weightKg', 'color', 'neutered', 'conditions', 'microchip'].forEach((f) => {
          form.elements[f].value = editing[f] ?? '';
        });
        form.elements.species.value = editing.species;
        form.elements.sex.value = editing.sex;
        photo = editing.photo || null;
      } else {
        if (params.get('welcome') === '1') document.getElementById('welcomeNote').hidden = false;
        const count = (await PetService.list()).length;
        if (count >= PetService.MAX_PETS_PER_OWNER) {
          showBlocked('info', `Mỗi tài khoản lưu tối đa ${PetService.MAX_PETS_PER_OWNER} hồ sơ thú cưng.`);
          return;
        }
      }
    } catch (err) {
      showBlocked('error', `${Fmt.esc(err.message || 'Không tải được hồ sơ.')} <a href="#" data-action="reload"><strong>Thử lại</strong></a>`);
      return;
    } finally {
      form.removeAttribute('aria-busy');
    }
    syncBreeds();
    renderPreview();
  }

  init();
});
