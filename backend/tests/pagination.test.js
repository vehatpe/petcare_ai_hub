'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { parsePagination, buildMeta } = require('../src/utils/pagination');
const { ok } = require('../src/utils/http');
const { startTestApp } = require('./helpers/harness');

test('parsePagination: defaults, clamping, offset ignored, and invalid inputs -> 422', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(parsePagination({ limit: '50' }), { page: 1, limit: 50, offset: 0 });
  assert.deepEqual(parsePagination({ limit: '51' }), { page: 1, limit: 50, offset: 0 });
  assert.deepEqual(parsePagination({ page: '2', limit: '10', offset: '40' }), { page: 2, limit: 10, offset: 10 });

  for (const bad of [{ page: '0' }, { page: '-1' }, { page: 'abc' }, { page: '1.5' }]) {
    assert.throws(
      () => parsePagination(bad),
      (err) => err.status === 422 && Boolean(err.errors?.page)
    );
  }
  for (const bad of [{ limit: '0' }, { limit: '-2' }, { limit: '1.5' }, { limit: 'xyz' }]) {
    assert.throws(
      () => parsePagination(bad),
      (err) => err.status === 422 && Boolean(err.errors?.limit)
    );
  }
});

test('buildMeta: total=0 -> totalPages=1, total=41 limit=20 -> 3', () => {
  assert.deepEqual(buildMeta({ page: 1, limit: 20, total: 0 }), { page: 1, limit: 20, total: 0, totalPages: 1 });
  assert.deepEqual(buildMeta({ page: 2, limit: 20, total: 41 }), { page: 2, limit: 20, total: 41, totalPages: 3 });
});

test('ok(): omits meta when undefined, includes top-level meta when provided', () => {
  const mkRes = () => {
    const res = { statusCode: null, payload: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.payload = body;
      return res;
    };
    return res;
  };

  const r1 = mkRes();
  ok(r1, { items: [] }, 'OK');
  assert.equal(r1.statusCode, 200);
  assert.equal('meta' in r1.payload, false);

  const r2 = mkRes();
  const meta = { page: 1, limit: 20, total: 0, totalPages: 1 };
  ok(r2, { items: [] }, 'OK', 200, meta);
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.payload.meta, meta);
});

