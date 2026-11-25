'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRANSITIONS,
  TERMINAL,
  canTransition,
  assertTransition,
  minutesUntil
} = require('../src/utils/booking-state');
const { startTestApp } = require('./helpers/harness');

test('Booking state machine: 5x5 table-driven transition check', () => {
  const allStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  const validPairs = new Set([
    'pending->confirmed',
    'pending->cancelled',
    'confirmed->cancelled',
    'confirmed->completed',
    'confirmed->no_show'
  ]);

  let tested = 0;
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      tested++;
      const pair = `${from}->${to}`;
      const allowed = canTransition(from, to);
      if (validPairs.has(pair)) {
        assert.equal(allowed, true, `Transition ${pair} should be valid`);
        assert.doesNotThrow(() => assertTransition(from, to));
      } else {
        assert.equal(allowed, false, `Transition ${pair} should be invalid`);
        assert.throws(
          () => assertTransition(from, to),
          (err) => err.code === 'invalid_transition' && err.status === 409
        );
      }
    }
  }
  assert.equal(tested, 25, 'Must test all 25 pairs');
  assert.deepEqual(TERMINAL, ['completed', 'cancelled', 'no_show']);
});

test('minutesUntil calculation & boundary logic', () => {
  // Target: 2026-06-15 14:00 (VN time, UTC+7)
  const slotDate = '2026-06-15';
  const slotTime = '14:00';

  // 120 minutes before: 12:00 VN time (05:00 UTC)
  const clock120m = new Date('2026-06-15T05:00:00.000Z');
  assert.equal(minutesUntil(slotDate, slotTime, clock120m, 'Asia/Ho_Chi_Minh'), 120);

  // 119 minutes before: 12:01 VN time (05:01 UTC)
  const clock119m = new Date('2026-06-15T05:01:00.000Z');
  assert.equal(minutesUntil(slotDate, slotTime, clock119m, 'Asia/Ho_Chi_Minh'), 119);

  // At the slot start: 14:00 VN time (07:00 UTC)
  const clockAt = new Date('2026-06-15T07:00:00.000Z');
  assert.equal(minutesUntil(slotDate, slotTime, clockAt, 'Asia/Ho_Chi_Minh'), 0);

  // Past the slot start: 14:30 VN time (07:30 UTC)
  const clockPast = new Date('2026-06-15T07:30:00.000Z');
  assert.equal(minutesUntil(slotDate, slotTime, clockPast, 'Asia/Ho_Chi_Minh'), -30);

  // Midnight boundary test: Slot at 2026-06-16 00:00 vs clock 2026-06-15 23:59 (1 min before)
  const clockBeforeMidnight = new Date('2026-06-15T16:59:00.000Z'); // 23:59 VN time
  assert.equal(minutesUntil('2026-06-16', '08:30', clockBeforeMidnight, 'Asia/Ho_Chi_Minh'), 1 + 8 * 60 + 30);
});

