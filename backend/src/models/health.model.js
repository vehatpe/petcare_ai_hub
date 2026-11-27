'use strict';
const { T, lc, iso } = require('./db');

const mapVacc = (r) => ({
  id: lc(r.VaccinationId), petId: lc(r.PetId), vaccineName: r.VaccineName, administeredOn: r.AdministeredOn,
  nextDueOn: r.NextDueOn || null, providerName: r.ProviderName, batchNo: r.BatchNo, source: r.Source, createdAt: iso(r.CreatedAt)
});
const VACC_COLS = `v.VaccinationId, v.PetId, v.VaccineName, CONVERT(CHAR(10), v.AdministeredOn, 23) AS AdministeredOn,
  CONVERT(CHAR(10), v.NextDueOn, 23) AS NextDueOn, v.ProviderName, v.BatchNo, v.Source, v.CreatedAt`;

module.exports = (db) => ({
  async listWeights(petId) {
    const rows = await db.query(
      `SELECT MetricId, Value, CONVERT(CHAR(10), MeasuredOn, 23) AS MeasuredOn FROM dbo.Health_Metrics
       WHERE PetId = @petId AND MetricType = 'weight' ORDER BY MeasuredOn, CreatedAt`, { petId: [T.guid, petId] });
    return rows.map((r) => ({ id: lc(r.MetricId), weightKg: Number(r.Value), measuredOn: r.MeasuredOn }));
  },
  async addWeight(w) {
    await db.query(
      `INSERT INTO dbo.Health_Metrics (MetricId, PetId, MetricType, Value, MeasuredOn) VALUES (@id, @petId, 'weight', @v, CAST(@on AS DATE))`,
      { id: [T.guid, w.id], petId: [T.guid, w.petId], v: [T.dec, w.weightKg], on: [T.ymd, w.measuredOn] });
    return { id: w.id, weightKg: w.weightKg, measuredOn: w.measuredOn };
  },
  async deleteWeight(petId, id) {
    const r = await db.exec(`DELETE FROM dbo.Health_Metrics WHERE MetricId = @id AND PetId = @petId AND MetricType = 'weight'`,
      { id: [T.guid, id], petId: [T.guid, petId] });
    return r.rowsAffected[0] > 0;
  },

  async listVaccinations(petId) {
    return (await db.query(`SELECT ${VACC_COLS} FROM dbo.Vaccinations v WHERE v.PetId = @petId ORDER BY v.AdministeredOn DESC, v.CreatedAt DESC`,
      { petId: [T.guid, petId] })).map(mapVacc);
  },
  async listVaccinationsForOwner(ownerId) {
    return (await db.query(
      `SELECT ${VACC_COLS} FROM dbo.Vaccinations v JOIN dbo.Pets p ON p.PetId = v.PetId WHERE p.OwnerId = @owner`,
      { owner: [T.guid, ownerId] })).map(mapVacc);
  },
  async getVaccination(petId, id) {
    const r = (await db.query(`SELECT ${VACC_COLS} FROM dbo.Vaccinations v WHERE v.VaccinationId = @id AND v.PetId = @petId`,
      { id: [T.guid, id], petId: [T.guid, petId] }))[0];
    return r ? mapVacc(r) : null;
  },
  async addVaccination(v) {
    await db.query(
      `INSERT INTO dbo.Vaccinations (VaccinationId, PetId, VaccineName, AdministeredOn, NextDueOn, ProviderName, BatchNo, Source)
       VALUES (@id, @petId, @name, CAST(@on AS DATE), CAST(@due AS DATE), @provider, @batch, @source)`,
      {
        id: [T.guid, v.id], petId: [T.guid, v.petId], name: [T.str(80), v.vaccineName], on: [T.ymd, v.administeredOn],
        due: [T.ymd, v.nextDueOn], provider: [T.str(120), v.providerName], batch: [T.str(40), v.batchNo], source: [T.vstr(6), v.source]
      });
    return v;
  },
  async deleteVaccination(petId, id) {
    const r = await db.exec(`DELETE FROM dbo.Vaccinations WHERE VaccinationId = @id AND PetId = @petId`, { id: [T.guid, id], petId: [T.guid, petId] });
    return r.rowsAffected[0] > 0;
  },

  async listMedicalRecords(petId) {
    const rows = await db.query(
      `SELECT r.RecordId, CONVERT(CHAR(10), r.VisitDate, 23) AS VisitDate, u.FullName AS VetName,
              r.Subjective, r.Objective, r.Assessment, r.PlanText
       FROM dbo.Medical_Records r LEFT JOIN dbo.Users u ON u.UserId = r.VetId
       WHERE r.PetId = @petId ORDER BY r.VisitDate DESC, r.CreatedAt DESC`, { petId: [T.guid, petId] });
    return rows.map((r) => ({
      id: lc(r.RecordId), visitDate: r.VisitDate, vetName: r.VetName || null,
      subjective: r.Subjective, objective: r.Objective, assessment: r.Assessment, plan: r.PlanText
    }));
  },
  async listMedicalRecordsPaginated(petId, { offset = 0, limit = 10 } = {}) {
    const [countRow] = await db.query(
      `SELECT COUNT(*) AS total FROM dbo.Medical_Records WHERE PetId = @petId`,
      { petId: [T.guid, petId] }
    );
    const rows = await db.query(
      `SELECT r.RecordId, CONVERT(CHAR(10), r.VisitDate, 23) AS VisitDate, u.FullName AS VetName,
              r.Subjective, r.Objective, r.Assessment, r.PlanText
       FROM dbo.Medical_Records r LEFT JOIN dbo.Users u ON u.UserId = r.VetId
       WHERE r.PetId = @petId
       ORDER BY r.VisitDate DESC, r.CreatedAt DESC, r.RecordId DESC
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
      { petId: [T.guid, petId], offset: [T.int, offset], limit: [T.int, limit] }
    );
    return {
      rows: rows.map((r) => ({
        id: lc(r.RecordId), visitDate: r.VisitDate, vetName: r.VetName || null,
        subjective: r.Subjective, objective: r.Objective, assessment: r.Assessment, plan: r.PlanText
      })),
      total: Number(countRow?.total) || 0
    };
  },
  async addMedicalRecord(m) {
    await db.query(
      `INSERT INTO dbo.Medical_Records (RecordId, PetId, BookingId, VetId, VisitDate, Subjective, Objective, Assessment, PlanText)
       VALUES (@id, @petId, @bookingId, @vetId, CAST(@visit AS DATE), @s, @o, @a, @p)`,
      {
        id: [T.guid, m.id], petId: [T.guid, m.petId], bookingId: [T.guid, m.bookingId], vetId: [T.guid, m.vetId],
        visit: [T.ymd, m.visitDate], s: [T.str(2000), m.subjective], o: [T.str(2000), m.objective],
        a: [T.str(2000), m.assessment], p: [T.str(2000), m.plan]
      });
    const vet = (await db.query(`SELECT FullName FROM dbo.Users WHERE UserId = @id`, { id: [T.guid, m.vetId] }))[0];
    return {
      id: m.id, visitDate: m.visitDate, vetName: vet ? vet.FullName : null,
      subjective: m.subjective, objective: m.objective, assessment: m.assessment, plan: m.plan
    };
  }
});
