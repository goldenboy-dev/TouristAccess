import { api } from '../api.js';
import { API_URL } from '../config.js';
import { store } from '../store.js';
import { escapeHtml, getPaymentIcon } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

let cajeroOptionsLoaded = false;

async function ensureCajeroOptions() {
  if (cajeroOptionsLoaded) return;
  const select = document.getElementById('caja-filter-cajero');
  try {
    const data = await api('/dashboard/users');
    const cashiers = (data.users || []).filter(u => u.role === 'CASHIER');
    select.innerHTML = '<option value="">Todos los cajeros</option>' +
      cashiers.map(c => `<option value="${c.id}">${escapeHtml(c.name || c.email)}</option>`).join('');
    cajeroOptionsLoaded = true;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function buildQuery() {
  const from = document.getElementById('caja-date-from').value;
  const to = document.getElementById('caja-date-to').value;
  const cajero = document.getElementById('caja-filter-cajero').value;
  const params = new URLSearchParams();
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);
  if (cajero) params.set('cajero_id', cajero);
  return params.toString();
}

export async function loadCashReport() {
  await ensureCajeroOptions();
  const tbody = document.getElementById('caja-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Cargando...</td></tr>';

  try {
    const qs = buildQuery();
    const data = await api(`/dashboard/cash-report${qs ? '?' + qs : ''}`);

    if (!data.rows || !data.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Sin ventas en el período seleccionado</td></tr>';
      document.getElementById('caja-grand-total').textContent = '₲0';
      return;
    }

    tbody.innerHTML = data.rows.map(r => `<tr>
      <td>${escapeHtml(r.cajeroNombre)}</td>
      <td>${r.totalTickets}</td>
      <td>${getPaymentIcon('CASH')} ₲${r.byMethod.CASH.toLocaleString()}</td>
      <td>${getPaymentIcon('TRANSFER')} ₲${r.byMethod.TRANSFER.toLocaleString()}</td>
      <td>${getPaymentIcon('QR')} ₲${r.byMethod.QR.toLocaleString()}</td>
      <td>${getPaymentIcon('CARD')} ₲${r.byMethod.CARD.toLocaleString()}</td>
      <td><strong>₲${r.totalAmount.toLocaleString()}</strong></td>
      <td>${r.cancelledCount}</td>
    </tr>`).join('');

    document.getElementById('caja-grand-total').textContent = `₲${data.grandTotal.toLocaleString()}`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${err.message}</td></tr>`;
  }
}

const EXPORT_FILENAMES = { csv: 'cierre-caja.csv', excel: 'cierre-caja.xlsx', pdf: 'cierre-caja.pdf' };

// A file download needs the Authorization header, so it cannot be a plain
// <a href> — the api() wrapper assumes a JSON body, so this does its own
// fetch and turns the response into a Blob download.
export async function handleExportCashReport(format = 'csv') {
  try {
    const params = new URLSearchParams(buildQuery());
    params.set('format', format);
    const res = await fetch(`${API_URL}/dashboard/cash-report/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${store.authToken}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || 'No se pudo exportar el reporte');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILENAMES[format] || EXPORT_FILENAMES.csv;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
