const prisma = require('../utils/prisma');
const ticketService = require('../services/ticket.service');
const settingsService = require('../services/settings.service');
const cashReportService = require('../services/cash-report.service');
const executiveReportService = require('../services/executive-report.service');
const reportExportService = require('../services/report-export.service');
const { auditFromRequest, AUDIT_EVENTS } = require('../utils/audit');
const { startOfLocalDay, endOfLocalDay, startOfToday } = require('../utils/date');
const { badRequest } = require('../utils/errors');
const { PAYMENT_METHODS } = require('../constants/ticket');

// ─── DASHBOARD STATS ────────────────────────────────────────
const getStats = async (req, res, next) => {
  try {
    const { date_from, date_to } = req.query; // validated by Zod

    // A cashier only ever sees their own numbers.
    const isCashier = req.user.role === 'CASHIER';
    const baseWhere = isCashier ? { createdById: req.user.id } : {};

    const dateFilter = {};
    if (date_from) dateFilter.gte = startOfLocalDay(date_from);
    if (date_to)   dateFilter.lte = endOfLocalDay(date_to);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const periodFilter = hasDateFilter ? dateFilter : { gte: startOfToday() };
    const rangeFilter = { ...baseWhere, createdAt: periodFilter, status: { in: ['ACTIVE', 'USED'] } };

    const [
      totalTickets, activeTickets, usedTickets, cancelledTickets,
      ticketsSoldToday, usedTicketsToday,
      revenueAgg, rangeSumAgg, revenueByMethodRows, recentEntries,
    ] = await Promise.all([
      prisma.ticket.count({ where: baseWhere }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'CANCELLED' } }),
      prisma.ticket.count({ where: { ...baseWhere, createdAt: periodFilter } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'USED', updatedAt: periodFilter } }),
      prisma.ticket.aggregate({
        where: { ...baseWhere, status: { in: ['ACTIVE', 'USED'] } },
        _sum: { price: true },
      }),
      prisma.ticket.aggregate({ where: rangeFilter, _sum: { price: true } }),
      // Summed in the database: this used to fetch every ticket of the period
      // just to add up prices per payment method in JS.
      prisma.ticket.groupBy({
        by: ['payment_method'],
        where: rangeFilter,
        _sum: { price: true },
      }),
      prisma.scan.findMany({
        take: 15,
        where: isCashier ? { ticket: { createdById: req.user.id } } : {},
        orderBy: { scannedAt: 'desc' },
        include: {
          ticket: { select: { customer_name: true, visitor_type: true, payment_method: true } },
          guard: { select: { email: true } },
        },
      }),
    ]);

    const revenueByMethod = { CASH: 0, TRANSFER: 0, QR: 0, CARD: 0 };
    for (const row of revenueByMethodRows) {
      if (revenueByMethod[row.payment_method] !== undefined) {
        revenueByMethod[row.payment_method] = row._sum.price || 0;
      }
    }

    res.status(200).json({
      stats: {
        totalTickets,
        activeTickets,
        usedTickets,
        cancelledTickets,
        totalRevenue: revenueAgg._sum.price || 0,
        usedTicketsToday,
        ticketsSoldToday,
        revenueToday: rangeSumAgg._sum.price || 0,
        revenueByMethod,
      },
      recentEntries: recentEntries.map(s => ({
        customerName: s.ticket.customer_name,
        ticketType: s.ticket.visitor_type,
        paymentMethod: s.ticket.payment_method,
        guardEmail: s.guard.email,
        scannedAt: s.scannedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ─── EXECUTIVE SUMMARY (ADMIN only) ──────────────────────────
const getExecutiveSummary = async (req, res, next) => {
  try {
    const { days } = req.query; // validated by Zod
    res.status(200).json(await executiveReportService.getExecutiveSummary({ days }));
  } catch (error) {
    next(error);
  }
};

// ─── LIST USERS (ADMIN only) ────────────────────────────────
const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, email: true, name: true, role: true, active: true, createdAt: true,
        _count: { select: { createdTickets: true, scans: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ users });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE USER NAME (ADMIN only) ───────────────────────────
const updateUserName = async (req, res, next) => {
  try {
    const { name } = req.body; // validated + trimmed by Zod

    const updatedUser = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { name },
      select: { id: true, name: true, email: true },
    });

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.USER_NAME_UPDATED,
      resource_type: 'User',
      resource_id: updatedUser.id,
      metadata: { newName: updatedUser.name, targetEmail: updatedUser.email },
    });

    res.status(200).json({ message: 'Nombre actualizado correctamente', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

// ─── UPDATE USER ROLE (ADMIN only) ───────────────────────────
const updateUserRole = async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    const { role } = req.body; // validated by Zod

    if (targetId === req.user.id) {
      throw badRequest('No podés cambiar tu propio rol');
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw badRequest('Usuario no encontrado');

    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: targetId },
        data: { role },
        select: { id: true, email: true, role: true },
      }),
      // A role change alters what the session is allowed to do — same
      // criterion the password-change flow already applies.
      prisma.refreshToken.updateMany({
        where: { user_id: targetId, revoked: false },
        data: { revoked: true },
      }),
    ]);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.USER_ROLE_UPDATED,
      resource_type: 'User',
      resource_id: updatedUser.id,
      metadata: { previousRole: target.role, newRole: role, targetEmail: updatedUser.email },
    });

    res.status(200).json({ message: 'Rol actualizado correctamente', user: updatedUser });
  } catch (error) {
    next(error);
  }
};

