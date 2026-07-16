/**
 * Calendar-date handling.
 *
 * A visit date is a calendar day at the gate ("16 de julio"), not an instant.
 * The trap: `new Date('2026-07-16')` is parsed as UTC midnight, so in Paraguay
 * (UTC-3/-4) it lands on the 15th at 21:00 local. Anything that then calls
 * setHours(0,0,0,0) — the guard's "is this ticket for today?" check, every date
 * filter — reads the day BEFORE the one the cashier typed.
 *
 * Everything that turns a YYYY-MM-DD string into a Date must go through here.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse 'YYYY-MM-DD' as midnight in the server's local timezone.
 * Returns null for anything that is not a real calendar date (this also
 * rejects rollovers such as 2026-02-31, which the Date constructor accepts).
 */
function parseLocalDate(dateStr) {
  if (!DATE_RE.test(String(dateStr ?? ''))) return null;

  const [y, m, d] = String(dateStr).split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);

  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Local midnight of a 'YYYY-MM-DD' string or a Date. Null if unparseable. */
function startOfLocalDay(input) {
  if (input instanceof Date) {
    const d = new Date(input);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return parseLocalDate(input);
}

/** Last millisecond of the local day. Null if unparseable. */
function endOfLocalDay(input) {
  const start = startOfLocalDay(input);
  if (!start) return null;
  start.setHours(23, 59, 59, 999);
  return start;
}

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** 'YYYY-MM-DD' for a Date, in local time (never toISOString, which is UTC). */
function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Whole local days between two dates, ignoring the time of day. */
function localDaysBetween(a, b) {
  const start = startOfLocalDay(a);
  const end = startOfLocalDay(b);
  if (!start || !end) return NaN;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/** true when the two dates fall on the same local calendar day. */
function isSameLocalDay(a, b) {
  const x = startOfLocalDay(a);
  const y = startOfLocalDay(b);
  return Boolean(x && y && x.getTime() === y.getTime());
}

/** The local day a filter refers to; defaults to today when no date is given. */
function resolveLocalDay(dateStr) {
  const dayStart = dateStr ? parseLocalDate(dateStr) : startOfToday();
  if (!dayStart) return null;
  return { dayStart, dayEnd: endOfLocalDay(dayStart) };
}

module.exports = {
  DATE_RE,
  parseLocalDate,
  startOfLocalDay,
  endOfLocalDay,
  startOfToday,
  toLocalDateStr,
  localDaysBetween,
  isSameLocalDay,
  resolveLocalDay,
};
