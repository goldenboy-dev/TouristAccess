import { store } from './store.js';
import { checkAuth, login, logout } from './auth.js';
import { domRefs } from './utils/dom.js';
import { getAudio } from './utils/notifications.js';

// Features
import { loadDashboard, stopFraudRefresh } from './features/dashboard.js';
import { onFraudDateChange, toggleSuspiciousFilter, loadAlertHistory } from './features/fraud-dashboard.js';
import {
  loadTickets, initCreateTicketPage, handleCreateTicketSubmit,
  updatePriceSummary, renderCedulaFields, toggleToken, copyToken,
  handleCancelTicket, confirmCancelTicket, hideCancelTicketModal,
  confirmAndCreate, hideConfirmationModal, handlePrint, handlePrintThermal,
  handleRegenerateQr,
} from './features/tickets.view.js';
import { initScanner, stopScanner, handleManualValidate, resetScannerLock } from './features/scanner.js';
import {
  loadUsers, handleRegister, handleEditName, saveEditName, cancelEditName,
  handleEditRole, saveEditRole, cancelEditRole,
  handleToggleActive, confirmToggleActive, cancelToggleActive,
  loadPricing, handleSavePricing,
  loadOperatingSettings, handleSaveOperatingSettings,
} from './features/users.js';
import { loadCashReport, handleExportCashReport } from './features/cash-report.js';
import {
  handleForcedPasswordChangeSubmit, showChangePasswordModal,
  hideChangePasswordModal, handleChangePasswordSubmit,
  showRevokeSessionsModal, hideRevokeSessionsModal, confirmRevokeSessions,
} from './features/password.js';
import { loadAuditLog, goToPrevAuditPage, goToNextAuditPage, clearAuditFilters } from './features/audit-log.js';

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('visible');
}

export function navigateTo(pageId) {
  domRefs.pages.forEach(p => p.classList.remove('active'));
  domRefs.navItems.forEach(n => n.classList.remove('active'));

  const pg  = document.getElementById(`page-${pageId}`);
  const nav = document.querySelector(`[data-page="${pageId}"]`);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');

  if (pageId !== 'validate') stopScanner();
  if (pageId !== 'dashboard') stopFraudRefresh();

  if (pageId === 'dashboard')     loadDashboard();
  if (pageId === 'tickets')       loadTickets();
  if (pageId === 'users')       { loadUsers(); loadPricing(); loadOperatingSettings(); }
  if (pageId === 'caja')          loadCashReport();
  if (pageId === 'audit')         loadAuditLog(1);
  if (pageId === 'create-ticket') initCreateTicketPage();
  if (pageId === 'validate' && store.currentUser?.role === 'GUARD') {
    document.getElementById('validate-token').value = '';
    initScanner();
  }
}

