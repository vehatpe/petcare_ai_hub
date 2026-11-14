'use strict';
/**
 * PetCare AI Hub - Database Migration Runner
 * Usage:
 *   node scripts/migrate.js             # Runs pending baseline and migration scripts
 *   node scripts/migrate.js --seed      # Runs pending migrations and seeds
 *   node scripts/migrate.js --pool-only # Forces mssql pool runner over TCP
 *
 * Supports both mssql pool (TCP / Docker / CI) and sqlcmd (Windows SQLEXPRESS / Shared Memory).
 * Tracks schema versions and SHA-256 checksums in dbo.SchemaVersions.
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');
const { loadConfig } = require('../src/config');

const SCRIPTS_DIR = path.resolve(__dirname, '../../database/scripts');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');
const SEEDS_DIR = path.resolve(__dirname, '../../database/seeds');

function computeChecksum(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function checkSqlcmdAvailable() {
  try {
    const res = spawnSync('sqlcmd', ['-?'], { stdio: 'ignore' });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

function runSqlcmd(server, database, user, password, queryOrFile, isFile = false) {
  const args = ['-S', server];
  if (user) {
    args.push('-U', user, '-P', password);
  } else {
    args.push('-E');
  }
  if (database) {
    args.push('-d', database);
  }
  args.push('-C', '-b', '-h', '-1', '-W');
  if (isFile) {
    args.push('-i', queryOrFile);
  } else {
    args.push('-Q', queryOrFile);
  }

  const res = spawnSync('sqlcmd', args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`sqlcmd failed (code ${res.status}): ${(res.stderr || res.stdout || '').trim()}`);
  }
  return (res.stdout || '').trim();
}

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
}

function splitSqlBatches(content) {
  // Strip hardcoded database creation/switching statements so batches stay in the pool's target database
  const cleaned = content
    .replace(/\bUSE\s+\[?[\w]+\]?\s*;?/gi, '')
    .replace(/IF\s+DB_ID\([^)]+\)\s+IS\s+NULL\s+CREATE\s+DATABASE\s+[\w]+;?/gi, '');

  return cleaned
    .replace(/\r\n/g, '\n')
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .filter((b) => stripComments(b).length > 0);
}

// ------------------- SQLCMD Runner -------------------
async function runWithSqlcmd(dbConfig, filesToRun) {
  const server = dbConfig.server || 'localhost\\SQLEXPRESS';
  const database = dbConfig.database || 'PetCareAIHub';
  const user = dbConfig.user;
  const password = dbConfig.password;

  console.log(`[MIGRATE] Using sqlcmd to connect to ${server} (Database: ${database})...`);

  // 1. Ensure Database exists
  try {
    runSqlcmd(server, 'master', user, password, `
      IF DB_ID(N'${database}') IS NULL
      BEGIN
        CREATE DATABASE [${database}];
      END
    `);
  } catch (err) {
    console.warn(`[WARN] Could not check/create database from master via sqlcmd: ${err.message}`);
  }

  // 2. Ensure SchemaVersions exists with Checksum column
  runSqlcmd(server, database, user, password, `
    IF OBJECT_ID(N'dbo.SchemaVersions', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SchemaVersions (
        Version   VARCHAR(100) NOT NULL PRIMARY KEY,
        AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME(),
        Checksum  VARCHAR(64)  NULL
      );
    END
    ELSE IF COL_LENGTH('dbo.SchemaVersions', 'Checksum') IS NULL
    BEGIN
      ALTER TABLE dbo.SchemaVersions ADD Checksum VARCHAR(64) NULL;
    END
  `);

  // 3. Get applied versions and checksums
  const output = runSqlcmd(server, database, user, password, 'SET NOCOUNT ON; SELECT Version + \'|\' + ISNULL(Checksum, \'\') FROM dbo.SchemaVersions;');
  const applied = new Map();
  output.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s) return;
    const [v, c] = s.split('|');
    applied.set(v.trim(), c ? c.trim() : null);
  });

  let appliedCount = 0;
  for (const item of filesToRun) {
    const content = fs.readFileSync(item.path, 'utf8');
    const checksum = computeChecksum(content);

    if (applied.has(item.version)) {
      const storedChecksum = applied.get(item.version);
      if (storedChecksum && storedChecksum !== checksum) {
        throw new Error(`[CHECKSUM MISMATCH] ${item.version} was altered after being applied! Stored: ${storedChecksum}, Current: ${checksum}`);
      }
      if (!storedChecksum) {
        // Backfill checksum
        const escVer = item.version.replace(/'/g, "''");
        runSqlcmd(server, database, user, password, `UPDATE dbo.SchemaVersions SET Checksum = '${checksum}' WHERE Version = '${escVer}';`);
      }
      console.log(`[SKIP] ${item.version} (already applied, checksum verified)`);
    } else {
      console.log(`[MIGRATE] Applying ${item.version} via sqlcmd...`);
      runSqlcmd(server, database, user, password, item.path, true);
      const escapedVersion = item.version.replace(/'/g, "''");
      runSqlcmd(server, database, user, password, `INSERT INTO dbo.SchemaVersions (Version, Checksum) VALUES ('${escapedVersion}', '${checksum}');`);
      console.log(`[MIGRATE] OK: ${item.version}`);
      appliedCount++;
    }
  }

  console.log(`Migration finished. ${appliedCount} script(s) applied, ${filesToRun.length - appliedCount} skipped.`);
}

// ------------------- MSSQL Pool Runner -------------------
async function runWithMssql(dbConfig, filesToRun) {
  let server = dbConfig.server || 'localhost';
  let instanceName = undefined;
  if (server.includes('\\')) {
    const parts = server.split('\\');
    server = parts[0];
    instanceName = parts[1];
  }

  const options = {
    encrypt: dbConfig.encrypt ?? true,
    trustServerCertificate: dbConfig.trustServerCertificate ?? true
  };
  if (instanceName) options.instanceName = instanceName;

  const mssqlConfig = {
    server,
    database: dbConfig.database || 'PetCareAIHub',
    port: instanceName ? undefined : (dbConfig.port || 1433),
    options,
    pool: { max: 5, min: 0, idleTimeoutMillis: 10000 },
    connectionTimeout: 8000
  };
  if (dbConfig.user) {
    mssqlConfig.user = dbConfig.user;
    mssqlConfig.password = dbConfig.password;
  }

  console.log(`[MIGRATE] Using mssql connection pool to ${mssqlConfig.server}:${mssqlConfig.port || 'default'} (Database: ${mssqlConfig.database})...`);

  // Ensure database exists
  try {
    const masterPool = await new sql.ConnectionPool({ ...mssqlConfig, database: 'master' }).connect();
    const req = masterPool.request();
    const dbName = mssqlConfig.database.replace(/]/g, ']]');
    await req.query(`IF DB_ID(N'${dbName}') IS NULL CREATE DATABASE [${dbName}];`);
    await masterPool.close();
  } catch (err) {
    console.warn(`[WARN] Could not check/create database from master: ${err.message}`);
  }

  const pool = await new sql.ConnectionPool(mssqlConfig).connect();
  try {
    const req = pool.request();
    await req.query(`
      IF OBJECT_ID(N'dbo.SchemaVersions', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.SchemaVersions (
          Version   VARCHAR(100) NOT NULL PRIMARY KEY,
          AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME(),
          Checksum  VARCHAR(64)  NULL
        );
      END
      ELSE IF COL_LENGTH('dbo.SchemaVersions', 'Checksum') IS NULL
      BEGIN
        ALTER TABLE dbo.SchemaVersions ADD Checksum VARCHAR(64) NULL;
      END
    `);

    const res = await pool.request().query('SELECT Version, Checksum FROM dbo.SchemaVersions;');
    const applied = new Map(res.recordset.map((r) => [r.Version, r.Checksum ? r.Checksum.trim() : null]));

    let appliedCount = 0;
    for (const item of filesToRun) {
      const content = fs.readFileSync(item.path, 'utf8');
      const checksum = computeChecksum(content);

      if (applied.has(item.version)) {
        const storedChecksum = applied.get(item.version);
        if (storedChecksum && storedChecksum !== checksum) {
          throw new Error(`[CHECKSUM MISMATCH] ${item.version} was altered after being applied! Stored: ${storedChecksum}, Current: ${checksum}`);
        }
        if (!storedChecksum) {
          const upReq = pool.request();
          upReq.input('version', sql.VarChar(100), item.version);
          upReq.input('checksum', sql.VarChar(64), checksum);
          await upReq.query('UPDATE dbo.SchemaVersions SET Checksum = @checksum WHERE Version = @version;');
        }
        console.log(`[SKIP] ${item.version} (already applied, checksum verified)`);
      } else {
        const batches = splitSqlBatches(content);
        console.log(`[MIGRATE] Applying ${item.version} (${batches.length} batches via mssql pool)...`);
        for (let i = 0; i < batches.length; i++) {
          await pool.request().query(batches[i]);
        }
        const recordReq = pool.request();
        recordReq.input('version', sql.VarChar(100), item.version);
        recordReq.input('checksum', sql.VarChar(64), checksum);
        await recordReq.query('INSERT INTO dbo.SchemaVersions (Version, Checksum) VALUES (@version, @checksum);');
        console.log(`[MIGRATE] OK: ${item.version}`);
        appliedCount++;
      }
    }
    console.log(`Migration finished. ${appliedCount} script(s) applied, ${filesToRun.length - appliedCount} skipped.`);
  } finally {
    await pool.close();
  }
}

async function runMigrations() {
  const withSeed = process.argv.includes('--seed');
  const forcePoolOnly = process.argv.includes('--pool-only');
  const config = loadConfig();
  const dbConfig = { ...config.db };

  // Collect scripts to run
  const filesToRun = [];

  // 1. Baseline scripts from database/scripts/
  if (fs.existsSync(SCRIPTS_DIR)) {
    const scripts = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of scripts) {
      filesToRun.push({ version: f, path: path.join(SCRIPTS_DIR, f) });
    }
  }

  // 2. Incremental migrations from database/migrations/
  if (fs.existsSync(MIGRATIONS_DIR)) {
    const migrations = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrations) {
      filesToRun.push({ version: f, path: path.join(MIGRATIONS_DIR, f) });
    }
  }

  // 3. Optional seeds
  if (withSeed && fs.existsSync(SEEDS_DIR)) {
    const seeds = fs.readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of seeds) {
      filesToRun.push({ version: `seed_${f}`, path: path.join(SEEDS_DIR, f) });
    }
  }

  if (forcePoolOnly) {
    await runWithMssql(dbConfig, filesToRun);
    return;
  }

  // Choose runner
  const hasSqlcmd = checkSqlcmdAvailable();
  if (hasSqlcmd && process.platform === 'win32' && !dbConfig.user && (!dbConfig.server || dbConfig.server === 'localhost')) {
    try {
      runSqlcmd('localhost\\SQLEXPRESS', null, null, null, 'SELECT 1;');
      dbConfig.server = 'localhost\\SQLEXPRESS';
    } catch (_) {}
  }

  const isNamedInstance = String(dbConfig.server).includes('\\');
  const preferSqlcmd = hasSqlcmd && (isNamedInstance || (!dbConfig.user && process.platform === 'win32'));

  if (preferSqlcmd) {
    try {
      await runWithSqlcmd(dbConfig, filesToRun);
      return;
    } catch (e) {
      console.warn(`[WARN] sqlcmd runner failed: ${e.message}. Falling back to mssql pool...`);
    }
  }

  try {
    await runWithMssql(dbConfig, filesToRun);
  } catch (e) {
    if (hasSqlcmd && !preferSqlcmd) {
      console.warn(`[WARN] mssql pool failed: ${e.message}. Trying fallback with sqlcmd...`);
      await runWithSqlcmd(dbConfig, filesToRun);
    } else {
      throw e;
    }
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('[FATAL] Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigrations, splitSqlBatches, computeChecksum };
