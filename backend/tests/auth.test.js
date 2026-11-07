'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');

const base = { role: 'customer', fullName: 'Nguyễn Văn A', email: 'a@example.com', phone: '0912 345 678', password: 'matkhau123' };

test('auth', async (t) => {
  const app = await startTestApp();
  t.after(app.close);
  const { call } = app;

  await t.test('register customer returns user + token; phone normalized; no password leak', async () => {
    const r = await call('POST', '/auth/register', { body: { ...base, phone: '+84 912 345 678' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.success, true);
    assert.equal(r.data.user.phone, '0912345678');
    assert.equal(r.data.user.role, 'customer');
    assert.equal(r.data.user.status, 'active');
    assert.ok(r.data.token);
    assert.equal(JSON.stringify(r.body).includes('passwordHash'), false);
    assert.equal(JSON.stringify(r.body).includes('matkhau123'), false);
  });

  await t.test('validation messages (422 + errors map)', async () => {
    const r = await call('POST', '/auth/register', { body: { role: 'customer', fullName: 'A', email: 'bad', phone: '123', password: 'abc' } });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'validation');
    assert.equal(r.body.data, null);
    assert.equal(r.body.errors.fullName, 'Vui lòng nhập họ và tên (ít nhất 2 ký tự).');
    assert.equal(r.body.errors.email, 'Email chưa đúng định dạng, ví dụ: ten@gmail.com.');
    assert.equal(r.body.errors.phone, 'Số điện thoại Việt Nam gồm 10 số, ví dụ: 0912 345 678.');
    assert.match(r.body.errors.password, /ít nhất 8 ký tự, gồm cả chữ và số/);
    const noDigit = await call('POST', '/auth/register', { body: { ...base, email: 'n@example.com', phone: '0912345670', password: 'chuxuongthoi' } });
    assert.equal(noDigit.status, 422);
  });

  await t.test('duplicate email and phone -> 409 duplicate with errors.*', async () => {
    const e = await call('POST', '/auth/register', { body: { ...base, phone: '0988888888' } });
    assert.equal(e.status, 409); assert.equal(e.body.code, 'duplicate'); assert.ok(e.body.errors.email);
    const p = await call('POST', '/auth/register', { body: { ...base, email: 'other@example.com' } });
    assert.equal(p.status, 409); assert.ok(p.body.errors.phone);
  });

  await t.test('provider registers as pending, no token; needs org fields; login -> 403 pending', async () => {
    const bad = await call('POST', '/auth/register', { body: { ...base, role: 'provider', email: 'p@example.com', phone: '0933333333' } });
    assert.equal(bad.status, 422); assert.ok(bad.body.errors.orgName); assert.ok(bad.body.errors.orgType);
    const r = await call('POST', '/auth/register', { body: { ...base, role: 'provider', email: 'p@example.com', phone: '0933333333', orgName: 'Phòng khám X', orgType: 'clinic' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.token, null);
    assert.equal(r.data.user.status, 'pending');
    assert.equal(r.data.user.orgName, 'Phòng khám X');
    const l = await call('POST', '/auth/login', { body: { identifier: 'p@example.com', password: 'matkhau123' } });
    assert.equal(l.status, 403); assert.equal(l.body.code, 'pending');
  });

  await t.test('vet/admin cannot self-register', async () => {
    for (const role of ['vet', 'admin', 'whatever']) {
      const r = await call('POST', '/auth/register', { body: { ...base, role, email: `${role}@example.com`, phone: '0944444444' } });
      assert.equal(r.status, 422, role);
      assert.ok(r.body.errors.role);
    }
  });

  await t.test('login by email or phone; wrong password and unknown user share one generic 401', async () => {
    const byEmail = await call('POST', '/auth/login', { body: { identifier: 'A@Example.com', password: 'matkhau123' } });
    assert.equal(byEmail.status, 200); assert.ok(byEmail.data.token);
    const byPhone = await call('POST', '/auth/login', { body: { identifier: '0912 345 678', password: 'matkhau123' } });
    assert.equal(byPhone.status, 200);
    const wrong = await call('POST', '/auth/login', { body: { identifier: 'a@example.com', password: 'sai-mat-khau1' } });
    const unknown = await call('POST', '/auth/login', { body: { identifier: 'nobody@example.com', password: 'matkhau123' } });
    assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
    assert.equal(wrong.body.code, 'credentials');
    assert.equal(wrong.body.message, unknown.body.message);
    const empty = await call('POST', '/auth/login', { body: {} });
    assert.equal(empty.status, 422); assert.ok(empty.body.errors.identifier && empty.body.errors.password);
  });

  await t.test('disabled account -> 403 disabled', async () => {
    app.testHelpers.state.users.find((u) => u.email === 'a@example.com').status = 'disabled';
    const l = await call('POST', '/auth/login', { body: { identifier: 'a@example.com', password: 'matkhau123' } });
    assert.equal(l.status, 403); assert.equal(l.body.code, 'disabled');
    app.testHelpers.state.users.find((u) => u.email === 'a@example.com').status = 'active';
  });

  await t.test('/auth/me: ok with token, 401 without or with garbage', async () => {
    const { token, user } = await app.registerCustomer();
    const me = await call('GET', '/auth/me', { token });
    assert.equal(me.status, 200); assert.equal(me.data.user.id, user.id);
    assert.equal((await call('GET', '/auth/me')).status, 401);
    const bad = await call('GET', '/auth/me', { token: 'abc.def.ghi' });
    assert.equal(bad.status, 401); assert.equal(bad.body.code, 'unauthenticated');
  });

  await t.test('malformed JSON -> 400; unknown route -> 404 envelope', async () => {
    const r = await call('POST', '/auth/login', { raw: '{oops' });
    assert.equal(r.status, 400); assert.equal(r.body.success, false);
    const nf = await call('GET', '/nope');
    assert.equal(nf.status, 404); assert.equal(nf.body.success, false);
  });

  await t.test('rate limit on /auth/* returns 429 envelope', async () => {
    const limited = await startTestApp({ env: { AUTH_RATE_LIMIT_MAX: '3' } });
    try {
      let last;
      for (let i = 0; i < 5; i++) last = await limited.call('POST', '/auth/login', { body: { identifier: 'x@example.com', password: 'abcdefg1' } });
      assert.equal(last.status, 429); assert.equal(last.body.code, 'rate_limited');
    } finally { await limited.close(); }
  });
});
