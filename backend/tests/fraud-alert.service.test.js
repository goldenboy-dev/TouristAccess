import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockModule, loadModule } from './helpers/cjs-mock.js';

const prismaMock = {
  fraudAlert: { upsert: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};
mockModule('src/utils/prisma.js', prismaMock);

const fraudAlertService = loadModule('src/services/fraud-alert.service.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistAlerts', () => {
  it('upserts one row per alert keyed by its synthetic id, without touching status', async () => {
    prismaMock.fraudAlert.upsert.mockResolvedValue({ id: 1, alert_key: 'alert-3-brecha' });

    await fraudAlertService.persistAlerts('2026-07-17', [
      { id: 'alert-3-brecha', cajero_id: 3, nivel: 'CRITICO', tipo: 'BRECHA_INGRESOS', mensaje: 'm', detalle: 'd' },
    ]);

    expect(prismaMock.fraudAlert.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.fraudAlert.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ alert_key: 'alert-3-brecha' });
    expect(call.create).toMatchObject({ alert_key: 'alert-3-brecha', cajero_id: 3, nivel: 'CRITICO' });
    expect(call.update).not.toHaveProperty('status');
    expect(call.update).not.toHaveProperty('reviewed_by_id');
  });

  it('does nothing for an empty alert list', async () => {
    const rows = await fraudAlertService.persistAlerts('2026-07-17', []);
    expect(rows).toEqual([]);
    expect(prismaMock.fraudAlert.upsert).not.toHaveBeenCalled();
  });
});

describe('listAlertHistory', () => {
  it('builds an empty where clause when no filters are given', async () => {
    prismaMock.fraudAlert.findMany.mockResolvedValue([]);
    prismaMock.fraudAlert.count.mockResolvedValue(0);

    await fraudAlertService.listAlertHistory({ page: 1, limit: 50 });

    expect(prismaMock.fraudAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filters by status, nivel and cajero_id', async () => {
    prismaMock.fraudAlert.findMany.mockResolvedValue([]);
    prismaMock.fraudAlert.count.mockResolvedValue(0);

    await fraudAlertService.listAlertHistory({ status: 'PENDIENTE', nivel: 'CRITICO', cajero_id: 5, page: 1, limit: 50 });

    expect(prismaMock.fraudAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDIENTE', nivel: 'CRITICO', cajero_id: 5 },
    }));
  });

  it('shapes rows into the API response, falling back to email for the cajero name', async () => {
    prismaMock.fraudAlert.findMany.mockResolvedValue([{
      id: 1, alert_key: 'alert-3-brecha', date: new Date('2026-07-17'), cajero_id: 3,
      cajero: { name: '', email: 'cajero3@tourist.com' },
      nivel: 'CRITICO', tipo: 'BRECHA_INGRESOS', mensaje: 'm', detalle: 'd',
      status: 'PENDIENTE', reviewedBy: null, reviewed_at: null, review_note: null,
    }]);
    prismaMock.fraudAlert.count.mockResolvedValue(1);

    const { entries, total } = await fraudAlertService.listAlertHistory({ page: 1, limit: 50 });

    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({ id: 1, cajero_nombre: 'cajero3', status: 'PENDIENTE', reviewed_by: null });
  });
});

describe('updateAlertStatus', () => {
  it('rejects an unknown status', async () => {
    await expect(fraudAlertService.updateAlertStatus({ id: 1, status: 'BOGUS', reviewedById: 1 }))
      .rejects.toThrow(/status debe ser/);
    expect(prismaMock.fraudAlert.findUnique).not.toHaveBeenCalled();
  });

  it('throws not found for a missing alert', async () => {
    prismaMock.fraudAlert.findUnique.mockResolvedValue(null);
    await expect(fraudAlertService.updateAlertStatus({ id: 999, status: 'REVISADA', reviewedById: 1 }))
      .rejects.toThrow(/no encontrada/i);
  });

  it('updates status, reviewer and timestamp, keeping the previous note when none is given', async () => {
    prismaMock.fraudAlert.findUnique.mockResolvedValue({ id: 1, status: 'PENDIENTE', review_note: 'nota vieja', alert_key: 'alert-3-brecha' });
    prismaMock.fraudAlert.update.mockResolvedValue({
      id: 1, alert_key: 'alert-3-brecha', date: new Date(), cajero_id: 3, cajero: null,
      nivel: 'CRITICO', tipo: 'BRECHA_INGRESOS', mensaje: 'm', detalle: 'd',
      status: 'DESESTIMADA', reviewedBy: { name: 'Admin', email: 'admin@tourist.com' },
      reviewed_at: new Date(), review_note: 'nota vieja',
    });

    const { updated } = await fraudAlertService.updateAlertStatus({ id: 1, status: 'DESESTIMADA', reviewedById: 9 });

    expect(prismaMock.fraudAlert.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'DESESTIMADA', review_note: 'nota vieja', reviewed_by_id: 9 }),
    }));
    expect(updated.status).toBe('DESESTIMADA');
    expect(updated.reviewed_by).toBe('Admin');
  });
});
