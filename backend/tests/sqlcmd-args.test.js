'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSqlcmdArgs } = require('../scripts/migrate');

test('buildSqlcmdArgs includes -f 65001 for UTF-8 encoding', () => {
  const args = buildSqlcmdArgs('localhost', 'PetCareAIHub', 'sa', 'password', 'SELECT 1;', false);
  assert.ok(args.includes('-f'), 'args must contain -f');
  const idx = args.indexOf('-f');
  assert.equal(args[idx + 1], '65001', '-f must be followed by 65001');
  assert.ok(args.includes('-S'), 'args must specify server');
  assert.ok(args.includes('-d'), 'args must specify database');
});
