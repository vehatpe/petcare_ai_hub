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
  const photoPick = document.getElementById('photoPick');
  const photoRemove = document.getElementById('photoRemove');
  const photoError = document.getElementById('photo-error');
  const previewAvatar = document.getElementById('previewAvatar');

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_EDGE = 1024;

  let photoUrl = null;
  let pendingFile = null;
  let pendingPreviewUrl = null;
  let editing = null;

  function revokePendingPreview() {
    if (pendingPreviewUrl && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(pendingPreviewUrl);
    }
    pendingPreviewUrl = null;
  }

  function currentPhotoSrc() {
    return pendingPreviewUrl || photoUrl;
  }

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

    const src = currentPhotoSrc();
    avatar.textContent = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
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

    photoRemove.hidden = !src;
  }

  if (previewAvatar) {
    previewAvatar.addEventListener('error', (e) => {
      if (!e.target || e.target.tagName !== 'IMG') return;
      const name = form.elements.name.value.trim();
      previewAvatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
    }, true);
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

  /* ---------- Photo upload (resized to max 1024px Blob; fallback to original file) ---------- */
  function resizeToBlob(file) {
    return new Promise((resolve) => {
      if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
        resolve(file);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.width || 0;
          const h = img.height || 0;
          if (!w || !h) {
            URL.revokeObjectURL(url);
            resolve(file);
            return;
          }
          const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext && canvas.getContext('2d');
          if (!ctx || typeof canvas.toBlob !== 'function') {
            URL.revokeObjectURL(url);
            resolve(file);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const outType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            resolve(blob || file);
          }, outType, 0.85);
        } catch (_) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function setBusy(busy, label) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle('is-loading', busy);
    if (photoPick) photoPick.disabled = busy;
    if (photoRemove) photoRemove.disabled = busy;
    if (label) submitBtn.textContent = label;
    else submitBtn.textContent = editing ? 'Lưu thay đổi' : 'Lưu hồ sơ';
  }

  photoPick.addEventListener('click', () => photoInput.click());
  photoRemove.addEventListener('click', async () => {
    photoError.hidden = true;
    if (pendingFile) {
      pendingFile = null;
      revokePendingPreview();
      photoInput.value = '';
      renderPreview();
      return;
    }
    if (!editing || !photoUrl) return;
    setBusy(true);
    try {
      const updated = await PetService.removePhoto(editing.id);
      editing = updated;
      photoUrl = updated.photo || null;
      photoInput.value = '';
      renderPreview();
      if (window.Toast) Toast.info('Đã xóa ảnh thú cưng.');
    } catch (err) {
      photoError.textContent = err.message || 'Không xóa được ảnh.';
      photoError.hidden = false;
    } finally {
      setBusy(false);
    }
  });
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    photoError.hidden = true;
    if (!file) return;
    try {
      if (ALLOWED_TYPES.indexOf(file.type) === -1) {
        throw new Error('Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.');
      }
      if (file.size > MAX_BYTES) {
        throw new Error('Ảnh lớn hơn 5 MB, vui lòng chọn ảnh nhỏ hơn.');
      }
      const processed = await resizeToBlob(file);
      revokePendingPreview();
      pendingFile = processed;
      if (typeof URL.createObjectURL === 'function') {
        pendingPreviewUrl = URL.createObjectURL(processed);
      }
      renderPreview();
    } catch (err) {
      photoInput.value = '';
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
    const wasEditing = Boolean(editing);
    setBusy(true);

    let saved;
    try {
      saved = await PetService.save({
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
        microchip: form.microchip.value
      });
    } catch (err) {
      setBusy(false);
      if (err.errors) {
        showErrors(err.errors);
      } else {
        alertBox.className = 'form-alert form-alert-error';
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        alertBox.focus();
      }
      return;
    }

    editing = saved;
    if (pendingFile) {
      setBusy(true, 'Đang tải ảnh…');
      try {
        const updated = await PetService.uploadPhoto(saved.id, pendingFile, pendingFile.name || 'pet.jpg');
        editing = updated;
        photoUrl = updated.photo || null;
        pendingFile = null;
        revokePendingPreview();
        renderPreview();
      } catch (err) {
        document.title = `Sửa hồ sơ ${saved.name} - PetCare AI Hub`;
        document.getElementById('pageTitle').textContent = `Sửa hồ sơ ${saved.name}`;
        setBusy(false);
        const msg = err.message || 'Không tải ảnh lên được.';
        photoError.textContent = msg;
        photoError.hidden = false;
        if (!wasEditing && window.Toast) {
          Toast.error('Đã lưu hồ sơ nhưng ảnh chưa tải lên được', msg);
        } else if (window.Toast) {
          Toast.error('Chưa tải ảnh lên được', msg);
        }
        return;
      }
    }

    setBusy(false);
    try {
      sessionStorage.setItem('petcare_flash', JSON.stringify({
        title: wasEditing ? 'Đã cập nhật hồ sơ' : 'Đã thêm thú cưng',
        message: `Hồ sơ của ${editing.name} đã được lưu.`
      }));
    } catch (_) { /* flash message is optional */ }
    window.location.href = returnUrl;
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
        photoUrl = editing.photo || null;
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
