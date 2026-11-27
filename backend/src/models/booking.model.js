'use strict';
const { T, lc, iso, isUniqueViolation } = require('./db');

const SELECT = `
  SELECT BookingId, BookingCode, UserId, PetId, ServiceId, PetName, ServiceName, ProviderLabel, PriceVnd,
         CONVERT(CHAR(10), BookingDate, 23) AS BookingDate, BookingTime, Notes, Status, CreatedAt
  FROM dbo.Bookings`;

const map = (r) => r && ({
  id: lc(r.BookingId), code: r.BookingCode, petId: lc(r.PetId) || null, petName: r.PetName, serviceId: r.ServiceId,
  serviceName: r.ServiceName, providerName: r.ProviderLabel, priceVnd: r.PriceVnd, date: r.BookingDate,
  time: r.BookingTime, notes: r.Notes, status: r.Status, createdAt: iso(r.CreatedAt)
});

const UPCOMING_EXPR = `CASE WHEN Status IN ('pending','confirmed') AND (BookingDate > CAST(@today AS DATE) OR (BookingDate = CAST(@today AS DATE) AND BookingTime >= @time)) THEN 1 ELSE 0 END`;

module.exports = (db) => {
  const getByOwner = async (id, ownerId) =>
    map((await db.query(`${SELECT} WHERE BookingId = @id AND UserId = @owner`, { id: [T.guid, id], owner: [T.guid, ownerId] }))[0]);

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
      return { rows: rows.map(map), total: Number(countRow?.total) || 0 };
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
      return map(rows[0]) || null;
    },
    getByOwner,
    async getById(id) {
      return map((await db.query(`${SELECT} WHERE BookingId = @id`, { id: [T.guid, id] }))[0]);
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
            `INSERT INTO dbo.Bookings (BookingId, BookingCode, UserId, PetId, ServiceId, PetName, ServiceName, ProviderLabel,
                                       PriceVnd, BookingDate, BookingTime, Notes, Status)
             VALUES (@id, @code, @owner, @pet, @svc, @petName, @svcName, @provider, @price, CAST(@d AS DATE), @t, @notes, 'pending')`,
            {
              ...p, id: [T.guid, b.id], code: [T.vstr(11), b.code], owner: [T.guid, b.ownerId], petName: [T.str(40), b.petName],
              svcName: [T.str(200), b.serviceName], provider: [T.str(260), b.providerName], price: [T.int, b.priceVnd],
              notes: [T.str(500), b.notes]
            });
          const row = (await tx.query(`${SELECT} WHERE BookingId = @id`, { id: [T.guid, b.id] }))[0];
          return { ok: true, booking: map(row) };
        });
      } catch (e) {
        // The filtered unique index is the last line of defence against a same-pet race.
        if (isUniqueViolation(e) && /UX_Bookings_Pet_Slot/.test(e.message)) return { ok: false, reason: 'pet_clash' };
        throw e;
      }
    },
    async cancel(id, ownerId) {
      const r = await db.exec(
        `UPDATE dbo.Bookings SET Status = 'cancelled', UpdatedAt = SYSUTCDATETIME()
         WHERE BookingId = @id AND UserId = @owner AND Status IN ('pending','confirmed')`,
        { id: [T.guid, id], owner: [T.guid, ownerId] });
      return r.rowsAffected[0] > 0 ? getByOwner(id, ownerId) : null;
    }
  };
};
