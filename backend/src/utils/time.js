'use strict';
// All "today"/"now" logic goes through here so it follows APP_TIMEZONE, not the server zone.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function nowInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

const todayInTz = (date, timeZone) => nowInTz(date, timeZone).date;

function isValidYmd(s) {
  if (typeof s !== 'string') return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function addDays(ymd, n) {
  const m = YMD_RE.exec(ymd);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return d.toISOString().slice(0, 10);
}

/** Whole months between a birth date and today (both YYYY-MM-DD). */
function monthsBetween(birthYmd, todayYmd) {
  const b = YMD_RE.exec(birthYmd);
  const t = YMD_RE.exec(todayYmd);
  let months = (+t[1] - +b[1]) * 12 + (+t[2] - +b[2]);
  if (+t[3] < +b[3]) months -= 1;
  return Math.max(0, months);
}

function ageLabel(birthYmd, todayYmd) {
  const months = monthsBetween(birthYmd, todayYmd);
  if (months < 1) return 'dưới 1 tháng';
  if (months < 24) return `${months} tháng`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years} tuổi ${rest} tháng` : `${years} tuổi`;
}

module.exports = { nowInTz, todayInTz, isValidYmd, addDays, monthsBetween, ageLabel };
