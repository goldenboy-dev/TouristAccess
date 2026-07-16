export function formatDate(s) {
  return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Today as YYYY-MM-DD in the user's timezone — the value an <input type="date">
 * expects, and the calendar day the backend reasons about.
 *
 * NOT toISOString(): that returns the UTC day, so after 21:00 in Paraguay it
 * says "tomorrow". The cashier would sell tickets dated for the next day (the
 * guard rejects them) and the fraud panel would open on an empty day.
 */
export function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getStatusName(s) { 
  return { ACTIVE: 'Activo', USED: 'Usado', CANCELLED: 'Cancelado' }[s] || s; 
}

export function getPaymentIcon(m) { 
  return { CASH: '💵', TRANSFER: '🏦', QR: '📱', CARD: '💳' }[m] || ''; 
}

export function getVisitorTypeName(t) {
  return { ADULT: 'Adulto', CHILD: 'Niño', LOCAL: 'Residente Local' }[t] || t;
}

export function getVisitorTypeClass(t) {
  return { ADULT: 'badge-adult', CHILD: 'badge-child', LOCAL: 'badge-local' }[t] || '';
}

export function escapeHtml(str) { 
  if (!str) return '';
  const d = document.createElement('div'); 
  d.textContent = str; 
  return d.innerHTML; 
}