// ─── Setup Event Listeners ─────────────────────────
function setupEventListeners() {
  domRefs.loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    domRefs.loginError.classList.add('hidden');
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    try {
      getAudio(); // unlock audio on first interaction
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      await login(email, password);
    } catch (err) {
      // Wrong-password responses carry `attemptsLeft` (how many tries before
      // lockout) alongside the generic "Credenciales inválidas" message —
      // the backend doesn't fold it into the message text itself.
      const attemptsLeft = err.data?.attemptsLeft;
      domRefs.loginError.textContent = Number.isInteger(attemptsLeft)
        ? `${err.message} (quedan ${attemptsLeft} intento${attemptsLeft === 1 ? '' : 's'} antes del bloqueo)`
        : err.message;
      domRefs.loginError.classList.remove('hidden');
    } finally {
      btn.disabled = false; 
    }
  });

  domRefs.logoutBtn.addEventListener('click', logout);

  domRefs.navItems.forEach(item => item.addEventListener('click', () => {
    if (item.dataset.page) navigateTo(item.dataset.page);
    closeSidebar();
  }));

  // Tablet/mobile sidebar toggle — the sidebar goes off-canvas below 1024px
  // (see styles.css), so it needs a way back onto the screen.
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-backdrop').classList.add('visible');
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  // Tickets Filter setup
  document.getElementById('tickets-refresh-btn').addEventListener('click', loadTickets);
  ['tickets-filter-status','tickets-filter-type','tickets-filter-payment','tickets-filter-cajero'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadTickets);
  });

  // Ticket creation setup — adults, children, locals
  document.getElementById('ticket-adults').addEventListener('input', () => {
    updatePriceSummary();
  });
  document.getElementById('ticket-children').addEventListener('input', () => {
    renderCedulaFields();
    updatePriceSummary();
  });
  document.getElementById('ticket-locals').addEventListener('input', () => {
    renderCedulaFields();
    updatePriceSummary();
  });
  document.getElementById('create-ticket-form').addEventListener('submit', handleCreateTicketSubmit);
  
  // Confirmation modal buttons
  document.getElementById('confirm-modal-yes').addEventListener('click', confirmAndCreate);
  document.getElementById('confirm-modal-no').addEventListener('click', hideConfirmationModal);

  // Event Delegation for Tickets Table & Result Cards (Dynamic HTML)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    
    const action = btn.dataset.action;
    if (action === 'toggle-token') toggleToken(btn, btn.dataset.token);
    if (action === 'copy-token') copyToken(btn.dataset.token);
    if (action === 'cancel-ticket') handleCancelTicket(btn.dataset.id);
    if (action === 'print-thermal') handlePrintThermal(btn.dataset.id, btn);
    if (action === 'regenerate-qr') handleRegenerateQr(btn.dataset.id, btn);
    if (action === 'edit-name') handleEditName(parseInt(btn.dataset.id), btn.dataset.name);
    if (action === 'edit-role') handleEditRole(parseInt(btn.dataset.id), btn.dataset.role);
    if (action === 'toggle-active') handleToggleActive(parseInt(btn.dataset.id), btn.dataset.active, btn.dataset.email);

    // Print buttons
    if (btn.classList.contains('print-btn') && btn.dataset.print) {
      handlePrint(btn.dataset.print);
    }
  });

  // Dashboard filter
  document.getElementById('dash-apply-filter').addEventListener('click', loadDashboard);
  document.getElementById('dash-clear-filter').addEventListener('click', () => {
    document.getElementById('dash-date-from').value = '';
    document.getElementById('dash-date-to').value   = '';
    loadDashboard();
  });

  // Fraud panel listeners
  const fraudDatePicker = document.getElementById('fraud-date-picker');
  if (fraudDatePicker) fraudDatePicker.addEventListener('change', onFraudDateChange);

  const btnSuspAll = document.getElementById('btn-susp-all');
  const btnSuspFlagged = document.getElementById('btn-susp-flagged');
  if (btnSuspAll) btnSuspAll.addEventListener('click', () => toggleSuspiciousFilter(false));
  if (btnSuspFlagged) btnSuspFlagged.addEventListener('click', () => toggleSuspiciousFilter(true));

  const alertHistoryFilterBtn = document.getElementById('alert-history-filter-btn');
  if (alertHistoryFilterBtn) alertHistoryFilterBtn.addEventListener('click', loadAlertHistory);

  // Validate setup
  document.getElementById('validate-form').addEventListener('submit', handleManualValidate);
  document.getElementById('validate-overlay-close').addEventListener('click', () => {
    const overlay = document.getElementById('validate-overlay');
    overlay.classList.add('hidden');
    // [FIX 1] Clean up pending confirmation flag if guard closed overlay without deciding
    delete overlay.dataset.pendingConfirmation;
    document.getElementById('validate-overlay-close').style.display = '';
    document.getElementById('validate-token').value = '';
    document.getElementById('validate-token').focus();
    resetScannerLock();
  });

  // User management setup
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('show-register-btn').addEventListener('click', () => {
    document.getElementById('register-form-container').classList.toggle('hidden');
  });
  document.getElementById('cancel-register-btn').addEventListener('click', () => {
    document.getElementById('register-form-container').classList.add('hidden');
    document.getElementById('register-form').reset();
    document.getElementById('register-msg').classList.add('hidden');
  });

  // [FIX 10] Edit-name modal buttons
  document.getElementById('edit-name-save').addEventListener('click', saveEditName);
  document.getElementById('edit-name-cancel').addEventListener('click', cancelEditName);

  // Edit-role modal buttons
  document.getElementById('edit-role-save').addEventListener('click', saveEditRole);
  document.getElementById('edit-role-cancel').addEventListener('click', cancelEditRole);

  // Activate/deactivate modal buttons
  document.getElementById('toggle-active-confirm').addEventListener('click', confirmToggleActive);
  document.getElementById('toggle-active-cancel').addEventListener('click', cancelToggleActive);

  // Pricing form
  document.getElementById('pricing-form').addEventListener('submit', handleSavePricing);

  // Operating settings form (horarios + aforo)
  document.getElementById('settings-form').addEventListener('submit', handleSaveOperatingSettings);

  // Cash report (Caja) filters + export
  document.getElementById('caja-apply-filter').addEventListener('click', loadCashReport);
  document.getElementById('caja-clear-filter').addEventListener('click', () => {
    document.getElementById('caja-date-from').value = '';
    document.getElementById('caja-date-to').value = '';
    document.getElementById('caja-filter-cajero').value = '';
    loadCashReport();
  });
  document.getElementById('caja-export-csv-btn').addEventListener('click', () => handleExportCashReport('csv'));
  document.getElementById('caja-export-excel-btn').addEventListener('click', () => handleExportCashReport('excel'));
  document.getElementById('caja-export-pdf-btn').addEventListener('click', () => handleExportCashReport('pdf'));

  // Cancel-ticket modal buttons
  document.getElementById('cancel-ticket-confirm').addEventListener('click', confirmCancelTicket);
  document.getElementById('cancel-ticket-dismiss').addEventListener('click', hideCancelTicketModal);

  // Forced password change (after login with PASSWORD_CHANGE_REQUIRED)
  document.getElementById('password-change-form').addEventListener('submit', handleForcedPasswordChangeSubmit);

  // Self-service password change (from the sidebar)
  document.getElementById('change-password-btn').addEventListener('click', showChangePasswordModal);
  document.getElementById('change-password-form').addEventListener('submit', handleChangePasswordSubmit);
  document.getElementById('change-password-cancel').addEventListener('click', hideChangePasswordModal);

  // Revoke all sessions (from the sidebar)
  document.getElementById('revoke-sessions-btn').addEventListener('click', showRevokeSessionsModal);
  document.getElementById('revoke-sessions-confirm').addEventListener('click', confirmRevokeSessions);
  document.getElementById('revoke-sessions-cancel').addEventListener('click', hideRevokeSessionsModal);

  // Audit log (admin)
  document.getElementById('audit-apply-filter').addEventListener('click', () => loadAuditLog(1));
  document.getElementById('audit-clear-filter').addEventListener('click', clearAuditFilters);
  document.getElementById('audit-prev-page').addEventListener('click', goToPrevAuditPage);
  document.getElementById('audit-next-page').addEventListener('click', goToNextAuditPage);
}

// ─── PWA: offline app shell ───────────────────
// Only registers over HTTPS or localhost — the browser refuses service
// workers on plain HTTP anywhere else, which matches this project's existing
// HTTPS-in-production stance (see httpsRedirect.js).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}

// ─── Init ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
});
