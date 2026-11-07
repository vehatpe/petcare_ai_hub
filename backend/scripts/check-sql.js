'use strict';
/**
 * Best-effort syntax check of database/scripts and database/seeds with node-sql-parser (transactsql).
 * This is NOT a substitute for running the scripts on SQL Server. The parser does not understand every
 * T-SQL construct; batches it cannot parse are reported as "unparsed", with the parser's message.
 * Exit code is 0 unless a file could not be read; unparsed batches are reported but not treated as errors.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Parser } = require('node-sql-parser');

const parser = new Parser();
const root = path.resolve(__dirname, '../../database');
const files = ['scripts', 'seeds'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(d, f)));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const totals = { parsed: 0, unparsed: 0 };

/**
 * The parser cannot read the idempotency guards (IF OBJECT_ID(..., N'U') IS NULL BEGIN ... END and
 * IF NOT EXISTS (SELECT ... sys.indexes ...)). We strip those wrappers and parse the CREATE statements
 * inside (named DEFAULT constraints are also rewritten to plain DEFAULT); the guards themselves are therefore NOT syntax-checked by this script (reviewed by hand instead).
 */
function unwrap(batch) {
  let b = batch;
  const m = /^IF OBJECT_ID\(N'[^']+',\s*N'U'\)\s+IS NULL\s+BEGIN\s+([\s\S]*?)\s+END$/i.exec(b);
  if (m) b = m[1];
  b = b.replace(/IF NOT EXISTS \(SELECT 1 FROM sys\.indexes WHERE name = N'[^']+' AND object_id = OBJECT_ID\(N'[^']+'\)\)/gi, ';');
  b = b.replace(/CONSTRAINT\s+DF_\w+\s+DEFAULT/gi, 'DEFAULT'); // parser lacks named DEFAULT constraints
  b = b.replace(/\s+ON DELETE (?:CASCADE|SET NULL)/gi, ''); // parser lacks referential actions on FKs
  return b.replace(/^\s*;/, '').trim();
}

for (const rel of files) {
  const text = stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log(`\n${rel}: ${batches.length} batch(es) separated by GO`);
  batches.forEach((batch, i) => {
    const head = batch.replace(/\s+/g, ' ').slice(0, 70);
    try {
      const inner = unwrap(batch);
      for (const stmt of inner.split(/;\s*/).filter((x) => x.trim())) parser.astify(stmt, { database: 'transactsql' });
      totals.parsed++;
      console.log(`  [parsed]   #${i + 1} ${head}${inner !== batch ? '  (guard stripped, inner statement parsed)' : ''}`);
    } catch (e) {
      totals.unparsed++;
      console.log(`  [unparsed] #${i + 1} ${head}\n             ${String(e.message).split('\n')[0].slice(0, 140)}`);
    }
  });
}
console.log(`\nTổng: ${totals.parsed} batch parse được, ${totals.unparsed} batch parser không xử lý được (cú pháp T-SQL ngoài phạm vi parser, KHÔNG có nghĩa là sai).`);
console.log('Lưu ý: script chưa được chạy trên SQL Server thật.');
