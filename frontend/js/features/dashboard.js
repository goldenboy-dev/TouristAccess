import { api } from '../api.js';
import { store } from '../store.js';
import { getPaymentIcon, escapeHtml, getVisitorTypeName } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';
import { initFraudPanel, stopFraudRefresh } from './fraud-dashboard.js';
import { loadExecutiveSummary } from './executive-dashboard.js';

export async function loadDashboard() {
  const from = document.getElementById('dash-date-from').value;
  const to   = document.getElementById('dash-date-to').value;
  let qs = '';
  if (from) qs += `date_from=${from}&`;
  if (to)   qs += `date_to=${to}&`;

  try {
    const data = await api(`/dashboard/stats${qs ? '?' + qs : ''}`);
    const s = data.stats;
    document.getElementById('stat-total').textContent        = s.totalTickets;
    document.getElementById('stat-active').textContent       = s.activeTickets;
    document.getElementById('stat-used-today').textContent   = s.usedTicketsToday;
    document.getElementById('stat-revenue').textContent      = `₲${s.totalRevenue.toLocaleString()}`;
    document.getElementById('stat-sold-today').textContent   = s.ticketsSoldToday;
    document.getElementById('stat-revenue-today').textContent= `₲${s.revenueToday.toLocaleString()}`;

    // Payment method breakdown
    const pm = s.revenueByMethod || {};
    document.getElementById('pm-cash').textContent     = `₲${(pm.CASH     || 0).toLocaleString()}`;
    document.getElementById('pm-transfer').textContent = `₲${(pm.TRANSFER || 0).toLocaleString()}`;
    document.getElementById('pm-qr').textContent       = `₲${(pm.QR      || 0).toLocaleString()}`;
    document.getElementById('pm-card').textContent     = `₲${(pm.CARD    || 0).toLocaleString()}`;

    // Recent entries
    const tbody = document.getElementById('recent-entries-tbody');
    if (data.recentEntries && data.recentEntries.length > 0) {
      tbody.innerHTML = data.recentEntries.map(e => `
        <tr>
          <td>${new Date(e.scannedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${escapeHtml(e.customerName)}</td>
          <td>${getVisitorTypeName(e.ticketType)}</td>
          <td>${getPaymentIcon(e.paymentMethod)} ${e.paymentMethod || '-'}</td>
          <td style="color:var(--text-muted)">${escapeHtml(e.guardEmail.split('@')[0])}</td>
        </tr>`).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin entradas recientes</td></tr>';
    }
  } catch (err) {
    if (store.currentUser?.role === 'GUARD') return;
    showToast(err.message, 'error');
  }

  // Init executive summary + fraud panel (both ADMIN-only, handled internally)
  loadExecutiveSummary();
  initFraudPanel();
}

export { stopFraudRefresh };
