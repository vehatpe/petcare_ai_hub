'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');

test('C1: End-to-end roles lifecycle on fake-models', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  let adminUser;
  let adminToken;
  let admin2User;
  let admin2Token;

  // 0. Tạo 2 tài khoản admin
  const adminId1 = crypto.randomUUID();
  await app.testHelpers.addStaff('admin', {
    id: adminId1,
    email: 'admin1@petcare.vn',
    phone: '0988000001',
    fullName: 'Quản Trị Viên 1',
    passwordHash: bcrypt.hashSync('AdminPass123!', 4)
  });
  const resAdmin1 = await app.call('POST', '/auth/login', {
    body: { identifier: 'admin1@petcare.vn', password: 'AdminPass123!' }
  });
  assert.equal(resAdmin1.status, 200);
  adminToken = resAdmin1.data.token;
  adminUser = resAdmin1.data.user;

  const adminId2 = crypto.randomUUID();
  await app.testHelpers.addStaff('admin', {
    id: adminId2,
    email: 'admin2@petcare.vn',
    phone: '0988000002',
    fullName: 'Quản Trị Viên 2',
    passwordHash: bcrypt.hashSync('AdminPass123!', 4)
  });
  const resAdmin2 = await app.call('POST', '/auth/login', {
    body: { identifier: 'admin2@petcare.vn', password: 'AdminPass123!' }
  });
  assert.equal(resAdmin2.status, 200);
  admin2Token = resAdmin2.data.token;
  admin2User = resAdmin2.data.user;

  // Biến lưu xuyên suốt vòng đời chính
  let providerUserId;
  let providerId;
  let providerToken;
  let vetUserId;
  let vetTempPassword;
  let vetToken;

  await t.test('1. Đăng ký Provider có orgArea -> Trạng thái pending, chưa đăng nhập được', async () => {
    const regRes = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Phạm Văn Chủ',
        email: 'provider.lead@petclinic.vn',
        phone: '0912345678',
        password: 'ProviderPass123!',
        orgName: 'Bệnh Viện Thú Y PetCare Trung Tâm',
        orgType: 'clinic',
        orgArea: 'Quận 1, TP.HCM'
      }
    });

    assert.equal(regRes.status, 201);
    assert.equal(regRes.body.success, true);
    assert.equal(regRes.data.user.role, 'provider');
    assert.equal(regRes.data.user.status, 'pending');
    providerUserId = regRes.data.user.id;

    // Đăng nhập sai mật khẩu -> 401 credentials
    const failPass = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.lead@petclinic.vn', password: 'SaiMatKhau!' }
    });
    assert.equal(failPass.status, 401);
    assert.equal(failPass.body.code, 'credentials');

    // Đăng nhập đúng mật khẩu -> 403 pending
    const pendingLogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.lead@petclinic.vn', password: 'ProviderPass123!' }
    });
    assert.equal(pendingLogin.status, 403);
    assert.equal(pendingLogin.body.code, 'pending');
  });

  await t.test('2. Admin duyệt Provider -> Sinh slug ProviderId, ghi AuditLog, Provider đăng nhập được', async () => {
    // Duyệt thành công
    const approveRes = await app.call('POST', `/admin/users/${providerUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1, TP.HCM' }
    });
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.success, true);
    assert.ok(approveRes.data.providerId, 'Phải có providerId');
    providerId = approveRes.data.providerId;

    // Kiểm tra provider trong state fake-models
    const pRecord = app.testHelpers.state.providers.find((p) => p.id === providerId);
    assert.ok(pRecord);
    assert.equal(pRecord.name, 'Bệnh Viện Thú Y PetCare Trung Tâm');
    assert.equal(pRecord.active, true);

    // Kiểm tra AuditLog duyệt
    const approveAudit = app.testHelpers.state.auditLogs.find(
      (a) => a.action === 'approve_provider' && a.targetId === providerUserId
    );
    assert.ok(approveAudit, 'Phải ghi AuditLog approve_provider');
    assert.equal(approveAudit.actorUserId, adminUser.id);

    // Provider đăng nhập thành công
    const loginRes = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.lead@petclinic.vn', password: 'ProviderPass123!' }
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.status, 'active');
    assert.equal(loginRes.data.user.providerId, providerId);
    providerToken = loginRes.data.token;
  });

  await t.test('3. Duyệt lặp lại -> 409 Conflict', async () => {
    const dupApprove = await app.call('POST', `/admin/users/${providerUserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 1, TP.HCM' }
    });
    assert.equal(dupApprove.status, 409);
  });

  await t.test('4. Tạo Provider thứ 2 cùng orgName -> Sinh slug hậu tố số (-2) chống trùng', async () => {
    const reg2 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Chi Nhánh 2',
        email: 'provider2@petclinic.vn',
        phone: '0912345679',
        password: 'ProviderPass123!',
        orgName: 'Bệnh Viện Thú Y PetCare Trung Tâm',
        orgType: 'clinic',
        orgArea: 'Quận 2, TP.HCM'
      }
    });
    assert.equal(reg2.status, 201);
    const p2UserId = reg2.data.user.id;

    const approve2 = await app.call('POST', `/admin/users/${p2UserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 2, TP.HCM' }
    });
    assert.equal(approve2.status, 200);
    assert.equal(approve2.data.providerId, `${providerId}-2`);
  });

  await t.test('5. Đăng ký Provider thứ 3 rồi Admin từ chối -> 403 rejected', async () => {
    const reg3 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Bị Từ Chối',
        email: 'provider.rejected@petclinic.vn',
        phone: '0912345670',
        password: 'ProviderPass123!',
        orgName: 'Phòng Khám X',
        orgType: 'clinic',
        orgArea: 'Quận 5'
      }
    });
    assert.equal(reg3.status, 201);
    const p3UserId = reg3.data.user.id;

    // Từ chối thiếu lý do -> 422
    const failReject = await app.call('POST', `/admin/users/${p3UserId}/reject`, {
      token: adminToken,
      body: {}
    });
    assert.equal(failReject.status, 422);

    // Từ chối hợp lệ
    const rejectRes = await app.call('POST', `/admin/users/${p3UserId}/reject`, {
      token: adminToken,
      body: { reason: 'Giấy phép không hợp lệ theo quy định' }
    });
    assert.equal(rejectRes.status, 200);

    // Đăng nhập đúng mật khẩu sau khi bị từ chối -> 403 rejected
    const rejLogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.rejected@petclinic.vn', password: 'ProviderPass123!' }
    });
    assert.equal(rejLogin.status, 403);
    assert.equal(rejLogin.body.code, 'rejected');
    assert.match(rejLogin.body.message, /Giấy phép không hợp lệ/);
  });

  await t.test('6. Provider tạo Vet -> Nhận mật khẩu tạm, Vet đăng nhập bị chặn 403 must_change_password', async () => {
    const createVetRes = await app.call('POST', '/provider/vets', {
      token: providerToken,
      body: {
        fullName: 'Bác Sĩ Hoàng Yến',
        email: 'vet.hoangyen@petclinic.vn',
        phone: '0933111222'
      }
    });

    assert.equal(createVetRes.status, 201);
    assert.equal(createVetRes.body.success, true);
    assert.ok(createVetRes.data.tempPassword, 'Phải có tempPassword');
    assert.ok(createVetRes.data.vet.id);
    assert.equal(createVetRes.data.vet.mustChangePassword, true);

    vetUserId = createVetRes.data.vet.id;
    vetTempPassword = createVetRes.data.tempPassword;

    // Đăng nhập bằng mật khẩu tạm
    const vetLoginRes = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.hoangyen@petclinic.vn', password: vetTempPassword }
    });
    assert.equal(vetLoginRes.status, 200);
    assert.equal(vetLoginRes.data.user.mustChangePassword, true);
    vetToken = vetLoginRes.data.token;

    // Gọi route thông thường (ví dụ /provider/vets) -> Bị chặn 403 must_change_password
    const blockVets = await app.call('GET', '/provider/vets', { token: vetToken });
    assert.equal(blockVets.status, 403);
    assert.equal(blockVets.body.code, 'must_change_password');

    // Route /auth/me được phép qua
    const meRes = await app.call('GET', '/auth/me', { token: vetToken });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.mustChangePassword, true);
  });

  await t.test('7. Vet đổi mật khẩu bắt buộc -> mustChangePassword tắt, dùng bình thường', async () => {
    const changePassRes = await app.call('POST', '/auth/change-password', {
      token: vetToken,
      body: {
        currentPassword: vetTempPassword,
        newPassword: 'VetNewPassword456!'
      }
    });

    assert.equal(changePassRes.status, 200);
    assert.equal(changePassRes.body.success, true);
    assert.equal(changePassRes.data.user.mustChangePassword, false);

    // Đăng nhập lại bằng mật khẩu mới
    const loginAgain = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.hoangyen@petclinic.vn', password: 'VetNewPassword456!' }
    });
    assert.equal(loginAgain.status, 200);
    assert.equal(loginAgain.data.user.mustChangePassword, false);
    vetToken = loginAgain.data.token;

    // Kiểm tra /auth/me
    const meAgain = await app.call('GET', '/auth/me', { token: vetToken });
    assert.equal(meAgain.status, 200);
    assert.equal(meAgain.data.user.mustChangePassword, false);
  });

  await t.test('8. Admin khóa Provider -> Vet trực thuộc bị khóa ngay lập tức (cascade)', async () => {
    const disableProviderRes = await app.call('POST', `/admin/users/${providerUserId}/disable`, {
      token: adminToken,
      body: { reason: 'Vi phạm quy chế phòng khám' }
    });
    assert.equal(disableProviderRes.status, 200);

    // Kiểm tra Providers.IsActive = 0
    const pCheck = app.testHelpers.state.providers.find((p) => p.id === providerId);
    assert.equal(pCheck.active, false);

    // Vet dùng token cũ gọi API -> Bị chặn 403 disabled vì cơ chế authenticate đọc DB kiểm tra user.status !== 'active'
    const vetCall = await app.call('GET', '/auth/me', { token: vetToken });
    assert.equal(vetCall.status, 403);
    assert.equal(vetCall.body.code, 'disabled');

    // Vet đăng nhập lại đúng mật khẩu -> Bị 403 disabled
    const vetLoginBlocked = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.hoangyen@petclinic.vn', password: 'VetNewPassword456!' }
    });
    assert.equal(vetLoginBlocked.status, 403);
    assert.equal(vetLoginBlocked.body.code, 'disabled');

    // Provider đăng nhập lại -> Bị 403 disabled
    const provLoginBlocked = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.lead@petclinic.vn', password: 'ProviderPass123!' }
    });
    assert.equal(provLoginBlocked.status, 403);
    assert.equal(provLoginBlocked.body.code, 'disabled');
  });

  await t.test('9. Admin mở khóa Provider -> Provider active, nhưng Vet vẫn disabled (mở khóa từng người)', async () => {
    const enableProviderRes = await app.call('POST', `/admin/users/${providerUserId}/enable`, {
      token: adminToken
    });
    assert.equal(enableProviderRes.status, 200);

    // Provider active lại
    const provLoginOk = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider.lead@petclinic.vn', password: 'ProviderPass123!' }
    });
    assert.equal(provLoginOk.status, 200);
    providerToken = provLoginOk.data.token;

    // Providers.IsActive = 1
    const pCheck = app.testHelpers.state.providers.find((p) => p.id === providerId);
    assert.equal(pCheck.active, true);

    // Vet vẫn disabled
    const vetLoginBlocked = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.hoangyen@petclinic.vn', password: 'VetNewPassword456!' }
    });
    assert.equal(vetLoginBlocked.status, 403);
    assert.equal(vetLoginBlocked.body.code, 'disabled');

    // Provider mở khóa Vet riêng lẻ
    const enableVetRes = await app.call('POST', `/provider/vets/${vetUserId}/enable`, {
      token: providerToken
    });
    assert.equal(enableVetRes.status, 200);

    // Vet đăng nhập lại bình thường
    const vetLoginOk = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.hoangyen@petclinic.vn', password: 'VetNewPassword456!' }
    });
    assert.equal(vetLoginOk.status, 200);
    vetToken = vetLoginOk.data.token;
  });

  await t.test('10. Phân quyền chéo giữa các vai trò (401 / 403 / 404)', async () => {
    const customer = await app.registerCustomer();
    const custToken = customer.token;

    // Không token -> 401
    const noToken = await app.call('GET', '/admin/users');
    assert.equal(noToken.status, 401);

    // Customer gọi route admin -> 403
    const custAdmin = await app.call('GET', '/admin/users', { token: custToken });
    assert.equal(custAdmin.status, 403);

    // Vet gọi route admin -> 403
    const vetAdmin = await app.call('GET', '/admin/users', { token: vetToken });
    assert.equal(vetAdmin.status, 403);

    // Customer gọi route provider -> 403
    const custProv = await app.call('GET', '/provider/vets', { token: custToken });
    assert.equal(custProv.status, 403);

    // Provider quản lý Vet của cơ sở khác -> 404
    // Tạo provider 3 với vet 3
    const regProv3 = await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ CS 3',
        email: 'provider3@clinic.vn',
        phone: '0977111222',
        password: 'PassWord123!',
        orgName: 'Cơ Sở 3',
        orgType: 'clinic',
        orgArea: 'Hà Nội'
      }
    });
    const p3App = await app.call('POST', `/admin/users/${regProv3.data.user.id}/approve`, {
      token: adminToken,
      body: { area: 'Hà Nội' }
    });
    const p3Login = await app.call('POST', '/auth/login', {
      body: { identifier: 'provider3@clinic.vn', password: 'PassWord123!' }
    });
    const p3Token = p3Login.data.token;
    const v3Create = await app.call('POST', '/provider/vets', {
      token: p3Token,
      body: { fullName: 'Bác Sĩ CS3', email: 'vet3@clinic.vn', phone: '0977333444' }
    });
    const vet3Id = v3Create.data.vet.id;

    // Provider 1 cố khóa vet của Provider 3 -> 404 (bảo vệ đa cơ sở)
    const crossDisable = await app.call('POST', `/provider/vets/${vet3Id}/disable`, {
      token: providerToken
    });
    assert.equal(crossDisable.status, 404);
  });

  await t.test('11. Ràng buộc bảo vệ Admin: không tự khóa mình, không khóa admin active cuối cùng', async () => {
    // Admin 1 cố tự khóa mình -> 403 forbidden
    const selfDisable = await app.call('POST', `/admin/users/${adminUser.id}/disable`, {
      token: adminToken,
      body: { reason: 'Thử tự khóa' }
    });
    assert.equal(selfDisable.status, 403);
    assert.equal(selfDisable.body.code, 'forbidden');
    assert.match(selfDisable.body.message, /không thể tự khóa tài khoản của chính mình/);

    // Admin 2 khóa Admin 1 -> Thành công (vì còn Admin 2 active)
    const disAdmin1 = await app.call('POST', `/admin/users/${adminUser.id}/disable`, {
      token: admin2Token,
      body: { reason: 'Khóa admin 1' }
    });
    assert.equal(disAdmin1.status, 200);

    // Admin 2 cố khóa chính mình -> 403 forbidden
    const disSelfAgain = await app.call('POST', `/admin/users/${admin2User.id}/disable`, {
      token: admin2Token,
      body: { reason: 'Khóa admin cuối' }
    });
    assert.equal(disSelfAgain.status, 403);
    assert.equal(disSelfAgain.body.code, 'forbidden');

    // Thử tạo một admin 3 active:
    const adminId3 = crypto.randomUUID();
    await app.testHelpers.addStaff('admin', {
      id: adminId3,
      email: 'admin3@petcare.vn',
      phone: '0988000003',
      fullName: 'Quản Trị Viên 3',
      passwordHash: bcrypt.hashSync('AdminPass123!', 4)
    });
    const resAdmin3 = await app.call('POST', '/auth/login', {
      body: { identifier: 'admin3@petcare.vn', password: 'AdminPass123!' }
    });
    const admin3Token = resAdmin3.data.token;

    // Admin 3 khóa Admin 2:
    const disAdmin2 = await app.call('POST', `/admin/users/${admin2User.id}/disable`, {
      token: admin3Token,
      body: { reason: 'Khóa admin 2' }
    });
    assert.equal(disAdmin2.status, 200);

    // Kích hoạt lại Admin 1 bằng admin3:
    await app.call('POST', `/admin/users/${adminUser.id}/enable`, { token: admin3Token });

    // Đăng nhập lại Admin 1:
    const logA1 = await app.call('POST', '/auth/login', { body: { identifier: 'admin1@petcare.vn', password: 'AdminPass123!' } });
    const a1Token = logA1.data.token;

    // Admin 1 khóa Admin 3 -> Thành công:
    const disA3 = await app.call('POST', `/admin/users/${adminId3}/disable`, {
      token: a1Token,
      body: { reason: 'Khóa admin 3' }
    });
    assert.equal(disA3.status, 200);

    // Bây giờ: Admin 1 là admin active DUY NHẤT trong toàn hệ thống (Admin 2 và Admin 3 đều disabled).
    // Nếu tạo 1 admin 4 tạm thời và admin 4 cố khóa Admin 1 (admin active duy nhất) -> 403 last active admin
    const adminId4 = crypto.randomUUID();
    await app.testHelpers.addStaff('admin', {
      id: adminId4,
      email: 'admin4@petcare.vn',
      phone: '0988000004',
      fullName: 'Quản Trị Viên 4',
      passwordHash: bcrypt.hashSync('AdminPass123!', 4)
    });
    // Kích hoạt admin 4 tạm thời
    const logA4 = await app.call('POST', '/auth/login', { body: { identifier: 'admin4@petcare.vn', password: 'AdminPass123!' } });
    // Admin 1 khóa Admin 4:
    await app.call('POST', `/admin/users/${adminId4}/disable`, { token: a1Token });
    // Bây giờ Admin 1 lại là admin active duy nhất.
    const count = await app.models.admin.countActiveAdmins();
    assert.equal(count, 1);
  });

  await t.test('12. Quét toàn bộ AuditLog: ghi đúng lịch sử và TUYỆT ĐỐI KHÔNG chứa mật khẩu', async () => {
    const logs = app.testHelpers.state.auditLogs;
    assert.ok(logs.length > 0, 'Phải có các dòng AuditLog');

    const serializedLogs = JSON.stringify(logs);

    // Danh sách mật khẩu đã dùng trong test
    const passwords = [
      'AdminPass123!',
      'ProviderPass123!',
      'PassWord123!',
      'VetNewPassword456!',
      vetTempPassword
    ];

    for (const pwd of passwords) {
      if (!pwd) continue;
      assert.equal(
        serializedLogs.includes(pwd),
        false,
        `AuditLog KHÔNG ĐƯỢC CHỨA mật khẩu: ${pwd}`
      );
    }

    // Kiểm tra các action bắt buộc có mặt trong AuditLog
    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('approve_provider'), 'Phải có log approve_provider');
    assert.ok(actions.includes('reject_user'), 'Phải có log reject_user');
    assert.ok(actions.includes('disable_user'), 'Phải có log disable_user');
    assert.ok(actions.includes('enable_user'), 'Phải có log enable_user');
    assert.ok(actions.includes('vet_created'), 'Phải có log vet_created');
  });
});
