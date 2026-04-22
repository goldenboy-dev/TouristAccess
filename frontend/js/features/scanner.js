import { api } from '../api.js';
import { store, setScanner } from '../store.js';
import { escapeHtml, getVisitorTypeName } from '../utils/formatters.js';
import { playSound } from '../utils/notifications.js';

let isProcessingScan = false;

export function initScanner() {
  if (!document.getElementById('qr-reader') || store.html5QrcodeScanner) return;
  const scanner = new window.Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 }, false);
  setScanner(scanner);
  scanner.render(onScanSuccess, () => {});
}

export function stopScanner() {
  if (store.html5QrcodeScanner) {
    try { store.html5QrcodeScanner.clear(); } catch {}
    setScanner(null);
  }
}

export function onScanSuccess(decodedText) { 
  if (!isProcessingScan) processToken(decodedText); 
}

export async function processToken(token) {
  isProcessingScan = true;
  const overlay = document.getElementById('validate-overlay');
  const content = document.getElementById('validate-overlay-content');
  const closeBtn = document.getElementById('validate-overlay-close');

  try {
    const data = await api('/tickets/validate', { method: 'POST', body: JSON.stringify({ token }) });
    overlay.classList.remove('hidden', 'success', 'warning', 'error');

    // ─── FREE ENTRY: needs guard confirmation ───
    if (data.status === 'confirmation_required') {
      overlay.classList.add('warning');
      playSound('warning');

      const t = data.ticket;
      const typeLabel = t.visitor_type === 'CHILD' ? 'NIÑO (menor de 12 años)' : 'RESIDENTE LOCAL';

      content.innerHTML = `
        <div class="overlay-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h1 style="font-size:1.8rem">ENTRADA GRATUITA</h1>
        <p style="margin-bottom:1rem">Verificar antes de permitir el ingreso</p>
        <div class="free-confirm-box">
          <div class="free-confirm-type">${typeLabel}</div>
          <div class="free-confirm-name">${escapeHtml(t.customer_name)}</div>
          ${t.cedula ? `<div class="free-confirm-cedula">Cédula registrada: <strong>${escapeHtml(t.cedula)}</strong></div>` : '<div class="free-confirm-cedula" style="opacity:0.6">Sin cédula registrada</div>'}
          <p style="margin-top:1rem;font-size:1rem;color:rgba(255,255,255,0.9)">¿Confirmás que esta persona califica para entrada gratuita?</p>
        </div>
        <div class="free-confirm-buttons">
          <button class="btn-free-confirm" id="btn-confirm-free-yes" data-token="${escapeHtml(token)}">
            ✓ SÍ, CONFIRMAR INGRESO
          </button>
          <button class="btn-free-reject" id="btn-confirm-free-no">
            ✗ RECHAZAR
          </button>
        </div>
      `;

      // Hide the default close button, we have custom buttons
      closeBtn.style.display = 'none';

      // Bind confirm/reject
      document.getElementById('btn-confirm-free-yes').addEventListener('click', async () => {
        try {
          const confirmData = await api('/tickets/validate', {
            method: 'POST',
            body: JSON.stringify({ token, free_confirmed: true })
          });

          overlay.classList.remove('warning');

          if (confirmData.status === 'valid') {
            overlay.classList.add('success');
            playSound('success');
            content.innerHTML = `
              <div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><polyline points="20 6 9 17 4 12"/></svg></div>
              <h1>¡Adelante!</h1>
              <p>Acceso Permitido · ${getVisitorTypeName(confirmData.ticket.visitor_type)}</p>
              <div class="customer-name-big">${escapeHtml(confirmData.ticket.customer_name)}</div>
            `;
          } else {
            overlay.classList.add('error');
            playSound('error');
            content.innerHTML = `
              <div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
              <h1>Error</h1><p>${confirmData.message}</p>
            `;
          }
        } catch (err) {
          overlay.classList.remove('warning');
          overlay.classList.add('error');
          playSound('error');
          content.innerHTML = `<div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><h1>Error</h1><p>${err.message}</p>`;
        }
        closeBtn.style.display = '';
      });

      document.getElementById('btn-confirm-free-no').addEventListener('click', () => {
        overlay.classList.remove('warning');
        overlay.classList.add('error');
        playSound('error');
        content.innerHTML = `
          <div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
          <h1>Rechazado</h1><p>Entrada gratuita no confirmada por el guardia</p>
        `;
        closeBtn.style.display = '';
      });

      return; // Don't call resetScannerLock yet
    }

    // ─── Normal flow ───
    closeBtn.style.display = '';

    if (data.status === 'valid') {
      overlay.classList.add('success'); playSound('success');
      content.innerHTML = `<div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><polyline points="20 6 9 17 4 12"/></svg></div><h1>¡Adelante!</h1><p>Acceso Permitido · ${getVisitorTypeName(data.ticket.visitor_type)}</p><div class="customer-name-big">${escapeHtml(data.ticket.customer_name)}</div>`;
    } else if (data.status === 'already_used') {
      overlay.classList.add('warning'); playSound('warning');
      const t = data.ticket?.usedAt ? new Date(data.ticket.usedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      content.innerHTML = `<div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><h1>Ticket Usado</h1><p>${data.message}</p><p style="margin-top:1rem;color:rgba(255,255,255,0.75)">Escaneado ${t ? 'a las ' + t : ''}</p><div class="customer-name-big">${escapeHtml(data.ticket?.customer_name || 'Desconocido')}</div>`;
    } else {
      overlay.classList.add('error'); playSound('error');
      content.innerHTML = `<div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><h1>Acceso Denegado</h1><p>${data.message}</p>`;
    }
  } catch (err) {
    overlay.classList.remove('hidden', 'success', 'warning');
    overlay.classList.add('error'); playSound('error');
    content.innerHTML = `<div class="overlay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:50px;height:50px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div><h1>Error</h1><p>${err.message}</p>`;
    closeBtn.style.display = '';
  }
}

export function resetScannerLock() {
  isProcessingScan = false;
}

export async function handleManualValidate(e) {
  e.preventDefault();
  if (isProcessingScan) return;
  const t = document.getElementById('validate-token').value.trim();
  if (t) processToken(t);
}
