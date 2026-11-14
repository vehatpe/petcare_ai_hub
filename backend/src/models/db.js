'use strict';
// Thin helper over an mssql ConnectionPool. All values go through parameters - never string concatenation.
const sql = require('mssql');

const T = {
  guid: sql.UniqueIdentifier,
  str: (n) => sql.NVarChar(n),
  vstr: (n) => sql.VarChar(n),
  max: sql.NVarChar(sql.MAX),
  int: sql.Int,
  dec: sql.Decimal(7, 3),
  bool: sql.Bit,
  ymd: sql.VarChar(10), // dates travel as 'YYYY-MM-DD' strings; SQL does CAST(@x AS DATE)
  dt: sql.DateTime2(3)
};

function bind(request, params) {
  for (const [name, [type, value]] of Object.entries(params || {})) request.input(name, type, value === undefined ? null : value);
  return request;
}

/** runner = pool or transaction; returns { query(sql, params) -> recordset[] , exec -> full result } */
function runner(source) {
  const make = () => (source.request ? source.request() : new sql.Request(source));
  return {
    async query(text, params) {
      const r = await bind(make(), params).query(text);
      return r.recordset || [];
    },
    async exec(text, params) {
      return bind(make(), params).query(text);
    }
  };
}

const isDeadlock = (e) => !!(e && (e.number === 1205 || e.originalError?.number === 1205));

function createDb(pool) {
  return {
    ...runner(pool),
    async transaction(work) {
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          const result = await work(runner(tx));
          await tx.commit();
          return result;
        } catch (e) {
          try { await tx.rollback(); } catch (_) { /* already rolled back */ }
          if (isDeadlock(e) && attempt < maxRetries) {
            const delayMs = (attempt + 1) * 50 + Math.floor(Math.random() * 25);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          throw e;
        }
      }
    }
  };
}

const lc = (v) => (v === null || v === undefined ? v : String(v).toLowerCase());
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const isUniqueViolation = (e) => e && (e.number === 2601 || e.number === 2627);

module.exports = { sql, T, createDb, lc, iso, isUniqueViolation, isDeadlock };
