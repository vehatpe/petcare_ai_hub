'use strict';
const { T, lc, iso } = require('./db');
const { LimitError } = require('../utils/errors');

const SELECT = `
  SELECT p.PetId, p.Name, p.Species, p.Breed, p.Sex, CONVERT(CHAR(10), p.BirthDate, 23) AS BirthDate, p.Color,
         p.Neutered, p.Microchip, p.Conditions, p.Photo, p.PhotoUrl, p.CreatedAt, p.UpdatedAt, p.OwnerId,
         (SELECT TOP 1 m.Value FROM dbo.Health_Metrics m
           WHERE m.PetId = p.PetId AND m.MetricType = 'weight'
           ORDER BY m.MeasuredOn DESC, m.CreatedAt DESC) AS WeightKg
  FROM dbo.Pets p`;

const map = (r) => r && ({
  id: lc(r.PetId), name: r.Name, species: r.Species, breed: r.Breed, sex: r.Sex, birthDate: r.BirthDate,
  weightKg: r.WeightKg === null || r.WeightKg === undefined ? null : Number(r.WeightKg),
  color: r.Color, neutered: r.Neutered, microchip: r.Microchip, conditions: r.Conditions, photo: r.PhotoUrl || r.Photo || null,
  createdAt: iso(r.CreatedAt), updatedAt: iso(r.UpdatedAt)
});

const insertWeight = (tx, petId, w) => tx.query(
  `INSERT INTO dbo.Health_Metrics (MetricId, PetId, MetricType, Value, MeasuredOn)
   VALUES (@id, @petId, 'weight', @value, CAST(@on AS DATE))`,
  { id: [T.guid, w.id], petId: [T.guid, petId], value: [T.dec, w.weightKg], on: [T.ymd, w.measuredOn] }
);

