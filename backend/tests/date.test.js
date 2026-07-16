import { describe, it, expect } from 'vitest';
import {
  parseLocalDate,
  startOfLocalDay,
  endOfLocalDay,
  toLocalDateStr,
  localDaysBetween,
  isSameLocalDay,
  resolveLocalDay,
} from '../src/utils/date.js';

// These tests encode the bug that broke the gate: `new Date('2026-07-16')` is
// UTC midnight, so anywhere west of Greenwich it reads as the 15th locally and
// a ticket sold for today was rejected as "not valid for today".
describe('parseLocalDate', () => {
  it('lands on the calendar day the cashier typed, not the UTC one', () => {
    const d = parseLocalDate('2026-07-16');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(0);
  });

  it('round-trips through toLocalDateStr', () => {
    expect(toLocalDateStr(parseLocalDate('2026-01-01'))).toBe('2026-01-01');
    expect(toLocalDateStr(parseLocalDate('2026-12-31'))).toBe('2026-12-31');
  });

  it('does not agree with the UTC parse west of Greenwich', () => {
    const local = parseLocalDate('2026-07-16');
    const utc = new Date('2026-07-16');
    const offset = new Date().getTimezoneOffset(); // >0 means behind UTC
    if (offset > 0) {
      expect(local.getTime()).not.toBe(utc.getTime());
      expect(utc.getDate()).toBe(15); // the bug, reproduced
      expect(local.getDate()).toBe(16);
    }
  });

  it('rejects a day that does not exist', () => {
    expect(parseLocalDate('2026-02-31')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('2025-02-29')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(parseLocalDate('2028-02-29')).not.toBeNull();
  });

  it('rejects anything that is not a plain calendar date', () => {
    expect(parseLocalDate('16-07-2026')).toBeNull();
    expect(parseLocalDate('2026-07-16T10:00:00Z')).toBeNull();
    expect(parseLocalDate('mañana')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
  });
});

describe('startOfLocalDay / endOfLocalDay', () => {
  it('brackets the local day from a string', () => {
    expect(startOfLocalDay('2026-07-16').getHours()).toBe(0);
    const end = endOfLocalDay('2026-07-16');
    expect(end.getDate()).toBe(16);
    expect(end.getHours()).toBe(23);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('normalizes a Date without mutating it', () => {
    const original = new Date(2026, 6, 16, 18, 30);
    const start = startOfLocalDay(original);
    expect(start.getHours()).toBe(0);
    expect(original.getHours()).toBe(18);
  });

  it('returns null for an invalid date', () => {
    expect(startOfLocalDay('nope')).toBeNull();
    expect(endOfLocalDay('nope')).toBeNull();
  });
});

describe('isSameLocalDay', () => {
  // The guard's check: a ticket stored at local midnight for today must match.
  it('matches a ticket stored for today against the current moment', () => {
    const storedForToday = startOfLocalDay(toLocalDateStr(new Date()));
    expect(isSameLocalDay(storedForToday, new Date())).toBe(true);
  });

  it('ignores the time of day', () => {
    expect(isSameLocalDay(new Date(2026, 6, 16, 0, 0), new Date(2026, 6, 16, 23, 59))).toBe(true);
  });

  it('separates adjacent days', () => {
    expect(isSameLocalDay(new Date(2026, 6, 16), new Date(2026, 6, 17))).toBe(false);
  });
});

describe('localDaysBetween', () => {
  it('counts whole calendar days regardless of the time', () => {
    expect(localDaysBetween(new Date(2026, 6, 16, 23, 0), new Date(2026, 6, 17, 1, 0))).toBe(1);
    expect(localDaysBetween(new Date(2026, 6, 16), new Date(2026, 6, 9))).toBe(-7);
    expect(localDaysBetween(new Date(2026, 6, 16), new Date(2026, 6, 16))).toBe(0);
  });
});

describe('resolveLocalDay', () => {
  it('defaults to today', () => {
    const { dayStart, dayEnd } = resolveLocalDay(undefined);
    expect(toLocalDateStr(dayStart)).toBe(toLocalDateStr(new Date()));
    expect(dayEnd.getHours()).toBe(23);
  });

  it('brackets the requested day', () => {
    const { dayStart, dayEnd } = resolveLocalDay('2026-04-22');
    expect(dayStart.getDate()).toBe(22);
    expect(dayStart.getMonth()).toBe(3);
    expect(dayEnd.getDate()).toBe(22);
  });

  it('returns null for an impossible day', () => {
    expect(resolveLocalDay('2026-02-31')).toBeNull();
  });
});
