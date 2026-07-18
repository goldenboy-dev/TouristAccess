import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockModule, loadModule } from './helpers/cjs-mock.js';

const prismaMock = {
  appSetting: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  ticket: { count: vi.fn() },
  $transaction: vi.fn(),
};

mockModule('src/utils/prisma.js', prismaMock);

const settingsService = loadModule('src/services/settings.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((ops) => Promise.all(ops));
});

describe('getOperatingSettings', () => {
  it('reports unconfigured when no rows exist', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([]);

    const settings = await settingsService.getOperatingSettings();

    expect(settings).toEqual({
      operating_hours_start: null,
      operating_hours_end: null,
      max_daily_capacity: null,
    });
  });

  it('reads configured hours and capacity from the AppSetting rows', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'operating_hours_start', value: '07:00' },
      { key: 'operating_hours_end', value: '20:00' },
      { key: 'max_daily_capacity', value: '500' },
    ]);

    const settings = await settingsService.getOperatingSettings();

    expect(settings).toEqual({
      operating_hours_start: '07:00',
      operating_hours_end: '20:00',
      max_daily_capacity: 500,
    });
  });
});

describe('isWithinOperatingHours', () => {
  const at = (h, m) => new Date(2026, 6, 17, h, m, 0);

  it('is always true when hours are unconfigured', () => {
    const settings = { operating_hours_start: null, operating_hours_end: null };
    expect(settingsService.isWithinOperatingHours(settings, at(3, 0))).toBe(true);
  });

  it('accepts the exact boundary minutes', () => {
    const settings = { operating_hours_start: '07:00', operating_hours_end: '20:00' };
    expect(settingsService.isWithinOperatingHours(settings, at(7, 0))).toBe(true);
    expect(settingsService.isWithinOperatingHours(settings, at(20, 0))).toBe(true);
  });

  it('rejects a minute just outside either boundary', () => {
    const settings = { operating_hours_start: '07:00', operating_hours_end: '20:00' };
    expect(settingsService.isWithinOperatingHours(settings, at(6, 59))).toBe(false);
    expect(settingsService.isWithinOperatingHours(settings, at(20, 1))).toBe(false);
  });
});

describe('updateOperatingSettings', () => {
  it('upserts both hour keys together', async () => {
    await settingsService.updateOperatingSettings(
      { operating_hours_start: '07:00', operating_hours_end: '20:00' },
      1,
    );

    expect(prismaMock.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'operating_hours_start' },
    }));
    expect(prismaMock.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'operating_hours_end' },
    }));
  });

  it('clears both hour keys when both are sent as null', async () => {
    await settingsService.updateOperatingSettings(
      { operating_hours_start: null, operating_hours_end: null },
      1,
    );

    expect(prismaMock.appSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ['operating_hours_start', 'operating_hours_end'] } },
    });
    expect(prismaMock.appSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects a one-sided hours update (defence-in-depth, Zod already blocks this)', async () => {
    await expect(settingsService.updateOperatingSettings(
      { operating_hours_start: '07:00' },
      1,
    )).rejects.toThrow(/juntos/);
  });

  it('rejects start >= end (defence-in-depth, Zod already blocks this)', async () => {
    await expect(settingsService.updateOperatingSettings(
      { operating_hours_start: '20:00', operating_hours_end: '07:00' },
      1,
    )).rejects.toThrow(/anterior/);
  });

  it('upserts the capacity key with a positive integer', async () => {
    await settingsService.updateOperatingSettings({ max_daily_capacity: 500 }, 1);

    expect(prismaMock.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'max_daily_capacity' },
      create: expect.objectContaining({ value: '500' }),
    }));
  });

  it('clears the capacity key when sent as null (unlimited)', async () => {
    await settingsService.updateOperatingSettings({ max_daily_capacity: null }, 1);

    expect(prismaMock.appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'max_daily_capacity' } });
  });

  it('refuses an empty update', async () => {
    await expect(settingsService.updateOperatingSettings({}, 1)).rejects.toThrow(/Nada/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('getSoldCountForDate', () => {
  it('counts only ACTIVE and USED tickets for the local day', async () => {
    prismaMock.ticket.count.mockResolvedValue(7);

    const count = await settingsService.getSoldCountForDate(new Date(2026, 6, 17));

    expect(count).toBe(7);
    expect(prismaMock.ticket.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['ACTIVE', 'USED'] } }),
    }));
  });
});
