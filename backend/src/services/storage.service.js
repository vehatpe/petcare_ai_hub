'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AppError, validation } = require('../utils/errors');

const ALLOWED_FOLDERS = new Set(['pets', 'avatars']);
const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SAFE_PUBLIC_ID = /^[a-z0-9/_.-]+$/i;

function assertValidFolder(folder) {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw validation('Thư mục lưu trữ không hợp lệ.');
  }
}

function assertValidExt(ext) {
  const clean = String(ext || '').toLowerCase();
  if (!ALLOWED_EXTS.has(clean)) {
    throw validation('Định dạng ảnh không hợp lệ.');
  }
  return clean;
}

function resolveLocalPath(uploadDir, publicId) {
  if (!publicId || typeof publicId !== 'string' || !SAFE_PUBLIC_ID.test(publicId) || publicId.includes('..') || publicId.startsWith('/')) {
    throw validation('Mã tệp lưu trữ không hợp lệ.');
  }
  const baseDir = path.resolve(uploadDir);
  const target = path.resolve(baseDir, publicId);
  if (!target.startsWith(baseDir + path.sep)) {
    throw validation('Đường dẫn tệp lưu trữ không hợp lệ.');
  }
  return target;
}

/**
 * Tạo service lưu trữ ảnh theo driver 'local' hoặc 'cloudinary'.
 * @param {{ config: object, cloudinaryClient?: object }} deps
 */
function createStorageService({ config, cloudinaryClient } = {}) {
  const storageCfg = config?.storage || {};
  const driver = storageCfg.driver || 'local';

  if (driver === 'cloudinary') {
    const getClient = () => {
      if (cloudinaryClient) return cloudinaryClient;
      const cld = require('cloudinary').v2;
      cld.config({
        cloud_name: storageCfg.cloudinary?.cloudName,
        api_key: storageCfg.cloudinary?.apiKey,
        api_secret: storageCfg.cloudinary?.apiSecret,
        secure: true
      });
      return cld;
    };

    return {
      async upload(buffer, { folder, ext }) {
        assertValidFolder(folder);
        assertValidExt(ext);
        const cld = getClient();
        const publicId = `${folder}/${crypto.randomUUID()}`;
        try {
          const result = await new Promise((resolve, reject) => {
            const stream = cld.uploader.upload_stream(
              { public_id: publicId, resource_type: 'image', type: 'upload', overwrite: false },
              (err, res) => (err ? reject(err) : resolve(res))
            );
            stream.end(buffer);
          });
          return {
            url: result.secure_url,
            publicId: result.public_id || publicId
          };
        } catch {
          throw new AppError(502, 'storage_error', 'Không lưu được ảnh, thử lại sau.');
        }
      },

      async remove(publicId) {
        if (!publicId) return;
        const cld = getClient();
        try {
          await cld.uploader.destroy(publicId, { resource_type: 'image', type: 'upload', invalidate: true });
        } catch {
          throw new AppError(502, 'storage_error', 'Không lưu được ảnh, thử lại sau.');
        }
      }
    };
  }

  // Driver 'local'
  const uploadDir = storageCfg.uploadDir || path.resolve(__dirname, '../../uploads');
  const publicBaseUrl = String(storageCfg.publicBaseUrl || '').replace(/\/+$/, '');

  return {
    async upload(buffer, { folder, ext }) {
      assertValidFolder(folder);
      const cleanExt = assertValidExt(ext);
      const id = crypto.randomUUID();
      const publicId = `${folder}/${id}.${cleanExt}`;
      const target = resolveLocalPath(uploadDir, publicId);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, buffer);
      return {
        url: `${publicBaseUrl}/uploads/${publicId}`,
        publicId
      };
    },

    async remove(publicId) {
      if (!publicId) return;
      const target = resolveLocalPath(uploadDir, publicId);
      try {
        await fs.promises.unlink(target);
      } catch (err) {
        if (err && err.code === 'ENOENT') return;
        throw err;
      }
    }
  };
}

module.exports = { createStorageService };
