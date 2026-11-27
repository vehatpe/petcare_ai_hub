'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

test('pets CRUD', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { call } = app;
  const { token } = await app.registerCustomer();

  await t.test('requires customer token', async () => {
    assert.equal((await call('GET', '/pets')).status, 401);
    const vet = await app.loginStaff('vet');
    assert.equal((await call('GET', '/pets', { token: vet.token })).status, 403);
  });

  await t.test('create without weight -> weightKg null, no metric row', async () => {
    const r = await call('POST', '/pets', { token, body: app.validPet() });
    assert.equal(r.status, 201);
    assert.equal(r.data.weightKg, null);
    assert.equal(r.data.photo, null);
    assert.equal(r.data.neutered, 'unknown');
    assert.equal(app.testHelpers.state.metrics.length, 0);
    assert.equal(r.data.ownerId, undefined);
  });

  await t.test('create with weight creates a Health_Metrics row dated today (APP_TIMEZONE)', async () => {
    const r = await call('POST', '/pets', { token, body: app.validPet({ name: 'Mực', weightKg: '11,5' }) });
    assert.equal(r.status, 201);
    assert.equal(r.data.weightKg, 11.5);
    const m = app.testHelpers.state.metrics.filter((x) => x.petId === r.data.id);
    assert.equal(m.length, 1);
    assert.equal(m[0].measuredOn, '2026-06-10');
  });

  await t.test('validation errors use the prototype messages', async () => {
    const r = await call('POST', '/pets', { token, body: { name: '', species: 'dragon', sex: 'x', birthDate: '2999-01-01', weightKg: 500, microchip: '123', conditions: 'a'.repeat(501) } });
    assert.equal(r.status, 422);
    assert.equal(r.body.errors.name, 'Vui lòng nhập tên của bé.');
    assert.equal(r.body.errors.species, 'Vui lòng chọn loài.');
    assert.equal(r.body.errors.sex, 'Vui lòng chọn giới tính.');
    assert.equal(r.body.errors.birthDate, 'Ngày sinh không thể ở tương lai.');
    assert.equal(r.body.errors.weightKg, 'Cân nặng cần trong khoảng 0,005 – 150 kg.');
    assert.equal(r.body.errors.microchip, 'Mã microchip gồm đúng 15 chữ số.');
    assert.equal(r.body.errors.conditions, 'Ghi chú sức khỏe tối đa 500 ký tự.');
    const old = await call('POST', '/pets', { token, body: app.validPet({ birthDate: '1990-01-01' }) });
    assert.equal(old.body.errors.birthDate, 'Ngày sinh quá xa, vui lòng kiểm tra lại.');
    const long = await call('POST', '/pets', { token, body: app.validPet({ name: 'x'.repeat(41) }) });
    assert.equal(long.body.errors.name, 'Tên tối đa 40 ký tự.');
  });

  await t.test('photo: accepts small data URL, rejects > 400KB and non-image', async () => {
    const small = 'data:image/png;base64,' + 'A'.repeat(1000);
    const ok = await call('POST', '/pets', { token, body: app.validPet({ name: 'Ảnh', photo: small }) });
    assert.equal(ok.status, 201); assert.equal(ok.data.photo, small);
    const big = await call('POST', '/pets', { token, body: app.validPet({ photo: 'data:image/png;base64,' + 'A'.repeat(420 * 1024) }) });
    assert.equal(big.status, 422); assert.match(big.body.errors.photo, /400 KB/);
    const bad = await call('POST', '/pets', { token, body: app.validPet({ photo: 'http://evil/x.png' }) });
    assert.equal(bad.status, 422);
    const huge = await call('POST', '/pets', { token, body: app.validPet({ photo: 'data:image/png;base64,' + 'A'.repeat(700 * 1024) }) });
    assert.equal(huge.status, 413);
  });

  await t.test('PUT: weight change adds a metric, same weight does not; absent photo keeps photo', async () => {
    const pet = await app.createPet(token, { name: 'Sữa', weightKg: 5, photo: 'data:image/png;base64,QUJD' });
    const count = () => app.testHelpers.state.metrics.filter((m) => m.petId === pet.id).length;
    assert.equal(count(), 1);
    const same = await call('PUT', `/pets/${pet.id}`, { token, body: app.validPet({ name: 'Sữa 2', weightKg: 5 }) });
    assert.equal(same.status, 200); assert.equal(same.data.name, 'Sữa 2'); assert.equal(same.data.photo, 'data:image/png;base64,QUJD');
    assert.equal(count(), 1);
    const heavier = await call('PUT', `/pets/${pet.id}`, { token, body: app.validPet({ weightKg: 5.6 }) });
    assert.equal(heavier.data.weightKg, 5.6);
    assert.equal(count(), 2);
    const cleared = await call('PUT', `/pets/${pet.id}`, { token, body: app.validPet({ weightKg: 5.6, photo: null }) });
    assert.equal(cleared.data.photo, null);
  });

  await t.test('GET one / list ordered old -> new / DELETE removes pet and children, keeps bookings', async () => {
    const t2 = (await app.registerCustomer()).token;
    const a = await app.createPet(t2, { name: 'A', weightKg: 3 });
    const b = await app.createPet(t2, { name: 'B' });
    const list = await call('GET', '/pets', { token: t2 });
    assert.deepEqual(list.data.map((p) => p.name), ['A', 'B']);
    assert.equal((await call('GET', `/pets/${a.id}`, { token: t2 })).data.name, 'A');
    await call('POST', `/pets/${a.id}/vaccinations`, { token: t2, body: { vaccineName: 'Dại', administeredOn: '2026-01-01' } });
    const bk = await call('POST', '/bookings', { token: t2, body: { petId: a.id, serviceId: 'medical-general', date: '2026-06-12', time: '14:00' } });
    assert.equal(bk.status, 201);
    const del = await call('DELETE', `/pets/${a.id}`, { token: t2 });
    assert.equal(del.status, 200); assert.deepEqual(del.data, { deleted: true });
    const st = app.testHelpers.state;
    assert.equal(st.metrics.filter((m) => m.petId === a.id).length, 0);
    assert.equal(st.vaccs.filter((v) => v.petId === a.id).length, 0);
    const bookings = await call('GET', '/bookings', { token: t2 });
    assert.equal(bookings.data.items.length, 1);
    assert.equal(bookings.data.items[0].petName, 'A'); assert.equal(bookings.data.items[0].petId, null);
    assert.equal((await call('GET', `/pets/${a.id}`, { token: t2 })).status, 404);
    assert.equal((await call('GET', `/pets/${b.id}`, { token: t2 })).status, 200);
  });

  await t.test('non-GUID id -> 404', async () => {
    assert.equal((await call('GET', '/pets/not-a-guid', { token })).status, 404);
  });

  await t.test('10-pet limit -> 409 conflict, per owner', async () => {
    const t3 = (await app.registerCustomer()).token;
    for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/pets', { token: t3, body: app.validPet({ name: 'P' + i }) })).status, 201);
    const r = await call('POST', '/pets', { token: t3, body: app.validPet() });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'conflict');
    const other = (await app.registerCustomer()).token;
    assert.equal((await call('POST', '/pets', { token: other, body: app.validPet() })).status, 201);
  });
});

