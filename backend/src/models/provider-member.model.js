'use strict';
const { T, lc, iso } = require('./db');
const { buildMeta } = require('../utils/pagination');

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
  async listVets({ providerId, page = 1, limit = 20 }) {
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const off = (p - 1) * lim;

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
      ORDER BY u.CreatedAt DESC, u.UserId ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;
    const rows = await db.query(dataSql, params);
    return {
      vets: rows.map(mapVet),
      meta: buildMeta({ page: p, limit: lim, total })
    };
  },

  async listVetOptions(providerId) {
    const rows = await db.query(
      `SELECT TOP 200 u.UserId, u.FullName
       FROM dbo.Users u
       WHERE u.Role = 'vet' AND u.Status = 'active' AND u.ProviderId = @providerId
       ORDER BY u.FullName ASC, u.UserId ASC`,
      { providerId: [T.vstr(50), providerId] }
    );
    return rows.map((r) => ({ id: lc(r.UserId), fullName: r.FullName }));
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
  },

  async getProviderProfile(providerId, runner = db) {
    const rows = await runner.query(
      `SELECT ProviderId, Name, Area, Type, Address, Phone, Description, LicenseNo, TaxCode, IsActive, IsSample, UpdatedAt
       FROM dbo.Providers
       WHERE ProviderId = @id`,
      { id: [T.vstr(50), providerId] }
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.ProviderId,
      name: r.Name,
      area: r.Area,
      type: r.Type,
      address: r.Address || null,
      phone: r.Phone || null,
      description: r.Description || null,
      licenseNo: r.LicenseNo || null,
      taxCode: r.TaxCode || null,
      isActive: Boolean(r.IsActive),
      isSample: Boolean(r.IsSample),
      updatedAt: iso(r.UpdatedAt)
    };
  },

  async getProviderForUpdate(tx, providerId) {
    const rows = await tx.query(
      `SELECT ProviderId, Name, Area, Type, Address, Phone, Description, LicenseNo, TaxCode, IsActive, IsSample, UpdatedAt
       FROM dbo.Providers WITH (UPDLOCK, HOLDLOCK)
       WHERE ProviderId = @id`,
      { id: [T.vstr(50), providerId] }
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.ProviderId,
      name: r.Name,
      area: r.Area,
      type: r.Type,
      address: r.Address || null,
      phone: r.Phone || null,
      description: r.Description || null,
      licenseNo: r.LicenseNo || null,
      taxCode: r.TaxCode || null,
      isActive: Boolean(r.IsActive),
      isSample: Boolean(r.IsSample),
      updatedAt: iso(r.UpdatedAt)
    };
  },

  async updateProviderProfile(tx, providerId, fields, updatedAt) {
    await tx.query(
      `UPDATE dbo.Providers
       SET Address = @address, Phone = @phone, Description = @description,
           LicenseNo = @licenseNo, TaxCode = @taxCode, UpdatedAt = @updatedAt
       WHERE ProviderId = @id`,
      {
        id: [T.vstr(50), providerId],
        address: [T.str(200), fields.address],
        phone: [T.vstr(20), fields.phone],
        description: [T.str(500), fields.description],
        licenseNo: [T.str(50), fields.licenseNo],
        taxCode: [T.vstr(20), fields.taxCode],
        updatedAt: [T.dt, updatedAt]
      }
    );
  },

  async listServices({ providerId, page = 1, limit = 20 }) {
    const p = Math.max(1, Number(page) || 1);
    const lim = Math.max(1, Math.min(50, Number(limit) || 20));
    const off = (p - 1) * lim;

    const params = {
      providerId: [T.vstr(50), providerId],
      limit: [T.int, lim],
      offset: [T.int, off]
    };

    const countSql = `SELECT COUNT(*) AS total FROM dbo.Services WHERE ProviderId = @providerId`;
    const [countRow] = await db.query(countSql, params);
    const total = countRow ? countRow.total : 0;

    const dataSql = `
      SELECT ServiceId, ProviderId, Category, CategoryLabel, Name, Description, PriceVnd, Unit, SlotCapacity, IsActive, IsSample, CreatedAt
      FROM dbo.Services
      WHERE ProviderId = @providerId
      ORDER BY CreatedAt DESC, ServiceId ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;
    const rows = await db.query(dataSql, params);
    return {
      services: rows.map((r) => ({
        id: r.ServiceId,
        providerId: r.ProviderId,
        category: r.Category,
        categoryLabel: r.CategoryLabel,
        name: r.Name,
        description: r.Description,
        priceVnd: r.PriceVnd,
        unit: r.Unit,
        slotCapacity: r.SlotCapacity,
        isActive: Boolean(r.IsActive),
        isSample: Boolean(r.IsSample),
        createdAt: iso(r.CreatedAt)
      })),
      meta: buildMeta({ page: p, limit: lim, total })
    };
  },

  async countServices(tx, providerId) {
    const rows = await tx.query(
      `SELECT COUNT(*) AS total FROM dbo.Services WITH (UPDLOCK, HOLDLOCK) WHERE ProviderId = @providerId`,
      { providerId: [T.vstr(50), providerId] }
    );
    return rows[0] ? rows[0].total : 0;
  },

  async getServiceForUpdate(tx, serviceId) {
    const rows = await tx.query(
      `SELECT ServiceId, ProviderId, Category, CategoryLabel, Name, Description, PriceVnd, Unit, SlotCapacity, IsActive, IsSample, CreatedAt
       FROM dbo.Services WITH (UPDLOCK, HOLDLOCK)
       WHERE ServiceId = @id`,
      { id: [T.vstr(50), serviceId] }
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.ServiceId,
      providerId: r.ProviderId,
      category: r.Category,
      categoryLabel: r.CategoryLabel,
      name: r.Name,
      description: r.Description,
      priceVnd: r.PriceVnd,
      unit: r.Unit,
      slotCapacity: r.SlotCapacity,
      isActive: Boolean(r.IsActive),
      isSample: Boolean(r.IsSample),
      createdAt: iso(r.CreatedAt)
    };
  },

  async findServiceByName(tx, providerId, name, excludeServiceId = null) {
    let sql = `SELECT ServiceId, Name FROM dbo.Services WITH (UPDLOCK, HOLDLOCK)
               WHERE ProviderId = @providerId AND LOWER(LTRIM(RTRIM(Name))) = LOWER(LTRIM(RTRIM(@name)))`;
    const params = {
      providerId: [T.vstr(50), providerId],
      name: [T.str(200), name]
    };
    if (excludeServiceId) {
      sql += ` AND ServiceId <> @excludeId`;
      params.excludeId = [T.vstr(50), excludeServiceId];
    }
    const rows = await tx.query(sql, params);
    return rows[0] || null;
  },

  async serviceIdExists(tx, serviceId) {
    const rows = await tx.query(
      `SELECT 1 AS existsFlag FROM dbo.Services WITH (UPDLOCK, HOLDLOCK) WHERE ServiceId = @id`,
      { id: [T.vstr(50), serviceId] }
    );
    return rows.length > 0;
  },

  async createService(tx, service) {
    await tx.query(
      `INSERT INTO dbo.Services (ServiceId, ProviderId, Category, CategoryLabel, Name, Description, PriceVnd, Unit, SlotCapacity, IsActive, IsSample, CreatedAt)
       VALUES (@id, @providerId, @category, @categoryLabel, @name, @description, @priceVnd, @unit, @slotCapacity, @isActive, @isSample, @createdAt)`,
      {
        id: [T.vstr(50), service.id],
        providerId: [T.vstr(50), service.providerId],
        category: [T.vstr(10), service.category],
        categoryLabel: [T.str(50), service.categoryLabel],
        name: [T.str(200), service.name],
        description: [T.str(500), service.description || ''],
        priceVnd: [T.int, service.priceVnd],
        unit: [T.str(30), service.unit],
        slotCapacity: [T.int, service.slotCapacity],
        isActive: [T.bool, service.isActive ? 1 : 0],
        isSample: [T.bool, service.isSample ? 1 : 0],
        createdAt: [T.dt, service.createdAt]
      }
    );
  },

  async updateService(tx, serviceId, fields) {
    await tx.query(
      `UPDATE dbo.Services
       SET Category = @category, CategoryLabel = @categoryLabel, Name = @name,
           Description = @description, PriceVnd = @priceVnd, Unit = @unit, SlotCapacity = @slotCapacity
       WHERE ServiceId = @id`,
      {
        id: [T.vstr(50), serviceId],
        category: [T.vstr(10), fields.category],
        categoryLabel: [T.str(50), fields.categoryLabel],
        name: [T.str(200), fields.name],
        description: [T.str(500), fields.description || ''],
        priceVnd: [T.int, fields.priceVnd],
        unit: [T.str(30), fields.unit],
        slotCapacity: [T.int, fields.slotCapacity]
      }
    );
  },

  async setServiceActive(tx, serviceId, isActive) {
    await tx.query(
      `UPDATE dbo.Services SET IsActive = @isActive WHERE ServiceId = @id`,
      {
        id: [T.vstr(50), serviceId],
        isActive: [T.bool, isActive ? 1 : 0]
      }
    );
  }
});
