import { api } from '../api.js';
import { escapeHtml, skeletonRows } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

// Mirrors backend/src/utils/audit.js: AUDIT_EVENTS — kept in sync manually,
// same tradeoff as the enum duplication the rest of the frontend already has
// (payment methods, visitor types) since the frontend can't import CJS.
const AUDIT_EVENT_LABELS = {
  'ticket.created': 'Ticket creado',
  'ticket.validated': 'Ticket validado',
  'ticket.validation_rejected': 'Validación rechazada',
  'ticket.cancelled': 'Ticket anulado',
  'ticket.printed_thermal': 'Impresión térmica',
  'ticket.qr_regenerated': 'QR regenerado',
  'auth.login.success': 'Login exitoso',
  'auth.login.failed': 'Login fallido',
  'auth.login.locked': 'Cuenta bloqueada',
  'auth.logout': 'Logout',
  'auth.register': 'Usuario registrado',
  'auth.password_changed': 'Contraseña cambiada',
  'auth.sessions_revoked.self': 'Sesiones revocadas (self)',
  'auth.sessions_revoked.admin': 'Sesiones revocadas (admin)',
  'user.name_updated': 'Nombre de usuario editado',
  'user.role_updated': 'Rol de usuario editado',
  'user.active_changed': 'Estado de usuario cambiado',
  'pricing.updated': 'Precio actualizado',
  'settings.updated': 'Configuración actualizada',
  'fraud_alert.status_updated': 'Estado de alerta actualizado',
};

let eventOptionsLoaded = false;
let currentPage = 1;
let lastTotal = 0;
const PAGE_LIMIT = 50;

function ensureEventOptions() {
  if (eventOptionsLoaded) return;
  const select = document.getElementById('audit-filter-event');
  select.innerHTML = '<option value="">Todos los eventos</option>' +
    Object.entries(AUDIT_EVENT_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  eventOptionsLoaded = true;
}

function buildQuery(page) {
  const params = new URLSearchParams();
  const event = document.getElementById('audit-filter-event').value;
  const outcome = document.getElementById('audit-filter-outcome').value;
  const resource_type = document.getElementById('audit-filter-resource').value;
  const date_from = document.getElementById('audit-filter-from').value;
  const date_to = document.getElementById('audit-filter-to').value;
  if (event) params.set('event', event);
  if (outcome) params.set('outcome', outcome);
  if (resource_type) params.set('resource_type', resource_type);
  if (date_from) params.set('date_from', date_from);
  if (date_to) params.set('date_to', date_to);
  params.set('page', page);
  params.set('limit', PAGE_LIMIT);
  return params.toString();
}

function renderRow(e) {
  const actorLabel = e.actor?.email || e.actor_email || '—';
  const metadataStr = e.metadata ? JSON.stringify(e.metadata) : '';
  return `<tr>
    <td>${new Date(e.created_at).toLocaleString('es-ES')}</td>
    <td>${escapeHtml(AUDIT_EVENT_LABELS[e.event] || e.event)}</td>
    <td>${escapeHtml(actorLabel)}</td>
    <td>${escapeHtml(e.actor_role || '—')}</td>
    <td><span class="badge ${e.outcome === 'FAILURE' ? 'badge-inactive' : 'badge-active'}">${e.outcome === 'FAILURE' ? 'Falla' : 'Éxito'}</span></td>
    <td>${escapeHtml(e.resource_type || '—')}${e.resource_id ? ` #${escapeHtml(String(e.resource_id))}` : ''}</td>
    <td>${escapeHtml(e.ip_address || '—')}</td>
    <td>${metadataStr ? `<span title="${escapeHtml(metadataStr)}">ℹ️</span>` : '—'}</td>
  </tr>`;
}

export async function loadAuditLog(page = currentPage) {
  ensureEventOptions();
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = skeletonRows(8);

  try {
    const qs = buildQuery(page);
    const data = await api(`/dashboard/audit-log?${qs}`);
    currentPage = data.page;
    lastTotal = data.total;

    if (!data.entries || !data.entries.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Sin eventos para este filtro</td></tr>';
    } else {
      tbody.innerHTML = data.entries.map(renderRow).join('');
    }

    const totalPages = Math.max(1, Math.ceil(lastTotal / PAGE_LIMIT));
    document.getElementById('audit-page-info').textContent =
      `Página ${currentPage} de ${totalPages} · ${lastTotal} evento(s)`;
    document.getElementById('audit-prev-page').disabled = currentPage <= 1;
    document.getElementById('audit-next-page').disabled = currentPage >= totalPages;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${err.message}</td></tr>`;
    showToast(err.message, 'error');
  }
}

export function goToPrevAuditPage() {
  if (currentPage > 1) loadAuditLog(currentPage - 1);
}

export function goToNextAuditPage() {
  const totalPages = Math.max(1, Math.ceil(lastTotal / PAGE_LIMIT));
  if (currentPage < totalPages) loadAuditLog(currentPage + 1);
}

export function clearAuditFilters() {
  document.getElementById('audit-filter-event').value = '';
  document.getElementById('audit-filter-outcome').value = '';
  document.getElementById('audit-filter-resource').value = '';
  document.getElementById('audit-filter-from').value = '';
  document.getElementById('audit-filter-to').value = '';
  loadAuditLog(1);
}
