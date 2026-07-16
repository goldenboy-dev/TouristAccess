import { store } from '../store.js';
import { getPaymentIcon, escapeHtml, getStatusName, formatDate, getVisitorTypeName, getVisitorTypeClass } from '../utils/formatters.js';
import { showToast, playSound } from '../utils/notifications.js';
import { fetchTickets, cancelTicket as cancelTicketApi, createTicket, fetchPricing } from './tickets.service.js';

// ─── PRICING ────────────────────────────────────────────────
// [FIX 6] No longer hardcoded — fetched from backend so it never drifts
// from the server-side price (which is the one actually charged).
let ADULT_PRICE = 10000; // fallback until loadPricing() resolves

async function loadPricing() {
  try {
    const data = await fetchPricing();
    if (data.ADULT_PRICE) ADULT_PRICE = data.ADULT_PRICE;
  } catch (err) {
    console.warn('No se pudo obtener el precio desde el backend, usando valor por defecto', err);
  }
}

// ──── LIST TICKETS ────────────────────────────────────────────
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
  if (type)    qs.set('visitor_type', type);
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
        <td><span class="badge ${getVisitorTypeClass(t.visitor_type)}">${getVisitorTypeName(t.visitor_type)}</span></td>
        <td>${t.price > 0 ? '₲' + t.price.toLocaleString() : '<span style="color:var(--success)">Gratis</span>'}</td>
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

// ──── CREATE TICKET ───────────────────────────────────────────

export async function initCreateTicketPage() {
  document.getElementById('ticket-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ticket-result').classList.add('hidden');
  document.getElementById('ticket-adults').value = 1;
  document.getElementById('ticket-children').value = 0;
  document.getElementById('ticket-locals').value = 0;
  renderCedulaFields();
  await loadPricing();
  updatePriceSummary();
}

