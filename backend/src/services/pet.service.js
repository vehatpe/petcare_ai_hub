'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict, LimitError } = require('../utils/errors');
const { validatePet } = require('../utils/validators');
const { todayInTz } = require('../utils/time');

const MAX_PETS = 10;

function createPetService({ models, config, clock = () => new Date() }) {
  const today = () => todayInTz(clock(), config.timezone);
  const check = (input) => {
    const r = validatePet(input || {}, today());
    if (Object.keys(r.errors).length) throw validation('Vui lòng kiểm tra lại các trường được đánh dấu.', r.errors);
    return r;
  };

  return {
    list: (ownerId) => models.pets.listByOwner(ownerId),

    async get(ownerId, id) {
      const pet = await models.pets.getByOwner(id, ownerId);
      if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      return pet;
    },

    async create(ownerId, input) {
      const { value } = check(input);
      const { weightKg, ...fields } = value;
      const now = clock().toISOString();
      const pet = { id: crypto.randomUUID(), ownerId, ...fields, createdAt: now, updatedAt: now };
      const weight = weightKg === null ? null : { id: crypto.randomUUID(), weightKg, measuredOn: today() };
      try {
        return await models.pets.create(pet, weight, MAX_PETS);
      } catch (e) {
        if (e instanceof LimitError) throw conflict(`Mỗi tài khoản lưu tối đa ${MAX_PETS} hồ sơ thú cưng. Hãy xóa hồ sơ không dùng nữa để thêm bé mới.`);
        throw e;
      }
    },

    async update(ownerId, id, input) {
      const existing = await models.pets.getByOwner(id, ownerId);
      if (!existing) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      const { value, hasPhoto } = check(input);
      const { weightKg, photo, ...fields } = value;
      const newWeight = weightKg !== null && weightKg !== existing.weightKg
        ? { id: crypto.randomUUID(), weightKg, measuredOn: today() } : null;
      const changes = { ...fields, updatedAt: clock().toISOString() };
      if (hasPhoto) changes.photo = photo;
      const pet = await models.pets.update(id, ownerId, changes, newWeight);
      if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      return pet;
    },

    async remove(ownerId, id) {
      if (!(await models.pets.remove(id, ownerId))) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      return { deleted: true };
    }
  };
}

module.exports = { createPetService };
