import { api } from '../api.js';
import { store } from '../store.js';
import { getRoleName } from '../utils/dom.js';
import { formatDate, escapeHtml, skeletonRows } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

export async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = skeletonRows(8);
  try {
    const data = await api('/dashboard/users');
    if (!data.users || !data.users.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No hay usuarios</td></tr>';
      return;
    }
    tbody.innerHTML = data.users.map(u => {
      // An admin cannot touch their own account or another admin's from this
      // panel — otherwise a single click could lock every admin out.
      const locked = u.role === 'ADMIN' || u.id === store.currentUser?.id;
      return `<tr>
      <td>#${u.id}</td>
      <td>
        <span class="user-name-display" id="user-name-${u.id}">${escapeHtml(u.name || '—')}</span>
        <button class="btn-edit-name" data-action="edit-name" data-id="${u.id}" data-name="${escapeHtml(u.name || '')}" title="Editar nombre">✏️</button>
      </td>
      <td>${escapeHtml(u.email)}</td>
      <td>
        <span class="badge badge-${u.role.toLowerCase()}">${getRoleName(u.role)}</span>
        ${locked ? '' : `<button class="btn-edit-name" data-action="edit-role" data-id="${u.id}" data-role="${u.role}" title="Editar rol">✏️</button>`}
      </td>
      <td>
        <span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Activo' : 'Inactivo'}</span>
        ${locked ? '' : `<button class="btn-edit-name" data-action="toggle-active" data-id="${u.id}" data-active="${u.active}" data-email="${escapeHtml(u.email)}" title="${u.active ? 'Desactivar' : 'Reactivar'}">${u.active ? '⛔' : '✅'}</button>`}
      </td>
      <td>${u._count.createdTickets}</td>
      <td>${u._count.scans}</td>
      <td>${formatDate(u.createdAt)}</td>
    </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${err.message}</td></tr>`;
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

// ─── Role editing ────────────────────────────────────────────
export function handleEditRole(userId, currentRole) {
  const modal = document.getElementById('edit-role-modal');
  const select = document.getElementById('edit-role-select');
  const hiddenId = document.getElementById('edit-role-user-id');

  select.value = currentRole;
  hiddenId.value = userId;
  modal.classList.remove('hidden');
}

export async function saveEditRole() {
  const modal = document.getElementById('edit-role-modal');
  const userId = document.getElementById('edit-role-user-id').value;
  const role = document.getElementById('edit-role-select').value;

  try {
    await api(`/dashboard/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    showToast('Rol actualizado', 'success');
    modal.classList.add('hidden');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export function cancelEditRole() {
  document.getElementById('edit-role-modal').classList.add('hidden');
}

// ─── Activate / deactivate ───────────────────────────────────
export function handleToggleActive(userId, currentActive, email) {
  const modal = document.getElementById('toggle-active-modal');
  const body = document.getElementById('toggle-active-modal-body');
  const hiddenId = document.getElementById('toggle-active-user-id');
  const hiddenNext = document.getElementById('toggle-active-next-value');
  const confirmBtn = document.getElementById('toggle-active-confirm');

  const willActivate = currentActive === 'false' || currentActive === false;
  body.textContent = willActivate
    ? `¿Reactivar la cuenta de ${email}?`
    : `¿Desactivar la cuenta de ${email}? No va a poder iniciar sesión hasta que se reactive.`;
  confirmBtn.textContent = willActivate ? 'Sí, reactivar' : 'Sí, desactivar';
  confirmBtn.className = willActivate ? 'btn-primary' : 'btn-danger';

  hiddenId.value = userId;
  hiddenNext.value = willActivate ? 'true' : 'false';
  modal.classList.remove('hidden');
}

export async function confirmToggleActive() {
  const modal = document.getElementById('toggle-active-modal');
  const userId = document.getElementById('toggle-active-user-id').value;
  const active = document.getElementById('toggle-active-next-value').value === 'true';

  try {
    await api(`/dashboard/users/${userId}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    });
    showToast(active ? 'Usuario reactivado' : 'Usuario desactivado', 'success');
    modal.classList.add('hidden');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export function cancelToggleActive() {
  document.getElementById('toggle-active-modal').classList.add('hidden');
}

// ─── Pricing (ADMIN only) ─────────────────────────────────────
export async function loadPricing() {
  try {
    const data = await api('/tickets/pricing');
    document.getElementById('pricing-adult-input').value = data.ADULT_PRICE;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function handleSavePricing(e) {
  e.preventDefault();
  const input = document.getElementById('pricing-adult-input');
  const msgEl = document.getElementById('pricing-msg');
  msgEl.classList.add('hidden');

  try {
    await api('/dashboard/pricing', {
      method: 'PATCH',
      body: JSON.stringify({ adult_price: parseInt(input.value, 10) }),
    });
    showToast('Precio actualizado', 'success');
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
  }
}

// ─── Operating settings: horarios + aforo (ADMIN only) ────────
export async function loadOperatingSettings() {
  try {
    const data = await api('/dashboard/settings');
    document.getElementById('settings-business-name').value = data.business_name || '';
    document.getElementById('settings-hours-start').value = data.operating_hours_start || '';
    document.getElementById('settings-hours-end').value = data.operating_hours_end || '';
    document.getElementById('settings-max-capacity').value = data.max_daily_capacity ?? '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function handleSaveOperatingSettings(e) {
  e.preventDefault();
  const msgEl = document.getElementById('settings-msg');
  msgEl.classList.add('hidden');

  try {
    await api('/dashboard/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        // Empty string means "clear this field" — the backend turns it into
        // null (unrestricted / default), not zero.
        business_name: document.getElementById('settings-business-name').value,
        operating_hours_start: document.getElementById('settings-hours-start').value,
        operating_hours_end: document.getElementById('settings-hours-end').value,
        max_daily_capacity: document.getElementById('settings-max-capacity').value,
      }),
    });
    showToast('Configuración actualizada', 'success');
  } catch (err) {
    msgEl.textContent = err.message;
    msgEl.className = 'error-msg';
    msgEl.classList.remove('hidden');
  }
}
