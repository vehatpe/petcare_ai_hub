'use strict';
const { T, lc, iso, isUniqueViolation } = require('./db');
const { DuplicateError } = require('../utils/errors');

const COLS = `UserId, Role, Status, FullName, Email, Phone, PasswordHash, OrgName, OrgType, CreatedAt`;
const map = (r) => r && ({
  id: lc(r.UserId), role: r.Role, status: r.Status, fullName: r.FullName, email: r.Email, phone: r.Phone,
  passwordHash: r.PasswordHash, orgName: r.OrgName, orgType: r.OrgType, createdAt: iso(r.CreatedAt)
});

module.exports = (db) => ({
  async create(u) {
    try {
      await db.query(
        `INSERT INTO dbo.Users (UserId, Role, Status, FullName, Email, Phone, PasswordHash, OrgName, OrgType)
         VALUES (@id, @role, @status, @fullName, @email, @phone, @hash, @orgName, @orgType)`,
        {
          id: [T.guid, u.id], role: [T.vstr(10), u.role], status: [T.vstr(10), u.status], fullName: [T.str(100), u.fullName],
          email: [T.str(254), u.email], phone: [T.vstr(15), u.phone], hash: [T.vstr(100), u.passwordHash],
          orgName: [T.str(150), u.orgName], orgType: [T.vstr(10), u.orgType]
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
  }
});
