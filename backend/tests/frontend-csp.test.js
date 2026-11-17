'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFrontendCsp } = require('../scripts/check-frontend-csp');

test('Frontend CSP compliance check', () => {
  const { ok, issues } = verifyFrontendCsp();
  assert.equal(ok, true, `CSP issues found:\n${issues.join('\n')}`);
});
