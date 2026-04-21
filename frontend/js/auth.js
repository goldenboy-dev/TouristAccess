import { api } from './api.js';
import { store, setAuthToken, setCurrentUser } from './store.js';
import { domRefs, getRoleName } from './utils/dom.js';
import { navigateTo } from './main.js';
import { stopScanner } from './features/scanner.js';
import { showToast } from './utils/notifications.js';

export function parseJwt(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

export function handleLogin(userData, token) {
  setAuthToken(token);
  setCurrentUser(userData);
  
  document.getElementById('user-email').textContent = store.currentUser.email;
  document.getElementById('user-role').textContent  = getRoleName(store.currentUser.role);
  document.getElementById('user-avatar').textContent = store.currentUser.email.charAt(0).toUpperCase();

  domRefs.navItems.forEach(item => {
    const roles = item.dataset.roles;
    if (roles) item.classList.toggle('hidden', !roles.split(',').includes(store.currentUser.role));
  });

  domRefs.loginScreen.classList.remove('active');
  domRefs.appScreen.classList.add('active');
  navigateTo(store.currentUser.role === 'GUARD' ? 'validate' : 'dashboard');
}

export function logout() {
  stopScanner();
  setAuthToken(null); 
  setCurrentUser(null);
  
  domRefs.appScreen.classList.remove('active');
  domRefs.loginScreen.classList.add('active');
  domRefs.loginForm.reset();
  domRefs.loginError.classList.add('hidden');
}

export function checkAuth() {
  if (store.authToken) {
    const p = parseJwt(store.authToken);
    if (p && p.exp * 1000 > Date.now()) { 
      handleLogin({ id: p.id, email: p.email, role: p.role }, store.authToken); 
      return; 
    }
    logout();
  }
}

export async function login(email, password) {
  const data = await api('/auth/login', { 
    method: 'POST', 
    body: JSON.stringify({ email, password }) 
  });
  handleLogin(data.user, data.token);
  showToast(`Bienvenido, ${getRoleName(data.user.role)}`, 'success');
}
