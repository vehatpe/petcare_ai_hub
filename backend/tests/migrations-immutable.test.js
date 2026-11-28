'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

const EXPECTED_HASHES = {
  'database/scripts/001_Create_Schema.sql': '563870c7c804c4c6822311a6d4c7cc9f628aebf3c024f6d7b12a43c7c68bab09',
  'database/scripts/002_Create_AI_Knowledge.sql': '68702cd78dedff38ff24228b658c8d5ace3297a2f629e278440c3773dda0327e',
  'database/migrations/003_Expand_Pet_Species_And_Weight.sql': '62a0e0482428cca9abfa63e0f4506bb8e2f83845c9c8dfdf9920cfb397e3a908',
  'database/migrations/004_Roles_Lifecycle.sql': '729207845b099031a1b96897d9f8161900ff954a620ded8539e267b5656e0140',
  'database/migrations/005_Users_TokenVersion.sql': '3641e9ca80e1746efa1e38d18349e31b25c58597f66a64fafcdbea0b524ad2a2',
  'database/migrations/006_Provider_Profile_Legal.sql': 'fa661c5a6bec370f1b973ab6bbf38f009bd680b25f1485fb7476bec88a817c7e',
  'database/migrations/007_Bookings_Lifecycle.sql': '1723c8093208969ba9f4884a8a7b57c84af837dd2517974791b19acaaedf7bf7',
  'database/migrations/008_Photos_Cloud.sql': '8af8c70347449af7827b59a26b9481caa2e5f022c514c977e9ae41ac1a94badf'
};

function computeChecksum(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

test('Applied migrations 001-007 are immutable (SHA-256 matches)', () => {
  for (const [relPath, expected] of Object.entries(EXPECTED_HASHES)) {
    const absPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `Missing migration file: ${relPath}`);
    const actual = computeChecksum(absPath);
    assert.equal(actual, expected, `Checksum mismatch for ${relPath}`);
  }
});
