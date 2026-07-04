const ACCESS_TOKEN_KEY = "accessToken";
const USER_KEY = "user";

export function getStoredSession() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  const storedUser = localStorage.getItem(USER_KEY);
  return {
    token,
    user: storedUser ? JSON.parse(storedUser) : null
  };
}

export function storeSession({ accessToken, user }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isDriver(user) {
  return user?.role === "DRIVER";
}
