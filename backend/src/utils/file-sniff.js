'use strict';

const { validation } = require('./errors');

/**
 * Nhận diện định dạng ảnh dựa trên magic bytes (không tin Content-Type hay đuôi tệp).
 * Chỉ chấp nhận PNG, JPEG, WEBP.
 * @param {Buffer} buffer
 * @returns {{ mime: string, ext: string } | null}
 */
function sniffFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // WEBP: "RIFF" ở 0..3 và "WEBP" ở 8..11
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

/**
 * Kiểm tra buffer có phải ảnh PNG, JPEG hoặc WEBP hợp lệ không.
 * @param {Buffer} buffer
 * @returns {{ mime: string, ext: string }}
 */
function assertImage(buffer) {
  const detected = sniffFile(buffer);
  if (!detected) {
    throw validation('Chỉ nhận ảnh PNG, JPEG hoặc WEBP.', {
      file: 'Chỉ nhận ảnh PNG, JPEG hoặc WEBP.'
    });
  }
  return detected;
}

module.exports = { sniffFile, assertImage };
