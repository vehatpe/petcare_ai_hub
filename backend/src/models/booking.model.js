'use strict';
const { T, lc, iso, isUniqueViolation } = require('./db');

const SELECT = `
  SELECT b.BookingId, b.BookingCode, b.UserId, b.PetId, b.ServiceId, b.ProviderId, b.VetId,
         b.PetName, b.ServiceName, b.ProviderLabel, b.PriceVnd,
         CONVERT(CHAR(10), b.BookingDate, 23) AS BookingDate, b.BookingTime, b.Notes, b.Status,
         b.ConfirmedAt, b.CompletedAt, b.NoShowAt, b.CancelledAt, b.CancelledBy, b.CancelReason,
         b.CreatedAt, p.IsSample AS ProviderIsSample
  FROM dbo.Bookings b
  LEFT JOIN dbo.Providers p ON b.ProviderId = p.ProviderId`;

const mapCustomer = (r) => r && ({
  id: lc(r.BookingId),
  code: r.BookingCode,
  petId: lc(r.PetId) || null,
  petName: r.PetName,
  serviceId: r.ServiceId,
  serviceName: r.ServiceName,
  providerId: r.ProviderId,
  providerName: r.ProviderLabel,
  providerIsSample: Boolean(r.ProviderIsSample),
  priceVnd: r.PriceVnd,
  date: r.BookingDate,
  time: r.BookingTime,
  notes: r.Notes,
  status: r.Status,
  confirmedAt: iso(r.ConfirmedAt),
  completedAt: iso(r.CompletedAt),
  cancelledAt: iso(r.CancelledAt),
  cancelledBy: r.CancelledBy || null,
  cancelReason: r.CancelReason || null,
  createdAt: iso(r.CreatedAt)
});

const UPCOMING_EXPR = `CASE WHEN Status IN ('pending','confirmed') AND (BookingDate > CAST(@today AS DATE) OR (BookingDate = CAST(@today AS DATE) AND BookingTime >= @time)) THEN 1 ELSE 0 END`;

const mapProvider = (r) => r && ({
  id: lc(r.BookingId),
  code: r.BookingCode,
  date: r.BookingDate,
  time: r.BookingTime,
  status: r.Status,
  serviceName: r.ServiceName,
  priceVnd: r.PriceVnd,
  petName: r.PetName,
  petSpecies: r.PetSpecies || null,
  customerName: r.CustomerName,
  customerPhone: r.CustomerPhone || null,
  vet: r.VetId ? { id: lc(r.VetId), name: r.VetName } : null,
  notes: r.Notes,
  cancelledBy: r.CancelledBy || null,
  cancelReason: r.CancelReason || null,
  createdAt: iso(r.CreatedAt),
  confirmedAt: iso(r.ConfirmedAt),
  completedAt: iso(r.CompletedAt),
  noShowAt: iso(r.NoShowAt)
});

const mapVet = (r) => r && ({
  id: lc(r.BookingId),
  code: r.BookingCode,
  date: r.BookingDate,
  time: r.BookingTime,
  status: r.Status,
  serviceName: r.ServiceName,
  petId: lc(r.PetId) || null,
  petName: r.PetName,
  petSpecies: r.PetSpecies || null,
  customerName: r.CustomerName || null,
  notes: r.Notes,
  hasMedicalRecord: Boolean(r.HasMedicalRecord)
});

const PROVIDER_SELECT = `
  SELECT b.BookingId, b.BookingCode, b.ProviderId, b.VetId,
         b.PetName, b.ServiceName, b.PriceVnd,
         CONVERT(CHAR(10), b.BookingDate, 23) AS BookingDate, b.BookingTime, b.Notes, b.Status,
         b.ConfirmedAt, b.CompletedAt, b.NoShowAt, b.CancelledBy, b.CancelReason, b.CreatedAt,
         pt.Species AS PetSpecies,
         u.FullName AS CustomerName, u.Phone AS CustomerPhone,
         v.FullName AS VetName
  FROM dbo.Bookings b
  LEFT JOIN dbo.Pets pt ON b.PetId = pt.PetId
  INNER JOIN dbo.Users u ON b.UserId = u.UserId
  LEFT JOIN dbo.Users v ON b.VetId = v.UserId`;

