import { describe, it, expect } from 'vitest';
import { mockModule, loadModule } from './helpers/cjs-mock.js';

// The metric builders are pure, but importing the module pulls in the Prisma
// client. Stub it so the unit tests never open a connection.
mockModule('src/utils/prisma.js', {});

const {
  computeGlobalHistAvg,
  classifyRisk,
  buildCashierMetrics,
  indexTodayStats,
  deriveAlerts,
  resolveDay,
  toLocalDateStr,
  ADULT_PRICE,
} = loadModule('src/services/fraud.service.js');

const cashier = { id: 7, name: 'Ana', email: 'ana@yaguaron.py' };

// Shorthand for "a cashier that sold this mix today".
function statsFor({ adults = 0, children = 0, locals = 0, declared = null } = {}) {
  return {
    total_adults: adults,
    total_children: children,
    total_locals: locals,
    total_persons: adults + children + locals,
    ingresos_declarados: declared === null ? adults * ADULT_PRICE : declared,
  };
}

const noOps = { total_operaciones: 0, operaciones_sospechosas: 0 };

describe('ADULT_PRICE', () => {
  it('comes from the environment', () => {
    expect(ADULT_PRICE).toBe(10000);
  });
});

describe('indexTodayStats', () => {
  it('folds groupBy rows into per-cashier totals', () => {
    const rows = [
      { createdById: 1, visitor_type: 'ADULT', _count: { _all: 3 }, _sum: { price: 30000 } },
      { createdById: 1, visitor_type: 'CHILD', _count: { _all: 2 }, _sum: { price: 0 } },
      { createdById: 2, visitor_type: 'LOCAL', _count: { _all: 5 }, _sum: { price: 0 } },
    ];

    const byCashier = indexTodayStats(rows);

    expect(byCashier.get(1)).toEqual({
      total_adults: 3, total_children: 2, total_locals: 0,
      total_persons: 5, ingresos_declarados: 30000,
    });
    expect(byCashier.get(2)).toEqual({
      total_adults: 0, total_children: 0, total_locals: 5,
      total_persons: 5, ingresos_declarados: 0,
    });
  });

  it('treats a null price sum as zero', () => {
    const byCashier = indexTodayStats([
      { createdById: 1, visitor_type: 'CHILD', _count: { _all: 1 }, _sum: { price: null } },
    ]);
    expect(byCashier.get(1).ingresos_declarados).toBe(0);
  });
});

describe('computeGlobalHistAvg', () => {
  it('weights each cashier average by its number of days', () => {
    // Same as averaging the 4 daily percentages: (10+10+10+50)/4 = 20.
    const rows = [
      { cashier_id: 1, avg_pct: 10, days: 3 },
      { cashier_id: 2, avg_pct: 50, days: 1 },
    ];
    expect(computeGlobalHistAvg(rows)).toBe(20);
  });

  it('falls back to the default reference when there is no history', () => {
    expect(computeGlobalHistAvg([])).toBe(15);
  });
});

describe('classifyRisk', () => {
  it('is CRITICO whenever money is missing, regardless of the ratio', () => {
    expect(classifyRisk({ brecha_ingresos: 10000, diferencia_pp: 0 })).toBe('CRITICO');
  });

  it('is CRITICO at or above the critical threshold', () => {
    expect(classifyRisk({ brecha_ingresos: 0, diferencia_pp: 20 })).toBe('CRITICO');
  });

  it('is AVISO between the warning and critical thresholds', () => {
    expect(classifyRisk({ brecha_ingresos: 0, diferencia_pp: 10 })).toBe('AVISO');
    expect(classifyRisk({ brecha_ingresos: 0, diferencia_pp: 19.9 })).toBe('AVISO');
  });

  it('is NORMAL below the warning threshold, including cashiers under their own history', () => {
    expect(classifyRisk({ brecha_ingresos: 0, diferencia_pp: 9.9 })).toBe('NORMAL');
    expect(classifyRisk({ brecha_ingresos: 0, diferencia_pp: -30 })).toBe('NORMAL');
  });
});

