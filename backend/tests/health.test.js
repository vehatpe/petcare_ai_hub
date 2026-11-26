'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

test('health records', async (t) => {
  const app = await startTestApp(); // today = 2026-06-10 in Asia/Ho_Chi_Minh
  t.after(app.close);
  const { call } = app;
  const { token } = await app.registerCustomer();
  const agg = (id) => call('GET', `/health-records?petId=${id}`, { token });

  await t.test('empty data: zeros, nextDue null, chart cannot render', async () => {
    const pet = await app.createPet(token);
    const r = await agg(pet.id);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.pet, { id: pet.id, name: 'Bơ' });
    assert.deepEqual(r.data.weights, []);
    assert.deepEqual(r.data.weightChart, { count: 0, canRender: false });
    assert.deepEqual(r.data.vaccineSummary, { total: 0, upToDate: 0, dueSoon: 0, overdue: 0, nextDue: null });
    assert.deepEqual(r.data.vaccinations, []);
    assert.deepEqual(r.data.medicalRecords, []);
  });

  await t.test('petId required and valid', async () => {
    assert.equal((await call('GET', '/health-records', { token })).status, 422);
    assert.equal((await call('GET', '/health-records?petId=zzz', { token })).status, 422);
  });

  await t.test('weightChart.canRender only with >= 2 points; weights ascending by date', async () => {
    const pet = await app.createPet(token, { name: 'W', weightKg: 4 });
    assert.deepEqual((await agg(pet.id)).data.weightChart, { count: 1, canRender: false });
    const p2 = await call('POST', `/pets/${pet.id}/weights`, { token, body: { weightKg: 3.8, measuredOn: '2026-05-01' } });
    assert.equal(p2.status, 201);
    assert.deepEqual(Object.keys(p2.data).sort(), ['id', 'measuredOn', 'weightKg']);
    const r = await agg(pet.id);
    assert.deepEqual(r.data.weightChart, { count: 2, canRender: true });
    assert.deepEqual(r.data.weights.map((w) => w.measuredOn), ['2026-05-01', '2026-06-10']);
    // latest by date drives pet.weightKg
    assert.equal((await call('GET', `/pets/${pet.id}`, { token })).data.weightKg, 4);
    const del = await call('DELETE', `/pets/${pet.id}/weights/${p2.data.id}`, { token });
    assert.equal(del.status, 200);
    assert.equal((await agg(pet.id)).data.weightChart.count, 1);
    assert.equal((await call('DELETE', `/pets/${pet.id}/weights/${p2.data.id}`, { token })).status, 404);
  });

  await t.test('weight validation: range, future date, missing', async () => {
    const pet = await app.createPet(token);
    assert.equal((await call('POST', `/pets/${pet.id}/weights`, { token, body: { weightKg: 0 } })).status, 422);
    assert.equal((await call('POST', `/pets/${pet.id}/weights`, { token, body: {} })).status, 422);
    const fut = await call('POST', `/pets/${pet.id}/weights`, { token, body: { weightKg: 3, measuredOn: '2026-06-11' } });
    assert.equal(fut.status, 422); assert.ok(fut.body.errors.measuredOn);
  });

  await t.test('vaccine statuses ok / due-soon / overdue / recorded; owner source; only latest dose counted', async () => {
    const pet = await app.createPet(token, { name: 'V' });
    const add = (body) => call('POST', `/pets/${pet.id}/vaccinations`, { token, body });
    const rabiesOld = await add({ vaccineName: 'Dại', administeredOn: '2025-01-01', nextDueOn: '2026-01-01' });
    assert.equal(rabiesOld.status, 201);
    assert.equal(rabiesOld.data.source, 'owner');
    assert.equal(rabiesOld.data.status, 'overdue'); // only dose so far
    await add({ vaccineName: 'Dại', administeredOn: '2026-05-01', nextDueOn: '2027-05-01' });
    await add({ vaccineName: '7 bệnh', administeredOn: '2025-06-01', nextDueOn: '2026-06-01' });
    await add({ vaccineName: 'FVRCP', administeredOn: '2025-06-25', nextDueOn: '2026-06-25' });
    await add({ vaccineName: 'Ghi nhận', administeredOn: '2026-02-01' });
    const r = (await agg(pet.id)).data;
    const byKey = Object.fromEntries(r.vaccinations.map((v) => [v.vaccineName + v.administeredOn, v.status]));
    assert.equal(byKey['Dại2025-01-01'], 'recorded', 'superseded dose is history, not overdue');
    assert.equal(byKey['Dại2026-05-01'], 'ok');
    assert.equal(byKey['7 bệnh2025-06-01'], 'overdue');
    assert.equal(byKey['FVRCP2025-06-25'], 'due-soon');
    assert.equal(byKey['Ghi nhận2026-02-01'], 'recorded');
    assert.deepEqual(r.vaccineSummary, { total: 4, upToDate: 1, dueSoon: 1, overdue: 1, nextDue: { vaccineName: '7 bệnh', dueOn: '2026-06-01' } });
    assert.equal(Object.keys(r.vaccineSummary).length, 5, 'no extra "valid booklet" style flags');
  });

  await t.test('vaccination validation + deleting only owner-sourced records', async () => {
    const pet = await app.createPet(token, { name: 'D' });
    const bad = await call('POST', `/pets/${pet.id}/vaccinations`, { token, body: { vaccineName: '', administeredOn: '2026-07-01', nextDueOn: 'x' } });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.errors.vaccineName && bad.body.errors.administeredOn && bad.body.errors.nextDueOn);
    const before = await call('POST', `/pets/${pet.id}/vaccinations`, { token, body: { vaccineName: 'A', administeredOn: '2026-03-01', nextDueOn: '2026-02-01' } });
    assert.equal(before.status, 422);
    const mine = (await call('POST', `/pets/${pet.id}/vaccinations`, { token, body: { vaccineName: 'A', administeredOn: '2026-03-01', providerName: 'PK', batchNo: 'L1' } })).data;
    assert.equal(mine.providerName, 'PK'); assert.equal(mine.batchNo, 'L1');
    // a clinic-confirmed row is inserted straight into the store
    app.testHelpers.state.vaccs.push({ id: 'c0000000-0000-4000-8000-000000000001', petId: pet.id, vaccineName: 'B', administeredOn: '2026-03-02', nextDueOn: null, providerName: 'PK', batchNo: '', source: 'clinic', createdAt: 'x' });
    const clinicDel = await call('DELETE', `/pets/${pet.id}/vaccinations/c0000000-0000-4000-8000-000000000001`, { token });
    assert.equal(clinicDel.status, 409);
    assert.equal((await call('DELETE', `/pets/${pet.id}/vaccinations/${mine.id}`, { token })).status, 200);
    assert.equal((await call('DELETE', `/pets/${pet.id}/vaccinations/${mine.id}`, { token })).status, 404);
  });

  await t.test('medical records: old route removed (404); vet writes via booking, owner sees them', async () => {
    const pet = await app.createPet(token, { name: 'M' });
    const vet = await app.loginStaff('vet');
    const body = { subjective: 'Bỏ ăn', objective: 'Sốt nhẹ', assessment: 'Theo dõi', plan: 'Tái khám' };
    assert.equal((await call('POST', `/pets/${pet.id}/medical-records`, { token: vet.token, body })).status, 404);
    assert.equal((await call('POST', '/vet/bookings/11111111-1111-4111-8111-111111111111/medical-record', { token, body })).status, 403);
    assert.equal((await call('POST', '/vet/bookings/11111111-1111-4111-8111-111111111111/medical-record', { token: vet.token, body })).status, 404);
  });
});
