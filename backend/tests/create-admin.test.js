'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createFakeModels } = require('./helpers/fake-models');
const { createAdminUser, parseArgs } = require('../scripts/create-admin');

describe('scripts/create-admin.js (unit & fake-models)', () => {
  test('parseArgs parses CLI arguments properly', () => {
    const parsed = parseArgs(['node', 'create-admin.js', '--email', 'admin@petcare.vn', '--name', 'Super Admin', '--phone', '0912345678']);
    assert.equal(parsed.email, 'admin@petcare.vn');
    assert.equal(parsed.name, 'Super Admin');
    assert.equal(parsed.phone, '0912345678');
  });

  test('successfully creates admin user and writes audit log', async () => {
    const { models } = createFakeModels();
    const res = await createAdminUser({
      email: 'admin@petcare.vn',
      name: 'Quản Trị Viên',
      phone: '0912345678',
      password: 'AdminPassword123',
      models,
      bcryptCost: 4
    });

    assert.equal(res.status, 'created');
    assert.equal(res.user.email, 'admin@petcare.vn');
    assert.equal(res.user.role, 'admin');
    assert.equal(res.user.status, 'active');
    assert.equal(res.user.mustChangePassword, false);

    const savedUser = await models.users.findByEmail('admin@petcare.vn');
    assert.ok(savedUser);
    assert.equal(savedUser.role, 'admin');
    assert.notEqual(savedUser.passwordHash, 'AdminPassword123');
  });

  test('rejects weak password or invalid email/phone', async () => {
    const { models } = createFakeModels();
    await assert.rejects(
      () => createAdminUser({
        email: 'invalid-email',
        name: 'A',
        phone: '1234',
        password: 'weak',
        models,
        bcryptCost: 4
      }),
      (err) => {
        assert.match(err.message, /Thông tin không hợp lệ/);
        return true;
      }
    );
  });

  test('idempotent: re-running with existing admin returns already_exists', async () => {
    const { models } = createFakeModels();
    const first = await createAdminUser({
      email: 'admin@petcare.vn',
      name: 'Quản Trị Viên',
      phone: '0912345678',
      password: 'AdminPassword123',
      models,
      bcryptCost: 4
    });
    assert.equal(first.status, 'created');

    const second = await createAdminUser({
      email: 'admin@petcare.vn',
      name: 'Quản Trị Viên Mới',
      phone: '0987654321',
      password: 'AnotherPassword123',
      models,
      bcryptCost: 4
    });
    assert.equal(second.status, 'already_exists');
    assert.equal(second.user.email, 'admin@petcare.vn');
  });

  test('refuses to covertly elevate role if email belongs to non-admin', async () => {
    const { models } = createFakeModels();
    await models.users.create({
      id: '00000000-0000-0000-0000-000000000001',
      role: 'customer',
      status: 'active',
      fullName: 'Khách Hàng',
      email: 'customer@petcare.vn',
      phone: '0912000001',
      passwordHash: 'hash'
    });

    await assert.rejects(
      () => createAdminUser({
        email: 'customer@petcare.vn',
        name: 'Admin Giả Mạo',
        phone: '0912000002',
        password: 'AdminPassword123',
        models,
        bcryptCost: 4
      }),
      (err) => {
        assert.equal(err.code, 'ROLE_CONFLICT');
        assert.match(err.message, /Không thể nâng quyền ngầm/);
        return true;
      }
    );
  });

  test('CLI invocation does NOT leak password in stdout or stderr', () => {
    const secretPass = 'SuperSecret123Pass!';
    const scriptPath = path.resolve(__dirname, '../scripts/create-admin.js');
    const res = spawnSync('node', [
      scriptPath,
      '--email', 'bad@test',
      '--name', 'A',
      '--phone', '0912345678'
    ], {
      env: { ...process.env, ADMIN_PASSWORD: secretPass },
      encoding: 'utf8'
    });

    assert.ok(!res.stdout.includes(secretPass), 'stdout must not contain password');
    assert.ok(!res.stderr.includes(secretPass), 'stderr must not contain password');
  });
});
