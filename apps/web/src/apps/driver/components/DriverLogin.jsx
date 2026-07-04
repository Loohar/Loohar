import { LogIn } from "lucide-react";
import { useState } from "react";

export function DriverLogin({ authError, authLoading, login, apiOnline }) {
  const [email, setEmail] = useState("driver@demobistro.local");
  const [password, setPassword] = useState("Driver123!");

  function submit(event) {
    event.preventDefault();
    login({ email, password });
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
            <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {authError ? <div className="driver-error">{authError}</div> : null}
          <button className="driver-button" disabled={authLoading || !apiOnline} type="submit">
            <LogIn size={20} />
            {authLoading ? "Signing in" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