module.exports = (db) => {
  const getByOwner = async (id, ownerId) =>
    map((await db.query(`${SELECT} WHERE p.PetId = @id AND p.OwnerId = @owner`, { id: [T.guid, id], owner: [T.guid, ownerId] }))[0]);

  return {
    async listByOwner(ownerId) {
      return (await db.query(`${SELECT} WHERE p.OwnerId = @owner ORDER BY p.CreatedAt, p.PetId`, { owner: [T.guid, ownerId] })).map(map);
    },
    getByOwner,
    async getById(id) {
      return map((await db.query(`${SELECT} WHERE p.PetId = @id`, { id: [T.guid, id] }))[0]);
    },
    async create(pet, weight, maxPerOwner) {
      await db.transaction(async (tx) => {
        const [{ n }] = await tx.query(
          `SELECT COUNT(*) AS n FROM dbo.Pets WITH (UPDLOCK, HOLDLOCK) WHERE OwnerId = @owner`, { owner: [T.guid, pet.ownerId] });
        if (n >= maxPerOwner) throw new LimitError('pet limit');
        await tx.query(
          `INSERT INTO dbo.Pets (PetId, OwnerId, Name, Species, Breed, Sex, BirthDate, Color, Neutered, Microchip, Conditions, Photo)
           VALUES (@id, @owner, @name, @species, @breed, @sex, CAST(@birth AS DATE), @color, @neutered, @microchip, @conditions, @photo)`,
          {
            id: [T.guid, pet.id], owner: [T.guid, pet.ownerId], name: [T.str(40), pet.name], species: [T.vstr(12), pet.species],
            breed: [T.str(80), pet.breed], sex: [T.vstr(6), pet.sex], birth: [T.ymd, pet.birthDate], color: [T.str(50), pet.color],
            neutered: [T.vstr(7), pet.neutered], microchip: [T.vstr(15), pet.microchip], conditions: [T.str(500), pet.conditions],
            photo: [T.max, pet.photo]
          });
        if (weight) await insertWeight(tx, pet.id, weight);
      });
      return getByOwner(pet.id, pet.ownerId);
    },
    async update(id, ownerId, ch, newWeight) {
      const found = await db.transaction(async (tx) => {
        const photoSql = Object.prototype.hasOwnProperty.call(ch, 'photo')
          ? ', Photo = @photo, PhotoUrl = NULL, PhotoPublicId = NULL'
          : '';
        const res = await tx.exec(
          `UPDATE dbo.Pets SET Name = @name, Species = @species, Breed = @breed, Sex = @sex, BirthDate = CAST(@birth AS DATE),
                  Color = @color, Neutered = @neutered, Microchip = @microchip, Conditions = @conditions,
                  UpdatedAt = SYSUTCDATETIME()${photoSql}
           WHERE PetId = @id AND OwnerId = @owner`,
          {
            id: [T.guid, id], owner: [T.guid, ownerId], name: [T.str(40), ch.name], species: [T.vstr(12), ch.species],
            breed: [T.str(80), ch.breed], sex: [T.vstr(6), ch.sex], birth: [T.ymd, ch.birthDate], color: [T.str(50), ch.color],
            neutered: [T.vstr(7), ch.neutered], microchip: [T.vstr(15), ch.microchip], conditions: [T.str(500), ch.conditions],
            photo: [T.max, ch.photo]
          });
        if (!res.rowsAffected[0]) return false;
        if (newWeight) await insertWeight(tx, id, newWeight);
        return true;
      });
      return found ? getByOwner(id, ownerId) : null;
    },
    async getPhotoPublicId(id, ownerId) {
      const rows = await db.query(
        `SELECT PhotoPublicId FROM dbo.Pets WHERE PetId = @id AND OwnerId = @owner`,
        { id: [T.guid, id], owner: [T.guid, ownerId] }
      );
      return rows.length ? (rows[0].PhotoPublicId || null) : null;
    },
    async setPhoto(tx, petId, ownerId, { url, publicId }) {
      const rows = await tx.query(
        `SELECT PhotoPublicId FROM dbo.Pets WITH (UPDLOCK) WHERE PetId = @id AND OwnerId = @owner`,
        { id: [T.guid, petId], owner: [T.guid, ownerId] }
      );
      if (!rows.length) return null;
      await tx.exec(
        `UPDATE dbo.Pets SET PhotoUrl = @url, PhotoPublicId = @publicId, Photo = NULL, UpdatedAt = SYSUTCDATETIME()
         WHERE PetId = @id AND OwnerId = @owner`,
        { id: [T.guid, petId], owner: [T.guid, ownerId], url: [T.str(500), url], publicId: [T.str(200), publicId] }
      );
      return { previousPublicId: rows[0].PhotoPublicId || null };
    },
    async clearPhoto(tx, petId, ownerId) {
      const rows = await tx.query(
        `SELECT PhotoPublicId FROM dbo.Pets WITH (UPDLOCK) WHERE PetId = @id AND OwnerId = @owner`,
        { id: [T.guid, petId], owner: [T.guid, ownerId] }
      );
      if (!rows.length) return null;
      await tx.exec(
        `UPDATE dbo.Pets SET PhotoUrl = NULL, PhotoPublicId = NULL, Photo = NULL, UpdatedAt = SYSUTCDATETIME()
         WHERE PetId = @id AND OwnerId = @owner`,
        { id: [T.guid, petId], owner: [T.guid, ownerId] }
      );
      return { previousPublicId: rows[0].PhotoPublicId || null };
    },
    async remove(id, ownerId) {
      return db.transaction(async (tx) => {
        const rows = await tx.query(
          `SELECT PhotoPublicId FROM dbo.Pets WITH (UPDLOCK) WHERE PetId = @id AND OwnerId = @owner`,
          { id: [T.guid, id], owner: [T.guid, ownerId] }
        );
        if (!rows.length) return { deleted: false, photoPublicId: null };
        const res = await tx.exec(
          `DELETE FROM dbo.Pets WHERE PetId = @id AND OwnerId = @owner`,
          { id: [T.guid, id], owner: [T.guid, ownerId] }
        );
        return {
          deleted: res.rowsAffected[0] > 0,
          photoPublicId: rows[0].PhotoPublicId || null
        };
      });
    }
  };
};
