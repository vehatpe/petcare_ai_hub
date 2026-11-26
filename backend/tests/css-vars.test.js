'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_DIR = path.resolve(__dirname, '../../frontend/css');

test('All CSS var(--...) references without fallback are defined in style.css', () => {
  const styleCss = fs.readFileSync(path.join(CSS_DIR, 'style.css'), 'utf8');
  const defined = new Set();
  for (const m of styleCss.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) {
    defined.add(m[1]);
  }
  assert.ok(defined.size > 0, 'style.css must define CSS custom properties');

  const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));
  const missing = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
    // Match var(--name) or var(--name, fallback)
    for (const m of content.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,([^)]+))?\)/g)) {
      const name = m[1];
      const hasFallback = m[2] !== undefined && m[2].trim().length > 0;
      if (!defined.has(name) && !hasFallback) {
        missing.push(`${file}: ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], `Undefined CSS variables without fallback:\n${missing.join('\n')}`);
});
