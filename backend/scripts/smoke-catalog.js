'use strict';
/**
 * PetCare AI Hub - C3 Services Management Smoke Test on REAL SQL Server 2022
 *
 * Requirements:
 * - Direct Admin seeding in DB with random password (never logged)
 * - Two approved providers (A and B)
 * - Provider A creates, updates, disables, enables services and reads back via SELECT
 * - Public catalog visibility: GET /services shows only active services of active providers
 * - Cross-provider isolation: Provider B cannot update or toggle Provider A's service (404)
 * - Concurrent POST requests (Promise.all) with identical name -> exactly one 201 and one 409
 * - Limit 50 services per provider -> 409 when exceeded
 * - Customer booking into disabled service -> rejected (404) and 0 Bookings rows created
 *   (booking date calculated dynamically: +7 days in config.timezone)
 * - Admin disables Provider A -> Provider A's services vanish from GET /services, Provider A cannot write
 * - AuditLog verification: no sensitive info, valid actions
 * - Strict cleanup order in try/finally: Bookings -> Pets -> Services -> AuditLog -> Providers -> Users
 * - Baseline verification: Users, Providers, Services counts return to exact baseline.
 *
 * Usage:
 *   node backend/scripts/smoke-catalog.js
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createSqlModels } = require('../src/models');
const { nowInTz } = require('../src/utils/time');

async function main() {
  const config = loadConfig();
  console.log('=== PETCARE AI HUB C3 SERVICES SMOKE (REAL SQL SERVER) ===');
  console.log(`Target SQL Server: ${config.db.server}:${config.db.port} | Database: ${config.db.database}`);

  const { models, pool } = await createSqlModels(config.db);
  const dummyAi = {
    embed: async () => { throw new Error('no ai in catalog smoke'); },
    generate: async () => { throw new Error('no ai in catalog smoke'); }
  };
  const app = createApp({ models, config, ai: dummyAi });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  console.log(`Test API Server running on ${baseUrl}\n`);

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
    return { status: res.status, ok: res.ok, body: json, headers: res.headers };
  }

  const results = [];
  function record(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
    if (!pass) {
      throw new Error(`Smoke step failed: ${name} - ${detail}`);
    }
  }

  // Baseline counts
  const baseU = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Users');
  const baselineUsers = baseU.recordset[0].cnt;
  const baseP = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Providers');
  const baselineProviders = baseP.recordset[0].cnt;
  const baseS = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Services');
  const baselineServices = baseS.recordset[0].cnt;
  const baseB = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Bookings');
  const baselineBookings = baseB.recordset[0].cnt;

  console.log(`Baseline counts - Users: ${baselineUsers}, Providers: ${baselineProviders}, Services: ${baselineServices}, Bookings: ${baselineBookings}\n`);

  const createdUserIds = [];
  const createdProviderIds = [];
  const createdServiceIds = [];
  const createdPetIds = [];
  const createdBookingIds = [];

  const runId = Math.floor(100000 + Math.random() * 900000);
  const testAdminId = crypto.randomUUID();
  const testAdminEmail = `smoke_admin_${runId}@petcare.vn`;
  const testAdminPass = `AdminPass_${runId}!`;
  const testAdminPhone = `098${String(runId).padStart(7, '0').slice(-7)}`;

  try {
    // 1. Seed test admin directly in DB
    const adminHash = await bcrypt.hash(testAdminPass, 10);
    await pool.request()
      .input('id', sql.UniqueIdentifier, testAdminId)
      .input('email', sql.NVarChar, testAdminEmail)
      .input('phone', sql.VarChar, testAdminPhone)
      .input('fullName', sql.NVarChar, 'Admin Smoke Catalog')
      .input('hash', sql.NVarChar, adminHash)
      .query(`
        INSERT INTO dbo.Users (UserId, Role, Status, FullName, Email, Phone, PasswordHash, MustChangePassword, TokenVersion)
        VALUES (@id, 'admin', 'active', @fullName, @email, @phone, @hash, 0, 0)
      `);
    createdUserIds.push(testAdminId);

    const loginAdminRes = await api('POST', '/auth/login', {
      body: { identifier: testAdminEmail, password: testAdminPass }
    });
    const adminToken = loginAdminRes.body.data?.token;
    record('1. Seed test Admin and login', loginAdminRes.status === 200 && Boolean(adminToken));

    // 2. Register & Approve Provider A and Provider B
    const provAPass = `ProvA_${runId}!`;
    const provAPhone = `091${String(runId).padStart(7, '0').slice(-7)}`;
    const regARes = await api('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Cơ Sở A',
        email: `prov_a_${runId}@petcare.vn`,
        phone: provAPhone,
        password: provAPass,
        orgName: `Bệnh viện Thú Y A ${runId}`,
        orgType: 'clinic',
        orgArea: 'Quận 1'
      }
    });
    if (regARes.status !== 201) {
      throw new Error(`Register Prov A failed: ${regARes.status} ${JSON.stringify(regARes.body)}`);
    }
    const provAUserId = regARes.body.data?.user?.id;
    createdUserIds.push(provAUserId);

    const appARes = await api('POST', `/admin/users/${provAUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1' }
    });
    if (appARes.status !== 200) {
      throw new Error(`Approve Prov A failed: ${appARes.status} ${JSON.stringify(appARes.body)}`);
    }
    const provAId = appARes.body.data?.providerId;
    createdProviderIds.push(provAId);

    const loginARes = await api('POST', '/auth/login', {
      body: { identifier: `prov_a_${runId}@petcare.vn`, password: provAPass }
    });
    const provAToken = loginARes.body.data?.token;

    // Provider B
    const provBPass = `ProvB_${runId}!`;
    const provBPhone = `092${String(runId).padStart(7, '0').slice(-7)}`;
    const regBRes = await api('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Spa B',
        email: `prov_b_${runId}@petcare.vn`,
        phone: provBPhone,
        password: provBPass,
        orgName: `Spa B ${runId}`,
        orgType: 'spa',
        orgArea: 'Quận 3'
      }
    });
    if (regBRes.status !== 201) {
      throw new Error(`Register Prov B failed: ${regBRes.status} ${JSON.stringify(regBRes.body)}`);
    }
    const provBUserId = regBRes.body.data?.user?.id;
    createdUserIds.push(provBUserId);

    const appBRes = await api('POST', `/admin/users/${provBUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 3' }
    });
    if (appBRes.status !== 200) {
      throw new Error(`Approve Prov B failed: ${appBRes.status} ${JSON.stringify(appBRes.body)}`);
    }
    const provBId = appBRes.body.data?.providerId;
    createdProviderIds.push(provBId);

    const loginBRes = await api('POST', '/auth/login', {
      body: { identifier: `prov_b_${runId}@petcare.vn`, password: provBPass }
    });
    const provBToken = loginBRes.body.data?.token;
    record('2. Approved Provider A & B created and logged in', Boolean(provAToken && provBToken), `ProvA: ${provAId}, ProvB: ${provBId}`);

    // 3. Provider A creates, updates, reads via SELECT
    const createSvcRes = await api('POST', '/provider/services', {
      token: provAToken,
      body: {
        name: `Khám tổng quát & Siêu âm ${runId}`,
        category: 'medical',
        categoryLabel: 'Khám & điều trị',
        priceVnd: 220000,
        unit: 'lượt khám',
        slotCapacity: 4,
        description: 'Khám lâm sàng và siêu âm bụng'
      }
    });
    const svcAId = createSvcRes.body.data?.id;
    if (svcAId) createdServiceIds.push(svcAId);

    const checkSvcA = await pool.request()
      .input('id', sql.VarChar, svcAId)
      .query('SELECT ServiceId, Name, PriceVnd, SlotCapacity, IsActive, IsSample FROM dbo.Services WHERE ServiceId = @id');
    const dbSvc = checkSvcA.recordset[0];
    record(
      '3. Provider A creates service and verified via SQL SELECT',
      createSvcRes.status === 201 && dbSvc?.PriceVnd === 220000 && dbSvc?.IsActive === true && dbSvc?.IsSample === false,
      `ServiceId: ${svcAId}`
    );

    // Update service
    const updateSvcRes = await api('PUT', `/provider/services/${svcAId}`, {
      token: provAToken,
      body: {
        name: `Khám tổng quát VIP ${runId}`,
        priceVnd: 350000,
        slotCapacity: 5
      }
    });
    const checkUpdate = await pool.request()
      .input('id', sql.VarChar, svcAId)
      .query('SELECT Name, PriceVnd, SlotCapacity FROM dbo.Services WHERE ServiceId = @id');
    record(
      '4. Provider A updates service price and slotCapacity',
      updateSvcRes.status === 200 && checkUpdate.recordset[0].PriceVnd === 350000 && checkUpdate.recordset[0].SlotCapacity === 5,
      `New Price: ${checkUpdate.recordset[0].PriceVnd}`
    );

    // 5. Public catalog visibility
    const pubList1 = await api('GET', `/services?providerId=${provAId}`);
    const inPubList1 = pubList1.body.data?.some((s) => s.id === svcAId);
    record('5. Service is visible in GET /services when active', pubList1.status === 200 && inPubList1);

    // 6. Disable service -> hidden from GET /services and /services/:id returns 404
    const disRes = await api('POST', `/provider/services/${svcAId}/disable`, { token: provAToken });
    const pubList2 = await api('GET', `/services?providerId=${provAId}`);
    const inPubList2 = pubList2.body.data?.some((s) => s.id === svcAId);
    const pubGetDis = await api('GET', `/services/${svcAId}`);
    const pubSlotsDis = await api('GET', `/services/${svcAId}/slots?date=2026-12-01`);
    record(
      '6. Disabled service hidden from GET /services and 404 on /services/:id & slots',
      disRes.status === 200 && !inPubList2 && pubGetDis.status === 404 && pubSlotsDis.status === 404,
      `List: ${!inPubList2}, Get: ${pubGetDis.status}, Slots: ${pubSlotsDis.status}`
    );

    // Enable service back
    const enRes = await api('POST', `/provider/services/${svcAId}/enable`, { token: provAToken });
    record('7. Enable service restored successfully', enRes.status === 200 && enRes.body.data?.isActive === true);

    // 8. Cross-provider isolation: Provider B cannot touch Provider A's service (404)
    const provBEditA = await api('PUT', `/provider/services/${svcAId}`, {
      token: provBToken,
      body: { name: 'Hack Name', priceVnd: 1000 }
    });
    const provBDisA = await api('POST', `/provider/services/${svcAId}/disable`, { token: provBToken });
    record(
      '8. Cross-provider isolation: Provider B cannot edit or toggle A (404)',
      provBEditA.status === 404 && provBDisA.status === 404,
      `Edit: ${provBEditA.status}, Disable: ${provBDisA.status}`
    );

    // 9. Concurrent POST with same name (Promise.all) -> exactly one 201 and one 409
    const dupName = `Dịch Vụ Song Song ${runId}`;
    const [c1, c2] = await Promise.all([
      api('POST', '/provider/services', {
        token: provAToken,
        body: { name: dupName, category: 'medical', priceVnd: 100000, unit: 'lần' }
      }),
      api('POST', '/provider/services', {
        token: provAToken,
        body: { name: dupName, category: 'medical', priceVnd: 100000, unit: 'lần' }
      })
    ]);
    const statuses = [c1.status, c2.status].sort();
    const concurrentPassed = statuses[0] === 201 && statuses[1] === 409;
    if (c1.status === 201 && c1.body.data?.id) createdServiceIds.push(c1.body.data.id);
    if (c2.status === 201 && c2.body.data?.id) createdServiceIds.push(c2.body.data.id);
    record(
      '9. Concurrent service creation with same name -> exactly one 201 and one 409',
      concurrentPassed,
      `Statuses: ${c1.status}, ${c2.status}`
    );

    // 10. Customer booking into disabled service -> rejected 404, 0 Bookings created
    // Disable svcAId
    await api('POST', `/provider/services/${svcAId}/disable`, { token: provAToken });

    // Register customer & pet
    const custPass = `CustPass_${runId}!`;
    const custPhone = `093${String(runId).padStart(7, '0').slice(-7)}`;
    const regCust = await api('POST', '/auth/register', {
      body: {
        role: 'customer',
        fullName: 'Khách Test Smoke',
        email: `cust_${runId}@petcare.vn`,
        phone: custPhone,
        password: custPass
      }
    });
    const custId = regCust.body.data?.user?.id;
    if (custId) createdUserIds.push(custId);
    const custToken = regCust.body.data?.token;

    const createPet = await api('POST', '/pets', {
      token: custToken,
      body: { name: 'Milo Smoke', species: 'dog', sex: 'male', birthDate: '2023-01-01' }
    });
    const petId = createPet.body.data?.id;
    if (petId) createdPetIds.push(petId);

    // Booking date: dynamic +7 days according to config.timezone
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const bookingDateStr = nowInTz(futureDate, config.timezone).date;

    const bookRes = await api('POST', '/bookings', {
      token: custToken,
      body: {
        petId,
        serviceId: svcAId,
        date: bookingDateStr,
        time: '09:30'
      }
    });

    const checkBookings = await pool.request()
      .input('sid', sql.VarChar, svcAId)
      .query('SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE ServiceId = @sid');
    const bookRowsCreated = checkBookings.recordset[0].cnt;
    record(
      '10. Booking into disabled service rejected (404) and 0 Bookings rows created',
      bookRes.status === 404 && bookRowsCreated === 0,
      `Status: ${bookRes.status}, DB Bookings: ${bookRowsCreated}`
    );

    // 11. Limit 50 services per provider
    // Provider B: insert up to 50 rows in DB directly (except the 51st via API)
    const countBBefore = await pool.request()
      .input('pid', sql.VarChar, provBId)
      .query('SELECT COUNT(*) AS cnt FROM dbo.Services WHERE ProviderId = @pid');
    const currentBCount = countBBefore.recordset[0].cnt;
    const toInsert = 50 - currentBCount;
    for (let i = 1; i <= toInsert; i++) {
      const sId = `${provBId}-seed-${i}-${runId}`.slice(0, 50);
      await pool.request()
        .input('id', sql.VarChar, sId)
        .input('pid', sql.VarChar, provBId)
        .input('name', sql.NVarChar, `Dịch vụ Spa Bulk ${i} ${runId}`)
        .input('cat', sql.VarChar, 'grooming')
        .input('label', sql.NVarChar, 'Spa & làm đẹp')
        .input('price', sql.Int, 50000)
        .input('unit', sql.NVarChar, 'lần')
        .query(`INSERT INTO dbo.Services (ServiceId, ProviderId, Category, CategoryLabel, Name, PriceVnd, Unit, SlotCapacity, IsActive, IsSample)
                VALUES (@id, @pid, @cat, @label, @name, @price, @unit, 2, 1, 0)`);
      createdServiceIds.push(sId);
    }

    // Now Provider B has 50 services. 51st must fail with 409
    const over50Res = await api('POST', '/provider/services', {
      token: provBToken,
      body: {
        name: `Dịch vụ thứ 51 ${runId}`,
        category: 'grooming',
        categoryLabel: 'Spa & làm đẹp',
        priceVnd: 100000,
        unit: 'lần'
      }
    });
    record('11. Limit 50 services per provider returns 409', over50Res.status === 409, `Message: ${over50Res.body.message}`);

    // 12. Admin disables Provider A -> all services vanish from GET /services and Provider A cannot write
    // Re-enable svcAId first
    await api('POST', `/provider/services/${svcAId}/enable`, { token: provAToken });
    const pubListBeforeDis = await api('GET', `/services?providerId=${provAId}`);

    const adminDisProvA = await api('POST', `/admin/users/${provAUserId}/disable`, { token: adminToken });
    const pubListAfterDis = await api('GET', `/services?providerId=${provAId}`);
    const provACannotCreate = await api('POST', '/provider/services', {
      token: provAToken,
      body: { name: 'Dịch vụ khi bị khóa', category: 'medical', priceVnd: 50000, unit: 'lần' }
    });
    record(
      '12. Admin disables Provider A -> services hidden from catalog, cannot create service',
      adminDisProvA.status === 200 && pubListBeforeDis.body.data?.length > 0 &&
      pubListAfterDis.body.data?.length === 0 && (provACannotCreate.status === 401 || provACannotCreate.status === 403 || provACannotCreate.status === 409),
      `Before: ${pubListBeforeDis.body.data?.length}, After: ${pubListAfterDis.body.data?.length}, Create: ${provACannotCreate.status}`
    );

    // 13. AuditLog security check -> Detail does not contain sensitive price/description
    const auditLogs = await pool.request()
      .input('target', sql.VarChar, svcAId)
      .query('SELECT Action, Detail FROM dbo.AuditLog WHERE TargetId = @target');
    const hasServiceAudit = auditLogs.recordset.length > 0;
    const anyLeakedSensitive = auditLogs.recordset.some((r) => {
      const d = r.Detail || '';
      return d.includes('350000') || d.includes('Khám lâm sàng và siêu âm bụng');
    });
    record(
      '13. AuditLog records service actions without leaking price/description',
      hasServiceAudit && !anyLeakedSensitive,
      `Entries: ${auditLogs.recordset.length}, Leaked: ${anyLeakedSensitive}`
    );

    // 14b. D1 Pagination check on GET /provider/services
    const svcP1 = await api('GET', '/provider/services?page=1&limit=2', { token: provAToken });
    const svcP2 = await api('GET', '/provider/services?page=2&limit=2', { token: provAToken });
    const svcMetaOk = svcP1.body?.meta?.page === 1 && svcP1.body?.meta?.limit === 2 && typeof svcP1.body?.meta?.total === 'number' && svcP2.body?.meta?.page === 2;
    record('13b. GET /provider/services pagination (page 1 & 2, meta)', svcP1.status === 200 && svcP2.status === 200 && svcMetaOk);

  } finally {
    console.log('\n--- CLEANING UP C3 TEST DATA ON REAL SQL SERVER ---');
    try {
      // 1. Delete Bookings
      if (createdBookingIds.length > 0) {
        const bList = createdBookingIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.Bookings WHERE BookingId IN (${bList})`);
      }

      // 2. Delete Pets
      if (createdPetIds.length > 0) {
        const petList = createdPetIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.Health_Metrics WHERE PetId IN (${petList})`);
        await pool.request().query(`DELETE FROM dbo.Vaccinations WHERE PetId IN (${petList})`);
        await pool.request().query(`DELETE FROM dbo.Medical_Records WHERE PetId IN (${petList})`);
        await pool.request().query(`DELETE FROM dbo.Bookings WHERE PetId IN (${petList})`);
        await pool.request().query(`DELETE FROM dbo.Pets WHERE PetId IN (${petList})`);
        console.log(`[CLEANUP] Deleted ${createdPetIds.length} test pet(s).`);
      }

      // 3. Delete Services
      if (createdServiceIds.length > 0) {
        const sList = createdServiceIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.Bookings WHERE ServiceId IN (${sList})`);
        await pool.request().query(`DELETE FROM dbo.Services WHERE ServiceId IN (${sList})`);
        console.log(`[CLEANUP] Deleted ${createdServiceIds.length} test service(s).`);
      }

      // 4. Delete AuditLog referencing created providers or users or services
      if (createdServiceIds.length > 0) {
        const sList = createdServiceIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.AuditLog WHERE TargetId IN (${sList})`);
      }
      if (createdProviderIds.length > 0) {
        const pList = createdProviderIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.AuditLog WHERE TargetId IN (${pList}) OR Detail LIKE '%${createdProviderIds[0]}%'`);
      }
      if (createdUserIds.length > 0) {
        const validUIds = createdUserIds.filter(Boolean);
        if (validUIds.length > 0) {
          const uList = validUIds.map((id) => `'${id}'`).join(',');
          await pool.request().query(`UPDATE dbo.Users SET ApprovedBy = NULL WHERE UserId IN (${uList}) OR ApprovedBy = '${testAdminId}'`);
          await pool.request().query(`DELETE FROM dbo.AuditLog WHERE ActorUserId IN (${uList}) OR TargetId IN (${uList})`);
          await pool.request().query(`DELETE FROM dbo.Users WHERE UserId IN (${uList})`);
          console.log(`[CLEANUP] Deleted ${validUIds.length} test user(s).`);
        }
      }

      // 5. Delete Providers
      if (createdProviderIds.length > 0) {
        const pList = createdProviderIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.Providers WHERE ProviderId IN (${pList})`);
        console.log(`[CLEANUP] Deleted ${createdProviderIds.length} test provider(s).`);
      }

      // 6. Verify row counts returned to baseline
      const afterU = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Users');
      const finalUsers = afterU.recordset[0].cnt;
      const afterP = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Providers');
      const finalProviders = afterP.recordset[0].cnt;
      const afterS = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Services');
      const finalServices = afterS.recordset[0].cnt;
      const afterB = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Bookings');
      const finalBookings = afterB.recordset[0].cnt;

      console.log(`Final counts    - Users: ${finalUsers}, Providers: ${finalProviders}, Services: ${finalServices}, Bookings: ${finalBookings}`);

      const cleaned = (finalUsers === baselineUsers) &&
                      (finalProviders === baselineProviders) &&
                      (finalServices === baselineServices) &&
                      (finalBookings === baselineBookings);

      record(
        '14. Database returned exactly to baseline counts',
        cleaned,
        `Delta U:${finalUsers - baselineUsers}, P:${finalProviders - baselineProviders}, S:${finalServices - baselineServices}, B:${finalBookings - baselineBookings}`
      );
    } catch (cleanupErr) {
      console.error('[CLEANUP ERROR]', cleanupErr.message);
      record('14. Cleanup/baseline', false, cleanupErr.message);
    } finally {
      const step14Found = results.some((r) => r.name.startsWith('14.'));
      if (!step14Found) {
        record('14. Cleanup/baseline', false, 'Cleanup did not complete');
      }
      await server.close();
      await pool.close();
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== RESULTS: ${passed}/${total} STEPS PASSED ===`);
  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[FATAL SMOKE ERROR]', err);
  process.exit(1);
});
