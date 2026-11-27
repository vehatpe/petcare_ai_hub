'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers/harness');
const { createFakeStorageService } = require('./helpers/fake-storage');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const GIF_HDR = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');

async function uploadPhoto(baseUrl, petId, token, buffer, filename = 'pet.png', field = 'photo') {
  const fd = new FormData();
  if (buffer !== null) {
    fd.append(field, new Blob([buffer]), filename);
  }
  const res = await fetch(`${baseUrl}/pets/${petId}/photo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd
  });
  const body = await res.json();
  return { status: res.status, body, data: body.data };
}

test('pet photo API: upload, replace, delete, validation, authz, rollback, cleanup', async (t) => {
  const storage = createFakeStorageService();
  const app = await startTestApp({ storageService: storage });
  t.after(app.close);

  const c1 = await app.registerCustomer();
  const c2 = await app.registerCustomer();
  const pet = await app.createPet(c1.token);

  // 1. Unauthenticated -> 401
  const rUnauth = await uploadPhoto(app.baseUrl, pet.id, null, PNG_1X1);
  assert.equal(rUnauth.status, 401);

  // 2. Staff roles (vet, provider, admin) -> 403
  for (const role of ['vet', 'provider', 'admin']) {
    const staff = await app.loginStaff(role);
    const rStaff = await uploadPhoto(app.baseUrl, pet.id, staff.token, PNG_1X1);
    assert.equal(rStaff.status, 403);
  }

  // 3. Upload valid PNG -> 200, photo is URL, file stored
  const r1 = await uploadPhoto(app.baseUrl, pet.id, c1.token, PNG_1X1);
  assert.equal(r1.status, 200);
  assert.match(r1.data.photo, /^\/uploads\/pets\/.+\.png$/);
  assert.equal(storage.files.size, 1);
  const firstKey = Array.from(storage.files.keys())[0];

  // 4. Upload second time -> old file removed
  const r2 = await uploadPhoto(app.baseUrl, pet.id, c1.token, PNG_1X1);
  assert.equal(r2.status, 200);
  assert.notEqual(r2.data.photo, r1.data.photo);
  assert.equal(storage.files.size, 1);
  assert.equal(storage.files.has(firstKey), false);

  // 5. Text file renamed .png -> 422, no new file
  const rTxt = await uploadPhoto(app.baseUrl, pet.id, c1.token, Buffer.from('hello world'), 'fake.png');
  assert.equal(rTxt.status, 422);
  assert.equal(storage.files.size, 1);

  // 6. GIF -> 422
  const rGif = await uploadPhoto(app.baseUrl, pet.id, c1.token, GIF_HDR, 'anim.gif');
  assert.equal(rGif.status, 422);
  assert.equal(storage.files.size, 1);

  // 7. > 5 MB -> 413
  const rBig = await uploadPhoto(app.baseUrl, pet.id, c1.token, Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png');
  assert.equal(rBig.status, 413);
  assert.equal(rBig.body.code, 'file_too_large');
  assert.equal(storage.files.size, 1);

  // 8. Missing file -> 422
  const rMissing = await uploadPhoto(app.baseUrl, pet.id, c1.token, null);
  assert.equal(rMissing.status, 422);

  // 9. Another customer's pet -> 404 and no orphan file left
  const rOther = await uploadPhoto(app.baseUrl, pet.id, c2.token, PNG_1X1);
  assert.equal(rOther.status, 404);
  assert.equal(storage.files.size, 1);

  // 10. DELETE /pets/:id/photo -> photo: null, file removed; idempotent
  const rDel = await app.call('DELETE', `/pets/${pet.id}/photo`, { token: c1.token });
  assert.equal(rDel.status, 200);
  assert.equal(rDel.data.photo, null);
  assert.equal(storage.files.size, 0);

  const rDel2 = await app.call('DELETE', `/pets/${pet.id}/photo`, { token: c1.token });
  assert.equal(rDel2.status, 200);
  assert.equal(rDel2.data.photo, null);

  // 11. DB error during setPhoto -> uploaded file rolled back
  const origSetPhoto = app.models.pets.setPhoto;
  app.models.pets.setPhoto = async () => { throw new Error('db_boom'); };
  const rBoom = await uploadPhoto(app.baseUrl, pet.id, c1.token, PNG_1X1);
  assert.equal(rBoom.status, 500);
  assert.equal(storage.files.size, 0);
  app.models.pets.setPhoto = origSetPhoto;

  // 12. PUT base64 while PhotoUrl exists -> URL file cleaned up
  await uploadPhoto(app.baseUrl, pet.id, c1.token, PNG_1X1);
  assert.equal(storage.files.size, 1);
  const b64 = `data:image/png;base64,${PNG_1X1.toString('base64')}`;
  const rPut = await app.call('PUT', `/pets/${pet.id}`, { token: c1.token, body: app.validPet({ photo: b64 }) });
  assert.equal(rPut.status, 200);
  assert.equal(rPut.data.photo, b64);
  assert.equal(storage.files.size, 0);

  // 13. DELETE /pets/:id when pet has URL photo -> file removed
  await uploadPhoto(app.baseUrl, pet.id, c1.token, PNG_1X1);
  assert.equal(storage.files.size, 1);
  const rRm = await app.call('DELETE', `/pets/${pet.id}`, { token: c1.token });
  assert.equal(rRm.status, 200);
  assert.equal(storage.files.size, 0);

  // 14. AuditLog never contains URL or publicId
  const logs = await app.testHelpers.queryAuditLogs();
  const photoLogs = logs.filter((l) => l.action === 'pet_photo_set' || l.action === 'pet_photo_clear');
  assert.ok(photoLogs.length >= 2);
  for (const log of photoLogs) {
    const raw = JSON.stringify(log);
    assert.equal(raw.includes('/uploads/'), false);
    assert.equal(raw.includes('publicId'), false);
  }
});
