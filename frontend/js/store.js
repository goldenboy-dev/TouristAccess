export const store = {
  authToken: localStorage.getItem('tourist_token') || null,
  currentUser: null,
  html5QrcodeScanner: null,
};

export function setAuthToken(token) {
  store.authToken = token;
  if (token) {
    localStorage.setItem('tourist_token', token);
  } else {
    localStorage.removeItem('tourist_token');
  }
}

export function setCurrentUser(user) {
  store.currentUser = user;
}

export function setScanner(scanner) {
  store.html5QrcodeScanner = scanner;
}
