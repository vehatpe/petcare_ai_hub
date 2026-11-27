'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createSqlModels } = require('../src/models');
const { createApp } = require('../src/app');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function getCounts(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Users) AS u,
      (SELECT COUNT(*) FROM dbo.Providers) AS p,
      (SELECT COUNT(*) FROM dbo.Services) AS s,
      (SELECT COUNT(*) FROM dbo.Bookings) AS b
  `);
  return r.recordset[0];
}

function assertOk(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log('=== PETCARE AI HUB UPLOADS SMOKE TESTS (REAL SQL SERVER 2022) ===');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petcare-smoke-uploads-'));
  const config = loadConfig({
    ...process.env,
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: tmpDir
  });

  const { models, pool: appPool } = await createSqlModels(config.db);
  const app = createApp({ models, config });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baseUrl = `${origin}/api/v1`;

  const pool = await new sql.ConnectionPool({
    server: config.db.server,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    options: { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate }
  }).connect();

  const baseline = await getCounts(pool);
  const createdUserIds = [];
  let petId = null;

  try {
    const suffix = Date.now().toString().slice(-8);
    // 1. Register 2 customers
    const reg = async (n) => {
      const r = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'customer',
          fullName: `Smoke Upload ${n}`,
          email: `smoke_up_${n}_${suffix}@example.com`,
          phone: `09${n}${suffix.slice(-7)}`,
          password: 'Password123!'
        })
      });
      const b = await r.json();
      assertOk(r.status === 201 && b.data?.token, `Register ${n} failed: ${r.status}`);
      createdUserIds.push(b.data.user.id);
      return b.data;
    };

    const c1 = await reg('1');
    const c2 = await reg('2');
    console.log('1. Registered 2 smoke customers.');

    // 2. Create pet
    const rPet = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c1.token}` },
      body: JSON.stringify({ name: 'Mít', species: 'cat', sex: 'female', birthDate: '2024-02-01' })
    });
    const bPet = await rPet.json();
    assertOk(rPet.status === 201 && bPet.data?.id, `Create pet failed: ${rPet.status}`);
    petId = bPet.data.id;
    console.log('2. Created pet:', petId);

    // 3. Upload PNG -> 200 & GET /uploads/... returns image/png
    const uploadPet = async (token, buf, name) => {
      const fd = new FormData();
      fd.append('photo', new Blob([buf]), name);
      const r = await fetch(`${baseUrl}/pets/${petId}/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      return { status: r.status, body: await r.json() };
    };

    const up1 = await uploadPet(c1.token, PNG_1X1, 'mit.png');
    assertOk(up1.status === 200 && up1.body.data?.photo?.startsWith('/uploads/pets/'), `Upload PNG failed: ${up1.status}`);
    const photoUrl = up1.body.data.photo;
    const relPath = photoUrl.replace(/^\/uploads\//, '');
    const diskPath = path.join(tmpDir, relPath);
    assertOk(fs.existsSync(diskPath), 'Uploaded file missing on disk');

    const rStatic = await fetch(`${origin}${photoUrl}`);
    assertOk(rStatic.status === 200, `GET ${photoUrl} failed: ${rStatic.status}`);
    assertOk((rStatic.headers.get('content-type') || '').includes('image/png'), 'Unexpected content-type for PNG');
    console.log('3. Uploaded PNG & verified static serving.');

    // 4. .txt renamed to .png -> 422
    const upTxt = await uploadPet(c1.token, Buffer.from('not-png'), 'x.png');
    assertOk(upTxt.status === 422, `Expected 422 for fake png, got ${upTxt.status}`);

    // 5. > 5 MB -> 413
    const upBig = await uploadPet(c1.token, Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png');
    assertOk(upBig.status === 413, `Expected 413 for >5MB, got ${upBig.status}`);

    // 6. Other customer -> 404
    const upOther = await uploadPet(c2.token, PNG_1X1, 'other.png');
    assertOk(upOther.status === 404, `Expected 404 for other customer, got ${upOther.status}`);
    console.log('4-6. Verified 422, 413, and 404.');

    // 7. DELETE /pets/:id/photo -> file removed from disk & DB columns NULL
    const rDelPhoto = await fetch(`${baseUrl}/pets/${petId}/photo`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${c1.token}` }
    });
    assertOk(rDelPhoto.status === 200, `DELETE pet photo failed: ${rDelPhoto.status}`);
    assertOk(!fs.existsSync(diskPath), 'File still exists on disk after DELETE photo');

    const dbPet = await pool.request().input('id', sql.UniqueIdentifier, petId)
      .query('SELECT PhotoUrl, PhotoPublicId FROM dbo.Pets WHERE PetId = @id');
    assertOk(dbPet.recordset[0].PhotoUrl === null && dbPet.recordset[0].PhotoPublicId === null, 'DB PhotoUrl/PhotoPublicId not NULL');
    console.log('7. Verified DELETE /pets/:id/photo.');

    // 8. Upload again & DELETE /pets/:id -> file removed from disk
    const up2 = await uploadPet(c1.token, PNG_1X1, 'mit2.png');
    assertOk(up2.status === 200, `Re-upload failed: ${up2.status}`);
    const diskPath2 = path.join(tmpDir, up2.body.data.photo.replace(/^\/uploads\//, ''));
    assertOk(fs.existsSync(diskPath2), 'Second uploaded file missing on disk');

    const rDelPet = await fetch(`${baseUrl}/pets/${petId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${c1.token}` }
    });
    assertOk(rDelPet.status === 200, `DELETE pet failed: ${rDelPet.status}`);
    petId = null;
    assertOk(!fs.existsSync(diskPath2), 'Pet photo file still exists after DELETE /pets/:id');
    console.log('8. Verified DELETE /pets/:id cleans up photo.');

    // 9. Avatar set & clear
    const fdAv = new FormData();
    fdAv.append('avatar', new Blob([PNG_1X1]), 'av.png');
    const rAvSet = await fetch(`${baseUrl}/auth/me/avatar`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${c1.token}` },
      body: fdAv
    });
    const bAvSet = await rAvSet.json();
    assertOk(rAvSet.status === 200 && bAvSet.data?.user?.avatarUrl?.startsWith('/uploads/avatars/'), `PUT avatar failed: ${rAvSet.status}`);
    const avDiskPath = path.join(tmpDir, bAvSet.data.user.avatarUrl.replace(/^\/uploads\//, ''));
    assertOk(fs.existsSync(avDiskPath), 'Avatar file missing on disk');

    const rAvDel = await fetch(`${baseUrl}/auth/me/avatar`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${c1.token}` }
    });
    assertOk(rAvDel.status === 200 && rAvDel.body !== null, `DELETE avatar failed: ${rAvDel.status}`);
    assertOk(!fs.existsSync(avDiskPath), 'Avatar file still exists after DELETE');
    console.log('9. Verified PUT/DELETE /auth/me/avatar.');
  } finally {
    let cleanupFailed = false;
    try {
      if (petId) {
        await pool.request().input('id', sql.UniqueIdentifier, petId).query('DELETE FROM dbo.Pets WHERE PetId = @id');
      }
      for (const uid of createdUserIds) {
        await pool.request().input('uid', sql.UniqueIdentifier, uid).query('DELETE FROM dbo.AuditLog WHERE ActorUserId = @uid');
        await pool.request().input('uid', sql.UniqueIdentifier, uid).query('DELETE FROM dbo.Users WHERE UserId = @uid');
      }
      const after = await getCounts(pool);
      if (after.u !== baseline.u || after.p !== baseline.p || after.s !== baseline.s || after.b !== baseline.b) {
        console.error('BASELINE MISMATCH:', { baseline, after });
        cleanupFailed = true;
      }
    } catch (cleanErr) {
      console.error('CLEANUP ERROR:', cleanErr);
      cleanupFailed = true;
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    await new Promise((r) => server.close(r));
    await pool.close();
    await appPool.close();
    if (cleanupFailed) process.exit(1);
  }
  console.log('=== UPLOADS SMOKE TESTS PASSED ===');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
