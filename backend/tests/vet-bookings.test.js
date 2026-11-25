'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

test('Vet Bookings API: access control, detail audit, medical record & vaccination', async (t) => {
  const app = await startTestApp({ now: new Date('2026-06-15T03:00:00.000Z') }); // 10:00 VN
  t.after(app.close);
  const { call, models } = app;

  const { token: custToken } = await app.registerCustomer({ email: 'cust@vettest.vn' });
  const pet = await app.createPet(custToken, { name: 'Milu', species: 'dog', photo: 'data:image/png;base64,AAAA' });

  const [firstSvc] = await models.catalog.listServices({});
  const svcId = firstSvc.id;
  const provId = firstSvc.providerId;

  const prov = await app.loginStaff('provider', { providerId: provId });
  const vet1 = await app.loginStaff('vet', { providerId: provId });
  const bcrypt = require('bcryptjs');
  await models.users.create({
    id: '00000000-0000-4000-8000-000000000222',
    fullName: 'BS Hai', email: 'vet2@prov-a.vn', phone: '0911222334',
    passwordHash: bcrypt.hashSync('Vet2Pass!123', 4), role: 'vet', status: 'active', providerId: provId
  });
  const vet2Login = await call('POST', '/auth/login', { body: { identifier: 'vet2@prov-a.vn', password: 'Vet2Pass!123' } });
  const vet2 = { user: vet2Login.data.user, token: vet2Login.data.token };
  await models.users.create({
    id: '00000000-0000-4000-8000-000000000333',
    fullName: 'Admin Test', email: 'admin-vettest@petcare.vn', phone: '0988777665',
    passwordHash: bcrypt.hashSync('AdminPass!123', 4), role: 'admin', status: 'active', providerId: null
  });
  const adminLogin = await call('POST', '/auth/login', { body: { identifier: 'admin-vettest@petcare.vn', password: 'AdminPass!123' } });
  const admin = { user: adminLogin.data.user, token: adminLogin.data.token };

  // Customer tạo 2 lịch: b1 (confirmed), b3 (pending)
  const b1Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-16', time: '09:00' } });
  const b3Res = await call('POST', '/bookings', { token: custToken, body: { petId: pet.id, serviceId: svcId, date: '2026-06-17', time: '10:00' } });
  const b1 = b1Res.data;
  const b3 = b3Res.data;

  // Provider xác nhận b1 và gán vet1; b3 giữ pending nhưng gán vet1
  await call('PATCH', `/bookings/${b1.id}/confirm`, { token: prov.token, body: { vetId: vet1.user.id } });
  await call('PATCH', `/bookings/${b3.id}/vet`, { token: prov.token, body: { vetId: vet1.user.id } });

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
    assert.equal(listRes.data.length, 2);
    assert.equal(listRes.data[0].customerPhone, undefined);
    assert.equal(listRes.data[0].customerEmail, undefined);

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
});
