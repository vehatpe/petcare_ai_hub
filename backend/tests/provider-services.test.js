'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');
const { validateServiceInput, getServiceOptions, SERVICE_LIMITS } = require('../src/utils/validators');
const { slugifyServiceName, makeServiceCandidateId } = require('../src/services/provider.service');

test('S10: Provider Services Management (Unit / DB giả)', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  // 1. Validators boundaries
  await t.test('validators: validateServiceInput boundaries', () => {
    // Missing required fields on create
    const { errors: errEmpty } = validateServiceInput({}, false);
    assert.ok(errEmpty.name);
    assert.ok(errEmpty.category);
    assert.ok(errEmpty.priceVnd);
    assert.ok(errEmpty.unit);

    // Name length: < 3 or > 200
    const { errors: errNameShort } = validateServiceInput({ name: 'ab', category: 'medical', priceVnd: 10000, unit: 'lượt' }, false);
    assert.match(errNameShort.name, /tối thiểu 3 ký tự/);
    const { errors: errNameLong } = validateServiceInput({ name: 'a'.repeat(201), category: 'medical', priceVnd: 10000, unit: 'lượt' }, false);
    assert.match(errNameLong.name, /tối đa 200 ký tự/);

    // Price: negative or > 100,000,000 or float
    const { errors: errPriceNeg } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', priceVnd: -1, unit: 'lượt' }, false);
    assert.ok(errPriceNeg.priceVnd);
    const { errors: errPriceMax } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', priceVnd: 100000001, unit: 'lượt' }, false);
    assert.ok(errPriceMax.priceVnd);
    const { errors: errPriceFloat } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', priceVnd: 100.5, unit: 'lượt' }, false);
    assert.ok(errPriceFloat.priceVnd);

    // Slot capacity: 0 or 51 or float
    const { errors: errCapZero } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', priceVnd: 1000, unit: 'lượt', slotCapacity: 0 }, false);
    assert.ok(errCapZero.slotCapacity);
    const { errors: errCap51 } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', priceVnd: 1000, unit: 'lượt', slotCapacity: 51 }, false);
    assert.ok(errCap51.slotCapacity);

    // Category invalid
    const { errors: errCat } = validateServiceInput({ name: 'Dịch vụ A', category: 'invalid', priceVnd: 1000, unit: 'lượt' }, false);
    assert.ok(errCat.category);

    // CategoryLabel mismatch
    const { errors: errLabel } = validateServiceInput({ name: 'Dịch vụ A', category: 'medical', categoryLabel: 'Cắt tỉa lông', priceVnd: 1000, unit: 'lượt' }, false);
    assert.ok(errLabel.categoryLabel);

    // Valid create defaults
    const { errors: errOk, value: valOk } = validateServiceInput({
      name: '  Khám răng tổng quát  ',
      category: 'medical',
      priceVnd: 150000,
      unit: 'lượt khám'
    }, false);
    assert.equal(Object.keys(errOk).length, 0);
    assert.equal(valOk.name, 'Khám răng tổng quát');
    assert.equal(valOk.categoryLabel, 'Khám & điều trị'); // default first label
    assert.equal(valOk.slotCapacity, 3); // default capacity
    assert.equal(valOk.description, '');
  });

  // 2. Slug generation and candidate id
  await t.test('slug and candidate id generation with suffix and truncation', () => {
    assert.equal(slugifyServiceName('  Khám Bệnh Cho Chó Mèo  '), 'kham-benh-cho-cho-meo');
    assert.equal(slugifyServiceName('Đặc Trị Đốm'), 'dac-tri-dom');
    assert.equal(slugifyServiceName(''), 'dich-vu');

    const cand1 = makeServiceCandidateId('prov-1', 'kham-benh', 1, 50);
    assert.equal(cand1, 'prov-1-kham-benh');
    const cand2 = makeServiceCandidateId('prov-1', 'kham-benh', 2, 50);
    assert.equal(cand2, 'prov-1-kham-benh-2');

    // Total length <= 50 bound check
    const longSlug = 'a'.repeat(60);
    const candLong = makeServiceCandidateId('long-provider-id-12345', longSlug, 10, 50);
    assert.ok(candLong.length <= 50);
    assert.ok(candLong.endsWith('-10'));
  });

  // Helper setup admin, providers, vets, customer
  const adminId = crypto.randomUUID();
  await app.testHelpers.addStaff('admin', {
    id: adminId,
    email: 'admin-s10@petcare.vn',
    phone: '0901000001',
    fullName: 'Admin S10',
    passwordHash: bcrypt.hashSync('Password123!', 4)
  });
  const resAdmin = await app.call('POST', '/auth/login', {
    body: { identifier: 'admin-s10@petcare.vn', password: 'Password123!' }
  });
  const adminToken = resAdmin.data.token;

  // Register and approve Provider A
  const regProvA = await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Owner A',
      email: 'prov-a@petcare.vn',
      phone: '0901000002',
      password: 'Password123!',
      orgName: 'Phòng khám A',
      orgType: 'clinic',
      orgArea: 'Quận 1'
    }
  });
  const provAUserId = regProvA.data.user.id;
  const appProvA = await app.call('POST', `/admin/users/${provAUserId}/approve`, {
    token: adminToken,
    body: { area: 'Quận 1' }
  });
  const provAId = appProvA.data.providerId;

  const loginProvA = await app.call('POST', '/auth/login', {
    body: { identifier: 'prov-a@petcare.vn', password: 'Password123!' }
  });
  const provAToken = loginProvA.data.token;

  // Register and approve Provider B
  const regProvB = await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Owner B',
      email: 'prov-b@petcare.vn',
      phone: '0901000003',
      password: 'Password123!',
      orgName: 'Spa Thú Cưng B',
      orgType: 'spa',
      orgArea: 'Quận 3'
    }
  });
  const provBUserId = regProvB.data.user.id;
  const appProvB = await app.call('POST', `/admin/users/${provBUserId}/approve`, {
    token: adminToken,
    body: { area: 'Quận 3' }
  });
  const provBId = appProvB.data.providerId;

  const loginProvB = await app.call('POST', '/auth/login', {
    body: { identifier: 'prov-b@petcare.vn', password: 'Password123!' }
  });
  const provBToken = loginProvB.data.token;

  // Customer
  const custRes = await app.registerCustomer();
  const customerToken = custRes.token;
  const customerUser = custRes.user;

  // Create Vet in Provider A
  const vetRes = await app.call('POST', '/provider/vets', {
    token: provAToken,
    body: {
      fullName: 'Bác sĩ A1',
      email: 'vet-a1@petcare.vn',
      phone: '0901000006'
    }
  });
  const vetTempPass = vetRes.data.tempPassword;
  const loginVet = await app.call('POST', '/auth/login', {
    body: { identifier: 'vet-a1@petcare.vn', password: vetTempPass }
  });
  const vetToken = loginVet.data.token;

  // 3. Phân quyền access control
  await t.test('access control: 401 unauth, 403 customer/vet/admin', async () => {
    // Unauth -> 401
    const resUnauth = await app.call('GET', '/provider/services');
    assert.equal(resUnauth.status, 401);

    // Customer -> 403
    const resCust = await app.call('GET', '/provider/services', { token: customerToken });
    assert.equal(resCust.status, 403);

    // Vet -> 403
    const resVet = await app.call('GET', '/provider/services', { token: vetToken });
    assert.equal(resVet.status, 403);

    // Admin -> 403 (provider services routes are role: provider only)
    const resAdminCall = await app.call('GET', '/provider/services', { token: adminToken });
    assert.equal(resAdminCall.status, 403);
  });

  // 4. GET /provider/services: returns services, meta, options
  await t.test('GET /provider/services: returns list, meta, options', async () => {
    const res = await app.call('GET', '/provider/services', { token: provAToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.data.services));
    assert.ok(res.data.meta);
    assert.ok(res.data.options);
    assert.equal(res.data.options.priceMaxVnd, 100000000);
    assert.equal(res.data.options.capacityMax, 50);
    assert.equal(res.data.options.nameMax, 200);
    assert.equal(res.data.options.unitMax, 30);
    assert.ok(Array.isArray(res.data.options.categories));
  });

  // 5. POST /provider/services: create service, audit log, name collision, limit 50
  let serviceA1Id = '';
  await t.test('POST /provider/services: create service successfully', async () => {
    const res = await app.call('POST', '/provider/services', {
      token: provAToken,
      body: {
        name: 'Tiêm phòng Dại định kỳ',
        category: 'medical',
        categoryLabel: 'Tiêm chủng',
        priceVnd: 120000,
        unit: 'mũi tiêm',
        slotCapacity: 4,
        description: 'Vắc xin ngừa bệnh dại cho chó mèo'
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.data.name, 'Tiêm phòng Dại định kỳ');
    assert.equal(res.data.providerId, provAId);
    assert.equal(res.data.isActive, true);
    assert.equal(res.data.isSample, false);
    assert.equal(res.data.slotCapacity, 4);
    assert.ok(res.data.id.startsWith(`${provAId}-tiem-phong-dai-dinh-ky`));
    serviceA1Id = res.data.id;
  });

  // 6. Duplicate name rejection (case insensitive, trimmed, even if hidden)
  await t.test('POST /provider/services: duplicate name rejection 409', async () => {
    const res = await app.call('POST', '/provider/services', {
      token: provAToken,
      body: {
        name: '  tiêm PHÒNG dại định KỲ  ',
        category: 'medical',
        priceVnd: 150000,
        unit: 'mũi'
      }
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'duplicate');
  });

  // 7. PUT /provider/services/:id: update fields and audit log (diff-only)
  await t.test('PUT /provider/services/:id: update fields and audit log diff-only', async () => {
    // Theo dõi số lần gọi logAudit và updateService
    let lastAuditLog = null;
    const origLogAudit = app.models.admin.logAudit;
    app.models.admin.logAudit = async (tx, entry) => {
      lastAuditLog = entry;
      return origLogAudit(tx, entry);
    };

    let updateServiceCalls = 0;
    const origUpdateService = app.models.providerMember.updateService;
    app.models.providerMember.updateService = async (tx, id, fields) => {
      updateServiceCalls++;
      return origUpdateService(tx, id, fields);
    };

    try {
      // 7a. Đổi fields -> ghi đúng tên các trường thật sự đổi
      lastAuditLog = null;
      updateServiceCalls = 0;
      const res = await app.call('PUT', `/provider/services/${serviceA1Id}`, {
        token: provAToken,
        body: {
          name: 'Tiêm phòng Dại & 7 bệnh',
          priceVnd: 250000,
          slotCapacity: 5,
          providerId: 'hacker-provider' // must be ignored
        }
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.name, 'Tiêm phòng Dại & 7 bệnh');
      assert.equal(res.data.priceVnd, 250000);
      assert.equal(res.data.slotCapacity, 5);
      assert.equal(res.data.providerId, provAId);
      assert.equal(updateServiceCalls, 1);
      assert.ok(lastAuditLog);
      const detail1 = JSON.parse(lastAuditLog.detail);
      assert.deepEqual(detail1.changedFields.sort(), ['name', 'priceVnd', 'slotCapacity'].sort());

      // 7b. Chỉ đổi chữ hoa/thường của tên -> vẫn tính có thay đổi và ghi audit đúng 1 trường 'name'
      lastAuditLog = null;
      updateServiceCalls = 0;
      const resCase = await app.call('PUT', `/provider/services/${serviceA1Id}`, {
        token: provAToken,
        body: {
          name: 'TIÊM PHÒNG DẠI & 7 BỆNH'
        }
      });
      assert.equal(resCase.status, 200);
      assert.equal(resCase.data.name, 'TIÊM PHÒNG DẠI & 7 BỆNH');
      assert.equal(updateServiceCalls, 1);
      assert.ok(lastAuditLog);
      const detailCase = JSON.parse(lastAuditLog.detail);
      assert.deepEqual(detailCase.changedFields, ['name']);

      // 7c. Gửi lại y nguyên giá trị cũ -> 200, updateService không được gọi, không ghi AuditLog
      lastAuditLog = null;
      updateServiceCalls = 0;
      const resIdentical = await app.call('PUT', `/provider/services/${serviceA1Id}`, {
        token: provAToken,
        body: {
          name: 'TIÊM PHÒNG DẠI & 7 BỆNH',
          priceVnd: 250000,
          slotCapacity: 5
        }
      });
      assert.equal(resIdentical.status, 200);
      assert.equal(updateServiceCalls, 0);
      assert.equal(lastAuditLog, null);

      // 7d. Gửi body {} -> 200, updateService không được gọi, không ghi AuditLog
      lastAuditLog = null;
      updateServiceCalls = 0;
      const resEmpty = await app.call('PUT', `/provider/services/${serviceA1Id}`, {
        token: provAToken,
        body: {}
      });
      assert.equal(resEmpty.status, 200);
      assert.equal(updateServiceCalls, 0);
      assert.equal(lastAuditLog, null);
    } finally {
      app.models.admin.logAudit = origLogAudit;
      app.models.providerMember.updateService = origUpdateService;
    }
  });

  // 8. Cross-provider isolation: Provider B cannot see or edit A's service -> 404
  await t.test('cross-provider isolation: Provider B editing or toggling A returns 404', async () => {
    const resEdit = await app.call('PUT', `/provider/services/${serviceA1Id}`, {
      token: provBToken,
      body: { name: 'Hacked Service Name', priceVnd: 10000 }
    });
    assert.equal(resEdit.status, 404);

    const resDisable = await app.call('POST', `/provider/services/${serviceA1Id}/disable`, {
      token: provBToken
    });
    assert.equal(resDisable.status, 404);

    const resEnable = await app.call('POST', `/provider/services/${serviceA1Id}/enable`, {
      token: provBToken
    });
    assert.equal(resEnable.status, 404);
  });

  // 9. Sample services cannot be edited or toggled -> 404
  await t.test('sample services cannot be edited or toggled -> 404', async () => {
    // Add sample service for prov-a
    await app.models.providerMember.createService(null, {
      id: 'sample-svc-1',
      providerId: provAId,
      category: 'medical',
      categoryLabel: 'Khám & điều trị',
      name: 'Dịch vụ mẫu',
      priceVnd: 100000,
      unit: 'lần',
      slotCapacity: 2,
      isActive: true,
      isSample: true,
      createdAt: new Date()
    });

    const resEdit = await app.call('PUT', '/provider/services/sample-svc-1', {
      token: provAToken,
      body: { name: 'Sửa dịch vụ mẫu' }
    });
    assert.equal(resEdit.status, 404);

    const resDisable = await app.call('POST', '/provider/services/sample-svc-1/disable', {
      token: provAToken
    });
    assert.equal(resDisable.status, 404);
  });

  // 10. Disable and Enable toggle: status changes, repeated toggle 409
  await t.test('disable and enable toggle: status 409 on repeat', async () => {
    // Disable once -> ok
    const resDis1 = await app.call('POST', `/provider/services/${serviceA1Id}/disable`, {
      token: provAToken
    });
    assert.equal(resDis1.status, 200);
    assert.equal(resDis1.data.isActive, false);

    // Disable second time -> 409
    const resDis2 = await app.call('POST', `/provider/services/${serviceA1Id}/disable`, {
      token: provAToken
    });
    assert.equal(resDis2.status, 409);

    // Enable once -> ok
    const resEn1 = await app.call('POST', `/provider/services/${serviceA1Id}/enable`, {
      token: provAToken
    });
    assert.equal(resEn1.status, 200);
    assert.equal(resEn1.data.isActive, true);

    // Enable second time -> 409
    const resEn2 = await app.call('POST', `/provider/services/${serviceA1Id}/enable`, {
      token: provAToken
    });
    assert.equal(resEn2.status, 409);
  });

  // 11. No DELETE route -> 404
  await t.test('no DELETE route for services -> 404', async () => {
    const resDel = await app.call('DELETE', `/provider/services/${serviceA1Id}`, {
      token: provAToken
    });
    assert.equal(resDel.status, 404);
  });

  // 12. Max 50 services limit
  await t.test('max 50 services limit rejection 409', async () => {
    // Create dummy services until 50 in provider B
    for (let i = 1; i <= 50; i++) {
      await app.models.providerMember.createService(null, {
        id: `${provBId}-svc-${i}`,
        providerId: provBId,
        category: 'grooming',
        categoryLabel: 'Spa & làm đẹp',
        name: `Dịch vụ spa số ${i}`,
        priceVnd: 50000,
        unit: 'lần',
        slotCapacity: 2,
        isActive: true,
        isSample: false,
        createdAt: new Date()
      });
    }

    const resOver = await app.call('POST', '/provider/services', {
      token: provBToken,
      body: {
        name: 'Dịch vụ spa thứ 51',
        category: 'grooming',
        categoryLabel: 'Spa & làm đẹp',
        priceVnd: 60000,
        unit: 'lần'
      }
    });
    assert.equal(resOver.status, 409);
    assert.match(resOver.message, /tối đa 50 dịch vụ/);
  });

  // 13. Public catalog and booking integration
  await t.test('public catalog and booking integration when service is hidden', async () => {
    // Create active service
    const createRes = await app.call('POST', '/provider/services', {
      token: provAToken,
      body: {
        name: 'Khám tổng quát đặc biệt',
        category: 'medical',
        categoryLabel: 'Khám & điều trị',
        priceVnd: 200000,
        unit: 'lượt'
      }
    });
    const sId = createRes.data.id;

    // Visible in GET /services and /services/:id
    const pubList1 = await app.call('GET', `/services?providerId=${provAId}`);
    assert.ok(pubList1.data.some((x) => x.id === sId));

    const pubGet1 = await app.call('GET', `/services/${sId}`);
    assert.equal(pubGet1.status, 200);

    // Disable service
    await app.call('POST', `/provider/services/${sId}/disable`, {
      token: provAToken
    });

    // Hidden in GET /services, 404 in GET /services/:id and /services/:id/slots
    const pubList2 = await app.call('GET', `/services?providerId=${provAId}`);
    assert.ok(!pubList2.data.some((x) => x.id === sId));

    const pubGet2 = await app.call('GET', `/services/${sId}`);
    assert.equal(pubGet2.status, 404);

    const pubSlots2 = await app.call('GET', `/services/${sId}/slots?date=2026-12-01`);
    assert.equal(pubSlots2.status, 404);

    // Customer pet for booking test
    const petRes = await app.call('POST', '/pets', {
      token: customerToken,
      body: { name: 'Miu Miu', species: 'cat', sex: 'female', birthDate: '2023-01-01' }
    });
    const petId = petRes.data.id;

    // Customer booking to hidden service -> 404 not found
    const bookRes = await app.call('POST', '/bookings', {
      token: customerToken,
      body: {
        petId,
        serviceId: sId,
        date: '2026-12-01',
        time: '08:30'
      }
    });
    assert.equal(bookRes.status, 404);
  });

  // 14. Transaction rollback when logAudit fails
  await t.test('transaction rollback when logAudit fails leaves no service created', async () => {
    // Override logAudit in admin model to throw once
    const originalLogAudit = app.models.admin.logAudit;
    app.models.admin.logAudit = async () => {
      throw new Error('Simulated DB audit log crash');
    };

    try {
      const resFail = await app.call('POST', '/provider/services', {
        token: provAToken,
        body: {
          name: 'Dịch vụ thất bại do audit',
          category: 'medical',
          categoryLabel: 'Khám & điều trị',
          priceVnd: 300000,
          unit: 'lượt'
        }
      });
      assert.equal(resFail.status, 500);

      // Verify no service created in fake models
      const checkSvc = await app.call('GET', '/provider/services', { token: provAToken });
      const found = checkSvc.data.services.some((s) => s.name === 'Dịch vụ thất bại do audit');
      assert.equal(found, false);
    } finally {
      app.models.admin.logAudit = originalLogAudit;
    }
  });

  // 15. Admin disabling provider hides all its services from GET /services
  await t.test('admin disabling provider hides all its services from public catalog', async () => {
    // Prov A currently has active service
    const pubListBefore = await app.call('GET', `/services?providerId=${provAId}`);
    assert.ok(pubListBefore.data.length > 0);

    // Admin disables Provider A
    const disableProv = await app.call('POST', `/admin/users/${provAUserId}/disable`, { token: adminToken });
    assert.equal(disableProv.status, 200);

    // Prov A's services should now be 0 in public catalog
    const pubListAfter = await app.call('GET', `/services?providerId=${provAId}`);
    assert.equal(pubListAfter.data.length, 0);

    // Provider A cannot create service when disabled
    const tryCreate = await app.call('POST', '/provider/services', {
      token: provAToken,
      body: {
        name: 'Dịch vụ khi cơ sở bị khóa',
        category: 'medical',
        priceVnd: 50000,
        unit: 'lần'
      }
    });
    // ActorUser status is now disabled, so assertActiveProvider throws 403 or 409
    assert.ok(tryCreate.status === 403 || tryCreate.status === 409);
  });
});
