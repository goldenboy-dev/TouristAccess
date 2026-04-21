export const domRefs = {
  loginScreen: document.getElementById('login-screen'),
  appScreen: document.getElementById('app-screen'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
  navItems: document.querySelectorAll('.nav-item'),
  pages: document.querySelectorAll('.page'),
};

export function getRoleName(r) { 
  return { ADMIN: 'Administrador', CASHIER: 'Cajero', GUARD: 'Guardia' }[r] || r; 
}

export function toggleHidden(element, hidden) {
  if (element) {
    element.classList.toggle('hidden', hidden);
  }
}
