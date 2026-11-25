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

async function run() {
  console.log('=== PETCARE AI HUB BOOKINGS SMOKE TESTS (REAL SQL SERVER 2022) ===');
  const config = loadConfig();
  const models = await createSqlModels(config.db);
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
  const custEmail = `smoke_bk_cust_${tag}@example.com`;
  const provAEmail = `smoke_bk_pa_${tag}@example.com`;
  const provBEmail = `smoke_bk_pb_${tag}@example.com`;
  const vetAEmail = `smoke_bk_va_${tag}@example.com`;
  const createdUserIds = [provAUserId, provBUserId, vetAUserId];
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
      { id: vetAUserId, email: vetAEmail, phone: `0973${String(tag).slice(-6)}`, role: 'vet', pid: provAId, name: 'Smoke Vet A' }
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

    // Provider A creates a service
    const svcRes = await api('POST', '/provider/services', {
      token: tokenPA,
      body: { name: 'Khám Smoke Gốc', category: 'medical', priceVnd: 200000, slotCapacity: 3 }
    });
    record('1. Provider A creates service', svcRes.status === 201, `id=${svcRes.data?.id}`);
    const svcId = svcRes.data.id;

    // Register Customer & create Pet
    const regCust = await api('POST', '/auth/register', {
      body: { fullName: 'Smoke Customer', email: custEmail, phone: `0974${String(tag).slice(-6)}`, password: 'SmokePass123!' }
    });
    const tokenCust = regCust.data.token;
    custUserId = regCust.data.user.id;
    createdUserIds.push(custUserId);

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
  } finally {
    let cleanupFailed = false;
    try {
      for (const uid of createdUserIds) {
        await pool.request().input('uid', sql.UniqueIdentifier, uid).query('DELETE FROM dbo.AuditLog WHERE ActorUserId = @uid');
      }
      if (custUserId) {
        await pool.request().input('uid', sql.UniqueIdentifier, custUserId).query('DELETE FROM dbo.Bookings WHERE UserId = @uid');
        await pool.request().input('uid', sql.UniqueIdentifier, custUserId).query('DELETE FROM dbo.Pets WHERE UserId = @uid');
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
      console.log('[CLEANUP] Removed smoke-bookings test data.');
    } catch (e) {
      cleanupFailed = true;
      console.error('[CLEANUP ERROR]', e.message);
    }
    await pool.close();
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
