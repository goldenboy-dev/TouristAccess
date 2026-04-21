import { store } from './store.js';
import { checkAuth, login, logout } from './auth.js';
import { domRefs } from './utils/dom.js';
import { getAudio } from './utils/notifications.js';

// Features
import { loadDashboard } from './features/dashboard.js';
import { loadTickets, initCreateTicketPage, handleCreateTicketSubmit, updatePriceSummary, toggleToken, copyToken, handleCancelTicket } from './features/tickets.view.js';
import { initScanner, stopScanner, handleManualValidate, resetScannerLock } from './features/scanner.js';
import { loadUsers, handleRegister } from './features/users.js';

export function navigateTo(pageId) {
  domRefs.pages.forEach(p => p.classList.remove('active'));
  domRefs.navItems.forEach(n => n.classList.remove('active'));

  const pg  = document.getElementById(`page-${pageId}`);
  const nav = document.querySelector(`[data-page="${pageId}"]`);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');

  if (pageId !== 'validate') stopScanner();

  if (pageId === 'dashboard')     loadDashboard();
  if (pageId === 'tickets')       loadTickets();
  if (pageId === 'users')         loadUsers();
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
      domRefs.loginError.textContent = err.message;
      domRefs.loginError.classList.remove('hidden');
    } finally { 
      btn.disabled = false; 
    }
  });

  domRefs.logoutBtn.addEventListener('click', logout);

  domRefs.navItems.forEach(item => item.addEventListener('click', () => {
    if (item.dataset.page) navigateTo(item.dataset.page);
  }));

  // Tickets Filter setup
  document.getElementById('tickets-refresh-btn').addEventListener('click', loadTickets);
  ['tickets-filter-status','tickets-filter-type','tickets-filter-payment'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadTickets);
  });

  // Ticket creation setup
  document.getElementById('ticket-adults').addEventListener('input', updatePriceSummary);
  document.getElementById('ticket-children').addEventListener('input', updatePriceSummary);
  document.getElementById('create-ticket-form').addEventListener('submit', handleCreateTicketSubmit);
  
  // Event Delegation for Tickets Table (Dynamic HTML)
  document.getElementById('tickets-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    
    const action = btn.dataset.action;
    if (action === 'toggle-token') toggleToken(btn, btn.dataset.token);
    if (action === 'copy-token') copyToken(btn.dataset.token);
    if (action === 'cancel-ticket') handleCancelTicket(btn.dataset.id);
  });

  // Dashboard filter
  document.getElementById('dash-apply-filter').addEventListener('click', loadDashboard);
  document.getElementById('dash-clear-filter').addEventListener('click', () => {
    document.getElementById('dash-date-from').value = '';
    document.getElementById('dash-date-to').value   = '';
    loadDashboard();
  });

  // Validate setup
  document.getElementById('validate-form').addEventListener('submit', handleManualValidate);
  document.getElementById('validate-overlay-close').addEventListener('click', () => {
    document.getElementById('validate-overlay').classList.add('hidden');
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
}

// ─── Init ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkAuth();
});
