'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const PAGES_DIR = path.join(FRONTEND_DIR, 'pages');

function extractLocalScripts(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[1];
    if (!/^https?:\/\//i.test(src) && !src.startsWith('//')) {
      scripts.push(src);
    }
  }
  return scripts;
}

test('Every local <script src> in frontend/index.html and frontend/pages/*.html exists on disk', () => {
  const htmlFiles = [
    path.join(FRONTEND_DIR, 'index.html'),
    ...fs.readdirSync(PAGES_DIR)
      .filter((f) => f.endsWith('.html'))
      .map((f) => path.join(PAGES_DIR, f))
  ];

  for (const htmlFile of htmlFiles) {
    const scripts = extractLocalScripts(htmlFile);
    const dir = path.dirname(htmlFile);
    for (const src of scripts) {
      const cleanSrc = src.split('?')[0].split('#')[0];
      const resolved = path.resolve(dir, cleanSrc);
      assert.ok(
        fs.existsSync(resolved),
        `Missing script "${src}" referenced in ${path.relative(FRONTEND_DIR, htmlFile)}`
      );
    }
  }
});

test('Vet pages load scripts in required order', () => {
  const vetPages = fs.readdirSync(PAGES_DIR)
    .filter((f) => f.startsWith('vet-') && f.endsWith('.html'));
  assert.ok(vetPages.length >= 2, 'Expected vet-bookings.html and vet-booking.html');

  const requiredOrder = [
    'format.js',
    'api.config.js',
    'auth.service.js',
    'auth-gate.js',
    'header.js'
  ];

  for (const page of vetPages) {
    const scripts = extractLocalScripts(path.join(PAGES_DIR, page));
    const names = scripts.map((s) => path.basename(s.split('?')[0]));
    let lastIdx = -1;
    for (const req of requiredOrder) {
      const idx = names.indexOf(req);
      assert.ok(idx !== -1, `${page} must include ${req}`);
      assert.ok(idx > lastIdx, `${page}: ${req} must appear after previous required scripts`);
      lastIdx = idx;
    }
    const pageScript = page.replace(/\.html$/, '.js');
    const pageIdx = names.indexOf(pageScript);
    assert.ok(pageIdx > lastIdx, `${page}: ${pageScript} must appear after header.js`);
  }
});
