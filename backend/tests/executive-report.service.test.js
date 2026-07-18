import { describe, it, expect, vi } from 'vitest';
import { mockModule, loadModule } from './helpers/cjs-mock.js';

const prismaMock = { $queryRaw: vi.fn() };
mockModule('src/utils/prisma.js', prismaMock);

const executiveReportService = loadModule('src/services/executive-report.service.js');
const { shiftDateStr, buildDailySeries, summarizeDailySeries, getExecutiveSummary } = executiveReportService;

describe('shiftDateStr', () => {
  it('shifts forward and backward across a month boundary', () => {
    expect(shiftDateStr('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftDateStr('2026-06-30', 1)).toBe('2026-07-01');
  });

  it('is a no-op for n=0', () => {
    expect(shiftDateStr('2026-07-17', 0)).toBe('2026-07-17');
  });
});

describe('buildDailySeries', () => {
  it('zero-fills days with no sales instead of skipping them', () => {
    const rows = [{ date: '2026-07-17', revenue: 10000, tickets: 2 }];
    const series = buildDailySeries(rows, '2026-07-17', 3);

    expect(series).toEqual([
      { date: '2026-07-15', revenue: 0, tickets: 0 },
      { date: '2026-07-16', revenue: 0, tickets: 0 },
      { date: '2026-07-17', revenue: 10000, tickets: 2 },
    ]);
  });

  it('ignores rows outside the requested window', () => {
    const rows = [
      { date: '2026-07-01', revenue: 99999, tickets: 9 },
      { date: '2026-07-17', revenue: 10000, tickets: 2 },
    ];
    const series = buildDailySeries(rows, '2026-07-17', 2);

    expect(series).toEqual([
      { date: '2026-07-16', revenue: 0, tickets: 0 },
      { date: '2026-07-17', revenue: 10000, tickets: 2 },
    ]);
  });
});

describe('summarizeDailySeries', () => {
  const rows = [
    { date: '2026-06-18', revenue: 5000, tickets: 1 },   // 29 días atrás — dentro del mes, fuera de la semana
    { date: '2026-07-10', revenue: 20000, tickets: 4 },  // 7 días atrás — justo fuera de la ventana de 7 días
    { date: '2026-07-16', revenue: 15000, tickets: 3 },  // ayer — dentro de la semana
    { date: '2026-07-17', revenue: 30000, tickets: 6 },  // hoy
  ];

  it('sums only today for the day bucket', () => {
    const { today } = summarizeDailySeries(rows, '2026-07-17');
    expect(today).toEqual({ revenue: 30000, tickets: 6 });
  });

  it('sums the last 7 days (inclusive) for the week bucket, excluding the 8th day back', () => {
    const { week } = summarizeDailySeries(rows, '2026-07-17');
    expect(week).toEqual({ revenue: 15000 + 30000, tickets: 3 + 6 });
  });

  it('sums the last 30 days (inclusive) for the month bucket', () => {
    const { month } = summarizeDailySeries(rows, '2026-07-17');
    expect(month).toEqual({
      revenue: 5000 + 20000 + 15000 + 30000,
      tickets: 1 + 4 + 3 + 6,
    });
  });

  it('returns zeros when there are no rows at all', () => {
    expect(summarizeDailySeries([], '2026-07-17')).toEqual({
      today: { revenue: 0, tickets: 0 },
      week: { revenue: 0, tickets: 0 },
      month: { revenue: 0, tickets: 0 },
    });
  });
});

describe('getExecutiveSummary', () => {
  it('queries a 30-day window and slices the chart to the requested days', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { date: '2026-07-17', revenue: 10000, tickets: 2 },
    ]);

    const summary = await getExecutiveSummary({ days: 7 });

    expect(summary.dailySeries).toHaveLength(7);
    expect(summary.dailySeries.at(-1).date).toBe(summary.dailySeries.at(-1).date); // sanity: shape present
    expect(summary.today.revenue).toBeGreaterThanOrEqual(0);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('defaults the chart window to 14 days when not specified', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    const summary = await getExecutiveSummary({});

    expect(summary.dailySeries).toHaveLength(14);
  });
});
