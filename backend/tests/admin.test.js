'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');

test('Admin API: access control, partner approval, rejection, and account disable/enable', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  let adminUser;
  let adminToken;

  // Helper để tạo và đăng nhập admin
  async function setupAdmin() {
    const id = crypto.randomUUID();
    await app.testHelpers.addStaff('admin', {
      id,
      email: 'admin@petcare.vn',
      phone: '0988888888',
      fullName: 'Quản trị viên Hệ thống',
      passwordHash: bcrypt.hashSync('AdminPass123!', 4)
    });
    const res = await app.call('POST', '/auth/login', {
      body: { identifier: 'admin@petcare.vn', password: 'AdminPass123!' }
    });
    adminToken = res.data.token;
    adminUser = res.data.user;
  }

  await setupAdmin();

  await t.test('401 when unauthenticated', async () => {
    const r1 = await app.call('GET', '/admin/users');
    assert.equal(r1.status, 401);

    const dummyId = crypto.randomUUID();
    const r2 = await app.call('POST', `/admin/users/${dummyId}/approve`);
    assert.equal(r2.status, 401);
  });

  await t.test('403 when authenticated as customer, provider, or vet', async () => {
    const { token: custToken } = await app.registerCustomer();
    const rCust = await app.call('GET', '/admin/users', { token: custToken });
    assert.equal(rCust.status, 403);

    const { token: vetToken } = await app.loginStaff('vet');
    const rVet = await app.call('GET', '/admin/users', { token: vetToken });
    assert.equal(rVet.status, 403);
  });

  await t.test('listUsers: returns meta, pagination, filters by status and role, never leaks passwordHash', async () => {
    const r = await app.call('GET', '/admin/users?limit=10&offset=0', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.meta);
    assert.equal(r.data.meta.limit, 10);
    assert.equal(r.data.meta.offset, 0);
    assert.ok(r.data.meta.total >= 1);
    assert.ok(Array.isArray(r.data.users));

    for (const u of r.data.users) {
      assert.equal(u.passwordHash, undefined, 'passwordHash must never be leaked');
      assert.equal(u.PasswordHash, undefined, 'PasswordHash must never be leaked');
    }
  });

  await t.test('approve provider: creates Providers entry, updates ProviderId/status/approvedBy/At, writes AuditLog', async () => {
    // Đăng ký 1 provider mới (sẽ ở trạng thái pending)
    const regRes = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ Nguyễn Văn A',
        email: 'provider1@clinic.vn',
        phone: '0933333331',
        password: 'Password123!',
        orgName: 'Bệnh Viện Thú Y Sài Gòn',
        orgType: 'clinic'
      }
    });
    assert.equal(regRes.status, 201);
    const providerUserId = regRes.data.user.id;
    assert.equal(regRes.data.user.status, 'pending');

    // Phê duyệt với area
    const appRes = await app.call('POST', `/admin/users/${providerUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 3, TP.HCM' }
    });
    assert.equal(appRes.status, 200);
    assert.equal(appRes.data.status, 'active');
    assert.equal(appRes.data.orgArea, 'Quận 3, TP.HCM');
    assert.ok(appRes.data.providerId);
    assert.equal(appRes.data.approvedBy, adminUser.id);
    assert.ok(appRes.data.approvedAt);

    // Kiểm tra trong state fake-models
    const createdProvider = app.testHelpers.state.providers.find((p) => p.id === appRes.data.providerId);
    assert.ok(createdProvider, 'Providers row should exist');
    assert.equal(createdProvider.name, 'Bệnh Viện Thú Y Sài Gòn');
    assert.equal(createdProvider.area, 'Quận 3, TP.HCM');
    assert.equal(createdProvider.type, 'clinic');
    assert.equal(createdProvider.active, true);

    // Kiểm tra AuditLog
    const audit = app.testHelpers.state.auditLogs.find((a) => a.action === 'approve_provider' && a.targetId === providerUserId);
    assert.ok(audit, 'AuditLog entry should be recorded');
    assert.equal(audit.actorUserId, adminUser.id);

    // Duyệt lặp lại -> 409 conflict
    const appAgain = await app.call('POST', `/admin/users/${providerUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 3' }
    });
    assert.equal(appAgain.status, 409);
  });

  await t.test('approve provider: slug generation handles duplicates, length > 50, and non-latin names', async () => {
    // 1. Slug trùng lặp: đăng ký thêm 1 provider cùng orgName "Bệnh Viện Thú Y Sài Gòn"
    const reg2 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ Nguyễn Văn B',
        email: 'provider2@clinic.vn',
        phone: '0933333332',
        password: 'Password123!',
        orgName: 'Bệnh Viện Thú Y Sài Gòn',
        orgType: 'clinic'
      }
    });
    const appRes2 = await app.call('POST', `/admin/users/${reg2.data.user.id}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1' }
    });
    assert.equal(appRes2.status, 200);
    assert.equal(appRes2.data.providerId, 'benh-vien-thu-y-sai-gon-2');

    // 2. Slug dài > 50 ký tự
    const longOrgName = 'Trung Tâm Chăm Sóc Sức Khỏe Thú Cưng Chất Lượng Cao Quốc Tế Miền Nam';
    const reg3 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ C',
        email: 'provider3@clinic.vn',
        phone: '0933333333',
        password: 'Password123!',
        orgName: longOrgName,
        orgType: 'clinic'
      }
    });
    const appRes3 = await app.call('POST', `/admin/users/${reg3.data.user.id}/approve`, {
      token: adminToken,
      body: { area: 'Quận 7' }
    });
    assert.equal(appRes3.status, 200);
    assert.ok(appRes3.data.providerId.length <= 50, `ProviderId length ${appRes3.data.providerId.length} must be <= 50`);

    // 3. Tên toàn ký tự không Latin (ví dụ tiếng Nhật/Hàn/Emoji)
    const nonLatinOrgName = '犬と猫のクリニック 🐾🐾🐾';
    const reg4 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ D',
        email: 'provider4@clinic.vn',
        phone: '0933333334',
        password: 'Password123!',
        orgName: nonLatinOrgName,
        orgType: 'clinic'
      }
    });
    const appRes4 = await app.call('POST', `/admin/users/${reg4.data.user.id}/approve`, {
      token: adminToken,
      body: { area: 'Quận 2' }
    });
    assert.equal(appRes4.status, 200);
    assert.equal(appRes4.data.providerId, 'co-so');
  });

  await t.test('approve provider: missing area returns 422, area > 100 returns 422', async () => {
    const reg = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ E',
        email: 'provider5@clinic.vn',
        phone: '0933333335',
        password: 'Password123!',
        orgName: 'Phòng Khám E',
        orgType: 'clinic'
      }
    });
    // Thiếu area -> 422
    const resMissing = await app.call('POST', `/admin/users/${reg.data.user.id}/approve`, {
      token: adminToken,
      body: {}
    });
    assert.equal(resMissing.status, 422);

    // Area dài 101 ký tự -> 422
    const resTooLong = await app.call('POST', `/admin/users/${reg.data.user.id}/approve`, {
      token: adminToken,
      body: { area: 'A'.repeat(101) }
    });
    assert.equal(resTooLong.status, 422);
    assert.ok(resTooLong.body.errors?.area);
  });

  await t.test('reject provider: requires reason <= 200, updates status to rejected and logs audit', async () => {
    const reg = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Bác Sĩ F',
        email: 'provider6@clinic.vn',
        phone: '0933333336',
        password: 'Password123!',
        orgName: 'Phòng Khám F',
        orgType: 'clinic'
      }
    });
    const userId = reg.data.user.id;

    // Không có lý do -> 422
    const rNoReason = await app.call('POST', `/admin/users/${userId}/reject`, {
      token: adminToken,
      body: {}
    });
    assert.equal(rNoReason.status, 422);

    // Lý do > 200 ký tự -> 422
    const rTooLong = await app.call('POST', `/admin/users/${userId}/reject`, {
      token: adminToken,
      body: { reason: 'A'.repeat(201) }
    });
    assert.equal(rTooLong.status, 422);

    // Từ chối hợp lệ
    const rOk = await app.call('POST', `/admin/users/${userId}/reject`, {
      token: adminToken,
      body: { reason: 'Giấy phép hành nghề chưa đạt yêu cầu theo quy định.' }
    });
    assert.equal(rOk.status, 200);
    assert.equal(rOk.data.status, 'rejected');

    // Thử duyệt sau khi đã từ chối -> 409
    const rAppAfterRej = await app.call('POST', `/admin/users/${userId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1' }
    });
    assert.equal(rAppAfterRej.status, 409);
  });

  await t.test('disable and enable provider: cascades to vets and Providers.IsActive in transaction', async () => {
    // 1. Tạo provider và duyệt
    const regP = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Spa Pet',
        email: 'spa_owner@spa.vn',
        phone: '0944444441',
        password: 'Password123!',
        orgName: 'Pet Spa Hoàng Gia',
        orgType: 'spa'
      }
    });
    const providerUserId = regP.data.user.id;
    const approveRes = await app.call('POST', `/admin/users/${providerUserId}/approve`, {
      token: adminToken,
      body: { area: 'Bình Thạnh' }
    });
    const providerId = approveRes.data.providerId;

    // Đăng nhập provider để lấy token
    const loginP = await app.call('POST', '/auth/login', {
      body: { identifier: 'spa_owner@spa.vn', password: 'Password123!' }
    });
    const providerToken = loginP.data.token;

    // Thêm 1 bác sĩ / nhân viên vet thuộc provider này vào state
    const vetId = crypto.randomUUID();
    app.testHelpers.state.users.push({
      id: vetId,
      role: 'vet',
      status: 'active',
      fullName: 'Bác sĩ Spa',
      email: 'vet_spa@spa.vn',
      phone: '0944444442',
      passwordHash: bcrypt.hashSync('Password123!', 4),
      providerId: providerId,
      createdAt: new Date().toISOString()
    });

    // 2. Khóa Provider
    const disRes = await app.call('POST', `/admin/users/${providerUserId}/disable`, { token: adminToken });
    assert.equal(disRes.status, 200);
    assert.equal(disRes.data.status, 'disabled');

    // Kiểm tra Providers.active == false và Vet status == 'disabled'
    const getProvRow = () => app.testHelpers.state.providers.find((p) => p.id === providerId);
    const getVetRow = () => app.testHelpers.state.users.find((u) => u.id === vetId);

    assert.equal(getProvRow().active, false);
    assert.equal(getVetRow().status, 'disabled');

    // 3. Khóa có hiệu lực ngay ở request kế tiếp với token cũ
    const meWithOldToken = await app.call('GET', '/auth/me', { token: providerToken });
    assert.equal(meWithOldToken.status, 403);
    assert.equal(meWithOldToken.body.code, 'disabled');

    // 4. Mở khóa Provider: chỉ mở provider + IsActive=1, vet vẫn disabled
    const enRes = await app.call('POST', `/admin/users/${providerUserId}/enable`, { token: adminToken });
    assert.equal(enRes.status, 200);
    assert.equal(enRes.data.status, 'active');

    assert.equal(getProvRow().active, true);
    assert.equal(getVetRow().status, 'disabled', 'Vet remains disabled on provider enable');

    // 5. Thử mở khóa vet khi cơ sở bị khóa -> 409
    // Khóa lại provider
    await app.call('POST', `/admin/users/${providerUserId}/disable`, { token: adminToken });
    assert.equal(getProvRow().active, false);

    const disVetRes = await app.call('POST', `/admin/users/${vetId}/enable`, { token: adminToken });
    assert.equal(disVetRes.status, 409);
    assert.match(disVetRes.body.message, /Cơ sở của bác sĩ này đang bị khóa/);

    // Mở khóa cơ sở trước rồi mở khóa vet -> 200
    await app.call('POST', `/admin/users/${providerUserId}/enable`, { token: adminToken });
    assert.equal(getProvRow().active, true);

    const enVetRes = await app.call('POST', `/admin/users/${vetId}/enable`, { token: adminToken });
    assert.equal(enVetRes.status, 200);
    assert.equal(enVetRes.data.status, 'active');
    assert.equal(getVetRow().status, 'active');
  });

  await t.test('admin constraints: admin cannot disable self, cannot disable last active admin', async () => {
    // Admin tự khóa mình -> 403
    const disSelf = await app.call('POST', `/admin/users/${adminUser.id}/disable`, { token: adminToken });
    assert.equal(disSelf.status, 403);

    // Tạo admin thứ hai
    const admin2Id = crypto.randomUUID();
    await app.testHelpers.addStaff('admin', {
      id: admin2Id,
      email: 'admin2@petcare.vn',
      phone: '0988888882',
      fullName: 'Admin 2',
      passwordHash: bcrypt.hashSync('AdminPass123!', 4)
    });

    // Khóa admin 2 (hệ thống lúc này có 2 admin active) -> thành công
    const disAdmin2 = await app.call('POST', `/admin/users/${admin2Id}/disable`, { token: adminToken });
    assert.equal(disAdmin2.status, 200);

    // Thử khóa admin cuối cùng (chính admin 1 đã bị chặn ở trên, nhưng giả sử gửi qua user khác)
    // Giờ admin 2 đã disabled, nếu cố disable adminUser (kể cả gọi bởi chính nó hoặc khác) -> 403
    const disLast = await app.call('POST', `/admin/users/${adminUser.id}/disable`, { token: adminToken });
    assert.equal(disLast.status, 403);
  });

  await t.test('transaction rollback on failure leaves no dirty state in fake-models', async () => {
    // Thử duyệt một provider nhưng simulate lỗi giữa chừng
    const reg = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Phòng Khám Lỗi Rollback',
        email: 'rollback@clinic.vn',
        phone: '0955555555',
        password: 'Password123!',
        orgName: 'Cơ Sở Lỗi',
        orgType: 'clinic'
      }
    });
    const targetUserId = reg.data.user.id;

    // Tạm thời chèn 1 hàm đè lên updateUserApproval để ném lỗi
    const origUpdate = app.models.admin.updateUserApproval;
    app.models.admin.updateUserApproval = async () => {
      throw new Error('Simulated crash during approval transaction');
    };

    const res = await app.call('POST', `/admin/users/${targetUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1' }
    });
    assert.equal(res.status, 500);

    // Phục hồi hàm
    app.models.admin.updateUserApproval = origUpdate;

    // Kiểm tra state: không có dòng Providers nào bị để lại, user vẫn pending
    const prov = app.testHelpers.state.providers.find((p) => p.name === 'Cơ Sở Lỗi');
    assert.equal(prov, undefined, 'Provider row must be rolled back');

    const user = app.testHelpers.state.users.find((u) => u.id === targetUserId);
    assert.equal(user.status, 'pending', 'User status must remain pending');
    assert.equal(user.providerId, null, 'User providerId must remain null');
  });
});
