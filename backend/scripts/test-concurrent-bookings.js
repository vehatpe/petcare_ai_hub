'use strict';
/**
 * PetCare AI Hub - Concurrent Booking Test on REAL SQL Server 2022
 * Exercises two concurrent transactions attempting to book the same slot simultaneously.
 * Verifies that UPDLOCK, HOLDLOCK, and transaction isolation prevent race conditions.
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const crypto = require('node:crypto');
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createSqlModels } = require('../src/models');

async function main() {
  const config = loadConfig();
  console.log('=== TESTING CONCURRENT TRANSACTIONS ON REAL SQL SERVER 2022 ===');
  const { models, pool } = await createSqlModels(config.db);

  const testUserId = crypto.randomUUID();
  const testPetId = crypto.randomUUID();
  const testDate = '2026-12-25';
  const testTime = '10:30';

  try {
    // Setup test user and pet directly
    const q = pool.request();
    q.input('userId', sql.UniqueIdentifier, testUserId);
    q.input('petId', sql.UniqueIdentifier, testPetId);
    await q.query(`
      SET ANSI_NULLS ON;
      SET QUOTED_IDENTIFIER ON;
      INSERT INTO dbo.Users (UserId, Role, Status, FullName, Email, Phone, PasswordHash)
      VALUES (@userId, 'customer', 'active', N'Concurrent Tester', 'concurrent@test.vn', '0999888777', 'dummyhash');

      INSERT INTO dbo.Pets (PetId, OwnerId, Name, Species, Sex, BirthDate)
      VALUES (@petId, @userId, N'Racer', 'dog', 'male', '2024-01-01');
    `);

    console.log(`Created test pet ${testPetId} for concurrent test.`);

    const bookingPayload1 = {
      id: crypto.randomUUID(),
      code: 'BK-RACE01A',
      ownerId: testUserId,
      petId: testPetId,
      petName: 'Racer',
      serviceId: 'medical-general',
      serviceName: 'Khám tổng quát',
      providerName: 'Bệnh viện PetCare',
      priceVnd: 250000,
      date: testDate,
      time: testTime,
      notes: 'Concurrent 1'
    };

    const bookingPayload2 = {
      id: crypto.randomUUID(),
      code: 'BK-RACE02B',
      ownerId: testUserId,
      petId: testPetId,
      petName: 'Racer',
      serviceId: 'medical-general',
      serviceName: 'Khám tổng quát',
      providerName: 'Bệnh viện PetCare',
      priceVnd: 250000,
      date: testDate,
      time: testTime,
      notes: 'Concurrent 2'
    };

    console.log('Dispatching 2 simultaneous booking transactions for the same pet at the exact same slot...');
    const [res1, res2] = await Promise.all([
      models.bookings.create(bookingPayload1, { capacity: 3 }),
      models.bookings.create(bookingPayload2, { capacity: 3 })
    ]);

    console.log('Transaction 1 result:', res1);
    console.log('Transaction 2 result:', res2);

    const oneSucceeded = (res1.ok && !res2.ok) || (!res1.ok && res2.ok);
    const reasonIsClash = (res1.reason === 'pet_clash' || res2.reason === 'pet_clash');

    if (oneSucceeded && reasonIsClash) {
      console.log('\n[PASS] Concurrency control succeeded! Exactly 1 booking was created, and the concurrent clash was prevented cleanly.');
    } else {
      console.error('\n[FAIL] Unexpected outcome in concurrent transactions!');
      process.exit(1);
    }
  } finally {
    // Cleanup
    const cleanupReq = pool.request();
    cleanupReq.input('userId', sql.UniqueIdentifier, testUserId);
    await cleanupReq.query(`
      SET ANSI_NULLS ON;
      SET QUOTED_IDENTIFIER ON;
      DELETE FROM dbo.Bookings WHERE UserId = @userId;
      DELETE FROM dbo.Pets WHERE OwnerId = @userId;
      DELETE FROM dbo.Users WHERE UserId = @userId;
    `);
    console.log('Cleaned up concurrent test data.');
    await pool.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL]:', err);
    process.exit(1);
  });
}

module.exports = { main };
