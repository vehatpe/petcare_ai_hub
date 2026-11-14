'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSqlBatches, computeChecksum } = require('../scripts/migrate');

test('splitSqlBatches: handles GO delimiters, comments, whitespace, and strips USE/CREATE DB', () => {
  const sql = `
/* Header comment */
USE PetCareAIHub;
GO

IF DB_ID(N'PetCareAIHub') IS NULL
    CREATE DATABASE PetCareAIHub;
GO

SELECT 1 AS A;
go

-- Inline comment
SELECT 2 AS B;
GO

   
GO
SELECT 3 AS C;
`;

  const batches = splitSqlBatches(sql);
  assert.equal(batches.length, 3);
  assert.equal(batches[0], 'SELECT 1 AS A;');
  assert.match(batches[1], /SELECT 2 AS B;/);
  assert.equal(batches[2], 'SELECT 3 AS C;');
});

test('computeChecksum: returns 64-char hex SHA-256 and normalizes CRLF vs LF', () => {
  const textLf = 'SELECT * FROM dbo.Users;\nWHERE Role = "customer";\n';
  const textCrlf = 'SELECT * FROM dbo.Users;\r\nWHERE Role = "customer";\r\n';

  const hashLf = computeChecksum(textLf);
  const hashCrlf = computeChecksum(textCrlf);

  assert.equal(hashLf.length, 64);
  assert.match(hashLf, /^[0-9a-f]{64}$/);
  assert.equal(hashLf, hashCrlf, 'CRLF and LF must produce identical checksums');

  const modified = textLf + '-- changed';
  assert.notEqual(computeChecksum(modified), hashLf, 'Modified content must change checksum');
});
