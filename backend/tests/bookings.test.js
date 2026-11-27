'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

const SLOTS = ['08:30', '09:30', '10:30', '14:00', '15:30', '16:30', '18:00', '19:30'];

test('catalog + slots', async (t) => {
  const app = await startTestApp(); // now = 2026-06-10 10:00 (Asia/Ho_Chi_Minh)
  t.after(app.close);
  const { call } = app;

  await t.test('public catalog; inactive hidden; filters; slotCapacity not exposed', async () => {
    const p = await call('GET', '/providers');
    assert.equal(p.status, 200); assert.equal(p.data.length, 2); assert.equal(p.data[0].isSample, true);
    const all = await call('GET', '/services');
    assert.deepEqual(all.data.map((s) => s.id).sort(), ['medical-general', 'spa-combo']);
    assert.equal(all.data[0].slotCapacity, undefined);
    assert.equal(all.data.find((s) => s.id === 'spa-combo').providerName, 'Spa A');
    assert.deepEqual((await call('GET', '/services?category=medical')).data.map((s) => s.id), ['medical-general']);
    assert.deepEqual((await call('GET', '/services?providerId=spa-a')).data.map((s) => s.id), ['spa-combo']);
    assert.deepEqual((await call('GET', '/services?q=combo')).data.map((s) => s.id), ['spa-combo']);
    assert.equal((await call('GET', '/services?category=zzz')).status, 422);
    assert.equal((await call('GET', '/services/medical-general')).status, 200);
    assert.equal((await call('GET', '/services/retired')).status, 404);
  });

  await t.test('slots: fixed list; passed times today unavailable; future day all available', async () => {
    const today = await call('GET', '/services/medical-general/slots?date=2026-06-10');
    assert.deepEqual(today.data.map((s) => s.time), SLOTS);
    assert.deepEqual(today.data.map((s) => s.available), [false, false, true, true, true, true, true, true]); // now is 10:00 local: 08:30/09:30 passed, 10:30 still open
  });

  await t.test('slots: boundary follows APP_TIMEZONE, not server zone', async () => {
    // 2026-06-10T17:30Z is already 00:30 on the 11th in Vietnam.
    const a = await startTestApp({ now: '2026-06-10T17:30:00Z' });
    try {
      assert.equal((await a.call('GET', '/services/medical-general/slots?date=2026-06-10')).status, 422, '10th is already past');
      const r = await a.call('GET', '/services/medical-general/slots?date=2026-06-11');
      assert.ok(r.data.every((s) => s.available));
    } finally { await a.close(); }
  });

  await t.test('slots: past date and bad date -> 422; unknown service -> 404', async () => {
    assert.equal((await call('GET', '/services/medical-general/slots?date=2026-06-09')).status, 422);
    assert.equal((await call('GET', '/services/medical-general/slots?date=abc')).status, 422);
    assert.equal((await call('GET', '/services/medical-general/slots')).status, 422);
    assert.equal((await call('GET', '/services/nope/slots?date=2026-06-12')).status, 404);
  });
});

