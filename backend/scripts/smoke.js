'use strict';
/**
 * PetCare AI Hub - Smoke Test Suite on REAL SQL Server 2022
 * Exercises complete happy-paths and conflict error paths via REST API.
 * Automatically cleans up all created test data on completion.
 *
 * Usage:
 *   node scripts/smoke.js
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createSqlModels } = require('../src/models');
const { createGeminiClient } = require('../src/services/gemini-client');

async function main() {
  const config = loadConfig();
  console.log('=== PETCARE AI HUB SMOKE TESTS (REAL SQL SERVER 2022) ===');
  console.log(`Target SQL Server: ${config.db.server}:${config.db.port} | Database: ${config.db.database}`);

  const { models, pool } = await createSqlModels(config.db);
  const ai = createGeminiClient(config.gemini);
  const app = createApp({ models, config, ai });

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

  const runId = Date.now();
  const testEmail = `smoke_${runId}@example.com`;
  const testPhone = `09${String(runId).slice(-8)}`;
  let testUserId = null;
  const createdPetIds = [];
  const createdBookingIds = [];

  const results = [];
  function record(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
  }

  try {
    // 0. GET /health
    const healthCheckRes = await api('GET', '/health');
    record(
      '0. GET /health',
      healthCheckRes.status === 200 && healthCheckRes.body.data?.status === 'ok' && healthCheckRes.body.data?.database === 'connected',
      `Status: ${healthCheckRes.body.data?.status}, Database: ${healthCheckRes.body.data?.database}`
    );

    // 1. GET /services
    const servicesRes = await api('GET', '/services');
    record(
      '1. GET /services',
      servicesRes.status === 200 && Array.isArray(servicesRes.body.data) && servicesRes.body.data.length > 0,
      `Found ${servicesRes.body.data?.length || 0} active services`
    );

    // 1b. Vietnamese text is stored/served intact (UTF-8 end to end)
    const allServices = servicesRes.body.data || [];
    const medical = allServices.find((x) => x.id === 'medical-general');
    const provRes = await api('GET', '/providers');
    const allText = JSON.stringify([allServices, provRes.body.data || []]);
    record(
      '1b. Vietnamese text intact',
      (!medical || medical.categoryLabel === 'Khám & điều trị') && !/[ÃÄ]/.test(allText),
      medical ? `medical-general = "${medical.categoryLabel}"` : 'medical-general not in seed'
    );
    record(
      '1c. Content-Type has charset=utf-8',
      /charset=utf-8/i.test(servicesRes.headers?.get?.('content-type') || ''),
      servicesRes.headers?.get?.('content-type') || 'no header'
    );

    // 2. GET /services/:id/slots
    const targetService = servicesRes.body.data[0];
    function ymdInTz(offsetDays, tz) {
      const d = new Date(Date.now() + offsetDays * 86400000);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    }
    const testDate = ymdInTz(7, config.timezone);
    const slotsRes = await api('GET', `/services/${targetService.id}/slots?date=${testDate}`);
    record(
      '2. GET /services/:id/slots',
      slotsRes.status === 200 && Array.isArray(slotsRes.body.data) && slotsRes.body.data.length === 8,
      `Date ${testDate}: ${slotsRes.body.data?.length || 0} slots returned`
    );

    // 3. Register Customer
    const regRes = await api('POST', '/auth/register', {
      body: {
        role: 'customer',
        fullName: 'Smoke Tester',
        email: testEmail,
        phone: testPhone,
        password: 'Password123'
      }
    });
    testUserId = regRes.body.data?.user?.id;
    let token = regRes.body.data?.token;
    record(
      '3. POST /auth/register',
      regRes.status === 201 && !!token && !!testUserId,
      `User ID: ${testUserId}`
    );

    // 4. Login Customer
    const loginRes = await api('POST', '/auth/login', {
      body: { identifier: testEmail, password: 'Password123' }
    });
    token = loginRes.body.data?.token || token;
    record(
      '4. POST /auth/login',
      loginRes.status === 200 && !!token,
      'Obtained valid JWT'
    );

    // 4b. Every supported species + a 45 g weight (hamster)
    for (const sp of ['rabbit', 'hamster', 'bird', 'fish', 'reptile', 'other']) {
      const r = await api('POST', '/pets', {
        token,
        body: { name: `Smoke-${sp}`, species: sp, sex: 'male', birthDate: '2024-03-01', weightKg: sp === 'hamster' ? 0.045 : undefined }
      });
      record(`4b. POST /pets species=${sp}`, r.status === 201 && r.body.data?.species === sp,
        sp === 'hamster' ? `weightKg=${r.body.data?.weightKg}` : `status ${r.status}`);
      if (sp === 'hamster' && r.body.data?.id) {
        const back = await api('GET', `/pets/${r.body.data.id}`, { token });
        record('4c. 0.045 kg stored and read back', back.body.data?.weightKg === 0.045, `weightKg=${back.body.data?.weightKg}`);
      }
      // Remove right away: an owner can hold at most 10 pets and later steps need room.
      if (r.body.data?.id) await api('DELETE', `/pets/${r.body.data.id}`, { token });
    }
    const badSp = await api('POST', '/pets', { token, body: { name: 'X', species: 'dragon', sex: 'male', birthDate: '2024-03-01' } });
    record('4d. unknown species -> 422', badSp.status === 422, `status ${badSp.status}`);

    // 5. Create Pet 1 and Pet 2
    const pet1Res = await api('POST', '/pets', {
      token,
      body: {
        name: 'SmokeDog1',
        species: 'dog',
        breed: 'Shiba',
        sex: 'male',
        birthDate: '2024-01-01',
        weightKg: 10.2
      }
    });
    const pet1Id = pet1Res.body.data?.id;
    if (pet1Id) createdPetIds.push(pet1Id);

    const pet2Res = await api('POST', '/pets', {
      token,
      body: {
        name: 'SmokeCat2',
        species: 'cat',
        breed: 'British Shorthair',
        sex: 'female',
        birthDate: '2024-06-01',
        weightKg: 4.1
      }
    });
    const pet2Id = pet2Res.body.data?.id;
    if (pet2Id) createdPetIds.push(pet2Id);

    record(
      '5. POST /pets (create 2 pets)',
      pet1Res.status === 201 && pet2Res.status === 201 && !!pet1Id && !!pet2Id,
      `Pet 1: ${pet1Id}, Pet 2: ${pet2Id}`
    );

    // 6. Add Weight to Pet 1 (POST /pets/:id/weights)
    const weightRes = await api('POST', `/pets/${pet1Id}/weights`, {
      token,
      body: { weightKg: 10.8, measuredOn: '2026-11-05' }
    });
    record(
      '6. POST /pets/:id/weights',
      weightRes.status === 201 && weightRes.body.data?.weightKg === 10.8,
      'Recorded 10.8 kg'
    );

    // 7. Add Vaccination to Pet 1 (POST /pets/:id/vaccinations)
    const vaccRes = await api('POST', `/pets/${pet1Id}/vaccinations`, {
      token,
      body: {
        vaccineName: 'Dại',
        administeredOn: '2026-10-01',
        nextDueOn: '2027-10-01',
        providerName: 'Phòng khám PetCare'
      }
    });
    record(
      '7. POST /pets/:id/vaccinations',
      vaccRes.status === 201 && vaccRes.body.data?.vaccineName === 'Dại',
      `Vaccine ID: ${vaccRes.body.data?.id}`
    );

    // 8. GET /health-records for Pet 1
    const healthRes = await api('GET', `/health-records?petId=${pet1Id}`, { token });
    const has2Weights = healthRes.body.data?.weights?.length === 2;
    const canRender = healthRes.body.data?.weightChart?.canRender === true;
    record(
      '8. GET /health-records',
      healthRes.status === 200 && has2Weights && canRender,
      `Weights count: 2, Chart canRender: ${canRender}`
    );

    // 9. Book Pet 1 for medical-general
    const bookingTime = '14:00';
    const book1Res = await api('POST', '/bookings', {
      token,
      body: {
        petId: pet1Id,
        serviceId: 'medical-general',
        date: testDate,
        time: bookingTime,
        notes: 'Khám định kỳ'
      }
    });
    const booking1Id = book1Res.body.data?.id;
    if (booking1Id) createdBookingIds.push(booking1Id);
    record(
      '9. POST /bookings (Pet 1)',
      book1Res.status === 201 && book1Res.body.data?.status === 'pending',
      `Code: ${book1Res.body.data?.code}`
    );

    // 10. ERROR BRANCH: Same pet booked again at the same slot -> 409 conflict (pet_clash)
    const clashRes = await api('POST', '/bookings', {
      token,
      body: {
        petId: pet1Id,
        serviceId: 'medical-general',
        date: testDate,
        time: bookingTime
      }
    });
    record(
      '10. POST /bookings - ERROR 409 (Thú cưng trùng giờ)',
      clashRes.status === 409 && clashRes.body.code === 'conflict',
      `HTTP ${clashRes.status}: ${clashRes.body.message}`
    );

    // 11. ERROR BRANCH: Slot capacity full -> 409 conflict
    // Query actual slotCapacity from catalog
    const svcDetail = await api('GET', `/services/${targetService.id}`);
    // In database, services have default SlotCapacity = 3.
    // Create pets and book until capacity is reached, then next must fail with 409.
    const capacityPets = [];
    for (let i = 1; i <= 3; i++) {
      const p = await api('POST', '/pets', {
        token,
        body: { name: `CapPet${i}`, species: 'cat', sex: 'female', birthDate: '2024-01-01' }
      });
      if (p.body.data?.id) {
        createdPetIds.push(p.body.data.id);
        capacityPets.push(p.body.data.id);
      }
    }

    const capTime = '16:30';
    let capBooked = 0;
    for (const pid of capacityPets) {
      const bRes = await api('POST', '/bookings', {
        token,
        body: { petId: pid, serviceId: targetService.id, date: testDate, time: capTime }
      });
      if (bRes.body.data?.id) { createdBookingIds.push(bRes.body.data.id); capBooked += 1; }
    }
    record('11-setup. filled slot capacity (3 bookings)', capBooked === 3, `${capBooked}/3 booked, ${capacityPets.length}/3 pets created`);

    // Now slot is full (3/3). Next booking with Pet 1 must return 409 conflict (full)
    const bookFullRes = await api('POST', '/bookings', {
      token,
      body: {
        petId: pet1Id,
        serviceId: targetService.id,
        date: testDate,
        time: capTime
      }
    });
    record(
      '11. POST /bookings - ERROR 409 (Khung giờ kín chỗ / Full capacity)',
      bookFullRes.status === 409 && bookFullRes.body.code === 'conflict',
      `HTTP ${bookFullRes.status}: ${bookFullRes.body.message}`
    );

    // 12. Cancel Booking with reason and verify CancelledBy / CancelReason
    const cancelReasonText = 'Bận việc gia đình đột xuất';
    const cancelRes = await api('PATCH', `/bookings/${booking1Id}/cancel`, {
      token,
      body: { reason: cancelReasonText }
    });
    const cancelData = cancelRes.body.data;
    const cancelOk = cancelRes.status === 200 &&
      cancelData?.status === 'cancelled' &&
      cancelData?.cancelledBy === 'customer' &&
      cancelData?.cancelReason === cancelReasonText &&
      Boolean(cancelData?.cancelledAt);
    record(
      '12. PATCH /bookings/:id/cancel with reason',
      cancelOk,
      `Status: ${cancelData?.status}, CancelledBy: ${cancelData?.cancelledBy}, Reason: "${cancelData?.cancelReason}"`
    );

    // 13. ERROR BRANCH: Cancel already cancelled booking -> 409 conflict
    const cancelAgainRes = await api('PATCH', `/bookings/${booking1Id}/cancel`, { token });
    record(
      '13. PATCH /bookings/:id/cancel - ERROR 409 (Hủy lịch đã hủy)',
      cancelAgainRes.status === 409 && cancelAgainRes.body.code === 'conflict',
      `HTTP ${cancelAgainRes.status}: ${cancelAgainRes.body.message}`
    );
  } finally {
    let cleanupFailed = false;
    console.log('\n--- CLEANING UP TEST DATA ON SQL SERVER ---');
    try {
      const cleanupPool = await new sql.ConnectionPool({
        server: config.db.server,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        options: { encrypt: config.db.encrypt, trustServerCertificate: config.db.trustServerCertificate }
      }).connect();

      const q = cleanupPool.request();
      if (testUserId) {
        q.input('userId', sql.UniqueIdentifier, testUserId);
        await q.query(`
          SET ANSI_NULLS ON;
          SET QUOTED_IDENTIFIER ON;
          DELETE FROM dbo.AuditLog WHERE ActorUserId = @userId;
          DELETE FROM dbo.Bookings WHERE UserId = @userId;
          DELETE FROM dbo.Health_Metrics WHERE PetId IN (SELECT PetId FROM dbo.Pets WHERE OwnerId = @userId);
          DELETE FROM dbo.Vaccinations WHERE PetId IN (SELECT PetId FROM dbo.Pets WHERE OwnerId = @userId);
          DELETE FROM dbo.Pets WHERE OwnerId = @userId;
          DELETE FROM dbo.Users WHERE UserId = @userId;
        `);
        console.log(`[CLEANUP] Successfully removed test user ${testEmail} and all related records.`);
      }
      await cleanupPool.close();
    } catch (cleanErr) {
      cleanupFailed = true;
      console.error('[CLEANUP ERROR]:', cleanErr.message);
    }

    await new Promise((r) => server.close(r));
    await pool.close();

    if (cleanupFailed) {
      console.error('[FATAL] Cleanup failed! Exiting with code 1.');
      process.exit(1);
    }
  }

  const allPassed = results.every((r) => r.pass);
  console.log(`\n=== SMOKE TEST SUMMARY: ${results.filter((r) => r.pass).length}/${results.length} PASSED ===`);
  if (!allPassed) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL]:', err);
    process.exit(1);
  });
}

module.exports = { main };
