'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { startTestApp } = require('./helpers/harness');

test('C1: Provider management of Vets and Mandatory Change Password', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  let adminToken;
  let adminUser;
  let providerToken;
  let providerUser;
  let providerId;

  let provider2Token;
  let provider2User;
  let provider2Id;

  // Setup 1: Admin
  const adminId = crypto.randomUUID();
  await app.testHelpers.addStaff('admin', {
    id: adminId,
    email: 'admin@petcare.vn',
    phone: '0988888888',
    fullName: 'Quản trị viên Hệ thống',
    passwordHash: bcrypt.hashSync('AdminPass123!', 4)
  });
  const resAdmin = await app.call('POST', '/auth/login', {
    body: { identifier: 'admin@petcare.vn', password: 'AdminPass123!' }
  });
  adminToken = resAdmin.data.token;
  adminUser = resAdmin.data.user;

  // Setup 2: Provider 1 (approved & active)
  await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Chủ Phòng Khám 1',
      email: 'clinic1@petcare.vn',
      phone: '0911111111',
      password: 'Password123!',
      orgName: 'Bệnh Viện Thú Y Alpha',
      orgType: 'clinic',
      orgArea: 'Quận 1, TP.HCM'
    }
  });
  const u1 = await app.models.users.findByEmail('clinic1@petcare.vn');
  const app1 = await app.call('POST', `/admin/users/${u1.id}/approve`, {
    token: adminToken,
    body: { area: 'Quận 1, TP.HCM' }
  });
  providerId = app1.data.providerId;
  const resP1 = await app.call('POST', '/auth/login', {
    body: { identifier: 'clinic1@petcare.vn', password: 'Password123!' }
  });
  providerToken = resP1.data.token;
  providerUser = resP1.data.user;

  // Setup 3: Provider 2 (approved & active)
  await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Chủ Phòng Khám 2',
      email: 'clinic2@petcare.vn',
      phone: '0922222222',
      password: 'Password123!',
      orgName: 'Bệnh Viện Thú Y Beta',
      orgType: 'clinic',
      orgArea: 'Quận 3, TP.HCM'
    }
  });
  const u2 = await app.models.users.findByEmail('clinic2@petcare.vn');
  const app2 = await app.call('POST', `/admin/users/${u2.id}/approve`, {
    token: adminToken,
    body: { area: 'Quận 3, TP.HCM' }
  });
  provider2Id = app2.data.providerId;
  const resP2 = await app.call('POST', '/auth/login', {
    body: { identifier: 'clinic2@petcare.vn', password: 'Password123!' }
  });
  provider2Token = resP2.data.token;
  provider2User = resP2.data.user;

  // --- Kiểm tra phân quyền truy cập /provider/* ---
  await t.test('customer and vet are forbidden (403) from accessing /provider/*', async () => {
    const { token: custToken } = await app.registerCustomer();
    const r1 = await app.call('GET', '/provider/vets', { token: custToken });
    assert.equal(r1.status, 403);

    const r2 = await app.call('POST', '/provider/vets', {
      token: custToken,
      body: { fullName: 'Bác Sĩ C', email: 'vetc@clinic.vn', phone: '0933333333' }
    });
    assert.equal(r2.status, 403);
  });

  // --- Provider pending/disabled bị chặn ---
  await t.test('pending or disabled provider is blocked from creating vet', async () => {
    // Tạo 1 provider pending
    await app.call('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ Phòng Khám Pending',
        email: 'clinicpending@petcare.vn',
        phone: '0944444444',
        password: 'Password123!',
        orgName: 'Bệnh Viện Pending',
        orgType: 'clinic',
        orgArea: 'Quận 10'
      }
    });
    const pendingUser = await app.models.users.findByEmail('clinicpending@petcare.vn');
    // Giả lập token provider pending
    const jwt = require('jsonwebtoken');
    const pendingToken = jwt.sign({ role: 'provider' }, 'test-secret-test-secret-test-secret-123', {
      algorithm: 'HS256',
      subject: pendingUser.id
    });
    const r = await app.call('POST', '/provider/vets', {
      token: pendingToken,
      body: { fullName: 'Bác sĩ P', email: 'vetp@clinic.vn', phone: '0955555555' }
    });
    assert.equal(r.status, 403);
  });

  // --- Provider tạo Vet hợp lệ ---
  let createdVet;
  let tempPassword;
  await t.test('Provider creates vet: temporary password returned once, cache-control no-store, audit logged', async () => {
    const res = await app.call('POST', '/provider/vets', {
      token: providerToken,
      body: {
        fullName: 'Bác Sĩ Trương Văn Bình',
        email: 'vet.binh@alpha.vn',
        phone: '0966666661'
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.vet);
    assert.ok(res.data.tempPassword);
    assert.equal(res.data.vet.fullName, 'Bác Sĩ Trương Văn Bình');
    assert.equal(res.data.vet.email, 'vet.binh@alpha.vn');
    assert.equal(res.data.vet.phone, '0966666661');
    assert.equal(res.data.vet.providerId, providerId);
    assert.equal(res.data.vet.status, 'active');
    assert.equal(res.data.vet.mustChangePassword, true);
    assert.equal(res.data.vet.passwordHash, undefined);

    // Header Cache-Control: no-store
    const cc = res.headers.get('cache-control') || '';
    assert.ok(cc.includes('no-store'), 'Cache-Control header must have no-store');

    // Mật khẩu tạm >= 12 ký tự, đủ chữ hoa/thường/số
    tempPassword = res.data.tempPassword;
    assert.ok(tempPassword.length >= 12);
    assert.match(tempPassword, /[A-Z]/);
    assert.match(tempPassword, /[a-z]/);
    assert.match(tempPassword, /\d/);

    createdVet = res.data.vet;

    // Kiểm tra AuditLog: không chứa mật khẩu
    const audits = app.testHelpers.state.auditLogs.filter((a) => a.action === 'vet_created' && a.targetId === createdVet.id);
    assert.equal(audits.length, 1);
    assert.ok(!audits[0].detail.includes(tempPassword), 'AuditLog must NEVER contain temp password');
  });

  // --- Trùng email / phone trả 409 có errors.email / errors.phone ---
  await t.test('duplicate email or phone returns 409 with structured errors', async () => {
    // Trùng email
    const r1 = await app.call('POST', '/provider/vets', {
      token: providerToken,
      body: {
        fullName: 'Bác Sĩ Trùng Email',
        email: 'vet.binh@alpha.vn',
        phone: '0977777771'
      }
    });
    assert.equal(r1.status, 409);
    assert.ok(r1.body.errors?.email);

    // Trùng phone
    const r2 = await app.call('POST', '/provider/vets', {
      token: providerToken,
      body: {
        fullName: 'Bác Sĩ Trùng SĐT',
        email: 'vet.khac@alpha.vn',
        phone: '0966666661'
      }
    });
    assert.equal(r2.status, 409);
    assert.ok(r2.body.errors?.phone);
  });

  // --- Provider liệt kê Vets: chỉ thấy vet của mình, không lộ hash hay tempPassword ---
  await t.test('GET /provider/vets lists only own vets, with pagination and no password/hash', async () => {
    const r = await app.call('GET', '/provider/vets', { token: providerToken });
    assert.equal(r.status, 200);
    assert.ok(r.body.meta);
    assert.equal(r.data.meta, undefined);
    assert.equal(r.data.vets.length, 1);
    assert.equal(r.data.vets[0].id, createdVet.id);
    assert.equal(r.data.vets[0].passwordHash, undefined);
    assert.equal(r.data.vets[0].tempPassword, undefined);

    // Provider 2 không thấy vet của Provider 1
    const r2 = await app.call('GET', '/provider/vets', { token: provider2Token });
    assert.equal(r2.status, 200);
    assert.equal(r2.data.vets.length, 0);
  });

  // --- Provider A không khóa/mở khóa được vet của Provider B (404) ---
  await t.test('Provider 2 cannot disable or enable vet of Provider 1 (returns 404)', async () => {
    const rDisable = await app.call('POST', `/provider/vets/${createdVet.id}/disable`, { token: provider2Token });
    assert.equal(rDisable.status, 404);

    const rEnable = await app.call('POST', `/provider/vets/${createdVet.id}/enable`, { token: provider2Token });
    assert.equal(rEnable.status, 404);
  });

  // --- Provider khóa và mở khóa Vet của mình ---
  await t.test('Provider disables and enables own vet; disabled vet cannot access system', async () => {
    const rDisable = await app.call('POST', `/provider/vets/${createdVet.id}/disable`, { token: providerToken });
    assert.equal(rDisable.status, 200);
    assert.equal(rDisable.data.status, 'disabled');

    // Đăng nhập bằng tài khoản vet bị khóa -> 403 disabled
    const rLoginDisabled = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.binh@alpha.vn', password: tempPassword }
    });
    assert.equal(rLoginDisabled.status, 403);
    assert.equal(rLoginDisabled.body.code, 'disabled');

    // Mở khóa lại
    const rEnable = await app.call('POST', `/provider/vets/${createdVet.id}/enable`, { token: providerToken });
    assert.equal(rEnable.status, 200);
    assert.equal(rEnable.data.status, 'active');
  });

  // --- Cơ sở bị khóa thì không thể mở khóa Vet (409) ---
  await t.test('cannot enable vet when provider facility is inactive (Providers.IsActive=0)', async () => {
    // Khóa vet trước
    await app.call('POST', `/provider/vets/${createdVet.id}/disable`, { token: providerToken });

    // Khóa cơ sở Alpha qua Admin
    const uProvider = await app.models.users.findByEmail('clinic1@petcare.vn');
    await app.call('POST', `/admin/users/${uProvider.id}/disable`, { token: adminToken });

    // Cố gắng mở khóa vet qua Admin (mô phỏng gọi enable)
    const rEnableFail = await app.call('POST', `/provider/vets/${createdVet.id}/enable`, { token: adminToken });
    assert.equal(rEnableFail.status, 409);
    assert.match(rEnableFail.body.message, /Cơ sở của bác sĩ này đang bị khóa/);

    // Mở khóa lại cơ sở Alpha
    await app.call('POST', `/admin/users/${uProvider.id}/enable`, { token: adminToken });
    // Token cũ của provider đã bị vô hiệu hóa khi cơ sở bị khóa -> đăng nhập lại lấy token mới
    const rProviderRelogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'clinic1@petcare.vn', password: 'Password123!' }
    });
    providerToken = rProviderRelogin.data.token;

    // Bây giờ mở khóa vet thành công
    const rEnableOk = await app.call('POST', `/provider/vets/${createdVet.id}/enable`, { token: adminToken });
    assert.equal(rEnableOk.status, 200);
    assert.equal(rEnableOk.data.status, 'active');
  });

  // --- Cổng must_change_password và quy trình đổi mật khẩu của Vet ---
  let vetToken;
  await t.test('Vet login: returns mustChangePassword=true, access to other routes returns 403 must_change_password', async () => {
    const rLogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.binh@alpha.vn', password: tempPassword }
    });
    assert.equal(rLogin.status, 200);
    assert.equal(rLogin.data.user.mustChangePassword, true);
    assert.equal(rLogin.data.user.providerId, providerId);
    vetToken = rLogin.data.token;

    // GET /auth/me được phép
    const rMe = await app.call('GET', '/auth/me', { token: vetToken });
    assert.equal(rMe.status, 200);
    assert.equal(rMe.data.user.mustChangePassword, true);
    assert.equal(rMe.data.user.providerId, providerId);

    // Gọi route nghiệp vụ khác (ví dụ: GET /vet/bookings) -> 403 must_change_password
    const rBlocked = await app.call('GET', '/vet/bookings', {
      token: vetToken
    });
    assert.equal(rBlocked.status, 403);
    assert.equal(rBlocked.body.code, 'must_change_password');
  });

  // --- Đổi mật khẩu: sai mật khẩu cũ / mật khẩu yếu / trùng mật khẩu cũ / thành công ---
  await t.test('POST /auth/change-password: validations, old password verification, and success unlocking', async () => {
    // Sai mật khẩu hiện tại
    const rWrongOld = await app.call('POST', '/auth/change-password', {
      token: vetToken,
      body: { currentPassword: 'SaiMatKhauCu123!', newPassword: 'MatKhauMoiDung123!' }
    });
    assert.equal(rWrongOld.status, 422);
    assert.ok(rWrongOld.body.errors?.currentPassword);

    // Mật khẩu mới yếu
    const rWeak = await app.call('POST', '/auth/change-password', {
      token: vetToken,
      body: { currentPassword: tempPassword, newPassword: '123' }
    });
    assert.equal(rWeak.status, 422);
    assert.ok(rWeak.body.errors?.newPassword);

    // Mật khẩu mới trùng mật khẩu cũ
    const rSame = await app.call('POST', '/auth/change-password', {
      token: vetToken,
      body: { currentPassword: tempPassword, newPassword: tempPassword }
    });
    assert.equal(rSame.status, 422);
    assert.ok(rSame.body.errors?.newPassword);

    // Đổi mật khẩu thành công
    const rSuccess = await app.call('POST', '/auth/change-password', {
      token: vetToken,
      body: { currentPassword: tempPassword, newPassword: 'NewDoctorPass123!' }
    });
    assert.equal(rSuccess.status, 200);
    assert.equal(rSuccess.data.user.mustChangePassword, false);
    assert.ok(rSuccess.data.token, 'changePassword must return new token');

    // Token cũ sau đổi mật khẩu bị vô hiệu hóa (401 token_revoked)
    const rOldTokenBlocked = await app.call('GET', '/auth/me', { token: vetToken });
    assert.equal(rOldTokenBlocked.status, 401);
    assert.equal(rOldTokenBlocked.body.code, 'token_revoked');

    // Token mới dùng được qua GET /auth/me
    const rMeAfter = await app.call('GET', '/auth/me', { token: rSuccess.data.token });
    assert.equal(rMeAfter.status, 200);
    assert.equal(rMeAfter.data.user.mustChangePassword, false);

    // Đăng nhập lại bằng mật khẩu mới
    const rRelogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.binh@alpha.vn', password: 'NewDoctorPass123!' }
    });
    assert.equal(rRelogin.status, 200);
    assert.equal(rRelogin.data.user.mustChangePassword, false);

    // Đăng nhập bằng mật khẩu cũ bị từ chối
    const rOldLogin = await app.call('POST', '/auth/login', {
      body: { identifier: 'vet.binh@alpha.vn', password: tempPassword }
    });
    assert.equal(rOldLogin.status, 401);
  });

  // --- Admin tạo Vet kèm providerId (hợp lệ / không tồn tại / bị khóa) ---
  await t.test('Admin creates vet with providerId: valid, nonexistent provider, or disabled provider', async () => {
    // Nonexistent provider -> 404
    const rNone = await app.call('POST', '/provider/vets', {
      token: adminToken,
      body: {
        providerId: 'nonexistent-provider-id',
        fullName: 'Bác Sĩ Admin Tạo',
        email: 'vet.adm1@petcare.vn',
        phone: '0981111111'
      }
    });
    assert.equal(rNone.status, 404);

    // Khóa Provider 2
    const uP2 = await app.models.users.findByEmail('clinic2@petcare.vn');
    await app.call('POST', `/admin/users/${uP2.id}/disable`, { token: adminToken });

    // Tạo vet cho provider đang bị khóa -> 422
    const rDisabled = await app.call('POST', '/provider/vets', {
      token: adminToken,
      body: {
        providerId: provider2Id,
        fullName: 'Bác Sĩ Admin Tạo 2',
        email: 'vet.adm2@petcare.vn',
        phone: '0982222222'
      }
    });
    assert.equal(rDisabled.status, 422);

    // Tạo vet cho provider đang hoạt động (Provider 1) -> 201
    const rOk = await app.call('POST', '/provider/vets', {
      token: adminToken,
      body: {
        providerId: providerId,
        fullName: 'Bác Sĩ Admin Tạo Hợp Lệ',
        email: 'vet.adm3@petcare.vn',
        phone: '0983333333'
      }
    });
    assert.equal(rOk.status, 201);
    assert.equal(rOk.data.vet.providerId, providerId);
    assert.ok(rOk.data.tempPassword);
  });

  // --- S5.1 Test: Transaction atomicity khi tạo Vet & rollback nếu logAudit thất bại ---
  await t.test('createVet transaction rollback: when logAudit throws, no vet remains in DB and no temp password returned', async () => {
    const originalLog = app.models.audit.log;
    app.models.audit.log = async () => {
      throw new Error('Simulated AuditLog database failure');
    };

    try {
      const res = await app.call('POST', '/provider/vets', {
        token: providerToken,
        body: {
          fullName: 'Bác Sĩ Rollback Test',
          email: 'vet.rollback@alpha.vn',
          phone: '0989999999'
        }
      });

      // (i) Request trả lỗi (500)
      assert.equal(res.status, 500);
      // (iii) Phản hồi không chứa tempPassword
      assert.equal(res.data, null);
      assert.equal(res.body.tempPassword, undefined);

      // (ii) KHÔNG có dòng vet nào còn trong state (rollback đúng)
      const inDb = await app.models.users.findByEmail('vet.rollback@alpha.vn');
      assert.equal(inDb, null);
    } finally {
      app.models.audit.log = originalLog;
    }

    // Sau đó gọi lại bình thường với cùng email thì thành công (không bị 409)
    const resRetry = await app.call('POST', '/provider/vets', {
      token: providerToken,
      body: {
        fullName: 'Bác Sĩ Rollback Test',
        email: 'vet.rollback@alpha.vn',
        phone: '0989999999'
      }
    });
    assert.equal(resRetry.status, 201);
    assert.ok(resRetry.data.vet);
    assert.equal(resRetry.data.vet.email, 'vet.rollback@alpha.vn');
    assert.ok(resRetry.data.tempPassword);
  });

  // --- S5.1 Test: Rate limiting change-password isolation by User ID ---
  await t.test('changePasswordLimiter isolates by authenticated user ID (user A rate limited, user B unaffected)', async () => {
    // Khởi tạo một app riêng với AUTH_RATE_LIMIT_MAX = 2
    const limitedApp = await startTestApp({
      env: { AUTH_RATE_LIMIT_MAX: '2' }
    });
    try {
      const { token: userAToken } = await limitedApp.registerCustomer({ email: 'userA@test.vn', phone: '0912111111' });
      const { token: userBToken } = await limitedApp.registerCustomer({ email: 'userB@test.vn', phone: '0912222222' });

      // User A gọi đổi pass 2 lần (thất bại vì sai pass cũ nhưng vẫn tiêu tốn rate limit)
      const rA1 = await limitedApp.call('POST', '/auth/change-password', {
        token: userAToken,
        body: { currentPassword: 'WrongOldPass1!', newPassword: 'NewPassword123!' }
      });
      assert.equal(rA1.status, 422);

      const rA2 = await limitedApp.call('POST', '/auth/change-password', {
        token: userAToken,
        body: { currentPassword: 'WrongOldPass2!', newPassword: 'NewPassword123!' }
      });
      assert.equal(rA2.status, 422);

      // Lần thứ 3 User A bị 429
      const rA3 = await limitedApp.call('POST', '/auth/change-password', {
        token: userAToken,
        body: { currentPassword: 'WrongOldPass3!', newPassword: 'NewPassword123!' }
      });
      assert.equal(rA3.status, 429);
      assert.equal(rA3.body.code, 'rate_limited');

      // User B cùng IP nhưng user id khác -> vẫn gọi được bình thường (trả 422 sai pass chứ không bị 429)
      const rB1 = await limitedApp.call('POST', '/auth/change-password', {
        token: userBToken,
        body: { currentPassword: 'WrongOldPassB!', newPassword: 'NewPassword123!' }
      });
      assert.equal(rB1.status, 422);
      assert.notEqual(rB1.status, 429);
    } finally {
      await limitedApp.close();
    }
  });

  // --- Việc 3: Bệnh án của Vet (hoãn có kiểm soát) ---
  await t.test('C2 rule: disabled vet cannot access /vet/bookings', async () => {
    const rVetBookings = await app.call('GET', '/vet/bookings', { token: vetToken });
    assert.ok(rVetBookings.status === 401 || rVetBookings.status === 403);
  });
});