describe('buildCashierMetrics', () => {
  it('reports no gap when every adult was charged', () => {
    const m = buildCashierMetrics({
      cashier,
      todayStats: statsFor({ adults: 10, children: 2 }),
      ops: noOps,
      historico_pct_gratuitos: 15,
    });

    expect(m.ingresos_esperados).toBe(100000);
    expect(m.ingresos_declarados).toBe(100000);
    expect(m.brecha_ingresos).toBe(0);
    expect(m.nivel_riesgo).toBe('NORMAL');
  });

  // The core fraud signal: adults registered but not charged.
  it('flags CRITICO when declared income is short of expected', () => {
    const m = buildCashierMetrics({
      cashier,
      todayStats: statsFor({ adults: 10, declared: 60000 }),
      ops: noOps,
      historico_pct_gratuitos: 15,
    });

    expect(m.brecha_ingresos).toBe(40000);
    expect(m.nivel_riesgo).toBe('CRITICO');
  });

  it('clamps a negative gap to zero instead of reporting negative fraud', () => {
    const m = buildCashierMetrics({
      cashier,
      todayStats: statsFor({ adults: 1, declared: 50000 }),
      ops: noOps,
      historico_pct_gratuitos: 15,
    });

    expect(m.brecha_ingresos).toBe(0);
    expect(m.nivel_riesgo).toBe('NORMAL');
  });

  it('computes the free-entry percentage and its distance from history', () => {
    const m = buildCashierMetrics({
      cashier,
      todayStats: statsFor({ adults: 5, children: 3, locals: 2 }),
      ops: noOps,
      historico_pct_gratuitos: 15,
    });

    expect(m.total_gratuitos).toBe(5);
    expect(m.pct_gratuitos_hoy).toBe(50);
    expect(m.diferencia_pp).toBe(35);
    expect(m.nivel_riesgo).toBe('CRITICO'); // 35pp over history
  });

  it('does not divide by zero when the cashier sold nothing', () => {
    const m = buildCashierMetrics({
      cashier, todayStats: statsFor({}), ops: noOps, historico_pct_gratuitos: 15,
    });
    expect(m.pct_gratuitos_hoy).toBe(0);
  });

  it('falls back to the email prefix when the cashier has no name', () => {
    const m = buildCashierMetrics({
      cashier: { id: 9, name: '', email: 'lucia@yaguaron.py' },
      todayStats: statsFor({ adults: 1 }),
      ops: noOps,
      historico_pct_gratuitos: 15,
    });
    expect(m.cajero_nombre).toBe('lucia');
  });
});

describe('deriveAlerts', () => {
  const base = {
    cajero_id: 7, cajero_nombre: 'Ana',
    ingresos_esperados: 100000, ingresos_declarados: 100000, brecha_ingresos: 0,
    pct_gratuitos_hoy: 10, historico_pct_gratuitos: 10, diferencia_pp: 0,
    operaciones_sospechosas: 0,
  };
  const fraudData = (overrides) => ({ date: '2026-07-16', cajeros: [{ ...base, ...overrides }] });

  it('raises nothing for a normal day', () => {
    const { alerts, total_criticas, total_avisos } = deriveAlerts(fraudData({}), null);
    expect(alerts).toHaveLength(0);
    expect(total_criticas).toBe(0);
    expect(total_avisos).toBe(0);
  });

  it('raises a critical alert for an income gap', () => {
    const { alerts, total_criticas } = deriveAlerts(fraudData({ brecha_ingresos: 40000 }), null);
    expect(alerts[0].tipo).toBe('BRECHA_INGRESOS');
    expect(alerts[0].nivel).toBe('CRITICO');
    expect(total_criticas).toBe(1);
  });

  it('raises the critical ratio alert but not the warning one', () => {
    const { alerts } = deriveAlerts(fraudData({ diferencia_pp: 25 }), null);
    expect(alerts.map(a => a.tipo)).toEqual(['RATIO_GRATUITOS_CRITICO']);
  });

  it('raises the warning ratio alert between thresholds', () => {
    const { alerts, total_avisos } = deriveAlerts(fraudData({ diferencia_pp: 12 }), null);
    expect(alerts.map(a => a.tipo)).toEqual(['RATIO_GRATUITOS_ELEVADO']);
    expect(total_avisos).toBe(1);
  });

  it('needs three suspicious operations before warning', () => {
    expect(deriveAlerts(fraudData({ operaciones_sospechosas: 2 }), null).alerts).toHaveLength(0);
    expect(deriveAlerts(fraudData({ operaciones_sospechosas: 3 }), null).alerts[0].tipo)
      .toBe('OPERACIONES_SOSPECHOSAS');
  });

  it('stacks every alert a single cashier triggers', () => {
    const { alerts } = deriveAlerts(fraudData({
      brecha_ingresos: 40000, diferencia_pp: 30, operaciones_sospechosas: 4,
    }), null);
    expect(alerts.map(a => a.tipo).sort()).toEqual([
      'BRECHA_INGRESOS', 'OPERACIONES_SOSPECHOSAS', 'RATIO_GRATUITOS_CRITICO',
    ]);
  });

  it('filters by level and recounts the totals', () => {
    const data = fraudData({ brecha_ingresos: 40000, operaciones_sospechosas: 3 });
    const { alerts, total_criticas, total_avisos } = deriveAlerts(data, 'CRITICO');
    expect(alerts).toHaveLength(1);
    expect(total_criticas).toBe(1);
    expect(total_avisos).toBe(0);
  });
});

describe('resolveDay', () => {
  it('parses YYYY-MM-DD in local time, not UTC', () => {
    const { dayStart, dayEnd } = resolveDay('2026-04-22');
    expect(dayStart.getFullYear()).toBe(2026);
    expect(dayStart.getMonth()).toBe(3); // April
    expect(dayStart.getDate()).toBe(22);
    expect(dayStart.getHours()).toBe(0);
    expect(dayEnd.getDate()).toBe(22);
    expect(dayEnd.getHours()).toBe(23);
  });

  it('defaults to today when no date is given', () => {
    const { dayStart } = resolveDay(undefined);
    expect(toLocalDateStr(dayStart)).toBe(toLocalDateStr(new Date()));
  });
});
