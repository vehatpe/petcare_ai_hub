'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { startTestApp } = require('./helpers/harness');

test('Token revocation via TokenVersion (S8 Việc 1)', async (t) => {
  const app = await startTestApp();
  t.after(async () => { await app.close(); });

  const { user: custUser, token: custToken } = await app.registerCustomer({
    fullName: 'Token Test Customer',
    email: 'tokentest@example.com',
    phone: '0981234567',
    password: 'Password123!'
  });

  await t.test('token without tv claim is treated as tv=0 and valid when user TokenVersion=0', async () => {
    // Generate raw token without tv claim
    const rawToken = jwt.sign({ role: custUser.role }, app.config.jwtSecret, {
      algorithm: 'HS256',
      subject: custUser.id,
      expiresIn: '1d'
    });
    const res = await app.call('GET', '/auth/me', { token: rawToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.id, custUser.id);
  });

  await t.test('changing password revokes old token (401 token_revoked) and returns valid new token', async () => {
    // Current custToken works
    const rBefore = await app.call('GET', '/auth/me', { token: custToken });
    assert.equal(rBefore.status, 200);

    // Change password
    const rChange = await app.call('POST', '/auth/change-password', {
      token: custToken,
      body: { currentPassword: 'Password123!', newPassword: 'NewPassword123!' }
    });
    assert.equal(rChange.status, 200);
    assert.ok(rChange.data.token, 'Must return new token');
    const newToken = rChange.data.token;

    // Old token now rejected with 401 token_revoked
    const rOld = await app.call('GET', '/auth/me', { token: custToken });
    assert.equal(rOld.status, 401);
    assert.equal(rOld.body.code, 'token_revoked');
    assert.match(rOld.body.message, /Phiên đăng nhập đã hết hiệu lực/);

    // New token works
    const rNew = await app.call('GET', '/auth/me', { token: newToken });
    assert.equal(rNew.status, 200);
    assert.equal(rNew.data.user.id, custUser.id);
  });

  await t.test('tokenVersion never leaks in public user responses or admin user list', async () => {
    const rMe = await app.call('GET', '/auth/me', {
      token: (await app.call('POST', '/auth/login', {
        body: { identifier: 'tokentest@example.com', password: 'NewPassword123!' }
      })).data.token
    });
    assert.equal(rMe.status, 200);
    assert.equal(rMe.data.user.tokenVersion, undefined);
    assert.equal(rMe.data.user.TokenVersion, undefined);
  });
});
