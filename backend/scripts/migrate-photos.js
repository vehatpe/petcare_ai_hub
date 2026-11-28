'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const sql = require('mssql');
const { loadConfig } = require('../src/config');
const { createDb, T } = require('../src/models/db');
const { createStorageService } = require('../src/services/storage.service');
const { sniffFile } = require('../src/utils/file-sniff');

const BATCH_SIZE = 20;
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function decodeBase64Photo(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  const base64Part = DATA_URL_RE.test(trimmed) ? trimmed.replace(DATA_URL_RE, '') : trimmed;
  if (!base64Part) return null;
  const buf = Buffer.from(base64Part, 'base64');
  return buf.length > 0 ? buf : null;
}

/**
 * Chuyển ảnh Base64 cũ trong cột Pets.Photo sang storage (local hoặc cloudinary).
 * An toàn chạy lại (idempotent): chỉ xử lý các dòng có Photo IS NOT NULL AND PhotoUrl IS NULL.
 * `ownerId` (tùy chọn) giới hạn trong thú cưng của một chủ nuôi; CLI không dùng, chỉ để smoke test
 * không đụng vào dữ liệu thật của DB dev.
 */
async function migratePhotos({ db, storage, dryRun = false, batchSize = BATCH_SIZE, ownerId = null, log = console.log } = {}) {
  const stats = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    skippedIds: [],
    failedIds: []
  };

  let afterId = null;
  while (true) {
    const rows = await db.query(
      `SELECT TOP (${Number(batchSize) || BATCH_SIZE}) PetId, Photo
       FROM dbo.Pets
       WHERE Photo IS NOT NULL AND PhotoUrl IS NULL
         AND (@ownerId IS NULL OR OwnerId = @ownerId)
         AND (@afterId IS NULL OR PetId > @afterId)
       ORDER BY PetId`,
      { afterId: [T.guid, afterId], ownerId: [T.guid, ownerId] }
    );
    if (!rows.length) break;

    for (const row of rows) {
      const petId = String(row.PetId).toLowerCase();
      afterId = row.PetId;
      stats.scanned += 1;

      try {
        const buffer = decodeBase64Photo(row.Photo);
        const detected = buffer ? sniffFile(buffer) : null;
        if (!detected) {
          stats.skipped += 1;
          stats.skippedIds.push(petId);
          continue;
        }

        if (dryRun) {
          stats.migrated += 1;
          continue;
        }

        const uploaded = await storage.upload(buffer, { folder: 'pets', ext: detected.ext });
        const res = await db.exec(
          `UPDATE dbo.Pets
           SET PhotoUrl = @url, PhotoPublicId = @publicId, Photo = NULL, UpdatedAt = SYSUTCDATETIME()
           WHERE PetId = @id AND PhotoUrl IS NULL`,
          {
            id: [T.guid, row.PetId],
            url: [T.vstr(500), uploaded.url],
            publicId: [T.vstr(200), uploaded.publicId]
          }
        );

        const affected = res?.rowsAffected?.[0] || 0;
        if (affected === 0) {
          try {
            await storage.remove(uploaded.publicId);
          } catch (_) {
            // best-effort cleanup
          }
          stats.skipped += 1;
          stats.skippedIds.push(petId);
        } else {
          stats.migrated += 1;
        }
      } catch (err) {
        stats.failed += 1;
        stats.failedIds.push(petId);
        log(`[migrate-photos] Lỗi PetId=${petId}: ${err?.message || 'unknown_error'}`);
      }
    }
  }

  return stats;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();
  const driver = config.storage?.driver || 'local';

  console.log(`[migrate-photos] Bắt đầu (driver=${driver}, dryRun=${dryRun}).`);
  if (driver !== 'cloudinary') {
    console.log('[migrate-photos] Lưu ý: đang dùng driver "local". Khi đưa lên production, hãy chạy với STORAGE_DRIVER=cloudinary.');
  }

  const pool = await sql.connect(config.db);
  try {
    const db = createDb(pool);
    const storage = createStorageService({ config });
    const stats = await migratePhotos({ db, storage, dryRun });
    console.log(
      `[migrate-photos] Hoàn tất: quét=${stats.scanned}, đã chuyển=${stats.migrated}, bỏ qua=${stats.skipped}, lỗi=${stats.failed}`
    );
    if (stats.skippedIds.length) {
      console.log(`[migrate-photos] PetId bỏ qua: ${stats.skippedIds.join(', ')}`);
    }
    if (stats.failedIds.length) {
      console.log(`[migrate-photos] PetId lỗi: ${stats.failedIds.join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate-photos] Lỗi nghiêm trọng:', err?.message || err);
    process.exit(1);
  });
}

module.exports = { migratePhotos, decodeBase64Photo };
