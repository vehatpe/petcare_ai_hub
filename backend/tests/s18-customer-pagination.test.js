'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

test('S18: GET /bookings pagination, scope, petId, ordering, authz, and dashboard SQL counts', async (t) => {
  const app = await startTestApp({ now: '2026-06-10T10:00:00+07:00' });
  t.after(app.close);
  const { call } = app;

  const A = await app.registerCustomer();
  const B = await app.registerCustomer();
  const pet1 = await app.createPet(A.token, { name: 'Mít' });
  const pet2 = await app.createPet(A.token, { name: 'Bơ' });
  const petB = await app.createPet(B.token, { name: 'Cún B' });

  // Seed 5 bookings for A + 1 for B directly in state so we can include past/today-past/completed/cancelled
  const st = app.testHelpers.state;
  st.bookings.push(
    // 1. Future confirmed (later)
    { id: '00000000-0000-4000-8000-000000000001', code: 'BK-UP2', ownerId: A.user.id, petId: pet1.id, petName: pet1.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-12', time: '14:00', notes: null, status: 'confirmed', createdAt: '2026-06-01T00:00:00.000Z' },
    // 2. Future pending (sooner)
    { id: '00000000-0000-4000-8000-000000000002', code: 'BK-UP1', ownerId: A.user.id, petId: pet2.id, petName: pet2.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-11', time: '09:30', notes: null, status: 'pending', createdAt: '2026-06-01T00:00:00.000Z' },
    // 3. Today but time already passed (08:30 < 10:00) -> history
    { id: '00000000-0000-4000-8000-000000000003', code: 'BK-TDY', ownerId: A.user.id, petId: pet1.id, petName: pet1.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-10', time: '08:30', notes: null, status: 'confirmed', createdAt: '2026-06-01T00:00:00.000Z' },
    // 4. Future but cancelled -> history
    { id: '00000000-0000-4000-8000-000000000004', code: 'BK-CAN', ownerId: A.user.id, petId: pet1.id, petName: pet1.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-15', time: '10:30', notes: null, status: 'cancelled', createdAt: '2026-06-01T00:00:00.000Z' },
    // 5. Past completed -> history
    { id: '00000000-0000-4000-8000-000000000005', code: 'BK-OLD', ownerId: A.user.id, petId: pet2.id, petName: pet2.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-05', time: '15:30', notes: null, status: 'completed', createdAt: '2026-06-01T00:00:00.000Z' },
    // 6. User B's booking
    { id: '00000000-0000-4000-8000-000000000006', code: 'BK-BBB', ownerId: B.user.id, petId: petB.id, petName: petB.name, serviceId: 'medical-general', serviceName: 'Khám tổng quát', providerName: 'Phòng khám A (Quận 1)', priceVnd: 250000, date: '2026-06-11', time: '08:30', notes: null, status: 'pending', createdAt: '2026-06-01T00:00:00.000Z' }
  );

  // scope=all: upcoming ascending (BK-UP1, BK-UP2), then history descending (BK-CAN, BK-TDY, BK-OLD)
  const all = await call('GET', '/bookings', { token: A.token });
  assert.equal(all.status, 200);
  assert.deepEqual(all.data.items.map((b) => b.code), ['BK-UP1', 'BK-UP2', 'BK-CAN', 'BK-TDY', 'BK-OLD']);
  assert.deepEqual(all.body.meta, { page: 1, limit: 20, total: 5, totalPages: 1 });

  // scope=upcoming & scope=history
  const up = await call('GET', '/bookings?scope=upcoming', { token: A.token });
  assert.deepEqual(up.data.items.map((b) => b.code), ['BK-UP1', 'BK-UP2']);
  assert.equal(up.body.meta.total, 2);

  const hist = await call('GET', '/bookings?scope=history', { token: A.token });
  assert.deepEqual(hist.data.items.map((b) => b.code), ['BK-CAN', 'BK-TDY', 'BK-OLD']);
  assert.equal(hist.body.meta.total, 3);

  // petId filter
  const byPet = await call('GET', `/bookings?petId=${pet1.id}`, { token: A.token });
  assert.deepEqual(byPet.data.items.map((b) => b.code), ['BK-UP2', 'BK-CAN', 'BK-TDY']);
  // other user's petId -> empty list, not 404/403
  const otherPet = await call('GET', `/bookings?petId=${petB.id}`, { token: A.token });
  assert.equal(otherPet.status, 200);
  assert.deepEqual(otherPet.data.items, []);

  // Pagination limit=2 across 3 pages without duplicates
  const p1 = await call('GET', '/bookings?page=1&limit=2', { token: A.token });
  const p2 = await call('GET', '/bookings?page=2&limit=2', { token: A.token });
  const p3 = await call('GET', '/bookings?page=3&limit=2', { token: A.token });
  assert.deepEqual(p1.body.meta, { page: 1, limit: 2, total: 5, totalPages: 3 });
  assert.deepEqual(p1.data.items.map((b) => b.code), ['BK-UP1', 'BK-UP2']);
  assert.deepEqual(p2.data.items.map((b) => b.code), ['BK-CAN', 'BK-TDY']);
  assert.deepEqual(p3.data.items.map((b) => b.code), ['BK-OLD']);

  // Validation errors
  assert.equal((await call('GET', '/bookings?page=0', { token: A.token })).status, 422);
  assert.equal((await call('GET', '/bookings?petId=not-a-guid', { token: A.token })).status, 422);
  assert.equal((await call('GET', '/bookings?scope=invalid', { token: A.token })).status, 422);

  // Dashboard SQL counts + prove listByOwner is NOT called
  const origListByOwner = app.models.bookings.listByOwner;
  app.models.bookings.listByOwner = () => { throw new Error('dashboard must not call listByOwner'); };
  try {
    const dash = await call('GET', '/dashboard/customer', { token: A.token });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.bookings.total, 5);
    assert.equal(dash.data.bookings.upcomingCount, 2);
    assert.equal(dash.data.bookings.next.code, 'BK-UP1');
  } finally {
    app.models.bookings.listByOwner = origListByOwner;
  }
});

test('S18: GET /pets/:id/medical-records pagination, authz, health-records cap 10, catalog contract', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { call } = app;

  const A = await app.registerCustomer();
  const B = await app.registerCustomer();
  const petA = await app.createPet(A.token, { name: 'Mít' });

  // Seed 12 medical records for petA
  const st = app.testHelpers.state;
  for (let i = 1; i <= 12; i++) {
    const day = String(i).padStart(2, '0');
    st.records.push({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      petId: petA.id,
      vetId: null,
      visitDate: `2026-05-${day}`,
      subjective: `S${i}`, objective: `O${i}`, assessment: `A${i}`, plan: `P${i}`
    });
  }

  // Paginated endpoint
  const r1 = await call('GET', `/pets/${petA.id}/medical-records?page=1&limit=5`, { token: A.token });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.items.length, 5);
  assert.deepEqual(r1.body.meta, { page: 1, limit: 5, total: 12, totalPages: 3 });
  assert.equal(r1.data.items[0].visitDate, '2026-05-12');

  // Authz: B cannot read A's pet medical records -> 404
  assert.equal((await call('GET', `/pets/${petA.id}/medical-records`, { token: B.token })).status, 404);

  // GET /health-records caps medicalRecords at 10 + returns medicalRecordsMeta
  const agg = await call('GET', `/health-records?petId=${petA.id}`, { token: A.token });
  assert.equal(agg.status, 200);
  assert.equal(agg.data.medicalRecords.length, 10);
  assert.deepEqual(agg.data.medicalRecordsMeta, { limit: 10, total: 12 });

  // Catalog contract unchanged (bare array, no meta)
  const provs = await call('GET', '/providers');
  assert.equal(provs.status, 200);
  assert.ok(Array.isArray(provs.data));
  assert.equal(provs.body.meta, undefined);

  const svcs = await call('GET', '/services');
  assert.equal(svcs.status, 200);
  assert.ok(Array.isArray(svcs.data));
  assert.equal(svcs.body.meta, undefined);
});
