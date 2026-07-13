import { LogIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DriverLogin({ authError, authLoading, login, loginDemo, apiOnline }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const userEditedCredentials = useRef(false);
  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  function clearLoginFields() {
    setEmail("");
    setPassword("");
    if (emailInputRef.current) emailInputRef.current.value = "";
    if (passwordInputRef.current) passwordInputRef.current.value = "";
  }

  function markCredentialEntry() {
    userEditedCredentials.current = true;
  }

  useEffect(() => {
    userEditedCredentials.current = false;
    clearLoginFields();
    const clearIfUntouched = () => {
      if (!userEditedCredentials.current) {
        clearLoginFields();
      }
    };
    window.addEventListener("pageshow", clearIfUntouched);
    const timers = [80, 400, 1200].map((delay) => window.setTimeout(clearIfUntouched, delay));
    return () => {
      window.removeEventListener("pageshow", clearIfUntouched);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function submit(event) {
    event.preventDefault();
    login({ email, password });
    setPassword("");
  }

  function submitDemoLogin() {
    userEditedCredentials.current = false;
    clearLoginFields();
    loginDemo();
  }

  return (
    <main className="driver-app">
      <section className="driver-login-card">
        <div className="driver-mark">D</div>
        <h1>Driver Delivery</h1>
        <p>Sign in to view assigned deliveries, update statuses, and track tips.</p>
        {!apiOnline ? <div className="driver-offline">API offline. Login is disabled, demo mode is available inside the SaaS shell.</div> : null}
        <form className="driver-login-form" onSubmit={submit}>
          <label>
            Email
            <input
              ref={emailInputRef}
              value={email}
              onKeyDown={markCredentialEntry}
              onPaste={markCredentialEntry}
              onDrop={markCredentialEntry}
              onChange={(event) => {
                markCredentialEntry();
                setEmail(event.target.value);
              }}
              type="email"
              name="username"
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              ref={passwordInputRef}
              value={password}
              onKeyDown={markCredentialEntry}
              onPaste={markCredentialEntry}
              onDrop={markCredentialEntry}
              onChange={(event) => {
                markCredentialEntry();
                setPassword(event.target.value);
              }}
              type="password"
              name="current-password"
              autoComplete="current-password"
            />
          </label>
          {authError ? <div className="driver-error">{authError}</div> : null}
          <button className="driver-button" disabled={authLoading || !apiOnline} type="submit">
            <LogIn size={20} />
            {authLoading ? "Signing in" : "Sign in"}
          </button>
          {import.meta.env.DEV ? <button className="driver-button secondary" disabled={authLoading || !apiOnline} type="button" onClick={submitDemoLogin}>Use seeded development account</button> : null}
        </form>
      </section>
    </main>
  );
}