module.exports = (db) => {
  const getByOwner = async (id, ownerId) =>
    mapCustomer((await db.query(`${SELECT} WHERE b.BookingId = @id AND b.UserId = @owner`, { id: [T.guid, id], owner: [T.guid, ownerId] }))[0]);

  return {
    async listByOwner(ownerId, { scope = 'all', petId = null, today, time, offset = 0, limit = 20 } = {}) {
      const scopeFilter = scope === 'upcoming' ? 'AND u.IsUpcoming = 1' : scope === 'history' ? 'AND u.IsUpcoming = 0' : '';
      const orderBy = scope === 'upcoming'
        ? 'BookingDate ASC, BookingTime ASC, BookingId ASC'
        : scope === 'history'
          ? 'BookingDate DESC, BookingTime DESC, BookingId DESC'
          : `u.IsUpcoming DESC,
             CASE WHEN u.IsUpcoming = 1 THEN CONVERT(CHAR(10), BookingDate, 23) + ' ' + BookingTime END ASC,
             CASE WHEN u.IsUpcoming = 0 THEN CONVERT(CHAR(10), BookingDate, 23) + ' ' + BookingTime END DESC,
             BookingId ASC`;
      const params = {
        owner: [T.guid, ownerId],
        petId: [T.guid, petId],
        today: [T.ymd, today],
        time: [T.vstr(5), time],
        offset: [T.int, offset],
        limit: [T.int, limit]
      };
      const [countRow] = await db.query(
        `SELECT COUNT(*) AS total
         FROM dbo.Bookings
         CROSS APPLY (SELECT ${UPCOMING_EXPR} AS IsUpcoming) u
         WHERE UserId = @owner AND (@petId IS NULL OR PetId = @petId) ${scopeFilter}`,
        params
      );
      const rows = await db.query(
        `${SELECT}
         CROSS APPLY (SELECT ${UPCOMING_EXPR} AS IsUpcoming) u
         WHERE UserId = @owner AND (@petId IS NULL OR PetId = @petId) ${scopeFilter}
         ORDER BY ${orderBy}
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
        params
      );
      return { rows: rows.map(mapCustomer), total: Number(countRow?.total) || 0 };
    },
    async countsByOwner(ownerId, { today, time }) {
      const [row] = await db.query(
        `SELECT COUNT(*) AS total,
                SUM(${UPCOMING_EXPR}) AS upcomingCount
         FROM dbo.Bookings
         WHERE UserId = @owner`,
        { owner: [T.guid, ownerId], today: [T.ymd, today], time: [T.vstr(5), time] }
      );
      return {
        total: Number(row?.total) || 0,
        upcomingCount: Number(row?.upcomingCount) || 0
      };
    },
    async nextUpcomingByOwner(ownerId, { today, time }) {
      const rows = await db.query(
        `${SELECT.replace('SELECT ', 'SELECT TOP (1) ')}
         WHERE UserId = @owner
           AND Status IN ('pending','confirmed')
           AND (BookingDate > CAST(@today AS DATE) OR (BookingDate = CAST(@today AS DATE) AND BookingTime >= @time))
         ORDER BY BookingDate ASC, BookingTime ASC, BookingId ASC`,
        { owner: [T.guid, ownerId], today: [T.ymd, today], time: [T.vstr(5), time] }
      );
      return mapCustomer(rows[0]) || null;
    },
    getByOwner,
    async getById(id) {
      return mapCustomer((await db.query(`${SELECT} WHERE b.BookingId = @id`, { id: [T.guid, id] }))[0]);
    },
    async countBySlot(serviceId, date) {
      const rows = await db.query(
        `SELECT BookingTime, COUNT(*) AS n FROM dbo.Bookings
         WHERE ServiceId = @svc AND BookingDate = CAST(@d AS DATE) AND Status <> 'cancelled' GROUP BY BookingTime`,
        { svc: [T.vstr(50), serviceId], d: [T.ymd, date] });
      return Object.fromEntries(rows.map((r) => [r.BookingTime, r.n]));
    },
    /** Capacity check + insert in one transaction; UPDLOCK+HOLDLOCK range-locks the slot so two users cannot overbook. */
    async create(b, { capacity }) {
      try {
        return await db.transaction(async (tx) => {
          const p = { svc: [T.vstr(50), b.serviceId], pet: [T.guid, b.petId], d: [T.ymd, b.date], t: [T.vstr(5), b.time] };
          const [clash] = await tx.query(
            `SELECT COUNT(*) AS n FROM dbo.Bookings WITH (UPDLOCK, HOLDLOCK)
             WHERE PetId = @pet AND BookingDate = CAST(@d AS DATE) AND BookingTime = @t AND Status <> 'cancelled'`, p);
          if (clash.n > 0) return { ok: false, reason: 'pet_clash' };
          const [used] = await tx.query(
            `SELECT COUNT(*) AS n FROM dbo.Bookings WITH (UPDLOCK, HOLDLOCK)
             WHERE ServiceId = @svc AND BookingDate = CAST(@d AS DATE) AND BookingTime = @t AND Status <> 'cancelled'`, p);
          if (used.n >= capacity) return { ok: false, reason: 'full' };
          await tx.query(
            `INSERT INTO dbo.Bookings (BookingId, BookingCode, UserId, PetId, ServiceId, ProviderId, PetName, ServiceName, ProviderLabel,
                                       PriceVnd, BookingDate, BookingTime, Notes, Status)
             VALUES (@id, @code, @owner, @pet, @svc, @providerId, @petName, @svcName, @provider, @price, CAST(@d AS DATE), @t, @notes, 'pending')`,
            {
              ...p, id: [T.guid, b.id], code: [T.vstr(11), b.code], owner: [T.guid, b.ownerId],
              providerId: [T.vstr(50), b.providerId],
              petName: [T.str(40), b.petName],
              svcName: [T.str(200), b.serviceName], provider: [T.str(260), b.providerName], price: [T.int, b.priceVnd],
              notes: [T.str(500), b.notes]
            });
          const row = (await tx.query(`${SELECT} WHERE b.BookingId = @id`, { id: [T.guid, b.id] }))[0];
          return { ok: true, booking: mapCustomer(row) };
        });
      } catch (e) {
        // The filtered unique index is the last line of defence against a same-pet race.
        if (isUniqueViolation(e) && /UX_Bookings_Pet_Slot/.test(e.message)) return { ok: false, reason: 'pet_clash' };
        throw e;
      }
    },
    /**
     * State transition with row lock & Status check.
     * UPDATE ... WHERE Id = @id AND Status = @from
     * Returns null if rowsAffected === 0 (lost race or mismatched status).
     */
    async transition(executor, id, { from, to, fields = {} }) {
      const client = executor || db;

      const runInTx = async (tx) => {
        // Read row with UPDLOCK, HOLDLOCK
        const [existing] = await tx.query(
          `SELECT BookingId, Status FROM dbo.Bookings WITH (UPDLOCK, HOLDLOCK) WHERE BookingId = @id`,
          { id: [T.guid, id] }
        );
        if (!existing || existing.Status !== from) {
          return null;
        }

        const setClauses = ['Status = @to', 'UpdatedAt = SYSUTCDATETIME()'];
        const params = {
          id: [T.guid, id],
          from: [T.vstr(15), from],
          to: [T.vstr(15), to]
        };

        if (fields.cancelledAt !== undefined) {
          setClauses.push('CancelledAt = @cancelledAt');
          params.cancelledAt = [T.dt, fields.cancelledAt ? new Date(fields.cancelledAt) : null];
        }
        if (fields.cancelledBy !== undefined) {
          setClauses.push('CancelledBy = @cancelledBy');
          params.cancelledBy = [T.vstr(10), fields.cancelledBy];
        }
        if (fields.cancelReason !== undefined) {
          setClauses.push('CancelReason = @cancelReason');
          params.cancelReason = [T.str(300), fields.cancelReason];
        }
        if (fields.confirmedAt !== undefined) {
          setClauses.push('ConfirmedAt = @confirmedAt');
          params.confirmedAt = [T.dt, fields.confirmedAt ? new Date(fields.confirmedAt) : null];
        }
        if (fields.completedAt !== undefined) {
          setClauses.push('CompletedAt = @completedAt');
          params.completedAt = [T.dt, fields.completedAt ? new Date(fields.completedAt) : null];
        }
        if (fields.noShowAt !== undefined) {
          setClauses.push('NoShowAt = @noShowAt');
          params.noShowAt = [T.dt, fields.noShowAt ? new Date(fields.noShowAt) : null];
        }
        if (fields.vetId !== undefined) {
          setClauses.push('VetId = @vetId');
          params.vetId = [T.guid, fields.vetId];
        }

        const query = `
          UPDATE dbo.Bookings
          SET ${setClauses.join(', ')}
          WHERE BookingId = @id AND Status = @from
        `;
        const r = await tx.exec(query, params);
        if (!r.rowsAffected || r.rowsAffected[0] === 0) {
          return null;
        }

        const [updatedRow] = await tx.query(`${SELECT} WHERE b.BookingId = @id`, { id: [T.guid, id] });
        return mapCustomer(updatedRow);
      };

      if (executor && typeof executor.query === 'function' && typeof executor.exec === 'function') {
        return runInTx(executor);
      }
      return db.transaction(runInTx);
    },
    async getByIdForProvider(id, providerId) {
      const rows = await db.query(
        `${PROVIDER_SELECT} WHERE b.BookingId = @id AND b.ProviderId = @providerId`,
        { id: [T.guid, id], providerId: [T.vstr(50), providerId] }
      );
      return mapProvider(rows[0]);
    },
    async listByProvider(providerId, filters = {}, { offset = 0, limit = 20 } = {}) {
      const dateWhere = ['b.ProviderId = @providerId'];
      const params = { providerId: [T.vstr(50), providerId] };

      if (filters.date) {
        dateWhere.push('b.BookingDate = CAST(@date AS DATE)');
        params.date = [T.ymd, filters.date];
      } else {
        if (filters.from) {
          dateWhere.push('b.BookingDate >= CAST(@from AS DATE)');
          params.from = [T.ymd, filters.from];
        }
        if (filters.to) {
          dateWhere.push('b.BookingDate <= CAST(@to AS DATE)');
          params.to = [T.ymd, filters.to];
        }
      }

      const itemWhere = [...dateWhere];
      if (filters.status) {
        itemWhere.push('b.Status = @status');
        params.status = [T.vstr(15), filters.status];
      }
      if (filters.vetId) {
        itemWhere.push('b.VetId = @vetId');
        params.vetId = [T.guid, filters.vetId];
      }
      if (filters.q) {
        const escapedQ = filters.q.replace(/[\\%_[]/g, (ch) => `\\${ch}`);
        itemWhere.push("(b.BookingCode LIKE @q ESCAPE '\\' OR b.PetName LIKE @q ESCAPE '\\')");
        params.q = [T.str(200), `%${escapedQ}%`];
      }

      const [countRow] = await db.query(
        `SELECT COUNT(*) AS total
         FROM dbo.Bookings b
         WHERE ${itemWhere.join(' AND ')}`,
        params
      );
      const rows = await db.query(
        `${PROVIDER_SELECT}
         WHERE ${itemWhere.join(' AND ')}
         ORDER BY b.BookingDate ASC, b.BookingTime ASC, b.BookingId ASC
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
        { ...params, offset: [T.int, offset], limit: [T.int, limit] }
      );

      const summaryRows = await db.query(
        `SELECT b.Status, COUNT(*) AS n
         FROM dbo.Bookings b
         WHERE ${dateWhere.join(' AND ')}
         GROUP BY b.Status`,
        params
      );
      const summary = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 };
      for (const r of summaryRows) {
        if (Object.prototype.hasOwnProperty.call(summary, r.Status)) {
          summary[r.Status] = r.n;
        }
      }

      return { items: rows.map(mapProvider), summary, total: Number(countRow?.total) || 0 };
    },
    async hasMedicalRecordForBooking(bookingId, vetId) {
      const rows = await db.query(
        `SELECT TOP 1 RecordId FROM dbo.Medical_Records WHERE BookingId = @bookingId AND VetId = @vetId`,
        { bookingId: [T.guid, bookingId], vetId: [T.guid, vetId] }
      );
      return rows.length > 0;
    },
    async isActiveVetOfProvider(vetId, providerId) {
      const rows = await db.query(
        `SELECT TOP 1 UserId FROM dbo.Users WHERE UserId = @vetId AND Role = 'vet' AND Status = 'active' AND ProviderId = @providerId`,
        { vetId: [T.guid, vetId], providerId: [T.vstr(50), providerId] }
      );
      return rows.length > 0;
    },
    async isFacilityActive(providerId) {
      const rows = await db.query(
        `SELECT TOP 1 IsActive FROM dbo.Providers WHERE ProviderId = @providerId`,
        { providerId: [T.vstr(50), providerId] }
      );
      return rows.length > 0 && Boolean(rows[0].IsActive);
    },
    async listForVet(vetId, filters = {}, { offset = 0, limit = 20 } = {}) {
      const where = ['b.VetId = @vetId'];
      const params = { vetId: [T.guid, vetId] };
      if (filters.status) { where.push('b.Status = @status'); params.status = [T.vstr(20), filters.status]; }
      if (filters.date) { where.push('b.BookingDate = CAST(@date AS DATE)'); params.date = [T.ymd, filters.date]; }
      if (filters.from) { where.push('b.BookingDate >= CAST(@from AS DATE)'); params.from = [T.ymd, filters.from]; }
      if (filters.to) { where.push('b.BookingDate <= CAST(@to AS DATE)'); params.to = [T.ymd, filters.to]; }
      if (filters.q) {
        where.push('(b.BookingCode LIKE @q OR b.PetName LIKE @q OR u.FullName LIKE @q OR b.ServiceName LIKE @q)');
        params.q = [T.str(100), `%${filters.q}%`];
      }
      const [countRow] = await db.query(
        `SELECT COUNT(*) AS total
         FROM dbo.Bookings b
         LEFT JOIN dbo.Pets p ON p.PetId = b.PetId
         LEFT JOIN dbo.Users u ON u.UserId = b.UserId
         WHERE ${where.join(' AND ')}`,
        params
      );
      const rows = await db.query(
        `SELECT b.BookingId, b.BookingCode, b.PetId, b.PetName, p.Species AS PetSpecies,
                b.ServiceName, CONVERT(CHAR(10), b.BookingDate, 23) AS BookingDate, b.BookingTime,
                b.Status, u.FullName AS CustomerName, b.Notes,
                CASE WHEN EXISTS (SELECT 1 FROM dbo.Medical_Records mr WHERE mr.BookingId = b.BookingId) THEN 1 ELSE 0 END AS HasMedicalRecord
         FROM dbo.Bookings b
         LEFT JOIN dbo.Pets p ON p.PetId = b.PetId
         LEFT JOIN dbo.Users u ON u.UserId = b.UserId
         WHERE ${where.join(' AND ')}
         ORDER BY b.BookingDate ASC, b.BookingTime ASC, b.BookingId ASC
         OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`,
        { ...params, offset: [T.int, offset], limit: [T.int, limit] }
      );
      return { rows: rows.map(mapVet), total: Number(countRow?.total) || 0 };
    },
    async getForVet(id, vetId, executor = db) {
      const lock = executor !== db ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
      const r = (await executor.query(
        `SELECT b.BookingId, b.BookingCode, b.ProviderId, b.PetId, b.PetName, p.Species AS PetSpecies,
                b.ServiceName, CONVERT(CHAR(10), b.BookingDate, 23) AS BookingDate, b.BookingTime,
                b.Status, u.FullName AS CustomerName, b.Notes, pr.Name AS ProviderName,
                CASE WHEN EXISTS (SELECT 1 FROM dbo.Medical_Records mr WHERE mr.BookingId = b.BookingId) THEN 1 ELSE 0 END AS HasMedicalRecord
         FROM dbo.Bookings b ${lock}
         LEFT JOIN dbo.Pets p ON p.PetId = b.PetId
         LEFT JOIN dbo.Users u ON u.UserId = b.UserId
         LEFT JOIN dbo.Providers pr ON pr.ProviderId = b.ProviderId
         WHERE b.BookingId = @id AND b.VetId = @vetId`,
        { id: [T.guid, id], vetId: [T.guid, vetId] }
      ))[0];
      if (!r) return null;
      return { ...mapVet(r), providerId: r.ProviderId, providerName: r.ProviderName || null };
    }
  };
};
