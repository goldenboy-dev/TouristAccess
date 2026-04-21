import { API_URL } from './config.js';
import { store } from './store.js';

export async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (store.authToken) headers['Authorization'] = `Bearer ${store.authToken}`;
  
  const res  = await fetch(`${API_URL}${endpoint}`, { 
    ...options, 
    headers: { ...headers, ...options.headers } 
  });
  
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Error en la solicitud');
  return data;
}
