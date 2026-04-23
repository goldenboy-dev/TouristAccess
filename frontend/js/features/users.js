import { api } from '../api.js';
import { getRoleName } from '../utils/dom.js';
import { formatDate, escapeHtml } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

export async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Cargando...</td></tr>';
  try {
    const data = await api('/dashboard/users');
    if (!data.users || !data.users.length) { 
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No hay usuarios</td></tr>'; 
      return; 
    }
    tbody.innerHTML = data.users.map(u => `<tr>
      <td>#${u.id}</td>
      <td>
        <span class="user-name-display" id="user-name-${u.id}">${escapeHtml(u.name || '—')}</span>
        <button class="btn-edit-name" data-action="edit-name" data-id="${u.id}" data-name="${escapeHtml(u.name || '')}" title="Editar nombre">✏️</button>
      </td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-${u.role.toLowerCase()}">${getRoleName(u.role)}</span></td>
      <td>${u._count.createdTickets}</td>
      <td>${u._count.scans}</td>
      <td>${formatDate(u.createdAt)}</td>
    </tr>`).join('');
  } catch (err) { 
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${err.message}</td></tr>`; 
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
        name:     document.getElementById('reg-name').value.trim(),
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

// ─── Inline name editing ────────────────────────────────────
// [FIX 10] Replaced native prompt() with inline modal — prompt() blocks the thread,
// has no styling, and is disabled on some mobile browsers.
export function handleEditName(userId, currentName) {
  const modal = document.getElementById('edit-name-modal');
  const input = document.getElementById('edit-name-input');
  const hiddenId = document.getElementById('edit-name-user-id');

  input.value = currentName || '';
  hiddenId.value = userId;
  modal.classList.remove('hidden');
  input.focus();
}

// Called from main.js event listeners
export async function saveEditName() {
  const modal = document.getElementById('edit-name-modal');
  const input = document.getElementById('edit-name-input');
  const userId = document.getElementById('edit-name-user-id').value;
  const newName = input.value.trim();

  if (!newName || newName.length < 2) {
    showToast('El nombre debe tener al menos 2 caracteres', 'error');
    return;
  }

  try {
    await api(`/dashboard/users/${userId}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName })
    });
    showToast('Nombre actualizado', 'success');
    modal.classList.add('hidden');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export function cancelEditName() {
  document.getElementById('edit-name-modal').classList.add('hidden');
}
