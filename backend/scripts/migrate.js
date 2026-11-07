'use strict';
/**
 * PetCare AI Hub - Database Migration Runner
 * Usage:
 *   node scripts/migrate.js             # Runs pending baseline and migration scripts
 *   node scripts/migrate.js --seed      # Runs pending migrations and seeds
 *
 * Supports both mssql pool (TCP / Docker / CI) and sqlcmd (Windows SQLEXPRESS / Shared Memory).
 */
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sql = require('mssql');
const { loadConfig } = require('../src/config');

const SCRIPTS_DIR = path.resolve(__dirname, '../../database/scripts');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../database/migrations');
const SEEDS_DIR = path.resolve(__dirname, '../../database/seeds');

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

function splitSqlBatches(content) {
  return content
    .replace(/\r\n/g, '\n')
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .filter((b) => !/^USE\s+[\[\]\w]+/i.test(b));
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
    runSqlcmd(server, null, user, password, `
      IF DB_ID(N'${database}') IS NULL
      BEGIN
        CREATE DATABASE [${database}];
      END
    `);
  } catch (err) {
    console.warn(`[WARN] Could not check/create database from master via sqlcmd: ${err.message}`);
  }

  // 2. Ensure SchemaVersions exists
  runSqlcmd(server, database, user, password, `
    IF OBJECT_ID(N'dbo.SchemaVersions', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SchemaVersions (
        Version   VARCHAR(100) NOT NULL PRIMARY KEY,
        AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  // 3. Get applied versions
  const output = runSqlcmd(server, database, user, password, 'SET NOCOUNT ON; SELECT Version FROM dbo.SchemaVersions;');
  const applied = new Set(output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

  let appliedCount = 0;
  for (const item of filesToRun) {
    if (applied.has(item.version)) {
      console.log(`[SKIP] ${item.version} (already applied)`);
    } else {
      console.log(`[MIGRATE] Applying ${item.version} via sqlcmd...`);
      runSqlcmd(server, database, user, password, item.path, true);
      const escapedVersion = item.version.replace(/'/g, "''");
      runSqlcmd(server, database, user, password, `INSERT INTO dbo.SchemaVersions (Version) VALUES ('${escapedVersion}');`);
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
    connectionTimeout: 5000
  };
  if (dbConfig.user) {
    mssqlConfig.user = dbConfig.user;
    mssqlConfig.password = dbConfig.password;
  }

  console.log(`[MIGRATE] Using mssql connection pool to ${mssqlConfig.server} (Database: ${mssqlConfig.database})...`);

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
          AppliedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAt DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    const res = await pool.request().query('SELECT Version FROM dbo.SchemaVersions;');
    const applied = new Set(res.recordset.map((r) => r.Version));

    let appliedCount = 0;
    for (const item of filesToRun) {
      if (applied.has(item.version)) {
        console.log(`[SKIP] ${item.version} (already applied)`);
      } else {
        const content = fs.readFileSync(item.path, 'utf8');
        const batches = splitSqlBatches(content);
        console.log(`[MIGRATE] Applying ${item.version} (${batches.length} batches)...`);
        for (let i = 0; i < batches.length; i++) {
          await pool.request().query(batches[i]);
        }
        const recordReq = pool.request();
        recordReq.input('version', sql.VarChar(100), item.version);
        await recordReq.query('INSERT INTO dbo.SchemaVersions (Version) VALUES (@version);');
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

  // Choose runner
  const hasSqlcmd = checkSqlcmdAvailable();
  if (hasSqlcmd && process.platform === 'win32' && !dbConfig.user && (!dbConfig.server || dbConfig.server === 'localhost')) {
    // Check if localhost\SQLEXPRESS is reachable
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

module.exports = { runMigrations };
