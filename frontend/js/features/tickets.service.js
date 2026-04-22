import { api } from '../api.js';

export async function fetchTickets(queryParams = '') {
  return await api(`/tickets?${queryParams}`);
}

export async function cancelTicket(id) {
  return await api(`/tickets/${id}/cancel`, { method: 'PATCH' });
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
