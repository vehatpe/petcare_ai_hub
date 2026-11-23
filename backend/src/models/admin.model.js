'use strict';
const { T, lc, iso } = require('./db');
const { AppError } = require('../utils/errors');

const USER_COLS = `u.UserId, u.Role, u.Status, u.FullName, u.Email, u.Phone, u.OrgName, u.OrgType, u.CreatedAt,
                   u.ProviderId, u.OrgArea, u.ApprovedBy, u.ApprovedAt, u.MustChangePassword, u.RejectReason`;

const mapUser = (r) => r && ({
  id: lc(r.UserId),
  role: r.Role,
  status: r.Status,
  fullName: r.FullName,
  email: r.Email,
  phone: r.Phone,
  orgName: r.OrgName || null,
  orgType: r.OrgType || null,
  createdAt: iso(r.CreatedAt),
  providerId: r.ProviderId || null,
  orgArea: r.OrgArea || null,
  approvedBy: lc(r.ApprovedBy),
  approvedAt: iso(r.ApprovedAt),
  mustChangePassword: Boolean(r.MustChangePassword),
  rejectReason: r.RejectReason || null
});

module.exports = (db) => ({
  async listUsers({ status, role, limit = 20, offset = 0 }) {
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const off = Math.max(0, Number(offset) || 0);

    const whereClauses = [];
    const params = {
      limit: [T.int, lim],
      offset: [T.int, off]
    };

    if (status) {
      whereClauses.push('u.Status = @status');
      params.status = [T.vstr(10), status];
    }
    if (role) {
      whereClauses.push('u.Role = @role');
      params.role = [T.vstr(10), role];
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM dbo.Users u ${whereSql}`;
    const [countRow] = await db.query(countSql, params);
    const total = countRow ? countRow.total : 0;

    const dataSql = `
      SELECT ${USER_COLS}
      FROM dbo.Users u
      ${whereSql}
      ORDER BY u.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;
    const rows = await db.query(dataSql, params);
    return {
      users: rows.map(mapUser),
      meta: { limit: lim, offset: off, total }
    };
  },

  /**
   * Helper that runs operations in a transaction (retries on 1205)
   */
  async transaction(work) {
    return db.transaction(work);
  },

  /**
   * Operations executed within a runner (pool or tx)
   */
  async getUserForUpdate(tx, userId) {
    const rows = await tx.query(
      `SELECT UserId, Role, Status, FullName, Email, Phone, OrgName, OrgType, CreatedAt,
              ProviderId, OrgArea, ApprovedBy, ApprovedAt, MustChangePassword, RejectReason, TokenVersion
       FROM dbo.Users WITH (UPDLOCK, HOLDLOCK)
       WHERE UserId = @id`,
      { id: [T.guid, userId] }
    );
    const r = rows[0];
    if (!r) return null;
    return {
      ...mapUser(r),
      tokenVersion: r.TokenVersion !== undefined && r.TokenVersion !== null ? Number(r.TokenVersion) : 0
    };
  },

  async providerExists(tx, providerId) {
    const rows = await tx.query(
      `SELECT 1 AS existsFlag FROM dbo.Providers WITH (UPDLOCK, HOLDLOCK) WHERE ProviderId = @id`,
      { id: [T.vstr(50), providerId] }
    );
    return rows.length > 0;
  },

  async isProviderActive(tx, providerId) {
    const rows = await tx.query(
      `SELECT IsActive FROM dbo.Providers WITH (UPDLOCK, HOLDLOCK) WHERE ProviderId = @id`,
      { id: [T.vstr(50), providerId] }
    );
    return rows.length > 0 && Boolean(rows[0].IsActive);
  },

  async countActiveAdmins(tx) {
    const [r] = await tx.query(
      `SELECT COUNT(*) AS total FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE Role = 'admin' AND Status = 'active'`
    );
    return r ? r.total : 0;
  },

  async insertProvider(tx, p) {
    await tx.query(
      `INSERT INTO dbo.Providers (ProviderId, Name, Area, Type, IsSample, IsActive, CreatedAt)
       VALUES (@id, @name, @area, @type, @isSample, @isActive, SYSUTCDATETIME())`,
      {
        id: [T.vstr(50), p.providerId],
        name: [T.str(150), p.name],
        area: [T.str(100), p.area],
        type: [T.vstr(10), p.type],
        isSample: [T.bool, p.isSample ? 1 : 0],
        isActive: [T.bool, p.isActive ? 1 : 0]
      }
    );
  },

  async updateUserApproval(tx, { userId, providerId, approvedBy, approvedAt }) {
    await tx.query(
      `UPDATE dbo.Users
       SET ProviderId = @providerId, Status = 'active', ApprovedBy = @approvedBy, ApprovedAt = @approvedAt
       WHERE UserId = @userId`,
      {
        userId: [T.guid, userId],
        providerId: [T.vstr(50), providerId],
        approvedBy: [T.guid, approvedBy],
        approvedAt: [T.dt, approvedAt]
      }
    );
  },

  async updateUserRejection(tx, { userId, rejectReason }) {
    await tx.query(
      `UPDATE dbo.Users
       SET Status = 'rejected', RejectReason = @rejectReason
       WHERE UserId = @userId`,
      {
        userId: [T.guid, userId],
        rejectReason: [T.str(200), rejectReason]
      }
    );
  },

  async updateUserStatus(tx, userId, status, incrementTokenVersion = false) {
    if (incrementTokenVersion) {
      await tx.query(
        `UPDATE dbo.Users SET Status = @status, TokenVersion = TokenVersion + 1 WHERE UserId = @id`,
        { id: [T.guid, userId], status: [T.vstr(10), status] }
      );
    } else {
      await tx.query(
        `UPDATE dbo.Users SET Status = @status WHERE UserId = @id`,
        { id: [T.guid, userId], status: [T.vstr(10), status] }
      );
    }
  },

  async disableProviderAndVets(tx, providerId) {
    await tx.query(
      `UPDATE dbo.Providers SET IsActive = 0 WHERE ProviderId = @providerId`,
      { providerId: [T.vstr(50), providerId] }
    );
    await tx.query(
      `UPDATE dbo.Users SET Status = 'disabled', TokenVersion = TokenVersion + 1 WHERE ProviderId = @providerId AND Role = 'vet'`,
      { providerId: [T.vstr(50), providerId] }
    );
  },

  async enableProviderOnly(tx, providerId) {
    await tx.query(
      `UPDATE dbo.Providers SET IsActive = 1 WHERE ProviderId = @providerId`,
      { providerId: [T.vstr(50), providerId] }
    );
  },

  async logAudit(tx, { actorUserId, action, targetType, targetId, detail }) {
    await tx.query(
      `INSERT INTO dbo.AuditLog (ActorUserId, Action, TargetType, TargetId, Detail)
       VALUES (@actorUserId, @action, @targetType, @targetId, @detail)`,
      {
        actorUserId: [T.guid, actorUserId || null],
        action: [T.vstr(40), action],
        targetType: [T.vstr(20), targetType],
        targetId: [T.vstr(50), String(targetId)],
        detail: [T.str(500), detail || null]
      }
    );
  }
});
