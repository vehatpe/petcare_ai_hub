'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { createStorageService } = require('../src/services/storage.service');
const { createApp } = require('../src/app');
const { createFakeModels } = require('./helpers/fake-models');

test('config: rejects invalid STORAGE_DRIVER and missing Cloudinary credentials', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'test', STORAGE_DRIVER: 's3' }),
    /STORAGE_DRIVER/
  );

  assert.throws(
    () => loadConfig({
      NODE_ENV: 'test',
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'demo'
    }),
    /CLOUDINARY_API_KEY/
  );
});

test('storage.service (local): upload, remove idempotency, path traversal guard, and /uploads static serving', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petcare-upload-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    STORAGE_DRIVER: 'local',
    UPLOAD_DIR: tmpDir,
    PUBLIC_BASE_URL: 'http://localhost:3000'
  });

  const storage = createStorageService({ config });
  const sample = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const uploaded = await storage.upload(sample, { folder: 'pets', ext: 'png' });

  assert.match(uploaded.publicId, /^pets\/[0-9a-f-]+\.png$/);
  assert.equal(uploaded.url, `http://localhost:3000/uploads/${uploaded.publicId}`);

  const savedPath = path.join(tmpDir, uploaded.publicId);
  assert.equal(fs.existsSync(savedPath), true);
  assert.deepEqual(fs.readFileSync(savedPath), sample);

  // Path traversal guard
  await assert.rejects(() => storage.remove('../package.json'), /không hợp lệ/);
  await assert.rejects(() => storage.remove('/etc/passwd'), /không hợp lệ/);

  // Serve via Express /uploads with Cross-Origin-Resource-Policy: cross-origin
  const { models } = createFakeModels();
  const app = createApp({
    models,
    config,
    ai: { embed: async () => [], generate: async () => '' },
    storageService: storage,
    logger: { error() {} }
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((r) => server.close(r)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/uploads/${uploaded.publicId}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const bodyBuf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(bodyBuf, sample);

  const traversalRes = await fetch(`${baseUrl}/uploads/../package.json`);
  assert.notEqual(traversalRes.status, 200);

  // Remove twice does not throw
  await storage.remove(uploaded.publicId);
  assert.equal(fs.existsSync(savedPath), false);
  await storage.remove(uploaded.publicId);
});

test('storage.service (cloudinary mock): passes expected options and wraps errors as 502', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'cloudinary',
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'demo-key',
    CLOUDINARY_API_SECRET: 'demo-secret'
  });

  let capturedOpts = null;
  let destroyed = null;
  const mockClient = {
    uploader: {
      upload_stream(opts, cb) {
        capturedOpts = opts;
        return {
          end() {
            cb(null, { secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/pets/abc.png', public_id: opts.public_id });
          }
        };
      },
      async destroy(publicId, opts) {
        destroyed = { publicId, opts };
        return { result: 'ok' };
      }
    }
  };

  const storage = createStorageService({ config, cloudinaryClient: mockClient });
  const up = await storage.upload(Buffer.from([1, 2, 3]), { folder: 'pets', ext: 'png' });
  assert.equal(capturedOpts.resource_type, 'image');
  assert.equal(capturedOpts.type, 'upload');
  assert.equal(capturedOpts.overwrite, false);
  assert.match(up.publicId, /^pets\/[0-9a-f-]+$/);
  assert.match(up.url, /^https:\/\/res\.cloudinary\.com\//);

  await storage.remove(up.publicId);
  assert.equal(destroyed.publicId, up.publicId);
  assert.equal(destroyed.opts.resource_type, 'image');
  assert.equal(destroyed.opts.type, 'upload');

  const failingClient = {
    uploader: {
      upload_stream(_opts, cb) {
        return { end() { cb(new Error('secret-api-key-leaked')); } };
      },
      async destroy() { throw new Error('secret-api-key-leaked'); }
    }
  };
  const failingStorage = createStorageService({ config, cloudinaryClient: failingClient });
  await assert.rejects(
    () => failingStorage.upload(Buffer.from([1, 2, 3]), { folder: 'avatars', ext: 'jpg' }),
    (err) => err.status === 502 && err.code === 'storage_error' && !err.message.includes('secret-api-key-leaked')
  );
});
