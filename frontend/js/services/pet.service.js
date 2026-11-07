/**
 * PetCare AI Hub - Pet Profile Service
 * Every pet belongs to exactly one owner (the signed-in user) and lives in the database
 * behind /api/v1/pets. A new account starts with zero pets; nothing is seeded.
 * weightKg is the latest entry of the pet's weight history (null when none was recorded).
 *
 * Exposed as window.PetService
 */
(function () {
  'use strict';

  const MAX_PETS_PER_OWNER = 10;
  const SPECIES = [
    { id: 'dog', label: 'Chó' },
    { id: 'cat', label: 'Mèo' },
    { id: 'other', label: 'Khác' }
  ];

  const BREEDS = {
    dog: ['Poodle', 'Corgi Pembroke', 'Golden Retriever', 'Labrador Retriever', 'Pug', 'Phốc sóc (Pomeranian)', 'Chihuahua', 'Husky Siberia', 'Alaskan Malamute', 'Shiba Inu', 'Becgie Đức (German Shepherd)', 'Bulldog Pháp', 'Chó Phú Quốc', 'Chó cỏ (chó ta)', 'Chó lai'],
    cat: ['Mèo Anh lông ngắn', 'Mèo Anh lông dài', 'Mèo Ba Tư', 'Mèo Munchkin', 'Mèo tai cụp (Scottish Fold)', 'Mèo Bengal', 'Mèo Maine Coon', 'Mèo Xiêm', 'Mèo ta (mèo mướp, tam thể)', 'Mèo lai'],
    other: []
  };

  const SEX_LABEL = { male: 'Đực', female: 'Cái' };
  const NEUTER_LABEL = { yes: 'Đã triệt sản', no: 'Chưa triệt sản', unknown: 'Chưa rõ' };

  const PetService = {
    SPECIES,
    BREEDS,
    SEX_LABEL,
    NEUTER_LABEL,
    MAX_PETS_PER_OWNER,

    speciesLabel(id) {
      const found = SPECIES.find((s) => s.id === id);
      return found ? found.label : 'Khác';
    },

    /** Pets of the signed-in owner, oldest first. Resolves to [] for guests. */
    async list() {
      if (!AuthService.isLoggedIn()) return [];
      return Api.get('/pets');
    },

    /** Resolves to the pet, or null when it does not exist / is not yours. */
    async get(id) {
      if (!AuthService.isLoggedIn() || !id) return null;
      try {
        return await Api.get('/pets/' + encodeURIComponent(id));
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    /** Returns { errors } (empty object when valid). */
    validate(input) {
      const errors = {};
      const name = String(input.name || '').trim();
      if (!name) errors.name = 'Vui lòng nhập tên của bé.';
      else if (name.length > 40) errors.name = 'Tên tối đa 40 ký tự.';

      if (!SPECIES.some((s) => s.id === input.species)) errors.species = 'Vui lòng chọn loài.';
      if (!SEX_LABEL[input.sex]) errors.sex = 'Vui lòng chọn giới tính.';

      const birth = Fmt.parseDate(input.birthDate);
      if (!input.birthDate) errors.birthDate = 'Vui lòng chọn ngày sinh. Nếu không nhớ chính xác, hãy chọn ngày gần đúng.';
      else if (!birth) errors.birthDate = 'Ngày sinh chưa hợp lệ.';
      else if (input.birthDate > Fmt.todayIso()) errors.birthDate = 'Ngày sinh không thể ở tương lai.';
      else if (birth.getFullYear() < 1995) errors.birthDate = 'Ngày sinh quá xa, vui lòng kiểm tra lại.';

      if (input.weightKg !== null && input.weightKg !== undefined && input.weightKg !== '') {
        const w = Number(input.weightKg);
        if (!Number.isFinite(w) || w < 0.1 || w > 150) errors.weightKg = 'Cân nặng cần trong khoảng 0,1 – 150 kg.';
      }
      if (input.microchip && !/^\d{15}$/.test(String(input.microchip).trim())) {
        errors.microchip = 'Mã microchip gồm đúng 15 chữ số.';
      }
      if (String(input.conditions || '').length > 500) errors.conditions = 'Ghi chú sức khỏe tối đa 500 ký tự.';
      return errors;
    },

    /** Create (no id) or update (id). Throws an Error with .errors { field: message } on validation problems. */
    async save(input) {
      const errors = this.validate(input);
      if (Object.keys(errors).length) {
        const err = new Error('Vui lòng kiểm tra lại các trường được đánh dấu.');
        err.errors = errors;
        throw err;
      }
      const weight = input.weightKg === '' || input.weightKg === null || input.weightKg === undefined ? null : Number(input.weightKg);
      const body = {
        name: String(input.name).trim(),
        species: input.species,
        breed: String(input.breed || '').trim(),
        sex: input.sex,
        birthDate: input.birthDate,
        weightKg: weight,
        color: String(input.color || '').trim(),
        neutered: NEUTER_LABEL[input.neutered] ? input.neutered : 'unknown',
        microchip: String(input.microchip || '').trim(),
        conditions: String(input.conditions || '').trim(),
        photo: input.photo || null
      };
      try {
        return input.id
          ? await Api.put('/pets/' + encodeURIComponent(input.id), body)
          : await Api.post('/pets', body);
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.errors).length) {
          const wrapped = new Error(err.message);
          wrapped.errors = err.errors;
          throw wrapped;
        }
        throw err;
      }
    },

    async remove(id) {
      await Api.del('/pets/' + encodeURIComponent(id));
      return true;
    },

    /** "2 tuổi 3 tháng", "5 tháng", "dưới 1 tháng" */
    ageLabel(birthDate) {
      const b = Fmt.parseDate(birthDate);
      if (!b) return '';
      const now = new Date();
      let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
      if (now.getDate() < b.getDate()) months -= 1;
      if (months < 1) return 'dưới 1 tháng';
      if (months < 24) return `${months} tháng`;
      const years = Math.floor(months / 12);
      const rest = months % 12;
      return rest ? `${years} tuổi ${rest} tháng` : `${years} tuổi`;
    },

    /** One-line summary: "Chó · Corgi Pembroke · 2 tuổi 3 tháng · 11,5 kg" */
    summary(pet) {
      const parts = [this.speciesLabel(pet.species)];
      if (pet.breed) parts.push(pet.breed);
      const age = this.ageLabel(pet.birthDate);
      if (age) parts.push(age);
      if (pet.weightKg) parts.push(String(pet.weightKg).replace('.', ',') + ' kg');
      return parts.join(' · ');
    }
  };

  window.PetService = PetService;
})();
