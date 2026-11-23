'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');
const { validateRegister, parseLegalInfo } = require('../src/utils/validators');

test('S9: Provider Profile and Legal Info (Unit / DB giả)', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  // 1. Test validators parseLegalInfo & validateRegister
  await t.test('validators: licenseNo and taxCode boundary checks', () => {
    // Empty / missing -> null
    const err1 = {};
    const res1 = parseLegalInfo({ licenseNo: '', taxCode: '   ' }, err1);
    assert.equal(res1.licenseNo, null);
    assert.equal(res1.taxCode, null);
    assert.equal(Object.keys(err1).length, 0);

    // Too long licenseNo (> 50)
    const err2 = {};
    parseLegalInfo({ licenseNo: 'A'.repeat(51) }, err2);
    assert.match(err2.licenseNo, /50 ký tự/);

    // Invalid characters in licenseNo
    const err3 = {};
    parseLegalInfo({ licenseNo: 'GP-1234@#$' }, err3);
    assert.match(err3.licenseNo, /chữ, số, khoảng trắng/);

    // Valid licenseNo with / - . and space
    const err4 = {};
    const res4 = parseLegalInfo({ licenseNo: '  GP-123/HCM.01  ' }, err4);
    assert.equal(res4.licenseNo, 'GP-123/HCM.01');
    assert.equal(Object.keys(err4).length, 0);

    // TaxCode length boundaries: 9, 10, 11, 12, 13, 14 digits
    for (const len of [9, 11, 12, 14]) {
      const errTax = {};
      parseLegalInfo({ taxCode: '1'.repeat(len) }, errTax);
      assert.match(errTax.taxCode, /10 hoặc 13 chữ số/);
    }
    for (const len of [10, 13]) {
      const errTax = {};
      const resTax = parseLegalInfo({ taxCode: `  0123-456-${'7'.repeat(len - 7)}  ` }, errTax);
      assert.equal(Object.keys(errTax).length, 0);
      assert.equal(resTax.taxCode.length, len);
    }

    // Role customer with legal info -> 422 errors
    const regCust = validateRegister({
      role: 'customer',
      fullName: 'Khách Hàng',
      email: 'cust@test.vn',
      phone: '0912345678',
      password: 'Password123',
      licenseNo: 'GP-123',
      taxCode: '0123456789'
    });
    assert.ok(regCust.errors.licenseNo);
    assert.ok(regCust.errors.taxCode);
  });

  // 2. Setup admin & provider
  const adminId = crypto.randomUUID();
  await app.testHelpers.addStaff('admin', {
    id: adminId,
    email: 'admin_s9@petcare.vn',
    phone: '0988111222',
    fullName: 'Quản Trị S9',
    passwordHash: bcrypt.hashSync('AdminPass123!', 4)
  });
  const resAdmin = await app.call('POST', '/auth/login', {
    body: { identifier: 'admin_s9@petcare.vn', password: 'AdminPass123!' }
  });
  const adminToken = resAdmin.data.token;

  let providerToken;
  let providerUser;
  let providerId;

  await t.test('register provider with optional legal info', async () => {
    const regRes = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Phòng Khám S9',
        email: 'provider_s9@clinic.vn',
        phone: '0912999888',
        password: 'Password123!',
        orgName: 'Phòng Khám PetCare S9',
        orgType: 'clinic',
        orgArea: 'Quận 1, TP.HCM',
        licenseNo: 'GPHN-S9/2026',
        taxCode: '0312-345-678'
      }
    });
    assert.equal(regRes.status, 201);
    assert.equal(regRes.data.user.status, 'pending');
    // Public user must not leak licenseNo, taxCode
    assert.equal(regRes.data.user.licenseNo, undefined);
    assert.equal(regRes.data.user.taxCode, undefined);
    providerUser = regRes.data.user;

    // Check admin listUsers returns legal info and hasLegalInfo=true
    const listRes = await app.call('GET', '/admin/users?role=provider', {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(listRes.status, 200);
    const u = listRes.data.users.find((x) => x.id === providerUser.id);
    assert.ok(u);
    assert.equal(u.licenseNo, 'GPHN-S9/2026');
    assert.equal(u.taxCode, '0312345678');
    assert.equal(u.hasLegalInfo, true);
  });

  await t.test('approve provider copies legal info to Providers and does not block when missing', async () => {
    // Approve providerUser
    const appRes = await app.call('POST', `/admin/users/${providerUser.id}/approve`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(appRes.status, 200);
    providerId = appRes.data.providerId;
    assert.ok(providerId);

    // Đăng nhập provider
    const loginRes = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider_s9@clinic.vn', password: 'Password123!' }
    });
    assert.equal(loginRes.status, 200);
    providerToken = loginRes.data.token;

    // Đăng ký 1 provider khác KHÔNG có legal info -> approve thành công
    const regRes2 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Spa Không Giấy Tờ',
        email: 'spa_no_legal@petcare.vn',
        phone: '0912777666',
        password: 'Password123!',
        orgName: 'Pet Spa S9',
        orgType: 'spa',
        orgArea: 'Quận 3, TP.HCM'
      }
    });
    assert.equal(regRes2.status, 201);
    const appRes2 = await app.call('POST', `/admin/users/${regRes2.data.user.id}/approve`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(appRes2.status, 200);
  });

  await t.test('access control on GET and PUT /provider/profile', async () => {
    // 401 unauthenticated
    const resUnauth = await app.call('GET', '/provider/profile');
    assert.equal(resUnauth.status, 401);

    // 403 customer
    const regCust = await app.call('POST', '/auth/register', {
      body: {
        role: 'customer',
        fullName: 'Khách Hàng Test',
        email: 'customer_test@petcare.vn',
        phone: '0912111000',
        password: 'Password123!'
      }
    });
    const custToken = regCust.data.token;
    const resCust = await app.call('GET', '/provider/profile', {
      headers: { authorization: `Bearer ${custToken}` }
    });
    assert.equal(resCust.status, 403);

    // 403 admin (chỉ provider mới quản lý profile cơ sở của mình)
    const resAdm = await app.call('GET', '/provider/profile', {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(resAdm.status, 403);
  });

  await t.test('GET /provider/profile returns correct fields and Cache-Control: no-store', async () => {
    const res = await app.call('GET', '/provider/profile', {
      headers: { authorization: `Bearer ${providerToken}` }
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.equal(res.data.id, providerId);
    assert.equal(res.data.name, 'Phòng Khám PetCare S9');
    assert.equal(res.data.area, 'Quận 1, TP.HCM');
    assert.equal(res.data.type, 'clinic');
    assert.equal(res.data.licenseNo, 'GPHN-S9/2026');
    assert.equal(res.data.taxCode, '0312345678');
    assert.equal(res.data.isActive, true);
    assert.equal(res.data.isSample, false);
  });

  await t.test('PUT /provider/profile updates address, phone, desc, keeps absent, clears on null/empty', async () => {
    // 422 if client tries to update name, area, or type
    const resBad = await app.call('PUT', '/provider/profile', {
      headers: { authorization: `Bearer ${providerToken}` },
      body: { name: 'Tên Cơ Sở Mới', address: '123 Nguyễn Thị Minh Khai' }
    });
    assert.equal(resBad.status, 422);
    assert.match(resBad.message || '', /Tên, khu vực và loại hình cơ sở do quản trị viên quản lý/);

    // Successful update
    const resOk = await app.call('PUT', '/provider/profile', {
      headers: { authorization: `Bearer ${providerToken}` },
      body: {
        address: '123 Nguyễn Thị Minh Khai, P. Bến Thành, Q.1',
        phone: '0909 111 222',
        description: 'Phòng khám thú y hiện đại, tận tâm.'
      }
    });
    if (resOk.status !== 200) console.error('resOk error:', resOk.body);
    assert.equal(resOk.status, 200);
    assert.match(resOk.headers.get('cache-control') || '', /no-store/);
    assert.equal(resOk.data.address, '123 Nguyễn Thị Minh Khai, P. Bến Thành, Q.1');
    assert.equal(resOk.data.phone, '0909111222');
    assert.equal(resOk.data.description, 'Phòng khám thú y hiện đại, tận tâm.');
    // Absent fields kept
    assert.equal(resOk.data.licenseNo, 'GPHN-S9/2026');
    assert.equal(resOk.data.taxCode, '0312345678');
    assert.ok(resOk.data.updatedAt);

    // Clear description and licenseNo with null / empty
    const resClear = await app.call('PUT', '/provider/profile', {
      headers: { authorization: `Bearer ${providerToken}` },
      body: {
        description: '',
        licenseNo: null
      }
    });
    assert.equal(resClear.status, 200);
    assert.equal(resClear.data.description, null);
    assert.equal(resClear.data.licenseNo, null);
    // Kept previous address & phone
    assert.equal(resClear.data.address, '123 Nguyễn Thị Minh Khai, P. Bến Thành, Q.1');
    assert.equal(resClear.data.phone, '0909111222');
  });

  await t.test('AuditLog records provider_profile_updated with only field names', async () => {
    const rawLogs = await app.testHelpers.queryAuditLogs({ action: 'provider_profile_updated' });
    assert.ok(rawLogs.length > 0);
    const lastLog = rawLogs[rawLogs.length - 1];
    const detail = JSON.parse(lastLog.detail);
    assert.ok(Array.isArray(detail.fields));
    // Must contain field names like 'description', 'licenseNo'
    assert.ok(detail.fields.includes('description'));
    assert.ok(detail.fields.includes('licenseNo'));
    // Detail must NEVER contain actual values (like phone numbers or addresses)
    assert.equal(detail.description, undefined);
    assert.equal(detail.address, undefined);
    assert.equal(detail.licenseNo, undefined);
  });

  await t.test('public APIs (GET /providers, GET /services) NEVER leak legal info', async () => {
    const provsRes = await app.call('GET', '/providers');
    assert.equal(provsRes.status, 200);
    for (const p of provsRes.data) {
      assert.equal(p.licenseNo, undefined);
      assert.equal(p.taxCode, undefined);
    }
    const myProv = provsRes.data.find((p) => p.id === providerId);
    assert.ok(myProv);
    assert.equal(myProv.address, '123 Nguyễn Thị Minh Khai, P. Bến Thành, Q.1');
    assert.equal(myProv.phone, '0909111222');

    const svcRes = await app.call('GET', '/services');
    assert.equal(svcRes.status, 200);
    for (const s of svcRes.data) {
      assert.equal(s.licenseNo, undefined);
      assert.equal(s.taxCode, undefined);
      assert.equal(s.providerLicenseNo, undefined);
      assert.equal(s.providerTaxCode, undefined);
    }
  });

  await t.test('disabled provider cannot update profile', async () => {
    // Disable provider via admin
    await app.call('POST', `/admin/users/${providerUser.id}/disable`, {
      headers: { authorization: `Bearer ${adminToken}` }
    });

    // Login again or use fresh token if possible, but user is disabled so login should 403 disabled
    const disabledLogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider_s9@clinic.vn', password: 'Password123!' }
    });
    assert.equal(disabledLogin.status, 403);

    // When user is disabled, authenticate rejects with 403 disabled
    const putRes = await app.call('PUT', '/provider/profile', {
      headers: { authorization: `Bearer ${providerToken}` },
      body: { address: 'Số mới' }
    });
    assert.equal(putRes.status, 403);
    assert.equal(putRes.body.code, 'disabled');
  });
});