test('Customer booking cancellation & lifecycle rules', async (t) => {
  const app = await startTestApp({ now: '2026-06-10T03:00:00.000Z' });
  t.after(app.close);

  const { call } = app;
  const A = await app.registerCustomer();
  const B = await app.registerCustomer();
  const petA = await app.createPet(A.token, { name: 'Miu Con' });

  await t.test('Customer creates booking with snapshots and providerIsSample flag', async () => {
    const res = await call('POST', '/bookings', {
      token: A.token,
      body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-12', time: '14:00', notes: 'Khám răng' }
    });
    assert.equal(res.status, 201);
    const b = res.data;
    assert.equal(b.status, 'pending');
    assert.equal(b.serviceName, 'Khám tổng quát');
    assert.equal(b.providerId, 'clinic-a');
    assert.equal(b.providerIsSample, true);
    assert.equal(b.priceVnd, 250000);
    assert.equal(b.petName, 'Miu Con');
    assert.equal(b.vetId, undefined); // Never leaked to customer
  });

  await t.test('Snapshot test: modifying service price/name or pet name does not alter existing booking DTO', async () => {
    const res = await call('POST', '/bookings', {
      token: A.token,
      body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-15', time: '10:30', notes: 'Tiêm phòng' }
    });
    assert.equal(res.status, 201);
    const bookingId = res.data.id;

    // Mutate catalog service and pet in backend state
    const svc = app.testHelpers.state.services.find((s) => s.id === 'medical-general');
    svc.name = 'Khám VIP Đặc Biệt';
    svc.priceVnd = 999999;
    const pet = app.testHelpers.state.pets.find((p) => p.id === petA.id);
    pet.name = 'Miu Đại Ca';

    // Retrieve booking via list / get
    const listRes = await call('GET', '/bookings', { token: A.token });
    const b = listRes.data.find((item) => item.id === bookingId);
    assert.equal(b.serviceName, 'Khám tổng quát', 'Snapshot serviceName must not change');
    assert.equal(b.priceVnd, 250000, 'Snapshot priceVnd must not change');
    assert.equal(b.petName, 'Miu Con', 'Snapshot petName must not change');

    // Restore names for subsequent tests
    svc.name = 'Khám tổng quát';
    svc.priceVnd = 250000;
    pet.name = 'Miu Con';
  });

  await t.test('Customer B cannot cancel Customer A booking (404)', async () => {
    const listA = (await call('GET', '/bookings', { token: A.token })).data;
    const bookingId = listA[0].id;

    const cancelRes = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: B.token,
      body: { reason: 'Tôi muốn hủy' }
    });
    assert.equal(cancelRes.status, 404);
  });

  await t.test('Reason validation: <= 300 characters, optional, empty body allowed', async () => {
    const listA = (await call('GET', '/bookings', { token: A.token })).data;
    const bookingId = listA[0].id;

    // 301 chars -> 422
    const longReason = 'A'.repeat(301);
    const r422 = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: { reason: longReason }
    });
    assert.equal(r422.status, 422);

    // Empty body -> success (backward compatible)
    const r200 = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: {}
    });
    assert.equal(r200.status, 200);
    assert.equal(r200.data.status, 'cancelled');
    assert.equal(r200.data.cancelledBy, 'customer');
    assert.equal(r200.data.cancelReason, null);
    assert.ok(r200.data.cancelledAt);

    // Audit log was recorded
    const logs = await app.testHelpers.queryAuditLogs({ action: 'booking_cancel' });
    assert.ok(logs.length >= 1);
    assert.equal(logs[logs.length - 1].targetId, bookingId);
    assert.equal(logs[logs.length - 1].detail, null); // Never leaks reason
  });

  await t.test('2-hour boundary rules for confirmed booking cancellation', async () => {
    // Create new booking for date 2026-06-20 at 14:00 (slot start = 14:00 VN time = 07:00 UTC)
    const createRes = await call('POST', '/bookings', {
      token: A.token,
      body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-20', time: '14:00', notes: 'Khám mắt' }
    });
    assert.equal(createRes.status, 201);
    const bookingId = createRes.data.id;

    // Change status to 'confirmed' directly in DB test double
    const rawBooking = app.testHelpers.state.bookings.find((b) => b.id === bookingId);
    rawBooking.status = 'confirmed';
    rawBooking.confirmedAt = '2026-06-10T10:00:00.000Z';

    // Case 1: 119 minutes remaining (12:01 VN time = 05:01 UTC) -> 409 cancel_window
    app.clock.current = new Date('2026-06-20T05:01:00.000Z');
    const r409 = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: { reason: 'Hủy sát giờ' }
    });
    assert.equal(r409.status, 409);
    assert.equal(r409.body.code, 'cancel_window');

    // Exactly 120 minutes remaining (12:00 VN time = 05:00 UTC) -> Allowed
    app.clock.current = new Date('2026-06-20T05:00:00.000Z');
    const rAllowed = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: { reason: 'Hủy đúng mốc 2 giờ' }
    });
    assert.equal(rAllowed.status, 200);
    assert.equal(rAllowed.data.status, 'cancelled');
    assert.equal(rAllowed.data.cancelReason, 'Hủy đúng mốc 2 giờ');
  });

  await t.test('Pending booking can be cancelled even if within 2 hours or close to slot', async () => {
    // Create booking for 2026-06-22 at 09:30
    const createRes = await call('POST', '/bookings', {
      token: A.token,
      body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-22', time: '09:30', notes: '' }
    });
    assert.equal(createRes.status, 201);
    const bookingId = createRes.data.id;

    // Current time is 09:00 VN time (30 minutes before slot)
    app.clock.current = new Date('2026-06-22T02:00:00.000Z');
    const cancelRes = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: { reason: 'Bận đột xuất' }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.status, 'cancelled');
  });

  await t.test('Yesterday confirmed booking cannot be cancelled (409 cancel_window)', async () => {
    const createRes = await call('POST', '/bookings', {
      token: A.token,
      body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-25', time: '10:30', notes: '' }
    });
    const bookingId = createRes.data.id;
    const rawBooking = app.testHelpers.state.bookings.find((b) => b.id === bookingId);
    rawBooking.status = 'confirmed';

    // Current time is tomorrow: 2026-06-26 10:30 VN time
    app.clock.current = new Date('2026-06-26T03:30:00.000Z');
    const cancelRes = await call('PATCH', `/bookings/${bookingId}/cancel`, {
      token: A.token,
      body: { reason: 'Đã quá ngày' }
    });
    assert.equal(cancelRes.status, 409);
    assert.equal(cancelRes.body.code, 'cancel_window');
  });
});
