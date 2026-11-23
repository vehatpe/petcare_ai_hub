'use strict';
const { T, lc, iso } = require('./db');

const VET_COLS = `u.UserId, u.Role, u.Status, u.FullName, u.Email, u.Phone, u.CreatedAt,
                  u.ProviderId, u.MustChangePassword, u.TokenVersion`;

const mapVet = (r) => r && ({
  id: lc(r.UserId),
  role: r.Role,
  status: r.Status,
  fullName: r.FullName,
  email: r.Email,
  phone: r.Phone,
  createdAt: iso(r.CreatedAt),
  providerId: r.ProviderId || null,
  mustChangePassword: Boolean(r.MustChangePassword),
  tokenVersion: r.TokenVersion !== undefined && r.TokenVersion !== null ? Number(r.TokenVersion) : 0
});

module.exports = (db) => ({
  async listVets({ providerId, limit = 20, offset = 0 }) {
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const off = Math.max(0, Number(offset) || 0);

    const params = {
      providerId: [T.vstr(50), providerId],
      limit: [T.int, lim],
      offset: [T.int, off]
    };

    const countSql = `SELECT COUNT(*) AS total FROM dbo.Users u WHERE u.Role = 'vet' AND u.ProviderId = @providerId`;
    const [countRow] = await db.query(countSql, params);
    const total = countRow ? countRow.total : 0;

    const dataSql = `
      SELECT ${VET_COLS}
      FROM dbo.Users u
      WHERE u.Role = 'vet' AND u.ProviderId = @providerId
      ORDER BY u.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;
    const rows = await db.query(dataSql, params);
    return {
      vets: rows.map(mapVet),
      meta: { limit: lim, offset: off, total }
    };
  },

  async getVetForUpdate(tx, vetId) {
    const rows = await tx.query(
      `SELECT UserId, Role, Status, FullName, Email, Phone, CreatedAt, ProviderId, MustChangePassword, TokenVersion
       FROM dbo.Users WITH (UPDLOCK, HOLDLOCK)
       WHERE UserId = @id AND Role = 'vet'`,
      { id: [T.guid, vetId] }
    );
    return mapVet(rows[0]);
  },

  async updateVetStatus(tx, vetId, status, incrementTokenVersion = false) {
    if (incrementTokenVersion) {
      await tx.query(
        `UPDATE dbo.Users SET Status = @status, TokenVersion = TokenVersion + 1 WHERE UserId = @id`,
        { id: [T.guid, vetId], status: [T.vstr(10), status] }
      );
    } else {
      await tx.query(
        `UPDATE dbo.Users SET Status = @status WHERE UserId = @id`,
        { id: [T.guid, vetId], status: [T.vstr(10), status] }
      );
    }
  },

  async transaction(work) {
    return db.transaction(work);
  }
});