test('bookings', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { call } = app;
  const A = await app.registerCustomer();
  const B = await app.registerCustomer();
  const petA = await app.createPet(A.token, { name: 'Bơ' });
  const petA2 = await app.createPet(A.token, { name: 'Mít' });
  const petB = await app.createPet(B.token, { name: 'Na' });
  const book = (token, over = {}) => call('POST', '/bookings', { token, body: { petId: petA.id, serviceId: 'medical-general', date: '2026-06-12', time: '14:00', ...over } });

  await t.test('create -> 201 pending with snapshots and code', async () => {
    const r = await book(A.token, { notes: '  hay nôn  ' });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.petName, 'Bơ');
    assert.equal(r.data.serviceName, 'Khám tổng quát');
    assert.equal(r.data.providerName, 'Phòng khám A (Quận 1)');
    assert.equal(r.data.priceVnd, 250000);
    assert.equal(r.data.notes, 'hay nôn');
    assert.match(r.data.code, /^BK-[A-Z0-9]{8}$/);
    assert.equal(r.data.ownerId, undefined);
  });

  await t.test('validation: past date, invalid time, passed time today, bad ids -> 422', async () => {
    const past = await book(A.token, { date: '2026-06-09' });
    assert.equal(past.status, 422); assert.ok(past.body.errors.date);
    const badTime = await book(A.token, { time: '13:00' });
    assert.equal(badTime.status, 422); assert.ok(badTime.body.errors.time);
    const passedToday = await book(A.token, { date: '2026-06-10', time: '08:30' });
    assert.equal(passedToday.status, 422); assert.ok(passedToday.body.errors.time);
    assert.equal((await book(A.token, { date: '2026-02-30' })).status, 422);
    assert.equal((await book(A.token, { petId: 'x' })).status, 422);
    assert.equal((await book(A.token, { petId: undefined })).status, 422);
    assert.equal((await book(A.token, { notes: 'x'.repeat(501) })).status, 422);
  });

  await t.test('unknown / inactive service -> 404', async () => {
    assert.equal((await book(A.token, { serviceId: 'nope' })).status, 404);
    assert.equal((await book(A.token, { serviceId: 'retired' })).status, 404);
  });

  await t.test('same pet cannot have two live bookings at the same date+time -> 409 errors.time', async () => {
    const r = await book(A.token); // already booked 06-12 14:00 above
    assert.equal(r.status, 409); assert.equal(r.body.code, 'conflict'); assert.ok(r.body.errors.time);
    assert.match(r.body.message, /Bơ/);
    // different service, same pet, same time is still a clash
    assert.equal((await book(A.token, { serviceId: 'spa-combo' })).status, 409);
  });

  await t.test('capacity: full slot -> 409; other slot ok; slots endpoint shows unavailable', async () => {
    // medical-general capacity = 2; one live booking at 06-12 14:00 (petA); add petA2
    assert.equal((await book(A.token, { petId: petA2.id })).status, 201);
    const full = await book(B.token, { petId: petB.id });
    assert.equal(full.status, 409); assert.ok(full.body.errors.time);
    const slots = await call('GET', '/services/medical-general/slots?date=2026-06-12');
    assert.equal(slots.data.find((s) => s.time === '14:00').available, false);
    assert.equal(slots.data.find((s) => s.time === '15:30').available, true);
    assert.equal((await book(B.token, { petId: petB.id, time: '15:30' })).status, 201);
  });

  await t.test('cancel flow: pending -> cancelled frees capacity; cancel twice 409; completed 409; unknown 404', async () => {
    const list = (await call('GET', '/bookings', { token: A.token })).data.items;
    const target = list.find((b) => b.petId === petA2.id && b.time === '14:00');
    const c = await call('PATCH', `/bookings/${target.id}/cancel`, { token: A.token });
    assert.equal(c.status, 200); assert.equal(c.data.status, 'cancelled');
    const again = await call('PATCH', `/bookings/${target.id}/cancel`, { token: A.token });
    assert.equal(again.status, 409); assert.equal(again.body.code, 'conflict');
    const slots = await call('GET', '/services/medical-general/slots?date=2026-06-12');
    assert.equal(slots.data.find((s) => s.time === '14:00').available, true, 'cancelled booking frees the slot');
    // re-book the same pet/time after cancel
    assert.equal((await book(A.token, { petId: petA2.id })).status, 201);
    // completed cannot be cancelled
    const done = list.find((b) => b.petId === petA.id);
    app.testHelpers.state.bookings.find((b) => b.id === done.id).status = 'completed';
    assert.equal((await call('PATCH', `/bookings/${done.id}/cancel`, { token: A.token })).status, 409);
    assert.equal((await call('PATCH', '/bookings/33333333-3333-4333-8333-333333333333/cancel', { token: A.token })).status, 404);
  });

  await t.test('list sorted by date+time and scoped to owner', async () => {
    const res = await call('GET', '/bookings', { token: A.token });
    const a = res.data.items;
    assert.ok(res.body.meta && res.body.meta.total === a.length);
    const keys = a.map((b) => b.date + b.time);
    assert.deepEqual(keys, [...keys].sort());
    assert.ok(a.every((b) => ['Bơ', 'Mít'].includes(b.petName)));
  });
});

test('dashboard numbers come from rows', async (t) => {
  const app = await startTestApp(); // now 2026-06-10 10:00 local
  t.after(app.close);
  const { call } = app;
  const { token } = await app.registerCustomer();

  await t.test('brand-new account: all zeros / null', async () => {
    const r = await call('GET', '/dashboard/customer', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, {
      petCount: 0,
      bookings: { total: 0, upcomingCount: 0, next: null },
      vaccines: { dueSoonCount: 0, overdueCount: 0, nextDue: null }
    });
  });

  await t.test('counts upcoming (not cancelled, >= now in APP_TIMEZONE) and vaccines across pets', async () => {
    const a = await app.createPet(token, { name: 'A' });
    const b = await app.createPet(token, { name: 'B' });
    const mk = (petId, date, time) => call('POST', '/bookings', { token, body: { petId, serviceId: 'spa-combo', date, time } });
    const later = (await mk(a.id, '2026-06-15', '09:30')).data;
    const sooner = (await mk(a.id, '2026-06-10', '14:00')).data;
    const cancelled = (await mk(b.id, '2026-06-11', '09:30')).data;
    await call('PATCH', `/bookings/${cancelled.id}/cancel`, { token });
    // a booking earlier today that has already passed (inserted directly; the API would refuse it)
    app.testHelpers.state.bookings.push({ ...later, id: '44444444-4444-4444-8444-444444444444', code: 'BK-PASTPAST', date: '2026-06-10', time: '08:30', ownerId: app.testHelpers.state.pets.find((p) => p.id === a.id).ownerId, petId: null, status: 'confirmed' });
    const vacc = (petId, body) => call('POST', `/pets/${petId}/vaccinations`, { token, body });
    await vacc(a.id, { vaccineName: 'Dại', administeredOn: '2025-06-01', nextDueOn: '2026-06-01' }); // overdue
    await vacc(b.id, { vaccineName: 'Dại', administeredOn: '2025-06-20', nextDueOn: '2026-06-25' }); // due soon
    await vacc(b.id, { vaccineName: '7 bệnh', administeredOn: '2026-01-01', nextDueOn: '2027-01-01' }); // ok
    const r = (await call('GET', '/dashboard/customer', { token })).data;
    assert.equal(r.petCount, 2);
    assert.equal(r.bookings.total, 4);
    assert.equal(r.bookings.upcomingCount, 2);
    assert.equal(r.bookings.next.id, sooner.id);
    assert.deepEqual(r.vaccines, {
      dueSoonCount: 1, overdueCount: 1,
      nextDue: { petId: a.id, petName: 'A', vaccineName: 'Dại', dueOn: '2026-06-01' }
    });
  });
});
