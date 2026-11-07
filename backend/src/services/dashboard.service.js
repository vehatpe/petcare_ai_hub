'use strict';
const { nowInTz } = require('../utils/time');
const { evaluateVaccinations } = require('../utils/health');

function createDashboardService({ models, config, clock = () => new Date() }) {
  return {
    async customer(ownerId) {
      const now = nowInTz(clock(), config.timezone);
      const [pets, bookings, vaccRows] = await Promise.all([
        models.pets.listByOwner(ownerId),
        models.bookings.listByOwner(ownerId),
        models.health.listVaccinationsForOwner(ownerId)
      ]);
      const upcoming = bookings
        .filter((b) => (b.status === 'pending' || b.status === 'confirmed') && (b.date + ' ' + b.time) >= (now.date + ' ' + now.time))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

      // Evaluate per pet (the latest-dose rule applies within one pet's record).
      let dueSoonCount = 0; let overdueCount = 0; let nextDue = null;
      const petName = new Map(pets.map((p) => [p.id, p.name]));
      const byPet = new Map();
      for (const r of vaccRows) { if (!byPet.has(r.petId)) byPet.set(r.petId, []); byPet.get(r.petId).push(r); }
      for (const [petId, rows] of byPet) {
        const { summary } = evaluateVaccinations(rows, now.date);
        dueSoonCount += summary.dueSoon;
        overdueCount += summary.overdue;
        if (summary.nextDue && (!nextDue || summary.nextDue.dueOn < nextDue.dueOn)) {
          nextDue = { petId, petName: petName.get(petId) || '', vaccineName: summary.nextDue.vaccineName, dueOn: summary.nextDue.dueOn };
        }
      }
      return {
        petCount: pets.length,
        bookings: { total: bookings.length, upcomingCount: upcoming.length, next: upcoming[0] || null },
        vaccines: { dueSoonCount, overdueCount, nextDue }
      };
    }
  };
}

module.exports = { createDashboardService };
