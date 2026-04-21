import { api } from '../api.js';
import { getRoleName } from '../utils/dom.js';
import { formatDate, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

export async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Cargando...</td></tr>';
  try {
    const data = await api('/dashboard/users');
    if (!data.users || !data.users.length) { 
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No hay usuarios</td></tr>'; 
      return; 
    }
    tbody.innerHTML = data.users.map(u => `<tr>
      <td>#${u.id}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-${u.role.toLowerCase()}">${getRoleName(u.role)}</span></td>
      <td>${u._count.createdTickets}</td>
      <td>${u._count.scans}</td>
      <td>${formatDate(u.createdAt)}</td>
    </tr>`).join('');
  } catch (err) { 
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${err.message}</td></tr>`; 
  }
}

export async function handleRegister(e) {
  e.preventDefault();
  const msgEl = document.getElementById('register-msg');
  msgEl.classList.add('hidden');
  try {
    await api('/auth/register', { 
      method: 'POST', 
      body: JSON.stringify({
        email:    document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-password').value,
        role:     document.getElementById('reg-role').value
      })
    });
    
    showToast('Usuario registrado', 'success');
    document.getElementById('register-form').reset();
    document.getElementById('register-form-container').classList.add('hidden');
    loadUsers();
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
  }
}
