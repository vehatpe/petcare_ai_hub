'use strict';
const { T, lc, iso, isUniqueViolation } = require('./db');
const { DuplicateError } = require('../utils/errors');

const COLS = `UserId, Role, Status, FullName, Email, Phone, PasswordHash, OrgName, OrgType, CreatedAt, ProviderId, OrgArea, ApprovedBy, ApprovedAt, MustChangePassword, RejectReason, TokenVersion, OrgLicenseNo, OrgTaxCode, AvatarUrl, AvatarPublicId`;
const map = (r) => r && ({
  id: lc(r.UserId), role: r.Role, status: r.Status, fullName: r.FullName, email: r.Email, phone: r.Phone,
  passwordHash: r.PasswordHash, orgName: r.OrgName, orgType: r.OrgType, createdAt: iso(r.CreatedAt),
  providerId: r.ProviderId || null, orgArea: r.OrgArea || null,
  approvedBy: lc(r.ApprovedBy), approvedAt: iso(r.ApprovedAt),
  mustChangePassword: Boolean(r.MustChangePassword), rejectReason: r.RejectReason || null,
  tokenVersion: r.TokenVersion !== undefined && r.TokenVersion !== null ? Number(r.TokenVersion) : 0,
  orgLicenseNo: r.OrgLicenseNo || null, orgTaxCode: r.OrgTaxCode || null,
  avatarUrl: r.AvatarUrl || null, avatarPublicId: r.AvatarPublicId || null
});

module.exports = (db) => ({
  async create(u, runner = db) {
    try {
      await runner.query(
        `INSERT INTO dbo.Users (UserId, Role, Status, FullName, Email, Phone, PasswordHash, OrgName, OrgType, ProviderId, OrgArea, ApprovedBy, ApprovedAt, MustChangePassword, RejectReason, OrgLicenseNo, OrgTaxCode)
         VALUES (@id, @role, @status, @fullName, @email, @phone, @hash, @orgName, @orgType, @providerId, @orgArea, @approvedBy, @approvedAt, @mustChangePassword, @rejectReason, @orgLicenseNo, @orgTaxCode)`,
        {
          id: [T.guid, u.id], role: [T.vstr(10), u.role], status: [T.vstr(10), u.status], fullName: [T.str(100), u.fullName],
          email: [T.str(254), u.email], phone: [T.vstr(15), u.phone], hash: [T.vstr(100), u.passwordHash],
          orgName: [T.str(150), u.orgName], orgType: [T.vstr(10), u.orgType],
          providerId: [T.vstr(50), u.providerId || null], orgArea: [T.str(100), u.orgArea || null],
          approvedBy: [T.guid, u.approvedBy || null], approvedAt: [T.dt, u.approvedAt || null],
          mustChangePassword: [T.bool, u.mustChangePassword ? 1 : 0], rejectReason: [T.str(200), u.rejectReason || null],
          orgLicenseNo: [T.str(50), u.orgLicenseNo || null], orgTaxCode: [T.vstr(20), u.orgTaxCode || null]
        }
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateError(/Phone/i.test(e.message) ? 'phone' : 'email');
      throw e;
    }
    return u;
  },
  async findByEmail(email) {
    return map((await db.query(`SELECT ${COLS} FROM dbo.Users WHERE Email = @email`, { email: [T.str(254), email] }))[0]);
  },
  async findByPhone(phone) {
    return map((await db.query(`SELECT ${COLS} FROM dbo.Users WHERE Phone = @phone`, { phone: [T.vstr(15), phone] }))[0]);
  },
  async findById(id) {
    return map((await db.query(`SELECT ${COLS} FROM dbo.Users WHERE UserId = @id`, { id: [T.guid, id] }))[0]);
  },
  async updatePassword(userId, passwordHash, mustChangePassword = false) {
    await db.query(
      `UPDATE dbo.Users
       SET PasswordHash = @hash, MustChangePassword = @mustChangePassword, TokenVersion = TokenVersion + 1
       WHERE UserId = @id`,
      {
        id: [T.guid, userId],
        hash: [T.vstr(100), passwordHash],
        mustChangePassword: [T.bool, mustChangePassword ? 1 : 0]
      }
    );
  },
  async setAvatar(tx, userId, { url, publicId }) {
    const rows = await tx.query(
      `SELECT AvatarPublicId FROM dbo.Users WITH (UPDLOCK) WHERE UserId = @id`,
      { id: [T.guid, userId] }
    );
    if (!rows.length) return null;
    await tx.exec(
      `UPDATE dbo.Users SET AvatarUrl = @url, AvatarPublicId = @publicId WHERE UserId = @id`,
      { id: [T.guid, userId], url: [T.str(500), url], publicId: [T.str(200), publicId] }
    );
    return { previousPublicId: rows[0].AvatarPublicId || null };
  },
  async clearAvatar(tx, userId) {
    const rows = await tx.query(
      `SELECT AvatarPublicId FROM dbo.Users WITH (UPDLOCK) WHERE UserId = @id`,
      { id: [T.guid, userId] }
    );
    if (!rows.length) return null;
    await tx.exec(
      `UPDATE dbo.Users SET AvatarUrl = NULL, AvatarPublicId = NULL WHERE UserId = @id`,
      { id: [T.guid, userId] }
    );
    return { previousPublicId: rows[0].AvatarPublicId || null };
  }
});
