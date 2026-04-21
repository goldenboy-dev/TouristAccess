import { store } from '../store.js';
import { getPaymentIcon, escapeHtml, getStatusName, formatDate } from '../utils/formatters.js';
import { showToast, playSound } from '../utils/notifications.js';
import { fetchTickets, cancelTicket as cancelTicketApi, createTicket } from './tickets.service.js';

// ---- LIST TICKETS ----

export async function loadTickets() {
  const tbody = document.getElementById('tickets-tbody');
  tbody.innerHTML = '<tr><td colspan="10" class="table-empty">Cargando...</td></tr>';

  const qs = new URLSearchParams();
  const status  = document.getElementById('tickets-filter-status').value;
  const type    = document.getElementById('tickets-filter-type').value;
  const payment = document.getElementById('tickets-filter-payment').value;
  const from    = document.getElementById('tickets-filter-from').value;
  const to      = document.getElementById('tickets-filter-to').value;

  if (status)  qs.set('status', status);
  if (type)    qs.set('ticket_type', type);
  if (payment) qs.set('payment_method', payment);
  if (from)    qs.set('date_from', from);
  if (to)      qs.set('date_to', to);

  try {
    const data = await fetchTickets(qs.toString());

    if (!data.tickets || data.tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No hay tickets con esos filtros</td></tr>';
      return;
    }

    const isAdminOrCashier = ['ADMIN', 'CASHIER'].includes(store.currentUser?.role);

    tbody.innerHTML = data.tickets.map(t => {
      const tokenCell = isAdminOrCashier
        ? `<td class="token-cell">
            <button class="btn-token-toggle" data-action="toggle-token" data-token="${escapeHtml(t.token)}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Ver
            </button>
            <button class="btn-token-copy hidden" data-action="copy-token" data-token="${escapeHtml(t.token)}" title="Copiar token">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <span class="token-value hidden">${escapeHtml(t.token.substring(0,16))}…</span>
           </td>`
        : '<td>—</td>';

      return `<tr>
        <td>#${t.id}</td>
        <td>${escapeHtml(t.customer_name)}</td>
        <td>${t.ticket_type === 'ADULT' ? 'Adulto' : 'Niño'}</td>
        <td>₲${t.price.toLocaleString()}</td>
        <td><span class="badge badge-payment">${getPaymentIcon(t.payment_method)} ${t.payment_method || 'CASH'}</span></td>
        <td>${formatDate(t.visit_date)}</td>
        <td><span class="badge badge-${t.status.toLowerCase()}">${getStatusName(t.status)}</span></td>
        <td>${t.createdBy?.email.split('@')[0] || '-'}</td>
        ${tokenCell}
        <td>${t.status === 'ACTIVE' ? `<button class="btn-danger-sm" data-action="cancel-ticket" data-id="${t.id}">Cancelar</button>` : '—'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty">${err.message}</td></tr>`;
    showToast(err.message, 'error');
  }
}

export function toggleToken(btn, token) {
  const cell  = btn.closest('.token-cell');
  const span  = cell.querySelector('.token-value');
  const copy  = cell.querySelector('.btn-token-copy');
  const hidden = span.classList.contains('hidden');
  span.classList.toggle('hidden', !hidden);
  copy.classList.toggle('hidden', !hidden);
  btn.innerHTML = hidden
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Ocultar`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Ver`;
}

export async function copyToken(token) {
  try {
    await navigator.clipboard.writeText(token);
    showToast('Token copiado al portapapeles', 'success');
  } catch {
    showToast('No se pudo copiar', 'error');
  }
}

export async function handleCancelTicket(id) {
  if (!confirm('¿Cancelar este ticket?')) return;
  try {
    await cancelTicketApi(id);
    showToast('Ticket cancelado', 'success');
    loadTickets();
  } catch (err) { showToast(err.message, 'error'); }
}

// ---- CREATE TICKET ----

export function initCreateTicketPage() {
  document.getElementById('ticket-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ticket-result').classList.add('hidden');
  document.getElementById('ticket-adults').value = 1;
  document.getElementById('ticket-children').value = 0;
  updatePriceSummary();
}

export function updatePriceSummary() {
  const adults = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const qty = adults + children;
  const total = adults * 10000;
  document.getElementById('price-total').textContent     = `₲${total.toLocaleString()}`;
  document.getElementById('price-breakdown').textContent = `(${qty} personas en total)`;
  document.getElementById('create-btn-text').textContent = qty > 1 ? `Generar Grupo (${qty}) + QR` : 'Generar Ticket + QR';
}

export async function handleCreateTicketSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('create-ticket-btn');
  btn.disabled = true;
  const adults = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;

  try {
    // API logic delegated to service
    const payload = {
      customer_name:  document.getElementById('ticket-customer').value.trim(),
      number_of_adults: adults,
      number_of_children: children,
      payment_method: document.getElementById('ticket-payment').value,
      visit_date:     document.getElementById('ticket-date').value
    };
    
    const data = await createTicket(payload);

    const results = data.tickets || [];
    const container = document.getElementById('ticket-result-cards');
    document.getElementById('result-title').textContent = data.group_id 
      ? `Grupo Creado Exitosamente (Total: ₲${data.total.toLocaleString()})`
      : 'Ticket Creado Exitosamente';

    // Display summary and a <details> expanding section
    container.innerHTML = `
      <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: var(--radius-sm); margin-bottom: 1rem;">
        <p style="margin: 0; color: var(--text-primary); font-weight: 500;">Operación: ${data.group_id ? data.group_id.split('-')[0] : (results[0] ? results[0].ticket.id : 'N/A')}</p>
        <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.9rem;">${results.length} entradas generadas</p>
      </div>
      <details style="margin-top: 1rem;">
        <summary style="cursor: pointer; font-weight: 600; color: var(--accent-primary); padding: 0.5rem 0;">Ver Entradas Individuales</summary>
        <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem;">
          ${results.map(({ ticket: t, qr }) => `
            <div class="ticket-card" style="border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 1rem;">
              <div class="ticket-result-layout">
                <div class="result-details" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;flex:1">
                  <div class="result-item"><span class="label">ID / GRUPO</span><span class="value">#${t.id} ${t.group_id ? `<br><small style="opacity:0.6">${t.group_id.split('-')[0]}</small>` : ''}</span></div>
                  <div class="result-item"><span class="label">Cliente</span><span class="value">${escapeHtml(t.customer_name)}</span></div>
                  <div class="result-item"><span class="label">Tipo</span><span class="value">${t.ticket_type === 'ADULT' ? 'Adulto' : 'Niño'}</span></div>
                  <div class="result-item"><span class="label">Precio</span><span class="value">₲${t.price.toLocaleString()}</span></div>
                  <div class="result-item"><span class="label">Pago</span><span class="value">${getPaymentIcon(t.payment_method)} ${t.payment_method}</span></div>
                  <div class="result-item"><span class="label">Fecha</span><span class="value">${formatDate(t.visit_date)}</span></div>
                  <div class="result-item" style="grid-column:1/-1">
                    <span class="label">Token (fallback)</span>
                    <span class="value" style="font-size:.72rem;opacity:.7;word-break:break-all">${t.token}</span>
                    <button class="btn-token-copy" data-action="copy-token" data-token="${t.token}" style="margin-top:.25rem" title="Copiar token">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar
                    </button>
                  </div>
                </div>
                ${qr ? `<div class="qr-display"><img src="${qr}" alt="QR"><p class="qr-caption">Escanear para entrar</p></div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </details>
    `;

    document.getElementById('ticket-result').classList.remove('hidden');
    playSound('success');
    showToast(results.length === 1 ? 'Ticket + QR generados ✓' : `${results.length} tickets generados ✓`, 'success');

    // Keep date, clear name and counts
    const dateVal = document.getElementById('ticket-date').value;
    const payVal  = document.getElementById('ticket-payment').value;
    document.getElementById('create-ticket-form').reset();
    document.getElementById('ticket-date').value    = dateVal;
    document.getElementById('ticket-payment').value = payVal;
    document.getElementById('ticket-adults').value = 1;
    document.getElementById('ticket-children').value = 0;
    updatePriceSummary();
    document.getElementById('ticket-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
