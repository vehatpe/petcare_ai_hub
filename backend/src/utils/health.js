'use strict';
const { addDays } = require('./time');

const vaccineKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

function statusFor(nextDueOn, today) {
  if (!nextDueOn) return 'recorded';
  if (nextDueOn < today) return 'overdue';
  if (nextDueOn <= addDays(today, 30)) return 'due-soon';
  return 'ok';
}

/**
 * rows: [{id, vaccineName, administeredOn, nextDueOn, providerName, batchNo, source, createdAt}]
 * Only the latest dose per vaccine is evaluated; older doses are history ('recorded').
 */
function evaluateVaccinations(rows, today) {
  const latest = new Map();
  for (const r of rows) {
    const k = vaccineKey(r.vaccineName);
    const cur = latest.get(k);
    if (!cur || r.administeredOn > cur.administeredOn ||
        (r.administeredOn === cur.administeredOn && String(r.createdAt) > String(cur.createdAt))) {
      latest.set(k, r);
    }
  }
  const latestIds = new Set([...latest.values()].map((r) => r.id));
  const list = rows
    .map((r) => ({
      id: r.id, vaccineName: r.vaccineName, administeredOn: r.administeredOn, nextDueOn: r.nextDueOn || null,
      providerName: r.providerName || '', batchNo: r.batchNo || '', source: r.source,
      status: latestIds.has(r.id) ? statusFor(r.nextDueOn, today) : 'recorded'
    }))
    .sort((a, b) => b.administeredOn.localeCompare(a.administeredOn));

  const current = list.filter((v) => latestIds.has(v.id));
  const withDue = current.filter((v) => v.nextDueOn).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn));
  const summary = {
    total: current.length,
    upToDate: current.filter((v) => v.status === 'ok').length,
    dueSoon: current.filter((v) => v.status === 'due-soon').length,
    overdue: current.filter((v) => v.status === 'overdue').length,
    nextDue: withDue.length ? { vaccineName: withDue[0].vaccineName, dueOn: withDue[0].nextDueOn } : null
  };
  return { list, summary, current };
}

module.exports = { evaluateVaccinations, statusFor, vaccineKey };
