'use strict';

const { AppError } = require('./errors');
const { nowInTz } = require('./time');

// Allowed status transitions (Quy tắc 7: pending -> confirmed | cancelled, confirmed -> cancelled | completed | no_show)
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: []
};

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'no_show']);
const TERMINAL = Object.freeze(['completed', 'cancelled', 'no_show']);

function canTransition(from, to) {
  if (!from || !to) return false;
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'invalid_transition', `Không thể chuyển trạng thái lịch hẹn từ '${from}' sang '${to}'.`);
  }
}

/**
 * Calculates minutes remaining from current time (clock) to the booking slot start time.
 * If clock is past slot start, returns a negative number or 0.
 *
 * @param {string|Date} date YYYY-MM-DD (or Date object representing booking date)
 * @param {string} time 'HH:mm'
 * @param {Function|Date|number} clock Date/timestamp or () => Date
 * @param {string} tz Timezone string, e.g. 'Asia/Ho_Chi_Minh'
 * @returns {number} difference in integer minutes (positive = future, negative = past)
 */
function minutesUntil(date, time, clock = () => new Date(), tz = 'Asia/Ho_Chi_Minh') {
  const currentDate = typeof clock === 'function' ? clock() : new Date(clock);

  let ymd = date;
  if (date instanceof Date) {
    ymd = date.toISOString().slice(0, 10);
  } else if (typeof date === 'string' && date.includes('T')) {
    ymd = date.slice(0, 10);
  }

  const [slotH, slotM] = time.split(':').map(Number);
  const [slotYear, slotMonth, slotDay] = ymd.split('-').map(Number);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(currentDate).map((p) => [p.type, p.value]));
  const curY = Number(parts.year);
  const curM = Number(parts.month);
  const curD = Number(parts.day);
  const curH = Number(parts.hour === '24' ? 0 : parts.hour);
  const curMin = Number(parts.minute);
  const diffDays = Math.round((Date.UTC(slotYear, slotMonth - 1, slotDay) - Date.UTC(curY, curM - 1, curD)) / 86400000);
  return diffDays * 1440 + (slotH - curH) * 60 + (slotM - curMin);
}

module.exports = {
  TRANSITIONS,
  TERMINAL,
  TERMINAL_STATUSES,
  canTransition,
  assertTransition,
  minutesUntil
};
