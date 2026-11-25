'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');

function seedProviderAndCustomer(app) {
  const { state } = app.testHelpers;
  // Ensure clinic-a and clinic-b exist
  if (!state.providers.find((p) => p.id === 'clinic-a')) {
    state.providers.push({ id: 'clinic-a', name: 'Phòng khám A', area: 'Q1', isSample: false, isActive: true });
  } else {
    state.providers.find((p) => p.id === 'clinic-a').isSample = false;
    state.providers.find((p) => p.id === 'clinic-a').isActive = true;
  }
  state.providers.push({ id: 'clinic-b', name: 'Phòng khám B', area: 'Q3', isSample: false, isActive: true });
}

test('Provider Bookings API: list, filters, transitions, vet assignment, permissions (DB giả)', async (t) => {
  // Clock: 2026-06-15 10:00 VN time (03:00 UTC)
  const app = await startTestApp({ now: '2026-06-15T03:00:00.000Z' });
  t.after(app.close);

  seedProviderAndCustomer(app);
  const { call } = app;
  const { state } = app.testHelpers;

  // Create users: Provider A, Provider B, Vet A (active), Vet A2 (disabled), Vet B, Customer, Admin
  const cust = await app.registerCustomer({ fullName: 'Khách Hàng A', phone: '0909888777' });
  const pet = await app.createPet(cust.token, { name: 'Milo', species: 'dog' });

  let seq = 1;
  const pwHash = bcrypt.hashSync('matkhau123', 4);
  async function makeUser({ role, status = 'active', providerId = null, fullName, login = true }) {
    const idx = seq++;
    const id = crypto.randomUUID();
    const email = `staff${idx}@clinic.vn`;
    await app.testHelpers.addStaff(role, {
      id,
      email,
      phone: `09880000${String(idx).padStart(2, '0')}`,
      fullName,
      status,
      providerId,
      passwordHash: pwHash
    });
    const u = state.users.find((x) => x.id === id);
    if (u) {
      u.providerId = providerId;
      u.status = status;
    }
    if (status !== 'active' || !login) {
      return { token: null, user: { id, email, role, status, providerId, fullName } };
    }
    const loginRes = await call('POST', '/auth/login', { body: { identifier: email, password: 'matkhau123' } });
    return { token: loginRes.data.token, user: loginRes.data.user };
  }

  const provA = await makeUser({ role: 'provider', status: 'active', providerId: 'clinic-a', fullName: 'Chủ A' });
  const provB = await makeUser({ role: 'provider', status: 'active', providerId: 'clinic-b', fullName: 'Chủ B' });
  const vetA = await makeUser({ role: 'vet', status: 'active', providerId: 'clinic-a', fullName: 'BS An' });
  const vetADisabled = await makeUser({ role: 'vet', status: 'disabled', providerId: 'clinic-a', fullName: 'BS Khóa' });
  const vetB = await makeUser({ role: 'vet', status: 'active', providerId: 'clinic-b', fullName: 'BS Bình', login: false });
  const admin = await makeUser({ role: 'admin', status: 'active', fullName: 'Admin' });

  // Create a service for clinic-b
  state.services.push({
    id: 'clinic-b-svc',
    providerId: 'clinic-b',
    category: 'medical',
    name: 'Khám B',
    priceVnd: 150000,
    slotCapacity: 3,
    isActive: true
  });

  // Customer books at clinic-a for 2026-06-15 14:00 (4h in future)
  const b1Res = await call('POST', '/bookings', {
    token: cust.token,
    body: { petId: pet.id, serviceId: 'medical-general', date: '2026-06-15', time: '14:00', notes: 'Ho nhẹ' }
  });
  assert.equal(b1Res.status, 201);
  const b1Id = b1Res.data.id;

  // Customer books another at clinic-a for 2026-06-15 15:30
  const b2Res = await call('POST', '/bookings', {
    token: cust.token,
    body: { petId: pet.id, serviceId: 'medical-general', date: '2026-06-15', time: '15:30' }
  });
  assert.equal(b2Res.status, 201);
  const b2Id = b2Res.data.id;

  // Customer books at clinic-b
  const bBRes = await call('POST', '/bookings', {
    token: cust.token,
    body: { petId: pet.id, serviceId: 'clinic-b-svc', date: '2026-06-16', time: '08:30' }
  });
  assert.equal(bBRes.status, 201, JSON.stringify(bBRes.body));
  const bBId = bBRes.data.id;

  await t.test('Permissions: customer, vet, admin cannot call provider booking routes (403)', async () => {
    for (const u of [cust, vetA, admin]) {
      assert.equal((await call('GET', '/provider/bookings', { token: u.token })).status, 403);
      assert.equal((await call('PATCH', `/bookings/${b1Id}/confirm`, { token: u.token })).status, 403);
      assert.equal((await call('PATCH', `/bookings/${b1Id}/complete`, { token: u.token })).status, 403);
      assert.equal((await call('PATCH', `/bookings/${b1Id}/no-show`, { token: u.token })).status, 403);
      assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: u.token, body: { vetId: vetA.user.id } })).status, 403);
    }
    // Vet and Admin also cannot cancel
    assert.equal((await call('PATCH', `/bookings/${b1Id}/cancel`, { token: vetA.token, body: { reason: 'Test' } })).status, 403);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/cancel`, { token: admin.token, body: { reason: 'Test' } })).status, 403);
  });

  await t.test('Provider B cannot see or mutate Provider A bookings (404)', async () => {
    const listB = await call('GET', '/provider/bookings', { token: provB.token });
    assert.equal(listB.status, 200);
    assert.equal(listB.data.items.length, 1);
    assert.equal(listB.data.items[0].id, bBId);

    assert.equal((await call('PATCH', `/bookings/${b1Id}/confirm`, { token: provB.token })).status, 404);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/cancel`, { token: provB.token, body: { reason: 'Hủy nhầm' } })).status, 404);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/complete`, { token: provB.token })).status, 404);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/no-show`, { token: provB.token })).status, 404);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: provB.token, body: { vetId: vetB.user.id } })).status, 404);
  });

  await t.test('List keys, filters, summary, and 422 validation', async () => {
    const res = await call('GET', '/provider/bookings?date=2026-06-15&status=pending', { token: provA.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.items.length, 2);
    assert.deepEqual(res.data.summary, { pending: 2, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 });

    const expectedKeys = [
      'cancelReason', 'cancelledBy', 'code', 'completedAt', 'confirmedAt', 'createdAt',
      'customerName', 'customerPhone', 'date', 'id', 'notes', 'petName', 'petSpecies',
      'priceVnd', 'serviceName', 'status', 'time', 'vet'
    ].sort();
    assert.deepEqual(Object.keys(res.data.items[0]).sort(), expectedKeys);
    assert.equal(res.data.items[0].customerPhone, '0909888777');

    // Invalid query params -> 422
    assert.equal((await call('GET', '/provider/bookings?status=bad', { token: provA.token })).status, 422);
    assert.equal((await call('GET', '/provider/bookings?date=2026-13-40', { token: provA.token })).status, 422);
    assert.equal((await call('GET', '/provider/bookings?from=2026-01-01&to=2026-06-01', { token: provA.token })).status, 422);
    assert.equal((await call('GET', '/provider/bookings?vetId=not-a-uuid', { token: provA.token })).status, 422);
  });

  await t.test('Assign Vet: valid, invalid (422), unassign (null), and already_recorded (409)', async () => {
    // Invalid vetId / other clinic / disabled -> 422
    assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: 'bad' } })).status, 422);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: vetB.user.id } })).status, 422);
    assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: vetADisabled.user.id } })).status, 422);

    // Valid assign
    const assignRes = await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: vetA.user.id } });
    assert.equal(assignRes.status, 200);
    assert.deepEqual(assignRes.data.vet, { id: vetA.user.id, name: 'BS An' });

    // Unassign with null
    const unassignRes = await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: null } });
    assert.equal(unassignRes.status, 200);
    assert.equal(unassignRes.data.vet, null);

    // Re-assign vetA, then simulate medical record written by vetA -> cannot change vet (409 already_recorded)
    await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: vetA.user.id } });
    (state.medicalRecords = state.medicalRecords || []).push({ id: 'mr-1', bookingId: b1Id, vetId: vetA.user.id, petId: pet.id });
    const vetA2 = await makeUser({ role: 'vet', status: 'active', providerId: 'clinic-a', fullName: 'BS An 2', login: false });
    const changeBlocked = await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: vetA2.user.id } });
    assert.equal(changeBlocked.status, 409);
    assert.equal(changeBlocked.body.code, 'already_recorded');
  });

  await t.test('Confirm, complete, no-show timing rules & state transitions', async () => {
    // Cannot complete or no-show while pending -> 409 invalid_transition
    assert.equal((await call('PATCH', `/bookings/${b1Id}/complete`, { token: provA.token })).body.code, 'invalid_transition');
    assert.equal((await call('PATCH', `/bookings/${b1Id}/no-show`, { token: provA.token })).body.code, 'invalid_transition');

    // Confirm b1 (at 10:00 for 14:00 slot -> ok)
    const confRes = await call('PATCH', `/bookings/${b1Id}/confirm`, { token: provA.token });
    assert.equal(confRes.status, 200);
    assert.equal(confRes.data.status, 'confirmed');
    assert.ok(confRes.data.confirmedAt);

    // Cannot complete before 14:00 -> 409 too_early
    const earlyComp = await call('PATCH', `/bookings/${b1Id}/complete`, { token: provA.token });
    assert.equal(earlyComp.status, 409);
    assert.equal(earlyComp.body.code, 'too_early');

    // Simulate slot start reached (10:00 VN time = 03:00 UTC) by setting slot time to 10:00
    state.bookings.find((x) => x.id === b1Id).time = '10:00';
    // Now confirm on b2 (15:30) works, but confirm on a 14:00 slot would be slot_passed
    const compRes = await call('PATCH', `/bookings/${b1Id}/complete`, { token: provA.token });
    assert.equal(compRes.status, 200);
    assert.equal(compRes.data.status, 'completed');
    assert.ok(compRes.data.completedAt);

    // Terminal state cannot be cancelled or assigned vet
    assert.equal((await call('PATCH', `/bookings/${b1Id}/cancel`, { token: provA.token, body: { reason: 'Hủy sau' } })).body.code, 'invalid_transition');
    assert.equal((await call('PATCH', `/bookings/${b1Id}/vet`, { token: provA.token, body: { vetId: null } })).body.code, 'invalid_transition');
  });

  await t.test('Provider cancel requires reason 3-300 chars and Customer sees it', async () => {
    // Missing / short / long reason -> 422
    assert.equal((await call('PATCH', `/bookings/${b2Id}/cancel`, { token: provA.token, body: {} })).status, 422);
    assert.equal((await call('PATCH', `/bookings/${b2Id}/cancel`, { token: provA.token, body: { reason: 'ab' } })).status, 422);
    assert.equal((await call('PATCH', `/bookings/${b2Id}/cancel`, { token: provA.token, body: { reason: 'a'.repeat(301) } })).status, 422);

    const cancelRes = await call('PATCH', `/bookings/${b2Id}/cancel`, {
      token: provA.token,
      body: { reason: 'Bác sĩ nghỉ đột xuất' }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.status, 'cancelled');
    assert.equal(cancelRes.data.cancelledBy, 'provider');
    assert.equal(cancelRes.data.cancelReason, 'Bác sĩ nghỉ đột xuất');

    // Customer sees cancelledBy & cancelReason in GET /bookings
    const custList = await call('GET', '/bookings', { token: cust.token });
    const b2Cust = custList.data.find((x) => x.id === b2Id);
    assert.equal(b2Cust.status, 'cancelled');
    assert.equal(b2Cust.cancelledBy, 'provider');
    assert.equal(b2Cust.cancelReason, 'Bác sĩ nghỉ đột xuất');
  });

  await t.test('Facility IsActive=0: readable (200) but writes blocked (409 facility_inactive)', async () => {
    state.providers.find((p) => p.id === 'clinic-b').isActive = false;
    assert.equal((await call('GET', '/provider/bookings', { token: provB.token })).status, 200);
    const writeRes = await call('PATCH', `/bookings/${bBId}/confirm`, { token: provB.token });
    assert.equal(writeRes.status, 409);
    assert.equal(writeRes.body.code, 'facility_inactive');
  });
});
