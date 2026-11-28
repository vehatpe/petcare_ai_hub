'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createDb, T } = require('../src/models/db');
const { createSqlModels } = require('../src/models');
const { createStorageService } = require('../src/services/storage.service');
const { createApp } = require('../src/app');
const { migratePhotos } = require('./migrate-photos');

const PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const GIF_B64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function getBaseline(db) {
  const [row] = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Users) AS users,
      (SELECT COUNT(*) FROM dbo.Providers) AS providers,
      (SELECT COUNT(*) FROM dbo.Services) AS services,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings
  `);
  return row;
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petcare-smoke-migrate-'));
  const config = loadConfig({ ...process.env, STORAGE_DRIVER: 'local', UPLOAD_DIR: tmpDir });
  const uploadDir = tmpDir;

  const { models, pool: appPool } = await createSqlModels(config.db);
  const pool = await new sql.ConnectionPool(config.db).connect();
  const db = createDb(pool);
  const storage = createStorageService({ config });
  const app = createApp({ models, config });
  const server = app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  const baselineBefore = await getBaseline(db);
  const createdPetIds = [];
  let userId = null;
  let cleanupFailed = false;

  try {
    const email = `smoke_mig_${Date.now()}@petcare.local`;
    const phone = `09${String(Date.now()).slice(-8)}`;
    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'customer', fullName: 'Smoke Migrate', email, phone, password: 'Password123' })
    });
    const regJson = await regRes.json();
    assert.equal(regRes.status, 201, `register failed: ${JSON.stringify(regJson)}`);
    const token = regJson.data.token;
    userId = regJson.data.user.id;

    // 1) Tạo 2 thú cưng tạm và gán Pets.Photo trực tiếp bằng SQL
    for (const [name, b64] of [['SmokePNG', PNG_B64], ['SmokeGIF', GIF_B64]]) {
      const pRes = await fetch(`${baseUrl}/pets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, species: 'dog', sex: 'male' })
      });
      const pJson = await pRes.json();
      assert.equal(pRes.status, 201, `create pet ${name} failed: ${JSON.stringify(pJson)}`);
      const petId = pJson.data.id;
      createdPetIds.push(petId);
      await db.exec(
        `UPDATE dbo.Pets SET Photo = @photo, PhotoUrl = NULL, PhotoPublicId = NULL WHERE PetId = @id`,
        { id: [T.guid, petId], photo: [T.max, b64] }
      );
    }

    const [pngId, gifId] = createdPetIds;

    // 2) dry-run -> không đổi cột nào, không tạo tệp
    const dry = await migratePhotos({ db, storage, dryRun: true, log: () => {} });
    assert.ok(dry.migrated >= 1, 'dryRun should count PNG');
    const [pngDry] = await db.query(`SELECT Photo, PhotoUrl, PhotoPublicId FROM dbo.Pets WHERE PetId = @id`, { id: [T.guid, pngId] });
    assert.equal(pngDry.Photo, PNG_B64);
    assert.equal(pngDry.PhotoUrl, null);
    assert.equal(pngDry.PhotoPublicId, null);

    // 3) Chạy thật -> PNG chuyển sang PhotoUrl + file tồn tại; GIF giữ nguyên Photo
    const run1 = await migratePhotos({ db, storage, dryRun: false, log: () => {} });
    assert.ok(run1.migrated >= 1, 'run1 should migrate PNG');
    assert.ok(run1.skipped >= 1, 'run1 should skip GIF');

    const [pngAfter] = await db.query(`SELECT Photo, PhotoUrl, PhotoPublicId FROM dbo.Pets WHERE PetId = @id`, { id: [T.guid, pngId] });
    assert.equal(pngAfter.Photo, null);
    assert.ok(pngAfter.PhotoUrl, 'PNG PhotoUrl must be set');
    assert.ok(pngAfter.PhotoPublicId, 'PNG PhotoPublicId must be set');

    const filePath = path.resolve(uploadDir, pngAfter.PhotoPublicId);
    assert.equal(fs.existsSync(filePath), true, `Uploaded file missing at ${filePath}`);

    const getRes = await fetch(`${baseUrl}/pets/${pngId}`, { headers: { Authorization: `Bearer ${token}` } });
    const getJson = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getJson.data.photo, pngAfter.PhotoUrl);
    assert.equal(String(getJson.data.photo).includes('data:image'), false);

    const [gifAfter] = await db.query(`SELECT Photo, PhotoUrl FROM dbo.Pets WHERE PetId = @id`, { id: [T.guid, gifId] });
    assert.equal(gifAfter.Photo, GIF_B64);
    assert.equal(gifAfter.PhotoUrl, null);

    // 4) Chạy lần 2 -> migrated = 0
    const run2 = await migratePhotos({ db, storage, dryRun: false, log: () => {} });
    assert.equal(run2.migrated, 0);

    console.log('smoke-migrate-photos: PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      for (const petId of createdPetIds) {
        await db.exec(`DELETE FROM dbo.Pets WHERE PetId = @id`, { id: [T.guid, petId] });
      }
      if (userId) {
        await db.exec(`DELETE FROM dbo.AuditLog WHERE ActorUserId = @id`, { id: [T.guid, userId] });
        await db.exec(`DELETE FROM dbo.Users WHERE UserId = @id`, { id: [T.guid, userId] });
      }
      const baselineAfter = await getBaseline(db);
      assert.deepEqual(baselineAfter, baselineBefore, 'Baseline mismatch after cleanup');
    } catch (err) {
      cleanupFailed = true;
      console.error('smoke-migrate-photos cleanup/baseline error:', err?.message || err);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await pool.close();
      await appPool.close();
    }
    if (cleanupFailed) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('smoke-migrate-photos FAILED:', err);
  process.exit(1);
});
