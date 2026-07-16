// Same protocol as the page: hardcoding http:// breaks under HTTPS (mixed
// content gets blocked by the browser) once the frontend is served over TLS.
export const API_BASE_URL = `${location.protocol}//${location.hostname}:3000`;
export const API_URL = `${API_BASE_URL}/api`;
console.log("API configurada en:", API_URL);
