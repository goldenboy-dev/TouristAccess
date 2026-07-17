import { api } from '../api.js';
import { domRefs } from '../utils/dom.js';
import { showToast } from '../utils/notifications.js';
import { logout } from '../auth.js';

// Restricted token issued by /auth/login when the password must be rotated.
// Kept in memory only — it scopes to /auth/change-password and must never
// reach localStorage or the normal store.
let forcedChangeToken = null;

function extractErrorMessages(err) {
  if (Array.isArray(err.details)) return err.details.map(d => d.message);
  if (err.details && Array.isArray(err.details.errors)) return err.details.errors;
  return [err.message];
}

function renderErrors(box, messages) {
  box.innerHTML = messages.map(m => `<div>• ${m}</div>`).join('');
  box.classList.remove('hidden');
}

// ─── Forced flow (login returned PASSWORD_CHANGE_REQUIRED) ──
export function showForcedPasswordChange(token, message) {
  forcedChangeToken = token;
  domRefs.loginScreen.classList.remove('active');
  domRefs.passwordChangeScreen.classList.add('active');
  document.getElementById('password-change-message').textContent =
    message || 'Debés cambiar tu contraseña para continuar.';
  document.getElementById('password-change-form').reset();
  document.getElementById('pwd-change-errors').classList.add('hidden');
}

function hideForcedPasswordChange() {
  forcedChangeToken = null;
  domRefs.passwordChangeScreen.classList.remove('active');
  domRefs.loginScreen.classList.add('active');
}

export async function handleForcedPasswordChangeSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('pwd-change-errors');
  errBox.classList.add('hidden');
  errBox.innerHTML = '';

  const currentPassword = document.getElementById('pwd-change-current').value;
  const newPassword = document.getElementById('pwd-change-new').value;
  const confirmPassword = document.getElementById('pwd-change-confirm').value;

  if (newPassword !== confirmPassword) {
    renderErrors(errBox, ['La confirmación no coincide con la nueva contraseña.']);
    return;
  }

  const btn = document.getElementById('pwd-change-btn');
  btn.disabled = true;
  try {
    await api('/auth/change-password', {
      method: 'POST',
      token: forcedChangeToken,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    showToast('Contraseña actualizada. Iniciá sesión con tu nueva contraseña.', 'success');
    hideForcedPasswordChange();
  } catch (err) {
    renderErrors(errBox, extractErrorMessages(err));
  } finally {
    btn.disabled = false;
  }
}

// ─── Self-service flow (logged-in user, from the sidebar) ──
export function showChangePasswordModal() {
  document.getElementById('change-password-form').reset();
  document.getElementById('change-password-errors').classList.add('hidden');
  document.getElementById('change-password-modal').classList.remove('hidden');
}

export function hideChangePasswordModal() {
  document.getElementById('change-password-modal').classList.add('hidden');
}

export async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('change-password-errors');
  errBox.classList.add('hidden');
  errBox.innerHTML = '';

  const currentPassword = document.getElementById('change-password-current').value;
  const newPassword = document.getElementById('change-password-new').value;
  const confirmPassword = document.getElementById('change-password-confirm').value;

  if (newPassword !== confirmPassword) {
    renderErrors(errBox, ['La confirmación no coincide con la nueva contraseña.']);
    return;
  }

  const btn = document.getElementById('change-password-save');
  btn.disabled = true;
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    hideChangePasswordModal();
    showToast('Contraseña actualizada. Iniciá sesión nuevamente.', 'success');
    await logout();
  } catch (err) {
    renderErrors(errBox, extractErrorMessages(err));
  } finally {
    btn.disabled = false;
  }
}
