'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');
const { createFakeStorageService } = require('./helpers/fake-storage');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function uploadAvatar(baseUrl, token, buffer, filename = 'avatar.png') {
  const fd = new FormData();
  if (buffer !== null) {
    fd.append('avatar', new Blob([buffer]), filename);
  }
  const res = await fetch(`${baseUrl}/auth/me/avatar`, {
    method: 'PUT',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd
  });
  const body = await res.json();
  return { status: res.status, body, data: body.data };
}

test('avatar API: all roles can set/clear own avatar, validation, cleanup', async (t) => {
  const storage = createFakeStorageService();
  const app = await startTestApp({ storageService: storage });
  t.after(app.close);

  // 1. Unauthenticated -> 401
  const rUnauth = await uploadAvatar(app.baseUrl, null, PNG_1X1);
  assert.equal(rUnauth.status, 401);

  // 2. Customer + staff roles can set and clear own avatar
  const c1 = await app.registerCustomer();
  const c2 = await app.registerCustomer();
  const vet = await app.loginStaff('vet');
  const provider = await app.loginStaff('provider');
  const admin = await app.loginStaff('admin');

  for (const actor of [c1, vet, provider, admin]) {
    const rSet = await uploadAvatar(app.baseUrl, actor.token, PNG_1X1);
    assert.equal(rSet.status, 200);
    assert.match(rSet.data.user.avatarUrl, /^\/uploads\/avatars\/.+\.png$/);

    const rMe = await app.call('GET', '/auth/me', { token: actor.token });
    assert.equal(rMe.status, 200);
    assert.equal(rMe.data.user.avatarUrl, rSet.data.user.avatarUrl);
  }
  assert.equal(storage.files.size, 4);

  // 3. Replacing c1 avatar removes old file, leaves c2 unaffected
  const oldC1Url = (await app.call('GET', '/auth/me', { token: c1.token })).data.user.avatarUrl;
  const rReplace = await uploadAvatar(app.baseUrl, c1.token, PNG_1X1);
  assert.equal(rReplace.status, 200);
  assert.notEqual(rReplace.data.user.avatarUrl, oldC1Url);
  assert.equal(storage.files.size, 4);

  const rC2Me = await app.call('GET', '/auth/me', { token: c2.token });
  assert.equal(rC2Me.data.user.avatarUrl, null);

  // 4. Invalid format -> 422; > 5 MB -> 413
  const rBad = await uploadAvatar(app.baseUrl, c1.token, Buffer.from('not-an-image'), 'bad.png');
  assert.equal(rBad.status, 422);

  const rBig = await uploadAvatar(app.baseUrl, c1.token, Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png');
  assert.equal(rBig.status, 413);
  assert.equal(rBig.body.code, 'file_too_large');

  // 5. DELETE /auth/me/avatar -> avatarUrl: null, file removed
  const rDel = await app.call('DELETE', '/auth/me/avatar', { token: c1.token });
  assert.equal(rDel.status, 200);
  assert.equal(rDel.data.user.avatarUrl, null);
  assert.equal(storage.files.size, 3);

  // 6. AuditLog has avatar_set / avatar_clear, detail is string for set, no URL/publicId
  const logs = await app.testHelpers.queryAuditLogs();
  const setLogs = logs.filter((l) => l.action === 'avatar_set');
  const clearLogs = logs.filter((l) => l.action === 'avatar_clear');
  assert.ok(setLogs.length >= 1);
  assert.ok(clearLogs.length >= 1);
  for (const log of [...setLogs, ...clearLogs]) {
    if (log.action === 'avatar_set') assert.equal(typeof log.detail, 'string');
    const raw = JSON.stringify(log);
    assert.equal(raw.includes('/uploads/'), false);
    assert.equal(raw.includes('publicId'), false);
  }
});
