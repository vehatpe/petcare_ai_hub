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
  const currentInstantMs = currentDate.getTime();

  let ymd = date;
  if (date instanceof Date) {
    ymd = date.toISOString().slice(0, 10);
  } else if (typeof date === 'string' && date.includes('T')) {
    ymd = date.slice(0, 10);
  }

  const [slotH, slotM] = time.split(':').map(Number);
  const [slotYear, slotMonth, slotDay] = ymd.split('-').map(Number);

  // We need to construct the slot start instant in the target timezone (e.g. UTC+7)
  // For 'Asia/Ho_Chi_Minh', UTC offset is always +07:00 (no daylight saving).
  // But to be robust across any valid timezone, we can use Intl or ISO string with known offset.
  // In Vietnam timezone, offset is +07:00.
  let slotUtcMs;
  if (tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon') {
    slotUtcMs = Date.UTC(slotYear, slotMonth - 1, slotDay, slotH - 7, slotM, 0, 0);
  } else {
    // General fallback: approximate or parse via local date formatting
    const assumedUtc = Date.UTC(slotYear, slotMonth - 1, slotDay, slotH, slotM, 0, 0);
    const tzParts = nowInTz(new Date(assumedUtc), tz);
    // Find offset
    const currentInTz = nowInTz(currentDate, tz);
    const [curY, curM, curD] = currentInTz.date.split('-').map(Number);
    const [curH, curMin] = currentInTz.time.split(':').map(Number);
    const diffDays = Math.round((Date.UTC(slotYear, slotMonth - 1, slotDay) - Date.UTC(curY, curM, curD)) / 86400000);
    const diffMinutes = diffDays * 1440 + (slotH - curH) * 60 + (slotM - curMin);
    return diffMinutes;
  }

  return Math.floor((slotUtcMs - currentInstantMs) / (60 * 1000));
}

module.exports = {
  TRANSITIONS,
  TERMINAL,
  TERMINAL_STATUSES,
  canTransition,
  assertTransition,
  minutesUntil
};
