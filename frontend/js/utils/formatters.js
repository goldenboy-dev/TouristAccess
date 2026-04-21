export function formatDate(s) {
  return new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function getStatusName(s) { 
  return { ACTIVE: 'Activo', USED: 'Usado', CANCELLED: 'Cancelado' }[s] || s; 
}

export function getPaymentIcon(m) { 
  return { CASH: '💵', TRANSFER: '🏦', QR: '📱', CARD: '💳' }[m] || ''; 
}

export function escapeHtml(str) { 
  if (!str) return '';
  const d = document.createElement('div'); 
  d.textContent = str; 
  return d.innerHTML; 
}
