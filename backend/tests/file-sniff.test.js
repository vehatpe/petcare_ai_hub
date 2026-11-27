'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffFile, assertImage } = require('../src/utils/file-sniff');
const { AppError } = require('../src/utils/errors');

test('file-sniff: accepts PNG, JPEG, WEBP magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(sniffFile(png), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(assertImage(png), { mime: 'image/png', ext: 'png' });

  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.deepEqual(sniffFile(jpg), { mime: 'image/jpeg', ext: 'jpg' });

  const webp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii')
  ]);
  assert.deepEqual(sniffFile(webp), { mime: 'image/webp', ext: 'webp' });
});

test('file-sniff: rejects GIF, SVG, text, empty/short buffers, and fake WEBP', () => {
  assert.equal(sniffFile(Buffer.from('GIF89a\x01\x00\x01\x00', 'ascii')), null);
  assert.equal(sniffFile(Buffer.from('GIF87a\x01\x00\x01\x00', 'ascii')), null);
  assert.equal(sniffFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')), null);
  assert.equal(sniffFile(Buffer.from('hello world, not a png', 'utf8')), null);
  assert.equal(sniffFile(Buffer.alloc(0)), null);
  assert.equal(sniffFile(Buffer.from([0x89, 0x50])), null);

  const fakeWebp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE', 'ascii')
  ]);
  assert.equal(sniffFile(fakeWebp), null);

  assert.throws(
    () => assertImage(Buffer.from('GIF89a', 'ascii')),
    (err) => err instanceof AppError && err.status === 422 && Boolean(err.errors?.file)
  );
});
