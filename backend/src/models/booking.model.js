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

module.exports = (db) => {
  const getByOwner = async (id, ownerId) =>
    mapCustomer((await db.query(`${SELECT} WHERE b.BookingId = @id AND b.UserId = @owner`, { id: [T.guid, id], owner: [T.guid, ownerId] }))[0]);

  return {
    async listByOwner(ownerId) {
      return (await db.query(`${SELECT} WHERE b.UserId = @owner ORDER BY b.BookingDate, b.BookingTime, b.CreatedAt`, { owner: [T.guid, ownerId] })).map(mapCustomer);
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
    async cancel(id, ownerId, cancelledAt, cancelReason = null) {
      // Keep legacy method for compatibility if called directly
      const r = await db.exec(
        `UPDATE dbo.Bookings
         SET Status = 'cancelled', CancelledBy = 'customer', CancelledAt = @cat, CancelReason = @reason, UpdatedAt = SYSUTCDATETIME()
         WHERE BookingId = @id AND UserId = @owner AND Status IN ('pending','confirmed')`,
        {
          id: [T.guid, id],
          owner: [T.guid, ownerId],
          cat: [T.dateTime2, cancelledAt ? new Date(cancelledAt) : new Date()],
          reason: [T.str(300), cancelReason]
        });
      return r.rowsAffected[0] > 0 ? getByOwner(id, ownerId) : null;
    }
  };
};