// ─── ACTIVATE / DEACTIVATE USER (ADMIN only) ─────────────────
// Scope is deliberately narrow: only CASHIER/GUARD accounts can be toggled
// here, and never the acting admin's own account — otherwise a panel action
// could lock every admin out of the system.
const updateUserActive = async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    const { active } = req.body; // validated by Zod

    if (targetId === req.user.id) {
      throw badRequest('No podés desactivar tu propia cuenta');
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw badRequest('Usuario no encontrado');
    if (target.role === 'ADMIN') {
      throw badRequest('No se puede activar/desactivar una cuenta de administrador desde este panel');
    }

    const operations = [
      prisma.user.update({
        where: { id: targetId },
        data: { active },
        select: { id: true, email: true, active: true },
      }),
    ];
    if (active === false) {
      operations.push(prisma.refreshToken.updateMany({
        where: { user_id: targetId, revoked: false },
        data: { revoked: true },
      }));
    }

    const [updatedUser] = await prisma.$transaction(operations);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.USER_ACTIVE_CHANGED,
      resource_type: 'User',
      resource_id: updatedUser.id,
      metadata: { active, targetEmail: updatedUser.email },
    });

    res.status(200).json({
      message: active ? 'Usuario reactivado' : 'Usuario desactivado',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// ─── PRICING (ADMIN only) ────────────────────────────────────
const updatePricing = async (req, res, next) => {
  try {
    const { adult_price } = req.body; // validated by Zod

    const previous = await ticketService.getPricing();
    await ticketService.setAdultPrice(adult_price, req.user.id);

    await auditFromRequest(req, {
      event: AUDIT_EVENTS.PRICING_UPDATED,
      resource_type: 'AppSetting',
      resource_id: 'adult_price',
      metadata: { previousPrice: previous.ADULT_PRICE, newPrice: adult_price },
    });

    res.status(200).json({ message: 'Precio actualizado correctamente', pricing: await ticketService.getPricing() });
  } catch (error) {
    next(error);
  }
};

// ─── OPERATING SETTINGS: horarios + aforo (ADMIN only) ───────
const getOperatingSettings = async (_req, res, next) => {
  try {
    res.status(200).json(await settingsService.getOperatingSettings());
  } catch (error) {
    next(error);
  }
};

const updateOperatingSettings = async (req, res, next) => {
  try {
    const previous = await settingsService.getOperatingSettings();
    await settingsService.updateOperatingSettings(req.body, req.user.id); // validated by Zod

    const updated = await settingsService.getOperatingSettings();
    await auditFromRequest(req, {
      event: AUDIT_EVENTS.SETTINGS_UPDATED,
      resource_type: 'AppSetting',
      resource_id: 'operating_settings',
      metadata: { previous, updated },
    });

    res.status(200).json({ message: 'Configuración actualizada correctamente', settings: updated });
  } catch (error) {
    next(error);
  }
};

// ─── AUDIT LOG (ADMIN only) ─────────────────────────────────
// A persisted trail is only useful if it can be read back. Filterable by
// event, actor, outcome and date range; paginated.
const getAuditLog = async (req, res, next) => {
  try {
    const { event, actor_id, outcome, resource_type, date_from, date_to, page, limit } = req.query;

    const where = {};
    if (event) where.event = event;
    if (resource_type) where.resource_type = resource_type;
    if (outcome) where.outcome = outcome;
    if (actor_id) where.actor_id = actor_id;

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = startOfLocalDay(date_from);
      if (date_to)   where.created_at.lte = endOfLocalDay(date_to);
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { id: true, email: true, name: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.status(200).json({
      entries: entries.map(e => ({
        ...e,
        // Stored as a JSON string; hand the client an object.
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
};

// ─── CASH REPORT / CIERRE DE CAJA (ADMIN only) ───────────────
const getCashReport = async (req, res, next) => {
  try {
    const { date_from, date_to, cajero_id } = req.query; // validated by Zod
    const report = await cashReportService.getCashReport({ date_from, date_to, cajero_id });
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

const csvCell = (value) => `"${String(value).replace(/"/g, '""')}"`;

const exportCashReport = async (req, res, next) => {
  try {
    const { date_from, date_to, cajero_id, format } = req.query; // validated by Zod
    const report = await cashReportService.getCashReport({ date_from, date_to, cajero_id });
    const { rows, grandTotal, grandTotalTickets } = report;

    const from = date_from || 'hoy';
    const to = date_to || 'hoy';
    const filenameBase = `cierre-caja-${from}_a_${to}`;

    if (format === 'excel') {
      const buffer = await reportExportService.buildCashReportExcel({ ...report, date_from: from, date_to: to });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
      return res.status(200).send(buffer);
    }

    if (format === 'pdf') {
      const buffer = await reportExportService.buildCashReportPdf({ ...report, date_from: from, date_to: to });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
      return res.status(200).send(buffer);
    }

    const header = ['Cajero', 'Email', 'Total tickets', ...PAYMENT_METHODS, 'Total', 'Cancelados'];
    const lines = [header.map(csvCell).join(',')];

    for (const row of rows) {
      lines.push([
        row.cajeroNombre,
        row.cajeroEmail,
        row.totalTickets,
        ...PAYMENT_METHODS.map((m) => row.byMethod[m]),
        row.totalAmount,
        row.cancelledCount,
      ].map(csvCell).join(','));
    }

    lines.push(['TOTAL', '', grandTotalTickets, ...PAYMENT_METHODS.map(() => ''), grandTotal, ''].map(csvCell).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    res.status(200).send(lines.join('\n'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStats, getExecutiveSummary, getUsers, updateUserName, updateUserRole, updateUserActive,
  updatePricing, getOperatingSettings, updateOperatingSettings,
  getAuditLog, getCashReport, exportCashReport,
};
