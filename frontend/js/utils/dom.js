// [FIX 8] Lazy getters — resolve on first access instead of module load time.
// ES modules are deferred, but this is fragile. Getters guarantee DOM is ready.
export const domRefs = {
  get loginScreen() { return document.getElementById('login-screen'); },
  get appScreen() { return document.getElementById('app-screen'); },
  get passwordChangeScreen() { return document.getElementById('password-change-screen'); },
  get loginForm() { return document.getElementById('login-form'); },
  get loginError() { return document.getElementById('login-error'); },
  get logoutBtn() { return document.getElementById('logout-btn'); },
  get navItems() { return document.querySelectorAll('.nav-item'); },
  get pages() { return document.querySelectorAll('.page'); },
};

export function getRoleName(r) { 
  return { ADMIN: 'Administrador', CASHIER: 'Cajero', GUARD: 'Guardia' }[r] || r; 
}

export function toggleHidden(element, hidden) {
  if (element) {
    element.classList.toggle('hidden', hidden);
  }
}
