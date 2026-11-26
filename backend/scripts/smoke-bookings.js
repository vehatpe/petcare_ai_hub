'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sql = require('mssql');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const db = require('../src/models/db');
const { createSqlModels } = require('../src/models');
const { createApp } = require('../src/app');
const { nowInTz } = require('../src/utils/time');

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

async function run() {
  console.log('=== PETCARE AI HUB BOOKINGS SMOKE TESTS (REAL SQL SERVER 2022) ===');
  const config = loadConfig();
  const { models, pool: appPool } = await createSqlModels(config.db);
  const app = createApp({ models, config });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  const pool = await new sql.ConnectionPool({
    server: config.db.server,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    options: { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate }
  }).connect();

  const baseline = await getCounts(pool);
  console.log(`Baseline counts - Users: ${baseline.u}, Providers: ${baseline.p}, Services: ${baseline.s}, Bookings: ${baseline.b}`);

  let passed = 0;
  let failed = 0;
  function record(name, ok, detail = '') {
    if (ok) {
      passed++;
      console.log(`[PASS] ${name}${detail ? ' - ' + detail : ''}`);
    } else {
      failed++;
      console.error(`[FAIL] ${name}${detail ? ' - ' + detail : ''}`);
    }
  }

  async function api(method, path, { token, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, data: json.data };
  }

  const tag = Date.now();
  const provAId = `smoke-bk-a-${tag}`;
  const provBId = `smoke-bk-b-${tag}`;
  const provAUserId = crypto.randomUUID();
  const provBUserId = crypto.randomUUID();
  const vetAUserId = crypto.randomUUID();
  const vetA2UserId = crypto.randomUUID();
  const vetBUserId = crypto.randomUUID();
  const custEmail = `smoke_bk_cust_${tag}@example.com`;
  const provAEmail = `smoke_bk_pa_${tag}@example.com`;
  const provBEmail = `smoke_bk_pb_${tag}@example.com`;
  const vetAEmail = `smoke_bk_va_${tag}@example.com`;
  const vetA2Email = `smoke_bk_va2_${tag}@example.com`;
  const vetBEmail = `smoke_bk_vb_${tag}@example.com`;
  const createdUserIds = [provAUserId, provBUserId, vetAUserId, vetA2UserId, vetBUserId];
  let custUserId = null;

  try {
    const pwHash = bcrypt.hashSync('SmokePass123!', 10);

    // Seed Providers A & B and their staff users
    await pool.request()
      .input('pa', sql.VarChar(50), provAId)
      .input('pb', sql.VarChar(50), provBId)
      .query(`
        INSERT INTO dbo.Providers (ProviderId, Name, Type, Area, IsSample, IsActive)
        VALUES (@pa, N'Smoke Clinic A', 'clinic', N'Q1', 0, 1),
               (@pb, N'Smoke Clinic B', 'clinic', N'Q3', 0, 1);
      `);

    for (const u of [
      { id: provAUserId, email: provAEmail, phone: `0971${String(tag).slice(-6)}`, role: 'provider', pid: provAId, name: 'Smoke Prov A' },
      { id: provBUserId, email: provBEmail, phone: `0972${String(tag).slice(-6)}`, role: 'provider', pid: provBId, name: 'Smoke Prov B' },
      { id: vetAUserId, email: vetAEmail, phone: `0973${String(tag).slice(-6)}`, role: 'vet', pid: provAId, name: 'Smoke Vet A' },
      { id: vetA2UserId, email: vetA2Email, phone: `0975${String(tag).slice(-6)}`, role: 'vet', pid: provAId, name: 'Smoke Vet A2' },
      { id: vetBUserId, email: vetBEmail, phone: `0976${String(tag).slice(-6)}`, role: 'vet', pid: provBId, name: 'Smoke Vet B' }
    ]) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, u.id)
        .input('email', sql.VarChar(120), u.email)
        .input('phone', sql.VarChar(20), u.phone)
        .input('hash', sql.VarChar(200), pwHash)
        .input('name', sql.NVarChar(100), u.name)
        .input('role', sql.VarChar(20), u.role)
        .input('pid', sql.VarChar(50), u.pid)
        .query(`
          INSERT INTO dbo.Users (UserId, Email, Phone, PasswordHash, FullName, Role, Status, ProviderId, MustChangePassword)
          VALUES (@id, @email, @phone, @hash, @name, @role, 'active', @pid, 0);
        `);
    }

    const loginPA = await api('POST', '/auth/login', { body: { identifier: provAEmail, password: 'SmokePass123!' } });
    const loginPB = await api('POST', '/auth/login', { body: { identifier: provBEmail, password: 'SmokePass123!' } });
    const tokenPA = loginPA.data.token;
    const tokenPB = loginPB.data.token;

    // Seed Service A directly
    const svcId = `smoke-svc-${tag}`;
    await pool.request()
      .input('id', sql.VarChar(50), svcId)
      .input('pid', sql.VarChar(50), provAId)
      .query(`
        INSERT INTO dbo.Services (ServiceId, ProviderId, Category, CategoryLabel, Name, PriceVnd, Unit, SlotCapacity, IsActive)
        VALUES (@id, @pid, 'medical', N'Khám & điều trị', N'Khám Smoke Gốc', 200000, N'lần', 3, 1);
      `);
    record('1. Provider A service seeded', true, `id=${svcId}`);

    // Seed Customer & login
    custUserId = crypto.randomUUID();
    createdUserIds.push(custUserId);
    await pool.request()
      .input('id', sql.UniqueIdentifier, custUserId)
      .input('email', sql.VarChar(120), custEmail)
      .input('phone', sql.VarChar(20), `0974${String(tag).slice(-6)}`)
      .input('hash', sql.VarChar(200), pwHash)
      .query(`
        INSERT INTO dbo.Users (UserId, Email, Phone, PasswordHash, FullName, Role, Status, MustChangePassword)
        VALUES (@id, @email, @phone, @hash, N'Smoke Customer', 'customer', 'active', 0);
      `);
    const loginCust = await api('POST', '/auth/login', { body: { identifier: custEmail, password: 'SmokePass123!' } });
    const tokenCust = loginCust.data.token;

    const petRes = await api('POST', '/pets', {
      token: tokenCust,
      body: { name: 'SmokePet', species: 'dog', sex: 'male', birthDate: '2024-01-01' }
    });
    const petId = petRes.data.id;

    // Compute tomorrow in config.timezone (no hardcoded dates)
    const todayYmd = nowInTz(new Date(), config.timezone).date;
    const tomorrowYmd = addDaysYmd(todayYmd, 1);

    // 2. Customer creates 3 bookings: bk1 (complete flow), bk2 (cancel flow), bk3 (race confirm)
    const bk1 = (await api('POST', '/bookings', { token: tokenCust, body: { petId, serviceId: svcId, date: tomorrowYmd, time: '08:30' } })).data;
    const bk2 = (await api('POST', '/bookings', { token: tokenCust, body: { petId, serviceId: svcId, date: tomorrowYmd, time: '10:30' } })).data;
    const bk3 = (await api('POST', '/bookings', { token: tokenCust, body: { petId, serviceId: svcId, date: tomorrowYmd, time: '14:00' } })).data;
    record('2. Customer created 3 bookings', Boolean(bk1?.id && bk2?.id && bk3?.id));

    // 3. Snapshot test: Provider updates service price/name -> existing booking keeps old snapshot
    await api('PUT', `/provider/services/${svcId}`, {
      token: tokenPA,
      body: { name: 'Khám Smoke Mới', category: 'medical', priceVnd: 500000, slotCapacity: 3 }
    });
    const listPA = await api('GET', `/provider/bookings?date=${tomorrowYmd}`, { token: tokenPA });
    const bk1Item = listPA.data.items.find((x) => x.id === bk1.id);
    record(
      '3. Snapshot preserved after service update',
      bk1Item && bk1Item.serviceName === 'Khám Smoke Gốc' && bk1Item.priceVnd === 200000,
      `serviceName=${bk1Item?.serviceName}, price=${bk1Item?.priceVnd}`
    );

    // 4. Provider B cannot access Provider A booking -> 404
    const crossRes = await api('PATCH', `/bookings/${bk1.id}/confirm`, { token: tokenPB });
    record('4. Cross-provider confirm returns 404', crossRes.status === 404, `status=${crossRes.status}`);

    // 5. Provider A confirms bk1 & assigns Vet A
    const confRes = await api('PATCH', `/bookings/${bk1.id}/confirm`, { token: tokenPA });
    const vetRes = await api('PATCH', `/bookings/${bk1.id}/vet`, { token: tokenPA, body: { vetId: vetAUserId } });
    record('5. Confirm + Assign Vet', confRes.status === 200 && vetRes.status === 200 && vetRes.data.vet?.id === vetAUserId);

    // 6. Move bk1 date to yesterday via SQL to test complete
    const yesterdayYmd = addDaysYmd(todayYmd, -1);
    await pool.request()
      .input('id', sql.UniqueIdentifier, bk1.id)
      .input('d', sql.VarChar(10), yesterdayYmd)
      .query(`UPDATE dbo.Bookings SET BookingDate = CAST(@d AS DATE) WHERE BookingId = @id`);
    const compRes = await api('PATCH', `/bookings/${bk1.id}/complete`, { token: tokenPA });
    record('6. Complete past-slot booking', compRes.status === 200 && compRes.data.status === 'completed');

    // 7. Provider A cancels bk2 with reason -> Customer sees it
    const cancelRes = await api('PATCH', `/bookings/${bk2.id}/cancel`, { token: tokenPA, body: { reason: 'Cơ sở bảo trì' } });
    const custList = await api('GET', '/bookings', { token: tokenCust });
    const bk2Cust = custList.data.find((x) => x.id === bk2.id);
    record(
      '7. Provider cancel + Customer sees reason',
      cancelRes.status === 200 && bk2Cust?.cancelledBy === 'provider' && bk2Cust?.cancelReason === 'Cơ sở bảo trì'
    );

    // 8. Parallel confirm race on bk3: one 200, one 409 invalid_transition
    const [r1, r2] = await Promise.all([
      api('PATCH', `/bookings/${bk3.id}/confirm`, { token: tokenPA }),
      api('PATCH', `/bookings/${bk3.id}/confirm`, { token: tokenPA })
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    const errRes = r1.status === 409 ? r1 : r2;
    record('8. Parallel confirm race (200 + 409 invalid_transition)', statuses[0] === 200 && statuses[1] === 409 && errRes.body.code === 'invalid_transition');

    // 9. too_early: complete future-slot confirmed bk3 -> 409 too_early
    const earlyRes = await api('PATCH', `/bookings/${bk3.id}/complete`, { token: tokenPA });
    record('9. Complete future slot returns 409 too_early', earlyRes.status === 409 && earlyRes.body.code === 'too_early');

    // 10. no-show on past-slot confirmed bk3
    await pool.request()
      .input('id', sql.UniqueIdentifier, bk3.id)
      .input('d', sql.VarChar(10), yesterdayYmd)
      .query(`UPDATE dbo.Bookings SET BookingDate = CAST(@d AS DATE) WHERE BookingId = @id`);
    const noShowRes = await api('PATCH', `/bookings/${bk3.id}/no-show`, { token: tokenPA });
    record('10. No-show past-slot booking', noShowRes.status === 200 && noShowRes.data.status === 'no_show');

    // 11. Assign Vet of another facility -> 422; already_recorded -> 409
    const bk4 = (await api('POST', '/bookings', { token: tokenCust, body: { petId, serviceId: svcId, date: tomorrowYmd, time: '15:30' } })).data;
    const otherVetRes = await api('PATCH', `/bookings/${bk4.id}/vet`, { token: tokenPA, body: { vetId: vetBUserId } });
    record('11a. Assign vet from other facility -> 422', otherVetRes.status === 422);

    await api('PATCH', `/bookings/${bk4.id}/vet`, { token: tokenPA, body: { vetId: vetAUserId } });
    const mrId = crypto.randomUUID();
    await pool.request()
      .input('mrId', sql.UniqueIdentifier, mrId)
      .input('petId', sql.UniqueIdentifier, petId)
      .input('bkId', sql.UniqueIdentifier, bk4.id)
      .input('vetId', sql.UniqueIdentifier, vetAUserId)
      .input('d', sql.VarChar(10), tomorrowYmd)
      .query(`
        INSERT INTO dbo.Medical_Records (RecordId, PetId, BookingId, VetId, VisitDate, Subjective, Objective, Assessment, PlanText)
        VALUES (@mrId, @petId, @bkId, @vetId, CAST(@d AS DATE), N'Smoke check', N'Smoke obj', N'Smoke assess', N'Smoke plan');
      `);
    const alreadyRecRes = await api('PATCH', `/bookings/${bk4.id}/vet`, { token: tokenPA, body: { vetId: vetA2UserId } });
    record('11b. Change vet after medical record -> 409 already_recorded', alreadyRecRes.status === 409 && alreadyRecRes.body.code === 'already_recorded');

    // 12. slot_passed: confirm past-slot pending bk4 -> 409 slot_passed
    await pool.request()
      .input('id', sql.UniqueIdentifier, bk4.id)
      .input('d', sql.VarChar(10), yesterdayYmd)
      .query(`UPDATE dbo.Bookings SET BookingDate = CAST(@d AS DATE) WHERE BookingId = @id`);
    const slotPassedRes = await api('PATCH', `/bookings/${bk4.id}/confirm`, { token: tokenPA });
    record('12. Confirm past slot -> 409 slot_passed', slotPassedRes.status === 409 && slotPassedRes.body.code === 'slot_passed');

    // 13. facility_inactive: Providers.IsActive=0 -> confirm -> 409 facility_inactive, then restore IsActive=1
    await pool.request().input('pa', sql.VarChar(50), provAId).query('UPDATE dbo.Providers SET IsActive = 0 WHERE ProviderId = @pa');
    const inactiveRes = await api('PATCH', `/bookings/${bk4.id}/confirm`, { token: tokenPA });
    await pool.request().input('pa', sql.VarChar(50), provAId).query('UPDATE dbo.Providers SET IsActive = 1 WHERE ProviderId = @pa');
    record('13. Facility IsActive=0 -> 409 facility_inactive', inactiveRes.status === 409 && inactiveRes.body.code === 'facility_inactive');

    // 15. Vet API: list, detail (no photo), medical-record (201 then 409), cross-vet 404, vaccination (201), customer reads back,
    //     concurrent medical-record (Promise.all -> 201 + 409), pending -> 409 invalid_transition, SQL AuditLog check
    const vetListRes = await api('GET', '/vet/bookings', { token: tokenVetA });
    const vetDetailRes = await api('GET', `/vet/bookings/${bk1.id}`, { token: tokenVetA });
    const vetMr1 = await api('POST', `/vet/bookings/${bk1.id}/medical-record`, {
      token: tokenVetA,
      body: { subjective: 'Ho nhẹ', objective: 'Thân nhiệt 38.5', assessment: 'Ổn định', plan: 'Theo dõi thêm' }
    });
    const vetMr2 = await api('POST', `/vet/bookings/${bk1.id}/medical-record`, {
      token: tokenVetA,
      body: { subjective: 'Lần 2', objective: 'o', assessment: 'a', plan: 'p' }
    });
    const vetMrOther = await api('POST', `/vet/bookings/${bk1.id}/medical-record`, {
      token: tokenVetB,
      body: { subjective: 'Khác', objective: 'o', assessment: 'a', plan: 'p' }
    });
    const vetVaccRes = await api('POST', `/vet/bookings/${bk1.id}/vaccinations`, {
      token: tokenVetA,
      body: { vaccineName: 'Rabies Smoke', administeredOn: todayYmd }
    });
    const custHealthRes = await api('GET', `/health-records?petId=${petId}`, { token: tokenCust });

    // (a) Concurrent medical-record on a fresh confirmed booking
    const bkConc = (await api('POST', '/bookings', {
      token: tokenCust,
      body: { petId, serviceId: svcAId, date: futureYmd, time: '14:00' }
    })).data;
    await api('PATCH', `/bookings/${bkConc.id}/confirm`, { token: tokenProvA });
    await api('PATCH', `/bookings/${bkConc.id}/vet`, { token: tokenProvA, body: { vetId: vetAUserId } });
    const [conc1, conc2] = await Promise.all([
      api('POST', `/vet/bookings/${bkConc.id}/medical-record`, {
        token: tokenVetA,
        body: { subjective: 'Song song 1', objective: 'o', assessment: 'a', plan: 'p' }
      }),
      api('POST', `/vet/bookings/${bkConc.id}/medical-record`, {
        token: tokenVetA,
        body: { subjective: 'Song song 2', objective: 'o', assessment: 'a', plan: 'p' }
      })
    ]);
    const concStatuses = [conc1.status, conc2.status].sort((a, b) => a - b);
    const concConflict = conc1.status === 409 ? conc1 : conc2;

    // (b) Pending booking -> 409 invalid_transition for both medical-record and vaccinations
    const bkPend = (await api('POST', '/bookings', {
      token: tokenCust,
      body: { petId, serviceId: svcAId, date: futureYmd, time: '15:00' }
    })).data;
    await api('PATCH', `/bookings/${bkPend.id}/vet`, { token: tokenProvA, body: { vetId: vetAUserId } });
    const pendMr = await api('POST', `/vet/bookings/${bkPend.id}/medical-record`, {
      token: tokenVetA,
      body: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' }
    });
    const pendVacc = await api('POST', `/vet/bookings/${bkPend.id}/vaccinations`, {
      token: tokenVetA,
      body: { vaccineName: 'Rabies Pending', administeredOn: todayYmd }
    });

    // (c) SQL AuditLog check: exactly 1 health_record_viewed for vetAUserId
    const auditViewRes = await pool.request()
      .input('uid', sql.UniqueIdentifier, vetAUserId)
      .query("SELECT COUNT(*) AS cnt FROM dbo.AuditLog WHERE ActorUserId = @uid AND Action = 'health_record_viewed'");
    const auditViewCount = auditViewRes.recordset[0].cnt;

    const vetApiOk = vetListRes.status === 200
      && vetDetailRes.status === 200 && vetDetailRes.data.pet && vetDetailRes.data.pet.photo === undefined
      && vetMr1.status === 201
      && vetMr2.status === 409 && vetMr2.body.code === 'already_recorded'
      && vetMrOther.status === 404
      && vetVaccRes.status === 201 && vetVaccRes.data.source === 'clinic'
      && custHealthRes.status === 200
      && custHealthRes.data.medicalRecords.length >= 1
      && custHealthRes.data.vaccinations.some((v) => v.vaccineName === 'Rabies Smoke')
      && concStatuses[0] === 201 && concStatuses[1] === 409 && concConflict.body.code === 'already_recorded'
      && pendMr.status === 409 && pendMr.body.code === 'invalid_transition'
      && pendVacc.status === 409 && pendVacc.body.code === 'invalid_transition'
      && auditViewCount === 1;
    record('15. Vet API (list, detail, MR 201/409, concurrent, pending 409, SQL AuditLog)', vetApiOk);
  } finally {
    let cleanupFailed = false;
    try {
      for (const uid of createdUserIds) {
        await pool.request().input('uid', sql.UniqueIdentifier, uid).query('DELETE FROM dbo.AuditLog WHERE ActorUserId = @uid');
      }
      if (custUserId) {
        await pool.request().input('vid', sql.UniqueIdentifier, vetAUserId).query('DELETE FROM dbo.Medical_Records WHERE VetId = @vid');
        await pool.request().input('uid', sql.UniqueIdentifier, custUserId).query(`
          DELETE v FROM dbo.Vaccinations v JOIN dbo.Pets p ON p.PetId = v.PetId WHERE p.OwnerId = @uid;
          DELETE FROM dbo.Bookings WHERE UserId = @uid;
          DELETE FROM dbo.Pets WHERE OwnerId = @uid;
        `);
      }
      await pool.request().input('pa', sql.VarChar(50), provAId).input('pb', sql.VarChar(50), provBId).query(`
        DELETE FROM dbo.Services WHERE ProviderId IN (@pa, @pb);
        DELETE FROM dbo.Users WHERE ProviderId IN (@pa, @pb);
      `);
      if (custUserId) {
        await pool.request().input('uid', sql.UniqueIdentifier, custUserId).query('DELETE FROM dbo.Users WHERE UserId = @uid');
      }
      await pool.request().input('pa', sql.VarChar(50), provAId).input('pb', sql.VarChar(50), provBId).query(`
        DELETE FROM dbo.Providers WHERE ProviderId IN (@pa, @pb);
      `);
      const after = await getCounts(pool);
      const baselineOk = after.u === baseline.u && after.p === baseline.p && after.s === baseline.s && after.b === baseline.b;
      record('14. Baseline counts restored', baselineOk, `U:${after.u}/${baseline.u} P:${after.p}/${baseline.p} S:${after.s}/${baseline.s} B:${after.b}/${baseline.b}`);
      console.log('[CLEANUP] Removed smoke-bookings test data.');
    } catch (e) {
      cleanupFailed = true;
      console.error('[CLEANUP ERROR]', e.message);
    }
    await pool.close();
    if (appPool && typeof appPool.close === 'function') await appPool.close();
    server.close();
    if (failed > 0 || cleanupFailed) {
      process.exitCode = 1;
    }
  }

  console.log(`\n=== BOOKINGS SMOKE SUMMARY: ${passed}/${passed + failed} PASSED ===`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
