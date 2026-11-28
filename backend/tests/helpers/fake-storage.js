'use strict';

const crypto = require('node:crypto');

/**
 * Bản giả lưu trữ ảnh trong bộ nhớ dùng cho unit/integration test.
 */
function createFakeStorageService() {
  const files = new Map();

  return {
    files,
    async upload(buffer, { folder, ext }) {
      const publicId = `${folder}/${crypto.randomUUID()}.${ext}`;
      files.set(publicId, Buffer.from(buffer));
      return {
        url: `/uploads/${publicId}`,
        publicId
      };
    },
    async remove(publicId) {
      if (!publicId) return;
      files.delete(publicId);
    }
  };
}

module.exports = { createFakeStorageService };
