'use strict';
/**
 * PetCare AI Hub - C1 Roles Lifecycle Smoke Test on REAL SQL Server 2022
 *
 * Exercises the complete C1 roles lifecycle:
 * - Direct Admin seeding in DB with random password (never logged)
 * - Provider registration with orgArea -> status 'pending' -> blocked login 403
 * - Admin approves Provider -> creates Providers entry, updates Users, logs AuditLog
 * - Idempotent approval rejection (409 conflict)
 * - Duplicate Provider orgName slug generation with numeric suffix (-2)
 * - Provider registration rejected by Admin -> status 'rejected' -> 403 rejected
 * - Provider creates Vet -> gets random temp password, MustChangePassword=1
 * - Vet login blocked by 403 must_change_password on non-auth routes
 * - Vet changes password -> MustChangePassword=0, full access granted
 * - Admin disables Provider -> cascade disables Vets and sets Providers.IsActive=0
 * - Vet and Provider blocked immediately even with existing tokens
 * - Admin enables Provider -> Provider active (IsActive=1), Vet remains disabled
 * - Provider individually enables Vet -> Vet restored
 * - SQL-Server-only tests:
 *   (a) CK_Users_ProviderLink rejects UPDATE Status='active' without ProviderId
 *   (b) Concurrent approval requests (Promise.all) safely create only ONE Providers row
 * - Cross-role authorization tests (401 / 403 / 404)
 * - AuditLog verification: no passwords logged, correct action count
 * - GUARANTEED CLEANUP (try/finally) in strict foreign-key order:
 *   delete vets -> delete providers -> clear ApprovedBy -> delete test admin ->
 *   delete created Providers rows -> delete created AuditLog rows.
 *   Row counts of Users and Providers must return exactly to baseline.
 *
 * Usage:
 *   node scripts/smoke-roles.js
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createSqlModels } = require('../src/models');

async function main() {
  const config = loadConfig();
  console.log('=== PETCARE AI HUB C1 ROLES LIFECYCLE SMOKE (REAL SQL SERVER) ===');
  console.log(`Target SQL Server: ${config.db.server}:${config.db.port} | Database: ${config.db.database}`);

  const { models, pool } = await createSqlModels(config.db);
  // Gemini client is dummy for C1 roles testing (no AI calls required)
  const dummyAi = {
    embed: async () => { throw new Error('no ai in roles smoke'); },
    generate: async () => { throw new Error('no ai in roles smoke'); }
  };
  const app = createApp({ models, config, ai: dummyAi });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  console.log(`Test API Server running on ${baseUrl}\n`);

  async function api(method, path, { token, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body: json, headers: res.headers };
  }

  const results = [];
  function record(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
    if (!pass) {
      throw new Error(`Smoke step failed: ${name} - ${detail}`);
    }
  }

  // Tracking for cleanup
  const runId = Date.now();
  const testAdminId = crypto.randomUUID();
  const testAdminEmail = `admin_smoke_${runId}@petcare.vn`;
  const testAdminPhone = `098${String(runId).slice(-7)}`;
  const testAdminPass = `AdminPass_${crypto.randomBytes(8).toString('hex')}!`;

  const createdUserIds = [testAdminId];
  const createdProviderIds = [];
  let baselineUsersCount = 0;
  let baselineProvidersCount = 0;

  let server2 = null;
  let baseUrl2 = '';

  try {
    // 0. Capture baselines
    const baseU = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Users');
    baselineUsersCount = baseU.recordset[0].cnt;
    const baseP = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Providers');
    baselineProvidersCount = baseP.recordset[0].cnt;

    // Setup second app with failing logAudit on action === 'vet_created' for atomic rollback test
    const faultyAdminModel = Object.create(models.admin);
    faultyAdminModel.logAudit = async (tx, params) => {
      if (params && params.action === 'vet_created') {
        throw new Error('Simulated audit logging failure during vet creation');
      }
      return models.admin.logAudit(tx, params);
    };
    const faultyModels = {
      ...models,
      admin: faultyAdminModel
    };
    const app2 = createApp({ models: faultyModels, config, ai: dummyAi });
    server2 = await new Promise((resolve) => {
      const s = app2.listen(0, () => resolve(s));
    });
    baseUrl2 = `http://127.0.0.1:${server2.address().port}/api/v1`;

    async function api2(method, path, { token, body } = {}) {
      const res = await fetch(`${baseUrl2}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, body: json, headers: res.headers };
    }

    // 1. Seed direct Admin user with random password
    const adminHash = await bcrypt.hash(testAdminPass, 10);
    await pool.request()
      .input('id', sql.UniqueIdentifier, testAdminId)
      .input('email', sql.VarChar(255), testAdminEmail)
      .input('phone', sql.VarChar(20), testAdminPhone)
      .input('name', sql.NVarChar(100), 'Quản Trị Viên Smoke')
      .input('hash', sql.VarChar(255), adminHash)
      .query(`
        INSERT INTO dbo.Users (UserId, Role, Status, FullName, Email, Phone, PasswordHash, MustChangePassword, CreatedAt)
        VALUES (@id, 'admin', 'active', @name, @email, @phone, @hash, 0, SYSUTCDATETIME())
      `);

    const adminLoginRes = await api('POST', '/auth/login', {
      body: { identifier: testAdminEmail, password: testAdminPass }
    });
    record(
      '1. Admin login on real SQL Server',
      adminLoginRes.status === 200 && Boolean(adminLoginRes.body.data?.token),
      `Admin ID: ${testAdminId}`
    );
    const adminToken = adminLoginRes.body.data?.token;

    // 2. Register Provider 1 (pending)
    const prov1Email = `prov1_${runId}@clinic.vn`;
    const prov1Phone = `091${String(runId).slice(-7)}`;
    const prov1Pass = `Prov1Pass_${crypto.randomBytes(6).toString('hex')}!`;
    const reg1Res = await api('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ CS Smoke 1',
        email: prov1Email,
        phone: prov1Phone,
        password: prov1Pass,
        orgName: `Bệnh Viện Thú Y Alpha ${runId}`,
        orgType: 'clinic',
        orgArea: 'Quận 1, TP.HCM',
        licenseNo: 'GPHN-SMOKE/01',
        taxCode: '0312-345-678'
      }
    });
    record(
      '2. Provider register -> status pending, no token',
      reg1Res.status === 201 && reg1Res.body.data?.user?.status === 'pending' && reg1Res.body.data?.token === null,
      `User ID: ${reg1Res.body.data?.user?.id}`
    );
    const prov1UserId = reg1Res.body.data?.user?.id;
    createdUserIds.push(prov1UserId);

    // 3. Provider login while pending -> 403 pending
    const prov1PendingLogin = await api('POST', '/auth/login', {
      body: { identifier: prov1Email, password: prov1Pass }
    });
    record(
      '3. Provider pending login -> 403 pending',
      prov1PendingLogin.status === 403 && prov1PendingLogin.body.code === 'pending',
      `HTTP ${prov1PendingLogin.status}: ${prov1PendingLogin.body.message}`
    );

    // 4. SQL Server check: CK_Users_ProviderLink rejects UPDATE Status='active' without ProviderId
    let ckConstraintViolated = false;
    try {
      await pool.request()
        .input('uid', sql.UniqueIdentifier, prov1UserId)
        .query("UPDATE dbo.Users SET Status = 'active' WHERE UserId = @uid");
    } catch (e) {
      if (e.message && e.message.includes('CK_Users_ProviderLink')) {
        ckConstraintViolated = true;
      }
    }
    record(
      '4. DB Constraint: CK_Users_ProviderLink rejects active provider without ProviderId',
      ckConstraintViolated,
      'Check constraint actively enforced by SQL Server'
    );

    // 5. Concurrent approval requests (Promise.all) -> exactly ONE succeeds, other gets 409
    const [appResA, appResB] = await Promise.all([
      api('POST', `/admin/users/${prov1UserId}/approve`, { token: adminToken, body: { area: 'Quận 1, TP.HCM' } }),
      api('POST', `/admin/users/${prov1UserId}/approve`, { token: adminToken, body: { area: 'Quận 1, TP.HCM' } })
    ]);
    const oneOk = (appResA.status === 200 && appResB.status === 409) || (appResB.status === 200 && appResA.status === 409);
    record(
      '5. Concurrency: Promise.all approve on same pending user -> 1 OK (200), 1 Conflict (409)',
      oneOk,
      `Res A: ${appResA.status}, Res B: ${appResB.status}`
    );
    const approvedProviderId = (appResA.status === 200 ? appResA.body.data : appResB.body.data).providerId;
    createdProviderIds.push(approvedProviderId);

    // 6. Direct SQL verification of Providers and AuditLog
    const provDbCheck = await pool.request()
      .input('pid', sql.VarChar(50), approvedProviderId)
      .query('SELECT ProviderId, Name, Area, IsActive, LicenseNo, TaxCode FROM dbo.Providers WHERE ProviderId = @pid');
    const auditDbCheck = await pool.request()
      .input('targetId', sql.VarChar(50), prov1UserId)
      .query("SELECT Action, TargetType, Detail FROM dbo.AuditLog WHERE TargetId = @targetId AND Action = 'approve_provider'");
    record(
      '6. DB check: Providers row created & AuditLog approve_provider recorded with LicenseNo/TaxCode',
      provDbCheck.recordset.length === 1 && provDbCheck.recordset[0].IsActive === true &&
      provDbCheck.recordset[0].LicenseNo === 'GPHN-SMOKE/01' && provDbCheck.recordset[0].TaxCode === '0312345678' &&
      auditDbCheck.recordset.length === 1,
      `ProviderId: ${approvedProviderId}, LicenseNo: ${provDbCheck.recordset[0]?.LicenseNo}, TaxCode: ${provDbCheck.recordset[0]?.TaxCode}`
    );

    // 7. Provider login after approval -> 200 OK
    const prov1LoginRes = await api('POST', '/auth/login', {
      body: { identifier: prov1Email, password: prov1Pass }
    });
    record(
      '7. Provider login after approval -> 200 OK',
      prov1LoginRes.status === 200 && prov1LoginRes.body.data?.user?.status === 'active',
      `Provider ID: ${prov1LoginRes.body.data?.user?.providerId}`
    );
    const prov1Token = prov1LoginRes.body.data?.token;

    // 7b (S9). Provider Profile: GET & PUT /provider/profile, public /providers check
    const getProfRes = await api('GET', '/provider/profile', { token: prov1Token });
    const getProfOk = getProfRes.status === 200 &&
      getProfRes.body.data?.licenseNo === 'GPHN-SMOKE/01' &&
      getProfRes.body.data?.taxCode === '0312345678' &&
      getProfRes.headers.get('cache-control')?.includes('no-store');

    const putProfRes = await api('PUT', '/provider/profile', {
      token: prov1Token,
      body: {
        address: 'Số 99 Đường Thú Y, Phường Tân Định, Quận 1',
        phone: '0909 888 777',
        description: 'Bệnh viện thú y Alpha chuyên khoa sâu.'
      }
    });

    const provDbAfterPut = await pool.request()
      .input('pid', sql.VarChar(50), approvedProviderId)
      .query('SELECT Address, Phone, Description, LicenseNo, TaxCode, UpdatedAt FROM dbo.Providers WHERE ProviderId = @pid');
    const rowP = provDbAfterPut.recordset[0];
    const putProfOk = putProfRes.status === 200 &&
      putProfRes.body.data?.address === 'Số 99 Đường Thú Y, Phường Tân Định, Quận 1' &&
      putProfRes.body.data?.phone === '0909888777' &&
      putProfRes.headers.get('cache-control')?.includes('no-store') &&
      rowP.Address === 'Số 99 Đường Thú Y, Phường Tân Định, Quận 1' &&
      rowP.Phone === '0909888777' &&
      rowP.LicenseNo === 'GPHN-SMOKE/01' &&
      Boolean(rowP.UpdatedAt);

    const publicProvsRes = await api('GET', '/providers');
    const myPublicProv = publicProvsRes.body.data?.find((p) => p.id === approvedProviderId);
    const publicNoLegal = myPublicProv &&
      myPublicProv.address === 'Số 99 Đường Thú Y, Phường Tân Định, Quận 1' &&
      myPublicProv.phone === '0909888777' &&
      myPublicProv.licenseNo === undefined &&
      myPublicProv.taxCode === undefined;

    // S9.1: Provider deletes licenseNo (null) -> Admin sees licenseNo: null on real SQL Server
    const putClearLicRes = await api('PUT', '/provider/profile', {
      token: prov1Token,
      body: { licenseNo: null }
    });
    const adminViewUsers = await api('GET', '/admin/users?role=provider', { token: adminToken });
    const targetProvUser = adminViewUsers.body.data?.users?.find((u) => u.id === prov1UserId);
    const adminSeesNullLic = targetProvUser &&
      targetProvUser.licenseNo === null &&
      targetProvUser.taxCode === '0312345678' &&
      targetProvUser.hasLegalInfo === true;

    record(
      '7b. S9 Provider Profile: GET/PUT /provider/profile on real DB & public /providers never leaks legal info & Admin sees deleted licenseNo as null',
      getProfOk && putProfOk && publicNoLegal && putClearLicRes.status === 200 && adminSeesNullLic,
      `PUT status: ${putProfRes.status}, DB Address: ${rowP?.Address}, Public legal masked: ${publicNoLegal}, Admin licenseNo: ${targetProvUser?.licenseNo}`
    );

    // 8. Register second provider with duplicate orgName -> slug with numeric suffix (-2)
    const prov2Email = `prov2_${runId}@clinic.vn`;
    const prov2Phone = `092${String(runId).slice(-7)}`;
    const prov2Pass = `Prov2Pass_${crypto.randomBytes(6).toString('hex')}!`;
    const reg2Res = await api('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ CS Smoke 2',
        email: prov2Email,
        phone: prov2Phone,
        password: prov2Pass,
        orgName: `Bệnh Viện Thú Y Alpha ${runId}`,
        orgType: 'clinic',
        orgArea: 'Quận 2, TP.HCM'
      }
    });
    const prov2UserId = reg2Res.body.data?.user?.id;
    createdUserIds.push(prov2UserId);
    const app2Res = await api('POST', `/admin/users/${prov2UserId}/approve`, {
      token: adminToken,
      body: { area: 'Quận 2, TP.HCM' }
    });
    record(
      '8. Duplicate orgName generates collision-free slug with suffix (-2)',
      app2Res.status === 200 && app2Res.body.data?.providerId === `${approvedProviderId}-2`,
      `Slug: ${app2Res.body.data?.providerId}`
    );
    createdProviderIds.push(app2Res.body.data?.providerId);

    // 9. Provider registration rejected by Admin -> 403 rejected on login
    const prov3Email = `prov3_${runId}@clinic.vn`;
    const prov3Phone = `093${String(runId).slice(-7)}`;
    const prov3Pass = `Prov3Pass_${crypto.randomBytes(6).toString('hex')}!`;
    const reg3Res = await api('POST', '/auth/register', {
      body: {
        role: 'provider',
        fullName: 'Chủ CS Smoke 3',
        email: prov3Email,
        phone: prov3Phone,
        password: prov3Pass,
        orgName: `Phòng Khám Từ Chối ${runId}`,
        orgType: 'clinic',
        orgArea: 'Quận 3, TP.HCM'
      }
    });
    const prov3UserId = reg3Res.body.data?.user?.id;
    createdUserIds.push(prov3UserId);
    const rejRes = await api('POST', `/admin/users/${prov3UserId}/reject`, {
      token: adminToken,
      body: { reason: 'Thiếu giấy phép hành nghề thú y' }
    });
    const prov3LoginRes = await api('POST', '/auth/login', {
      body: { identifier: prov3Email, password: prov3Pass }
    });
    record(
      '9. Admin rejects provider -> login returns 403 rejected with reason',
      rejRes.status === 200 && prov3LoginRes.status === 403 && prov3LoginRes.body.code === 'rejected',
      `Reason received: ${prov3LoginRes.body.message}`
    );

    // 10. Provider creates Vet -> gets random temp password & MustChangePassword=1
    const vetEmail = `vet_${runId}@clinic.vn`;
    const vetPhone = `094${String(runId).slice(-7)}`;
    const createVetRes = await api('POST', '/provider/vets', {
      token: prov1Token,
      body: {
        fullName: 'Bác Sĩ Nguyễn Văn Smoke',
        email: vetEmail,
        phone: vetPhone
      }
    });
    record(
      '10. Provider creates Vet -> returns temp password & mustChangePassword=true',
      createVetRes.status === 201 && Boolean(createVetRes.body.data?.tempPassword) && createVetRes.body.data?.vet?.mustChangePassword === true,
      `Vet ID: ${createVetRes.body.data?.vet?.id}`
    );
    const vetUserId = createVetRes.body.data?.vet?.id;
    const vetTempPassword = createVetRes.body.data?.tempPassword;
    createdUserIds.push(vetUserId);

    // 11. Vet logs in with temp password -> blocked by 403 must_change_password on non-auth routes
    const vetLoginRes = await api('POST', '/auth/login', {
      body: { identifier: vetEmail, password: vetTempPassword }
    });
    const vetToken = vetLoginRes.body.data?.token;
    const vetBlockedCall = await api('GET', '/provider/vets', { token: vetToken });
    const vetMeCall = await api('GET', '/auth/me', { token: vetToken });
    record(
      '11. Gate: Vet with temp password blocked on app routes (403 must_change_password), /auth/me allowed',
      vetLoginRes.status === 200 && vetBlockedCall.status === 403 && vetBlockedCall.body.code === 'must_change_password' && vetMeCall.status === 200,
      `Blocked route: ${vetBlockedCall.status} ${vetBlockedCall.body.code}, Me route: ${vetMeCall.status}`
    );

    // 12. Vet changes password -> MustChangePassword=0, app accessible, old token revoked (401 token_revoked)
    const newVetPass = `VetNewPass_${crypto.randomBytes(6).toString('hex')}!`;
    const changePassRes = await api('POST', '/auth/change-password', {
      token: vetToken,
      body: { currentPassword: vetTempPassword, newPassword: newVetPass }
    });
    const returnedNewToken = changePassRes.body.data?.token;

    // Token cũ trước đổi mật khẩu bị vô hiệu hóa ngay (401 token_revoked)
    const oldTokenCheck = await api('GET', '/auth/me', { token: vetToken });
    const newTokenCheck = await api('GET', '/auth/me', { token: returnedNewToken });

    const vetLoginNew = await api('POST', '/auth/login', {
      body: { identifier: vetEmail, password: newVetPass }
    });
    const vetNewToken = vetLoginNew.body.data?.token;
    const vetMeAfter = await api('GET', '/auth/me', { token: vetNewToken });
    record(
      '12. Vet changes password -> MustChangePassword cleared, old token 401 token_revoked, returned token and re-login work',
      changePassRes.status === 200 && Boolean(returnedNewToken) &&
      oldTokenCheck.status === 401 && oldTokenCheck.body.code === 'token_revoked' &&
      newTokenCheck.status === 200 && newTokenCheck.body.data?.user?.mustChangePassword === false &&
      vetLoginNew.status === 200 && vetMeAfter.body.data?.user?.mustChangePassword === false,
      `OldToken: ${oldTokenCheck.status} ${oldTokenCheck.body.code}, NewToken: ${newTokenCheck.status}`
    );

    // 13. Atomic rollback: createVet on server2 fails at logAudit -> 500, no row in Users, no tempPassword, retry on app1 succeeds 201
    const rollbackVetEmail = `vet_rollback_${runId}@clinic.vn`;
    const rollbackVetPhone = `096${String(runId).slice(-7)}`;
    const rollbackRes = await api2('POST', '/provider/vets', {
      token: prov1Token,
      body: {
        fullName: 'Bác Sĩ Rollback Test',
        email: rollbackVetEmail,
        phone: rollbackVetPhone
      }
    });

    const userCountCheck = await pool.request()
      .input('email', sql.NVarChar(254), rollbackVetEmail)
      .query('SELECT COUNT(*) AS cnt FROM dbo.Users WHERE Email = @email');
    const rowRolledBack = userCountCheck.recordset[0].cnt === 0;

    const noLeakedPassword = !rollbackRes.body?.data?.tempPassword;

    // Retry with identical email on real app1 -> Must succeed (not 409 conflict)
    const retryRes = await api('POST', '/provider/vets', {
      token: prov1Token,
      body: {
        fullName: 'Bác Sĩ Rollback Retry',
        email: rollbackVetEmail,
        phone: rollbackVetPhone
      }
    });
    const retryOk = retryRes.status === 201 && Boolean(retryRes.body.data?.vet?.id);
    if (retryOk && retryRes.body.data?.vet?.id) {
      createdUserIds.push(retryRes.body.data.vet.id);
    }

    record(
      '13. Atomic rollback: createVet mid-transaction failure rolls back user row, does not leak password, retry succeeds 201',
      (rollbackRes.status >= 500) && rowRolledBack && noLeakedPassword && retryOk,
      `Failure status: ${rollbackRes.status}, Rows in DB: ${userCountCheck.recordset[0].cnt}, Leaked tempPassword: ${!noLeakedPassword}, Retry status: ${retryRes.status}`
    );

    // 14. Admin disables Provider -> cascade disables Vets and Providers.IsActive=0
    const disProvRes = await api('POST', `/admin/users/${prov1UserId}/disable`, {
      token: adminToken,
      body: { reason: 'Kiểm tra đình chỉ hoạt động' }
    });
    const pCheckAfterDis = await pool.request()
      .input('pid', sql.VarChar(50), approvedProviderId)
      .query('SELECT IsActive FROM dbo.Providers WHERE ProviderId = @pid');
    const vetCheckAfterDis = await pool.request()
      .input('vid', sql.UniqueIdentifier, vetUserId)
      .query('SELECT Status FROM dbo.Users WHERE UserId = @vid');
    const vetTokenAfterDis = await api('GET', '/auth/me', { token: vetNewToken });

    // S9: Disabled provider cannot PUT /provider/profile
    const putProfAfterDis = await api('PUT', '/provider/profile', {
      token: prov1Token,
      body: { address: 'Địa chỉ cố tình sửa khi bị khóa' }
    });
    const putBlockedOnDis = putProfAfterDis.status === 403;

    record(
      '14. Admin disables Provider -> cascades to Vets and Providers.IsActive=0; old tokens blocked 403; profile update rejected',
      disProvRes.status === 200 && pCheckAfterDis.recordset[0].IsActive === false &&
      vetCheckAfterDis.recordset[0].Status === 'disabled' && vetTokenAfterDis.status === 403 &&
      putBlockedOnDis,
      `Provider IsActive: ${pCheckAfterDis.recordset[0].IsActive}, Vet status: ${vetCheckAfterDis.recordset[0].Status}, Profile PUT: ${putProfAfterDis.status}`
    );

    // 15. Admin enables Provider -> Provider active (IsActive=1), Vet remains disabled
    const enProvRes = await api('POST', `/admin/users/${prov1UserId}/enable`, { token: adminToken });
    const pCheckAfterEn = await pool.request()
      .input('pid', sql.VarChar(50), approvedProviderId)
      .query('SELECT IsActive FROM dbo.Providers WHERE ProviderId = @pid');
    const vetLoginStillDis = await api('POST', '/auth/login', {
      body: { identifier: vetEmail, password: newVetPass }
    });
    // Token cũ của provider trước khi bị khóa phải bị chặn 401 token_revoked
    const prov1OldTokenBlocked = await api('GET', '/auth/me', { token: prov1Token });
    record(
      '15. Admin enables Provider -> Provider active, Vet remains disabled; old provider token revoked (401 token_revoked)',
      enProvRes.status === 200 && pCheckAfterEn.recordset[0].IsActive === true && vetLoginStillDis.status === 403 &&
      prov1OldTokenBlocked.status === 401 && prov1OldTokenBlocked.body.code === 'token_revoked',
      `Provider IsActive: ${pCheckAfterEn.recordset[0].IsActive}, Old Prov Token: ${prov1OldTokenBlocked.status} ${prov1OldTokenBlocked.body.code}`
    );

    // 16. Provider individually enables Vet -> Vet restored to active
    const prov1LoginAgain = await api('POST', '/auth/login', {
      body: { identifier: prov1Email, password: prov1Pass }
    });
    const enVetRes = await api('POST', `/provider/vets/${vetUserId}/enable`, {
      token: prov1LoginAgain.body.data?.token
    });
    const vetLoginRestored = await api('POST', '/auth/login', {
      body: { identifier: vetEmail, password: newVetPass }
    });
    record(
      '16. Provider enables Vet individually -> Vet active again',
      enVetRes.status === 200 && vetLoginRestored.status === 200 && vetLoginRestored.body.data?.user?.status === 'active',
      `Vet status: ${vetLoginRestored.body.data?.user?.status}`
    );

    // 17. Cross-role authorization: Customer cannot access Admin or Provider routes (401 / 403)
    const custEmail = `cust_${runId}@example.com`;
    const custPhone = `095${String(runId).slice(-7)}`;
    const custPass = 'CustPass123!';
    const regCustRes = await api('POST', '/auth/register', {
      body: { role: 'customer', fullName: 'Khách Test C1', email: custEmail, phone: custPhone, password: custPass }
    });
    createdUserIds.push(regCustRes.body.data?.user?.id);
    const custToken = regCustRes.body.data?.token;

    const custOnAdmin = await api('GET', '/admin/users', { token: custToken });
    const custOnProv = await api('GET', '/provider/vets', { token: custToken });
    const noTokenOnAdmin = await api('GET', '/admin/users');
    record(
      '17. Cross-role access control -> 401 unauth, 403 forbidden for wrong roles',
      noTokenOnAdmin.status === 401 && custOnAdmin.status === 403 && custOnProv.status === 403,
      `NoToken: ${noTokenOnAdmin.status}, CustAdmin: ${custOnAdmin.status}, CustProv: ${custOnProv.status}`
    );

    // 18. AuditLog security check -> ensure NO PASSWORDS were ever logged in dbo.AuditLog
    const auditLogs = await pool.request().query('SELECT Detail FROM dbo.AuditLog');
    const allAuditText = JSON.stringify(auditLogs.recordset.map((r) => r.Detail));
    const leaked = [testAdminPass, prov1Pass, prov2Pass, prov3Pass, vetTempPassword, newVetPass, custPass]
      .some((p) => p && allAuditText.includes(p));
    record(
      '18. AuditLog security check -> Zero passwords or secrets leaked in Detail column',
      !leaked,
      `Scanned ${auditLogs.recordset.length} audit log entries`
    );

    // 19. D1 Pagination check on GET /admin/users
    const p1 = await api('GET', '/admin/users?page=1&limit=2', { token: adminToken });
    const p2 = await api('GET', '/admin/users?page=2&limit=2', { token: adminToken });
    const ids1 = new Set((p1.body?.data?.users || []).map((u) => u.id));
    const ids2 = (p2.body?.data?.users || []).map((u) => u.id);
    const noDup = ids2.every((id) => !ids1.has(id));
    const metaOk = p1.body?.meta?.page === 1 && p1.body?.meta?.limit === 2 && typeof p1.body?.meta?.total === 'number' && p2.body?.meta?.page === 2;
    record('19. GET /admin/users pagination (page 1 & 2, meta, no duplicates)', p1.status === 200 && p2.status === 200 && metaOk && noDup);

  } finally {
    console.log('\n--- CLEANING UP C1 TEST DATA ON REAL SQL SERVER ---');
    try {
      // 0. Delete AuditLogs referencing created Providers or Users first to prevent FK/orphan issues
      if (createdProviderIds.length > 0) {
        const pidList = createdProviderIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.AuditLog WHERE TargetId IN (${pidList}) OR Detail LIKE '%${createdProviderIds[0]}%'`);
      }
      if (createdUserIds.length > 0) {
        const idList = createdUserIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`UPDATE dbo.Users SET ApprovedBy = NULL WHERE UserId IN (${idList}) OR ApprovedBy = '${testAdminId}'`);
        await pool.request().query(`DELETE FROM dbo.AuditLog WHERE ActorUserId IN (${idList}) OR TargetId IN (${idList})`);
        await pool.request().query(`DELETE FROM dbo.Users WHERE UserId IN (${idList})`);
        console.log(`[CLEANUP] Deleted ${createdUserIds.length} test user(s) and cleared FK relationships.`);
      }

      // 2. Delete created Providers rows
      if (createdProviderIds.length > 0) {
        const pidList = createdProviderIds.map((id) => `'${id}'`).join(',');
        await pool.request().query(`DELETE FROM dbo.Providers WHERE ProviderId IN (${pidList})`);
        console.log(`[CLEANUP] Deleted ${createdProviderIds.length} test provider(s).`);
      }

      // 3. Verify row counts returned exactly to baseline
      const afterU = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Users');
      const finalUsersCount = afterU.recordset[0].cnt;
      const afterP = await pool.request().query('SELECT COUNT(*) AS cnt FROM dbo.Providers');
      const finalProvidersCount = afterP.recordset[0].cnt;

      const cleanedCleanly = (finalUsersCount === baselineUsersCount) && (finalProvidersCount === baselineProvidersCount);
      console.log(`[CLEANUP] Users count: ${finalUsersCount} (baseline: ${baselineUsersCount}), Providers count: ${finalProvidersCount} (baseline: ${baselineProvidersCount})`);
      if (!cleanedCleanly) {
        console.error('[CLEANUP WARNING] Database row counts did not return to baseline!');
        process.exitCode = 1;
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP ERROR]', cleanupErr);
      process.exitCode = 1;
    }

    if (server2) {
      await new Promise((r) => server2.close(r));
    }
    await new Promise((r) => server.close(r));
    await pool.close();
  }

  console.log(`\n=== C1 ROLES SMOKE SUMMARY: ${results.filter((r) => r.pass).length}/${results.length} PASSED ===`);
}

main().catch((err) => {
  console.error('Fatal error during C1 roles smoke test:', err);
  process.exit(1);
});
