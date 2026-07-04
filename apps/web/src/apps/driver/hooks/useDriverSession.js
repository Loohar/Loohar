import { useEffect, useState } from "react";
import { clearSession, getStoredSession, isDriver, storeSession } from "../../../shared/auth.js";
import { loginDriver } from "../services/driverApi.js";

export function useDriverSession() {
  const [session, setSession] = useState(() => getStoredSession());
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    if (session.user && !isDriver(session.user)) {
      setAuthError("This app is only for delivery drivers.");
    }
  }, [session.user]);

  async function login(credentials) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const payload = await loginDriver(credentials);
      if (!isDriver(payload.user)) {
        clearSession();
        setSession({ token: "", user: null });
        setAuthError("Use a driver account to open the delivery app.");
        return;
      }
      storeSession(payload);
      setSession({ token: payload.accessToken, user: payload.user });
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    clearSession();
    setSession({ token: "", user: null });
    setAuthError("");
  }

  return {
    token: session.token,
    user: session.user,
    isAuthorized: isDriver(session.user),
    authError,
    authLoading,
    login,
    logout
  };
}
