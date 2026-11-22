'use strict';
const sql = require('mssql');
const { createDb } = require('./db');

/** Connects to SQL Server and returns { models, pool }. */
async function createSqlModels(dbConfig) {
  const pool = await new sql.ConnectionPool({
    server: dbConfig.server, database: dbConfig.database, user: dbConfig.user, password: dbConfig.password, port: dbConfig.port,
    options: { encrypt: dbConfig.encrypt, trustServerCertificate: dbConfig.trustServerCertificate },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  }).connect();
  const db = createDb(pool);
  const models = {
    users: require('./user.model')(db),
    admin: require('./admin.model')(db),
    providerMember: require('./provider-member.model')(db),
    catalog: require('./catalog.model')(db),
    pets: require('./pet.model')(db),
    health: require('./health.model')(db),
    bookings: require('./booking.model')(db),
    knowledge: require('./knowledge.model')(db),
    audit: require('./audit.model')(db),
    async ping() {
      const r = await pool.request().query('SELECT 1 AS ok;');
      return r.recordset?.[0]?.ok === 1;
    }
  };
  return { models, pool };
}

module.exports = { createSqlModels };
