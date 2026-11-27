'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');

test('Vet Bookings API: access control, detail audit, medical record & vaccination', async (t) => {
  const app = await startTestApp({ now: '2026-06-15T03:00:00.000Z' }); // 10:00 VN
  t.after(app.close);
  const { call } = app;
  const { state } = app.testHelpers;

  if (!state.providers.find((p) => p.id === 'clinic-vet')) {
    state.providers.push({ id: 'clinic-vet', name: 'Phòng khám VetTest', area: 'Q1', isSample: false, isActive: true });
  }
  const svcId = crypto.randomUUID();
  state.services.push({
    id: svcId, providerId: 'clinic-vet', category: 'medical', name: 'Khám tổng quát', priceVnd: 200000, slotCapacity: 3, isActive: true
  });

  const { token: custToken } = await app.registerCustomer({ email: 'cust@vettest.vn', phone: '0909111000' });
  const pet = await app.createPet(custToken, { name: 'Milu', species: 'dog', photo: 'data:image/png;base64,AAAA' });

  let seq = 1;
  const pwHash = bcrypt.hashSync('matkhau123', 4);
  async function makeUser({ role, providerId = null, fullName }) {
    const idx = seq++;
    const id = crypto.randomUUID();
    const email = `vettest${idx}@clinic.vn`;
    await app.testHelpers.addStaff(role, {
      id, email, phone: `09770000${String(idx).padStart(2, '0')}`, fullName, status: 'active', providerId, passwordHash: pwHash
    });
    const u = state.users.find((x) => x.id === id);
    if (u) { u.providerId = providerId; u.status = 'active'; }
    const loginRes = await call('POST', '/auth/login', { body: { identifier: email, password: 'matkhau123' } });
    return { token: loginRes.data.token, user: loginRes.data.user };
  }

  const prov = await makeUser({ role: 'provider', providerId: 'clinic-vet', fullName: 'Chủ Cơ Sở' });
  const vet1 = await makeUser({ role: 'vet', providerId: 'clinic-vet', fullName: 'BS Một' });
  const vet2 = await makeUser({ role: 'vet', providerId: 'clinic-vet', fullName: 'BS Hai' });
  const admin = await makeUser({ role: 'admin', fullName: 'Admin Test' });

  // Customer tạo 2 lịch: b1 (confirmed), b3 (pending)
  const b1Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-16', time: '08:30' } });
  const b3Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-17', time: '08:30' } });
  assert.equal(b1Res.status, 201, JSON.stringify(b1Res.body));
  assert.equal(b3Res.status, 201);
  const b1 = b1Res.data;
  const b3 = b3Res.data;

  // Provider xác nhận b1 và gán vet1; b3 giữ pending nhưng gán vet1
  assert.equal((await call('PATCH', `/bookings/${b1.id}/confirm`, { token: prov.token })).status, 200);
  assert.equal((await call('PATCH', `/bookings/${b1.id}/vet`, { token: prov.token, body: { vetId: vet1.user.id } })).status, 200);
  assert.equal((await call('PATCH', `/bookings/${b3.id}/vet`, { token: prov.token, body: { vetId: vet1.user.id } })).status, 200);

  await t.test('access control: customer/provider/admin -> 403; other vet -> 404', async () => {
    for (const tk of [custToken, prov.token, admin.token]) {
      assert.equal((await call('GET', '/vet/bookings', { token: tk })).status, 403);
      assert.equal((await call('GET', `/vet/bookings/${b1.id}`, { token: tk })).status, 403);
      assert.equal((await call('POST', `/vet/bookings/${b1.id}/medical-record`, { token: tk, body: {} })).status, 403);
      assert.equal((await call('POST', `/vet/bookings/${b1.id}/vaccinations`, { token: tk, body: {} })).status, 403);
    }
    // Vet2 cùng cơ sở nhưng không được gán -> 404
    assert.equal((await call('GET', `/vet/bookings/${b1.id}`, { token: vet2.token })).status, 404);
    assert.equal((await call('POST', `/vet/bookings/${b1.id}/medical-record`, {
      token: vet2.token,
      body: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' }
    })).status, 404);
  });

  await t.test('GET /vet/bookings & GET /vet/bookings/:id: no photo, no customer phone/email, writes 1 AuditLog', async () => {
    const listRes = await call('GET', '/vet/bookings', { token: vet1.token });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.items.length, 2);
    assert.equal(listRes.body.meta.total, 2);
    assert.equal(listRes.data.items[0].customerPhone, undefined);
    assert.equal(listRes.data.items[0].customerEmail, undefined);

    const detailRes = await call('GET', `/vet/bookings/${b1.id}`, { token: vet1.token });
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.petDeleted, false);
    assert.equal(detailRes.data.pet.id, pet.id);
    assert.equal(detailRes.data.pet.photo, undefined);
  });

  await t.test('medical-record & vaccinations: pending -> 409; confirmed/completed -> 201; duplicate -> 409; server overrides visitDate/providerName', async () => {
    const mrBody = { visitDate: '2020-01-01', subjective: 'Ho', objective: 'Sốt', assessment: 'Viêm họng', plan: 'Thuốc 5 ngày' };
    // pending -> 409
    assert.equal((await call('POST', `/vet/bookings/${b3.id}/medical-record`, { token: vet1.token, body: mrBody })).status, 409);

    // confirmed -> 201, visitDate lấy từ booking (2026-06-16), bỏ qua 2020-01-01
    const r1 = await call('POST', `/vet/bookings/${b1.id}/medical-record`, { token: vet1.token, body: mrBody });
    assert.equal(r1.status, 201);
    assert.equal(r1.data.visitDate, '2026-06-16');

    // lần 2 -> 409 already_recorded
    const rDup = await call('POST', `/vet/bookings/${b1.id}/medical-record`, { token: vet1.token, body: mrBody });
    assert.equal(rDup.status, 409);
    assert.equal(rDup.body.code, 'already_recorded');

    // vaccination: source='clinic', providerName lấy từ DB
    const vRes = await call('POST', `/vet/bookings/${b1.id}/vaccinations`, {
      token: vet1.token,
      body: { vaccineName: 'Rabies', administeredOn: '2026-06-15', providerName: 'Fake Clinic' }
    });
    assert.equal(vRes.status, 201);
    assert.equal(vRes.data.source, 'clinic');
    assert.notEqual(vRes.data.providerName, 'Fake Clinic');

    // Customer thấy cả bệnh án và mũi tiêm; không xóa được mũi clinic
    const healthRes = await call('GET', `/health-records?petId=${pet.id}`, { token: custToken });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.data.medicalRecords.length, 1);
    assert.equal(healthRes.data.vaccinations.length, 1);
    const delVacc = await call('DELETE', `/pets/${pet.id}/vaccinations/${vRes.data.id}`, { token: custToken });
    assert.equal(delVacc.status, 409);
  });

  await t.test('deleted pet: GET detail returns petDeleted=true, POST medical-record returns 409', async () => {
    await call('DELETE', `/pets/${pet.id}`, { token: custToken });
    const detailRes = await call('GET', `/vet/bookings/${b3.id}`, { token: vet1.token });
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.petDeleted, true);
    assert.equal(detailRes.data.pet, null);

    const mrRes = await call('POST', `/vet/bookings/${b1.id}/medical-record`, {
      token: vet1.token,
      body: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' }
    });
    // b2 đã có bệnh án hoặc petDeleted -> đều 409
    assert.equal(mrRes.status, 409);
  });

  await t.test('audit failure rolls back medical-record transaction', async () => {
    const pet2 = await app.createPet(custToken, { name: 'Lu', species: 'dog' });
    const b4Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet2.id, serviceId: svcId, date: '2026-06-18', time: '08:30' } });
    assert.equal(b4Res.status, 201);
    const b4 = b4Res.data;
    assert.equal((await call('PATCH', `/bookings/${b4.id}/confirm`, { token: prov.token })).status, 200);
    assert.equal((await call('PATCH', `/bookings/${b4.id}/vet`, { token: prov.token, body: { vetId: vet1.user.id } })).status, 200);

    const origLog = app.models.audit.log;
    app.models.audit.log = async () => { throw new Error('audit_boom'); };
    try {
      const res = await call('POST', `/vet/bookings/${b4.id}/medical-record`, {
        token: vet1.token,
        body: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' }
      });
      assert.equal(res.status, 500);
      assert.equal(state.records.some((r) => r.bookingId === b4.id), false);
    } finally {
      app.models.audit.log = origLog;
    }
  });
});
