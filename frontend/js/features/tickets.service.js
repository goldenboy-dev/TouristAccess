import { api } from '../api.js';

export async function fetchTickets(queryParams = '') {
  return await api(`/tickets?${queryParams}`);
}

export async function cancelTicket(id, reason) {
  return await api(`/tickets/${id}/cancel`, { method: 'PATCH', body: JSON.stringify({ reason }) });
}

export async function printThermal(id) {
  return await api(`/tickets/${id}/print-thermal`, { method: 'POST' });
}

export async function regenerateQr(id) {
  return await api(`/tickets/${id}/regenerate-qr`, { method: 'POST' });
}

export async function createTicket(payload) {
  return await api('/tickets', { 
    method: 'POST', 
    body: JSON.stringify(payload) 
  });
}

export async function fetchGroupByCode(operationCode) {
  return await api(`/tickets/group/${operationCode}`);
}

export async function fetchPricing() {
  return await api('/tickets/pricing');
}
