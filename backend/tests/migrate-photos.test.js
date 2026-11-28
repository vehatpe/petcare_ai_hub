'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { migratePhotos } = require('../scripts/migrate-photos');
const { createFakeStorage } = require('./helpers/fake-storage');

// 1x1 PNG hợp lệ
const PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
// 1x1 GIF89a (không được phép -> phải bỏ qua và giữ nguyên Photo)
const GIF_B64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function createFakePetDb(initialRows) {
  const rows = initialRows.map((r) => ({ ...r }));
  return {
    rows,
    async query(_sql, params) {
      const afterId = params?.afterId?.[1] || null;
      return rows
        .filter((r) => r.Photo !== null && r.PhotoUrl === null && (!afterId || r.PetId > afterId))
        .sort((a, b) => a.PetId.localeCompare(b.PetId))
        .slice(0, 20)
        .map((r) => ({ PetId: r.PetId, Photo: r.Photo }));
    },
    async exec(_sql, params) {
      const id = params.id[1];
      const url = params.url[1];
      const publicId = params.publicId[1];
      const target = rows.find((r) => r.PetId === id && r.PhotoUrl === null);
      if (!target) return { rowsAffected: [0] };
      target.PhotoUrl = url;
      target.PhotoPublicId = publicId;
      target.Photo = null;
      return { rowsAffected: [1] };
    }
  };
}

describe('migrate-photos script', () => {
  it('chuyển ảnh PNG hợp lệ, bỏ qua GIF và chạy lại lần 2 không đổi gì', async () => {
    const db = createFakePetDb([
      { PetId: '00000000-0000-0000-0000-000000000001', Photo: PNG_B64, PhotoUrl: null, PhotoPublicId: null },
      { PetId: '00000000-0000-0000-0000-000000000002', Photo: GIF_B64, PhotoUrl: null, PhotoPublicId: null }
    ]);
    const storage = createFakeStorage();

    const first = await migratePhotos({ db, storage, dryRun: false, log: () => {} });
    assert.equal(first.scanned, 2);
    assert.equal(first.migrated, 1);
    assert.equal(first.skipped, 1);
    assert.equal(first.failed, 0);
    assert.deepEqual(first.skippedIds, ['00000000-0000-0000-0000-000000000002']);

    assert.equal(db.rows[0].Photo, null);
    assert.ok(db.rows[0].PhotoUrl);
    assert.ok(db.rows[0].PhotoPublicId);
    // GIF giữ nguyên Photo
    assert.equal(db.rows[1].Photo, GIF_B64);
    assert.equal(db.rows[1].PhotoUrl, null);

    // Chạy lại lần 2: chỉ còn dòng GIF bị bỏ qua, không upload thêm
    const second = await migratePhotos({ db, storage, dryRun: false, log: () => {} });
    assert.equal(second.scanned, 1);
    assert.equal(second.migrated, 0);
    assert.equal(second.skipped, 1);
    assert.equal(storage.files.size, 1);
  });

  it('một dòng lỗi không làm dừng cả lô', async () => {
    const db = createFakePetDb([
      { PetId: '00000000-0000-0000-0000-000000000001', Photo: PNG_B64, PhotoUrl: null, PhotoPublicId: null },
      { PetId: '00000000-0000-0000-0000-000000000002', Photo: PNG_B64, PhotoUrl: null, PhotoPublicId: null }
    ]);
    const baseStorage = createFakeStorage();
    let callCount = 0;
    const flakyStorage = {
      async upload(buf, opts) {
        callCount += 1;
        if (callCount === 1) throw new Error('storage_down');
        return baseStorage.upload(buf, opts);
      },
      remove: baseStorage.remove
    };

    const stats = await migratePhotos({ db, storage: flakyStorage, dryRun: false, log: () => {} });
    assert.equal(stats.scanned, 2);
    assert.equal(stats.migrated, 1);
    assert.equal(stats.failed, 1);
    assert.deepEqual(stats.failedIds, ['00000000-0000-0000-0000-000000000001']);
    // Dòng lỗi vẫn giữ nguyên Photo
    assert.equal(db.rows[0].Photo, PNG_B64);
    assert.equal(db.rows[0].PhotoUrl, null);
    // Dòng sau vẫn được chuyển
    assert.equal(db.rows[1].Photo, null);
    assert.ok(db.rows[1].PhotoUrl);
  });

  it('--dry-run không ghi tệp và không cập nhật DB', async () => {
    const db = createFakePetDb([
      { PetId: '00000000-0000-0000-0000-000000000001', Photo: PNG_B64, PhotoUrl: null, PhotoPublicId: null }
    ]);
    const storage = createFakeStorage();

    const stats = await migratePhotos({ db, storage, dryRun: true, log: () => {} });
    assert.equal(stats.migrated, 1);
    assert.equal(storage.files.size, 0);
    assert.equal(db.rows[0].Photo, PNG_B64);
    assert.equal(db.rows[0].PhotoUrl, null);
  });
});