test('authorization: user B cannot touch user A rows (404)', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { call } = app;
  const A = await app.registerCustomer();
  const B = await app.registerCustomer();
  const pet = await app.createPet(A.token, { weightKg: 4 });
  const w = (await call('POST', `/pets/${pet.id}/weights`, { token: A.token, body: { weightKg: 4.2 } })).data;
  const v = (await call('POST', `/pets/${pet.id}/vaccinations`, { token: A.token, body: { vaccineName: 'Dại', administeredOn: '2026-01-01' } })).data;
  const bk = (await call('POST', '/bookings', { token: A.token, body: { petId: pet.id, serviceId: 'medical-general', date: '2026-06-12', time: '14:00' } })).data;
  const tk = B.token;

  const attempts = [
    ['GET', `/pets/${pet.id}`], ['PUT', `/pets/${pet.id}`, app.validPet()], ['DELETE', `/pets/${pet.id}`],
    ['GET', `/health-records?petId=${pet.id}`],
    ['POST', `/pets/${pet.id}/weights`, { weightKg: 9 }], ['DELETE', `/pets/${pet.id}/weights/${w.id}`],
    ['POST', `/pets/${pet.id}/vaccinations`, { vaccineName: 'X', administeredOn: '2026-01-01' }],
    ['DELETE', `/pets/${pet.id}/vaccinations/${v.id}`],
    ['PATCH', `/bookings/${bk.id}/cancel`],
    ['POST', '/bookings', { petId: pet.id, serviceId: 'medical-general', date: '2026-06-13', time: '14:00' }],
    ['POST', '/ai/chat', { message: 'xin chào', petId: pet.id }]
  ];
  for (const [m, p, body] of attempts) {
    const r = await call(m, p, { token: tk, body });
    assert.equal(r.status, 404, `${m} ${p} -> ${r.status}`);
  }
  assert.deepEqual((await call('GET', '/pets', { token: tk })).data, []);
  assert.deepEqual((await call('GET', '/bookings', { token: tk })).data.items, []);
  // A's data is untouched
  assert.equal((await call('GET', `/pets/${pet.id}`, { token: A.token })).status, 200);
  assert.equal((await call('GET', '/bookings', { token: A.token })).data.items[0].status, 'pending');
  assert.equal((await call('GET', `/health-records?petId=${pet.id}`, { token: A.token })).data.weights.length, 2);
  // customers cannot write medical records; unauthenticated cannot either
  const mr = { visitDate: '2026-06-01', subjective: 's', objective: 'o', assessment: 'a', plan: 'p' };
  assert.equal((await call('POST', `/pets/${pet.id}/medical-records`, { token: A.token, body: mr })).status, 403);
  assert.equal((await call('POST', `/pets/${pet.id}/medical-records`, { body: mr })).status, 401);
});
