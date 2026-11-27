'use strict';
const crypto = require('node:crypto');
const { validation, notFound, conflict, LimitError } = require('../utils/errors');
const { validatePet } = require('../utils/validators');
const { assertImage } = require('../utils/file-sniff');
const { todayInTz } = require('../utils/time');

const MAX_PETS = 10;

async function removeQuietly(storageService, logger, publicId, context) {
  if (!publicId || !storageService?.remove) return;
  try {
    await storageService.remove(publicId);
  } catch (err) {
    logger?.warn?.(`storage_remove_failed:${context}`, err?.message || 'unknown_error');
  }
}

function createPetService({ models, config, storageService, logger = console, clock = () => new Date() }) {
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
      let previousPublicId = null;
      if (hasPhoto) {
        changes.photo = photo;
        previousPublicId = await models.pets.getPhotoPublicId(id, ownerId);
      }
      const pet = await models.pets.update(id, ownerId, changes, newWeight);
      if (!pet) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      if (previousPublicId) {
        await removeQuietly(storageService, logger, previousPublicId, 'pet_update_replace_photo');
      }
      return pet;
    },

    async setPhoto(ownerId, id, buffer) {
      const { ext } = assertImage(buffer);
      const uploaded = await storageService.upload(buffer, { folder: 'pets', ext });
      let res;
      try {
        res = await models.transaction(async (tx) => {
          const updated = await models.pets.setPhoto(tx, id, ownerId, uploaded);
          if (!updated) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
          await models.audit.log({
            actorUserId: ownerId,
            action: 'pet_photo_set',
            targetType: 'pet',
            targetId: id,
            detail: { ext }
          }, tx);
          return updated;
        });
      } catch (err) {
        await removeQuietly(storageService, logger, uploaded.publicId, 'pet_photo_set_rollback');
        throw err;
      }
      if (res.previousPublicId && res.previousPublicId !== uploaded.publicId) {
        await removeQuietly(storageService, logger, res.previousPublicId, 'pet_photo_set_cleanup');
      }
      return models.pets.getByOwner(id, ownerId);
    },

    async clearPhoto(ownerId, id) {
      const res = await models.transaction(async (tx) => {
        const cleared = await models.pets.clearPhoto(tx, id, ownerId);
        if (!cleared) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
        await models.audit.log({
          actorUserId: ownerId,
          action: 'pet_photo_clear',
          targetType: 'pet',
          targetId: id
        }, tx);
        return cleared;
      });
      if (res.previousPublicId) {
        await removeQuietly(storageService, logger, res.previousPublicId, 'pet_photo_clear_cleanup');
      }
      return models.pets.getByOwner(id, ownerId);
    },

    async remove(ownerId, id) {
      const res = await models.pets.remove(id, ownerId);
      if (!res || !res.deleted) throw notFound('Không tìm thấy hồ sơ thú cưng này.');
      if (res.photoPublicId) {
        await removeQuietly(storageService, logger, res.photoPublicId, 'pet_remove_cleanup');
      }
      return { deleted: true };
    }
  };
}

module.exports = { createPetService };
