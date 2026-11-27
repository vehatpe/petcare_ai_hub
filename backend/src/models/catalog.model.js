'use strict';
const { T } = require('./db');

const CATALOG_MAX_ROWS = 500;

const SERVICE_SELECT = `
  SELECT s.ServiceId, s.Category, s.CategoryLabel, s.ProviderId, p.Name AS ProviderName, p.Area AS ProviderArea,
         p.Address AS ProviderAddress, p.Phone AS ProviderPhone, p.Description AS ProviderDescription,
         s.Name, s.Description, s.PriceVnd, s.Unit, s.SlotCapacity, s.IsSample
  FROM dbo.Services s
  JOIN dbo.Providers p ON p.ProviderId = s.ProviderId
  WHERE s.IsActive = 1 AND p.IsActive = 1`;

const mapService = (r) => r && ({
  id: r.ServiceId, category: r.Category, categoryLabel: r.CategoryLabel, providerId: r.ProviderId,
  providerName: r.ProviderName, providerArea: r.ProviderArea,
  providerAddress: r.ProviderAddress || null, providerPhone: r.ProviderPhone || null, providerDescription: r.ProviderDescription || null,
  name: r.Name, description: r.Description,
  priceVnd: r.PriceVnd, unit: r.Unit, isSample: !!r.IsSample, slotCapacity: r.SlotCapacity
});

module.exports = (db) => ({
  async listProviders() {
    const rows = await db.query(
      `SELECT TOP (@max) ProviderId, Name, Area, Type, Address, Phone, Description, IsSample
       FROM dbo.Providers WHERE IsActive = 1 ORDER BY Name, ProviderId`,
      { max: [T.int, CATALOG_MAX_ROWS] }
    );
    return rows.map((r) => ({
      id: r.ProviderId,
      name: r.Name,
      area: r.Area,
      type: r.Type,
      address: r.Address || null,
      phone: r.Phone || null,
      description: r.Description || null,
      isSample: !!r.IsSample
    }));
  },
  async listServices({ category, providerId, q }) {
    const rows = await db.query(
      `${SERVICE_SELECT.replace('SELECT ', 'SELECT TOP (@max) ')}
         AND (@category IS NULL OR s.Category = @category)
         AND (@providerId IS NULL OR s.ProviderId = @providerId)
         AND (@q IS NULL OR s.Name LIKE @like ESCAPE '\\' OR p.Name LIKE @like ESCAPE '\\')
       ORDER BY s.Category, s.Name, s.ServiceId`,
      {
        max: [T.int, CATALOG_MAX_ROWS],
        category: [T.vstr(10), category], providerId: [T.vstr(50), providerId], q: [T.str(100), q],
        like: [T.str(110), q ? '%' + q.replace(/[\\%_[]/g, (m) => '\\' + m) + '%' : null]
      }
    );
    return rows.map(mapService);
  },
  async getService(id) {
    return mapService((await db.query(`${SERVICE_SELECT} AND s.ServiceId = @id`, { id: [T.vstr(50), id] }))[0]);
  }
});
