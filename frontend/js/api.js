import { API_URL } from './config.js';
import { store, setAuthToken, setRefreshToken } from './store.js';
import { showToast } from './utils/notifications.js';

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.map(cb => cb(token));
  refreshSubscribers = [];
}

/**
 * Enhanced fetch wrapper with auto-refresh logic.
 * If a request fails with 401 and code TOKEN_EXPIRED, it attempts to
 * swap the refreshToken for a new pair and retries the original request.
 */
export async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  // `options.token` overrides the stored session token — used for the
  // restricted password-change token, which is never written to the store.
  const bearer = options.token || store.authToken;
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  let res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  let data = await res.json();

  // If token expired, try to refresh
  if (res.status === 401 && data.code === 'TOKEN_EXPIRED' && store.refreshToken) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: store.refreshToken })
        });

        const refreshData = await refreshRes.json();

        if (refreshRes.ok) {
          setAuthToken(refreshData.accessToken);
          setRefreshToken(refreshData.refreshToken);
          isRefreshing = false;
          onRefreshed(refreshData.accessToken);
        } else {
          // Refresh failed (revoked/expired) -> Force logout
          isRefreshing = false;
          window.dispatchEvent(new CustomEvent('auth-failure'));
          throw new Error('Sesión expirada');
        }
      } catch (err) {
        isRefreshing = false;
        window.dispatchEvent(new CustomEvent('auth-failure'));
        throw err;
      }
    }

    // Queue requests while refreshing
    const retryOriginalRequest = new Promise(resolve => {
      subscribeTokenRefresh(token => {
        // Re-run the fetch with the new token
        const newHeaders = { ...headers, ...options.headers, 'Authorization': `Bearer ${token}` };
        resolve(fetch(`${API_URL}${endpoint}`, { ...options, headers: newHeaders }).then(r => r.json()));
      });
    });

    return retryOriginalRequest;
  }

  if (!res.ok) {
    const err = new Error(data.error || data.message || 'Error en la solicitud');
    err.code = data.code;
    // `errorHandler` (backend) merges AppError.details flat into the body
    // (retryAfterMinutes, attemptsLeft, errors) instead of nesting them under
    // `details` — only the Zod validation path (validate.js) actually nests
    // as `data.details`. Keep the whole body so callers can read either shape.
    err.details = data.details;
    err.data = data;

    // HTTPS_REQUIRED can surface from any endpoint (mixed-content/misconfigured
    // reverse proxy), not just the form that happened to trigger it — surface
    // it globally instead of requiring every call site to special-case it.
    if (data.code === 'HTTPS_REQUIRED') showToast(err.message, 'error');

    throw err;
  }
  return data;
}
