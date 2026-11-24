'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('frontend/css/style.css defines [hidden] with display: none !important', () => {
  const cssPath = path.resolve(__dirname, '../../frontend/css/style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify [hidden] rule with display: none !important exists
  const match = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important[^}]*\}/i.test(cssContent);
  assert.equal(match, true, 'frontend/css/style.css must have [hidden] { display: none !important; }');
});