export function renderCedulaFields() {
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const locals   = parseInt(document.getElementById('ticket-locals').value) || 0;

  const container = document.getElementById('cedula-fields-container');
  if (!container) return;

  let html = '';

  if (locals > 0) {
    html += `<div class="cedula-section"><h4 class="cedula-section-title">📋 Cédulas de Residentes Locales <span class="required-tag">obligatorio</span></h4>`;
    for (let i = 0; i < locals; i++) {
      html += `<div class="form-group cedula-field">
        <label>Cédula Local #${i + 1}</label>
        <input type="text" class="local-cedula-input" data-index="${i}" placeholder="Ej: 4.123.456" required>
      </div>`;
    }
    html += '</div>';
  }

  if (children > 0) {
    html += `<div class="cedula-section"><h4 class="cedula-section-title">📋 Cédulas de Niños <span class="optional-tag">opcional</span></h4>`;
    for (let i = 0; i < children; i++) {
      html += `<div class="form-group cedula-field">
        <label>Cédula Niño #${i + 1}</label>
        <input type="text" class="child-cedula-input" data-index="${i}" placeholder="Cédula opcional">
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

export function updatePriceSummary() {
  const adults   = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const locals   = parseInt(document.getElementById('ticket-locals').value) || 0;
  const qty      = adults + children + locals;
  const total    = adults * ADULT_PRICE;

  // Detailed breakdown
  const breakdown = document.getElementById('price-breakdown-detail');
  if (breakdown) {
    let lines = [];
    if (adults > 0)   lines.push(`${adults} adulto${adults > 1 ? 's' : ''} × ₲${ADULT_PRICE.toLocaleString()} = ₲${(adults * ADULT_PRICE).toLocaleString()}`);
    if (children > 0) lines.push(`${children} niño${children > 1 ? 's' : ''} = ₲0 (gratis)`);
    if (locals > 0)   lines.push(`${locals} local${locals > 1 ? 'es' : ''} = ₲0 (gratis)`);
    breakdown.innerHTML = lines.join('<br>');
  }

  document.getElementById('price-total').textContent = `₲${total.toLocaleString()}`;
  document.getElementById('price-persons').textContent = `${qty} persona${qty !== 1 ? 's' : ''} en total`;
  document.getElementById('create-btn-text').textContent = qty > 1 ? `Generar Grupo (${qty}) + QR` : 'Generar Ticket + QR';
}

// ─── Confirmation modal ──────────────────────────────────────
export function showConfirmationModal() {
  const adults   = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const locals   = parseInt(document.getElementById('ticket-locals').value) || 0;
  const total    = adults * ADULT_PRICE;
  const qty      = adults + children + locals;
  const payment  = document.getElementById('ticket-payment').value;
  const date     = document.getElementById('ticket-date').value;
  const customer = document.getElementById('ticket-customer').value.trim() || 'Sin nombre';

  const modal = document.getElementById('confirm-modal');
  const body  = document.getElementById('confirm-modal-body');

  body.innerHTML = `
    <div class="confirm-summary">
      <div class="confirm-total">₲${total.toLocaleString()}</div>
      <div class="confirm-detail">
        ${adults > 0 ? `<div>${adults} adulto${adults > 1 ? 's' : ''} × ₲${ADULT_PRICE.toLocaleString()} = ₲${(adults * ADULT_PRICE).toLocaleString()}</div>` : ''}
        ${children > 0 ? `<div>${children} niño${children > 1 ? 's' : ''} = ₲0 (gratis)</div>` : ''}
        ${locals > 0 ? `<div>${locals} local${locals > 1 ? 'es' : ''} = ₲0 (gratis)</div>` : ''}
      </div>
      <div class="confirm-separator"></div>
      <div class="confirm-meta">
        <span><strong>Cliente:</strong> ${escapeHtml(customer)}</span>
        <span><strong>Personas:</strong> ${qty}</span>
        <span><strong>Pago:</strong> ${getPaymentIcon(payment)} ${payment}</span>
        <span><strong>Fecha:</strong> ${formatDate(date + 'T00:00:00')}</span>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

export function hideConfirmationModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
}

export async function handleCreateTicketSubmit(e) {
  e.preventDefault();

  const adults   = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const locals   = parseInt(document.getElementById('ticket-locals').value) || 0;
  const qty = adults + children + locals;

  if (qty <= 0) { showToast('Debe haber al menos 1 persona', 'error'); return; }

  // Validate local cedulas before showing modal
  if (locals > 0) {
    const localInputs = document.querySelectorAll('.local-cedula-input');
    for (const input of localInputs) {
      if (!input.value.trim()) {
        showToast(`La cédula del residente local #${parseInt(input.dataset.index) + 1} es obligatoria`, 'error');
        input.focus();
        return;
      }
    }
  }

  // Show confirmation modal
  showConfirmationModal();
}

export async function confirmAndCreate() {
  hideConfirmationModal();

  const btn = document.getElementById('create-ticket-btn');
  btn.disabled = true;

  const adults   = parseInt(document.getElementById('ticket-adults').value) || 0;
  const children = parseInt(document.getElementById('ticket-children').value) || 0;
  const locals   = parseInt(document.getElementById('ticket-locals').value) || 0;

  // Gather cedulas
  const localsCedulas = [];
  document.querySelectorAll('.local-cedula-input').forEach(input => {
    localsCedulas.push(input.value.trim());
  });

  const childrenCedulas = [];
  document.querySelectorAll('.child-cedula-input').forEach(input => {
    childrenCedulas.push(input.value.trim());
  });

  try {
    const payload = {
      customer_name:      document.getElementById('ticket-customer').value.trim(),
      number_of_adults:   adults,
      number_of_children: children,
      number_of_locals:   locals,
      children_cedulas:   childrenCedulas,
      locals_cedulas:     localsCedulas,
      payment_method:     document.getElementById('ticket-payment').value,
      visit_date:         document.getElementById('ticket-date').value
    };

    const data = await createTicket(payload);

    // ── Render Step 1: Group Summary ──
    renderGroupSummary(data);

    playSound('success');
    showToast(`${data.tickets.length} ticket(s) generados ✓`, 'success');

    // Reset form but keep date and payment
    const dateVal = document.getElementById('ticket-date').value;
    const payVal  = document.getElementById('ticket-payment').value;
    document.getElementById('create-ticket-form').reset();
    document.getElementById('ticket-date').value    = dateVal;
    document.getElementById('ticket-payment').value = payVal;
    document.getElementById('ticket-adults').value   = 1;
    document.getElementById('ticket-children').value = 0;
    document.getElementById('ticket-locals').value   = 0;
    renderCedulaFields();
    updatePriceSummary();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── STEP 1: Group Summary Document ──────────────────────────
function renderGroupSummary(data) {
  const results   = data.tickets || [];
  const summary   = data.summary;
  const container = document.getElementById('ticket-result-cards');

  document.getElementById('result-title').textContent = 'Resumen de Operación';

  const visitDate = formatDate(summary.visit_date);
  const createdAt = new Date(summary.createdAt).toLocaleString('es-ES');

  container.innerHTML = `
    <div class="group-summary-doc" id="print-summary">
      <div class="summary-header-banner">
        <span class="summary-badge">🎫 RESUMEN DE VENTA</span>
      </div>

      <div class="summary-total-section">
        <div class="summary-total-big">₲${summary.total_amount.toLocaleString()}</div>
        <div class="summary-total-label">MONTO TOTAL A COBRAR</div>
      </div>

      <div class="summary-breakdown">
        ${summary.total_adults > 0 ? `<div class="breakdown-line"><span>${summary.total_adults} adulto${summary.total_adults > 1 ? 's' : ''} × ₲${ADULT_PRICE.toLocaleString()}</span><span class="breakdown-amount">₲${(summary.total_adults * ADULT_PRICE).toLocaleString()}</span></div>` : ''}
        ${summary.total_children > 0 ? `<div class="breakdown-line breakdown-free"><span>${summary.total_children} niño${summary.total_children > 1 ? 's' : ''}</span><span class="breakdown-amount">₲0 (gratis)</span></div>` : ''}
        ${summary.total_locals > 0 ? `<div class="breakdown-line breakdown-free"><span>${summary.total_locals} residente${summary.total_locals > 1 ? 's' : ''} local${summary.total_locals > 1 ? 'es' : ''}</span><span class="breakdown-amount">₲0 (gratis)</span></div>` : ''}
        <div class="breakdown-total-line"><span>Total personas: ${summary.total_persons}</span></div>
      </div>

      <div class="summary-meta-grid">
        <div class="summary-meta-item"><span class="meta-label">Código de Operación</span><span class="meta-value">${summary.operation_code}</span></div>
        <div class="summary-meta-item"><span class="meta-label">Cajero/a</span><span class="meta-value">${data.cashier_email || '-'}</span></div>
        <div class="summary-meta-item"><span class="meta-label">Fecha de Visita</span><span class="meta-value">${visitDate}</span></div>
        <div class="summary-meta-item"><span class="meta-label">Método de Pago</span><span class="meta-value">${getPaymentIcon(summary.payment_method)} ${summary.payment_method}</span></div>
        <div class="summary-meta-item"><span class="meta-label">Emisión</span><span class="meta-value">${createdAt}</span></div>
      </div>

      <div class="summary-alert">
        ⚠️ Verificá que el monto coincide con lo abonado antes de retirar tus entradas
      </div>
    </div>

    <div class="summary-actions">
      <button class="btn-primary" id="btn-confirm-and-show-tickets" style="width:auto;padding:0.9rem 2rem;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span>El cliente confirmó el monto → Ver entradas individuales</span>
      </button>
      <button class="btn-secondary print-btn" data-print="summary" style="margin-top:0.5rem;">🖨️ Imprimir Resumen</button>
    </div>

    <div id="individual-tickets-section" class="hidden">
      <div class="individual-tickets-header">
        <h3>Entradas Individuales</h3>
        <div class="print-buttons">
          <button class="btn-secondary print-btn" data-print="tickets">🖨️ Imprimir Entradas</button>
          <button class="btn-secondary print-btn" data-print="all">🖨️ Imprimir Todo</button>
        </div>
      </div>
      <div id="individual-tickets-list" class="individual-tickets-grid">
        ${renderIndividualTickets(results, data.cashier_email)}
      </div>
    </div>
  `;

  // Bind the confirm button
  document.getElementById('btn-confirm-and-show-tickets').addEventListener('click', () => {
    document.getElementById('individual-tickets-section').classList.remove('hidden');
    document.getElementById('btn-confirm-and-show-tickets').classList.add('hidden');
    document.getElementById('individual-tickets-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('ticket-result').classList.remove('hidden');
  document.getElementById('ticket-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── STEP 2: Individual Tickets ──────────────────────────────
function renderIndividualTickets(results, cashierEmail) {
  return results.map(({ ticket: t, qr }) => {
    const typeClass = getVisitorTypeClass(t.visitor_type);
    const typeName  = getVisitorTypeName(t.visitor_type);

    return `
      <div class="ticket-card individual-ticket" data-printable="ticket">
        <div class="ticket-card-header ${typeClass}">
          <span class="ticket-card-type">${typeName}</span>
          <span class="ticket-card-price">${t.price > 0 ? '₲' + t.price.toLocaleString() : 'GRATIS'}</span>
        </div>
        <div class="ticket-result-layout">
          <div class="result-details" style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;flex:1">
            <div class="result-item"><span class="label">ID</span><span class="value">#${t.id}</span></div>
            <div class="result-item"><span class="label">Cliente</span><span class="value">${escapeHtml(t.customer_name)}</span></div>
            <div class="result-item"><span class="label">Fecha</span><span class="value">${formatDate(t.visit_date)}</span></div>
            <div class="result-item"><span class="label">Pago</span><span class="value">${getPaymentIcon(t.payment_method)} ${t.payment_method}</span></div>
            ${t.cedula ? `<div class="result-item"><span class="label">Cédula</span><span class="value">${escapeHtml(t.cedula)}</span></div>` : ''}
            <div class="result-item"><span class="label">Cajero/a</span><span class="value">${cashierEmail ? cashierEmail.split('@')[0] : '-'}</span></div>
            <div class="result-item" style="grid-column:1/-1">
              <span class="label">Operación</span>
              <span class="value" style="font-size:.8rem;opacity:.7">${t.group_id ? t.group_id.split('-')[0] : '-'}</span>
            </div>
            <div class="result-item" style="grid-column:1/-1">
              <span class="label">Token</span>
              <span class="value" style="font-size:.68rem;opacity:.5;word-break:break-all;font-family:monospace">${t.token}</span>
              <button class="btn-token-copy" data-action="copy-token" data-token="${t.token}" style="margin-top:.25rem" title="Copiar token">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copiar
              </button>
            </div>
          </div>
          ${qr ? `<div class="qr-display"><img src="${qr}" alt="QR"><p class="qr-caption">Escanear para entrar</p></div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ─── Print handler ───────────────────────────────────────────
export function handlePrint(target) {
  if (target === 'summary') {
    const el = document.getElementById('print-summary');
    if (el) printElement(el);
  } else if (target === 'tickets') {
    const el = document.getElementById('individual-tickets-list');
    if (el) printElement(el);
  } else if (target === 'all') {
    const summary = document.getElementById('print-summary');
    const tickets = document.getElementById('individual-tickets-list');
    if (summary && tickets) {
      const combined = document.createElement('div');
      combined.innerHTML = summary.outerHTML + '<div style="page-break-before:always"></div>' + tickets.outerHTML;
      printElement(combined);
    }
  }
}

function printElement(el) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Imprimir - Tourist Access</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: Arial, sans-serif; padding: 1rem; color: #1f2937; }
      .group-summary-doc { max-width:500px; margin:0 auto; }
      .summary-total-section { text-align:center; padding:1.5rem; }
      .summary-total-big { font-size:2.5rem; font-weight:900; }
      .summary-total-label { font-size:0.8rem; color:#6b7280; text-transform:uppercase; letter-spacing:0.1em; margin-top:0.25rem; }
      .summary-breakdown { padding:1rem; border-top:2px dashed #e5e7eb; border-bottom:2px dashed #e5e7eb; }
      .breakdown-line { display:flex; justify-content:space-between; padding:0.3rem 0; }
      .breakdown-free { color:#6b7280; }
      .breakdown-total-line { font-weight:700; padding-top:0.5rem; border-top:1px solid #e5e7eb; margin-top:0.5rem; }
      .summary-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; padding:1rem; }
      .meta-label { font-size:0.7rem; color:#6b7280; text-transform:uppercase; display:block; }
      .meta-value { font-weight:700; font-size:0.9rem; }
      .summary-alert { background:#fef3c7; border:1px solid #f59e0b; padding:0.75rem; text-align:center; font-size:0.85rem; border-radius:8px; margin-top:1rem; }
      .summary-header-banner { text-align:center; padding:1rem; }
      .summary-badge { font-weight:800; font-size:1.2rem; }
      .ticket-card { border:1px solid #e5e7eb; border-radius:12px; padding:1rem; margin-bottom:1rem; page-break-inside:avoid; }
      .ticket-card-header { display:flex; justify-content:space-between; padding:0.5rem 0.75rem; border-radius:8px; margin-bottom:0.75rem; font-weight:700; }
      .badge-adult { background:#dbeafe; color:#1d4ed8; }
      .badge-child { background:#d1fae5; color:#065f46; }
      .badge-local { background:#ede9fe; color:#7c3aed; }
      .ticket-result-layout { display:flex; gap:1.5rem; align-items:center; }
      .result-details { flex:1; }
      .result-item { margin-bottom:0.4rem; }
      .label { font-size:0.7rem; color:#6b7280; text-transform:uppercase; display:block; }
      .value { font-weight:600; font-size:0.85rem; }
      .qr-display { text-align:center; }
      .qr-display img { width:140px; height:140px; }
      .qr-caption { font-size:0.7rem; color:#6b7280; margin-top:0.25rem; }
      .btn-token-copy { display:none; }
      .individual-tickets-grid { display:flex; flex-direction:column; gap:1rem; }
    </style>
  </head><body>${el.innerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}
