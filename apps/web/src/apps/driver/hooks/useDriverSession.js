import { useEffect, useState } from "react";
import { AUTH_EXPIRED_EVENT, AUTH_SESSION_UPDATED_EVENT, clearSession, getStoredSession, isDriver, storeSession } from "../../../shared/auth.js";
import { demoLoginDriver, loginDriver } from "../services/driverApi.js";

export function useDriverSession() {
  const [session, setSession] = useState(() => getStoredSession());
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    if (session.user && !isDriver(session.user)) {
      setAuthError("This app is only for delivery drivers.");
    }
  }, [session.user]);

  useEffect(() => {
    function handleSessionUpdated(event) {
      setSession(event.detail?.session || getStoredSession());
    }

    function handleSessionExpired() {
      setSession({ token: "", refreshToken: "", user: null });
      setAuthError("");
    }

    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, handleSessionUpdated);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, handleSessionUpdated);
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  async function login(credentials) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const payload = await loginDriver(credentials);
      if (!isDriver(payload.user)) {
        clearSession("driver_role_forbidden");
        setSession({ token: "", user: null });
        setAuthError("Use a driver account to open the delivery app.");
        return;
      }
      setSession(storeSession(payload));
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loginDemo() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const payload = await demoLoginDriver();
      if (!isDriver(payload.user)) {
        clearSession("driver_demo_unavailable");
        setSession({ token: "", user: null });
        setAuthError("Seeded development driver account is unavailable.");
        return;
      }
      setSession(storeSession(payload));
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    clearSession("driver_logout");
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
    loginDemo,
    logout
  };
}
