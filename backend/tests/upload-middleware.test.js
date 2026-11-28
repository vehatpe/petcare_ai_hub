'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loadConfig } = require('../src/config');
const { uploadSingle } = require('../src/middlewares/upload');
const { createErrorHandler } = require('../src/middlewares/error');

function createUploadTestApp() {
  const config = loadConfig({ NODE_ENV: 'test' });
  const app = express();
  app.post('/test-upload', uploadSingle('file', config), (req, res) => {
    res.json({ success: true, data: { size: req.file.buffer.length } });
  });
  app.use(createErrorHandler({ error() {} }));
  return app;
}

test('uploadSingle middleware: accepts valid file, rejects >5MB, >1 file, wrong field, and missing file', async (t) => {
  const app = createUploadTestApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/test-upload`;

  // 1. Valid file
  const fdOk = new FormData();
  fdOk.append('file', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])]), 'pet.png');
  const rOk = await fetch(url, { method: 'POST', body: fdOk });
  assert.equal(rOk.status, 200);
  const bOk = await rOk.json();
  assert.equal(bOk.data.size, 4);

  // 2. 5 MB + 1 byte -> 413 file_too_large
  const fdBig = new FormData();
  fdBig.append('file', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), 'big.png');
  const rBig = await fetch(url, { method: 'POST', body: fdBig });
  assert.equal(rBig.status, 413);
  const bBig = await rBig.json();
  assert.equal(bBig.code, 'file_too_large');

  // 3. Two files -> 422
  const fdTwo = new FormData();
  fdTwo.append('file', new Blob([Buffer.from([1, 2])]), 'a.png');
  fdTwo.append('file', new Blob([Buffer.from([3, 4])]), 'b.png');
  const rTwo = await fetch(url, { method: 'POST', body: fdTwo });
  assert.equal(rTwo.status, 422);

  // 4. Wrong field name -> 422
  const fdWrong = new FormData();
  fdWrong.append('avatar', new Blob([Buffer.from([1, 2])]), 'a.png');
  const rWrong = await fetch(url, { method: 'POST', body: fdWrong });
  assert.equal(rWrong.status, 422);

  // 5. No file -> 422
  const fdEmpty = new FormData();
  const rEmpty = await fetch(url, { method: 'POST', body: fdEmpty });
  assert.equal(rEmpty.status, 422);
});