test('Pagination across admin/users, provider/vets, provider/services & provider/vets/options', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  const pwHash = bcrypt.hashSync('TestPass123!', 4);
  await app.testHelpers.addStaff('admin', {
    id: crypto.randomUUID(),
    email: 'pag_admin@petcare.vn',
    phone: '0988000001',
    fullName: 'Admin Pag',
    passwordHash: pwHash
  });
  const adminToken = (await app.call('POST', '/auth/login', {
    body: { identifier: 'pag_admin@petcare.vn', password: 'TestPass123!' }
  })).data.token;

  const regProv1 = await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Provider 1',
      email: 'pag_prov1@petcare.vn',
      phone: '0988000002',
      password: 'TestPass123!',
      orgName: 'Cơ sở Phân Trang 1',
      orgType: 'clinic',
      orgArea: 'Quận 1'
    }
  });
  const prov1Id = (await app.call('POST', `/admin/users/${regProv1.data.user.id}/approve`, {
    token: adminToken,
    body: { area: 'Quận 1' }
  })).data.providerId;
  const provToken = (await app.call('POST', '/auth/login', {
    body: { identifier: 'pag_prov1@petcare.vn', password: 'TestPass123!' }
  })).data.token;

  const regProv2 = await app.call('POST', '/auth/register', {
    body: {
      role: 'provider',
      fullName: 'Provider 2',
      email: 'pag_prov2@petcare.vn',
      phone: '0988000003',
      password: 'TestPass123!',
      orgName: 'Cơ sở Phân Trang 2',
      orgType: 'spa',
      orgArea: 'Quận 3'
    }
  });
  const prov2Id = (await app.call('POST', `/admin/users/${regProv2.data.user.id}/approve`, {
    token: adminToken,
    body: { area: 'Quận 3' }
  })).data.providerId;
  const otherProvToken = (await app.call('POST', '/auth/login', {
    body: { identifier: 'pag_prov2@petcare.vn', password: 'TestPass123!' }
  })).data.token;

  for (let i = 1; i <= 5; i++) {
    await app.registerCustomer({
      email: `pag_cust_${i}@test.local`,
      phone: `091100000${i}`,
      fullName: `Pag Cust ${i}`
    });
  }

  await t.test('GET /admin/users: page 1/2/3, filter + pagination, page=0 -> 422, non-admin -> 403', async () => {
    const p1 = await app.call('GET', '/admin/users?q=Pag%20Cust&page=1&limit=2', { token: adminToken });
    const p2 = await app.call('GET', '/admin/users?q=Pag%20Cust&page=2&limit=2', { token: adminToken });
    const p3 = await app.call('GET', '/admin/users?q=Pag%20Cust&page=3&limit=2', { token: adminToken });
    const p4 = await app.call('GET', '/admin/users?q=Pag%20Cust&page=4&limit=2', { token: adminToken });

    assert.equal(p1.status, 200);
    assert.deepEqual(p1.body.meta, { page: 1, limit: 2, total: 5, totalPages: 3 });
    assert.equal(p1.data.users.length, 2);
    assert.equal(p2.data.users.length, 2);
    assert.equal(p3.data.users.length, 1);
    assert.equal(p4.data.users.length, 0);
    assert.deepEqual(p4.body.meta, { page: 4, limit: 2, total: 5, totalPages: 3 });

    const seen = new Set([...p1.data.users, ...p2.data.users, ...p3.data.users].map((u) => u.id));
    assert.equal(seen.size, 5);

    const bad = await app.call('GET', '/admin/users?page=0', { token: adminToken });
    assert.equal(bad.status, 422);

    const forbiddenRes = await app.call('GET', '/admin/users', { token: provToken });
    assert.equal(forbiddenRes.status, 403);
  });

  for (let i = 1; i <= 5; i++) {
    const vRes = await app.call('POST', '/provider/vets', {
      token: provToken,
      body: {
        email: `pag_vet_${i}@test.local`,
        phone: `092200000${i}`,
        fullName: `Bác sĩ ${i}`
      }
    });
    assert.equal(vRes.status, 201);
    if (i === 5) {
      const disRes = await app.call('POST', `/provider/vets/${vRes.data.vet.id}/disable`, { token: provToken });
      assert.equal(disRes.status, 200);
    }
  }
  const otherVetRes = await app.call('POST', '/provider/vets', {
    token: otherProvToken,
    body: {
      email: 'other_vet@test.local',
      phone: '0933000001',
      fullName: 'Bác sĩ Cơ sở khác'
    }
  });
  assert.equal(otherVetRes.status, 201);

  await t.test('GET /provider/vets: page 1/2/3, page=0 -> 422', async () => {
    const p1 = await app.call('GET', '/provider/vets?page=1&limit=2', { token: provToken });
    const p2 = await app.call('GET', '/provider/vets?page=2&limit=2', { token: provToken });
    const p3 = await app.call('GET', '/provider/vets?page=3&limit=2', { token: provToken });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.meta.total, 5);
    assert.equal(p1.body.meta.totalPages, 3);
    assert.equal(p1.data.vets.length, 2);
    assert.equal(p2.data.vets.length, 2);
    assert.equal(p3.data.vets.length, 1);

    const bad = await app.call('GET', '/provider/vets?page=0', { token: provToken });
    assert.equal(bad.status, 422);
  });

  await t.test('GET /provider/vets/options: only active vets of own provider, no email/phone', async () => {
    const res = await app.call('GET', '/provider/vets/options', { token: provToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.vets.length, 4);
    for (const v of res.data.vets) {
      assert.ok(v.id);
      assert.ok(v.fullName);
      assert.equal(v.email, undefined);
      assert.equal(v.phone, undefined);
      assert.notEqual(v.fullName, 'Bác sĩ 5');
      assert.notEqual(v.fullName, 'Bác sĩ Cơ sở khác');
    }

    const otherRes = await app.call('GET', '/provider/vets/options', { token: otherProvToken });
    assert.equal(otherRes.status, 200);
    assert.equal(otherRes.data.vets.length, 1);
    assert.equal(otherRes.data.vets[0].fullName, 'Bác sĩ Cơ sở khác');
  });

  for (let i = 1; i <= 5; i++) {
    const sRes = await app.call('POST', '/provider/services', {
      token: provToken,
      body: {
        category: 'medical',
        name: `Dịch vụ phân trang ${i}`,
        priceVnd: 100000 + i * 10000,
        unit: 'lần',
        slotCapacity: 2
      }
    });
    assert.equal(sRes.status, 201);
  }

  await t.test('GET /provider/services: page 1/2/3, page=0 -> 422', async () => {
    const p1 = await app.call('GET', '/provider/services?page=1&limit=2', { token: provToken });
    const p2 = await app.call('GET', '/provider/services?page=2&limit=2', { token: provToken });
    const p3 = await app.call('GET', '/provider/services?page=3&limit=2', { token: provToken });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.meta.total, 5);
    assert.equal(p1.body.meta.totalPages, 3);
    assert.equal(p1.data.services.length, 2);
    assert.equal(p2.data.services.length, 2);
    assert.equal(p3.data.services.length, 1);

    const bad = await app.call('GET', '/provider/services?page=0', { token: provToken });
    assert.equal(bad.status, 422);
  });
});
