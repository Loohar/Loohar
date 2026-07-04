import { AlertTriangle, Loader2, WifiOff } from "lucide-react";

export function DriverLoading({ label = "Loading deliveries" }) {
  return (
    <div className="driver-state">
      <Loader2 className="animate-spin" size={24} />
      <p>{label}</p>
    </div>
  );
}

export function DriverError({ message }) {
  if (!message) return null;
  return (
    <div className="driver-error">
      <AlertTriangle size={20} />
      <span>{message}</span>
    </div>
  );
}

export function DriverEmpty({ title, detail }) {
  return (
    <div className="driver-empty">
      <p>{title}</p>
      <span>{detail}</span>
    </div>
  );
}

export function DriverOffline() {
  return (
    <div className="driver-offline">
      <WifiOff size={20} />
      <span>Offline mode. Showing saved demo delivery data until the API is reachable.</span>
    </div>
  );
}

export function DriverRestricted({ onLogout }) {
  return (
    <main className="driver-app">
      <section className="driver-login-card">
        <div className="driver-mark">D</div>
        <h1>Driver access only</h1>
        <p>This delivery app is restricted to driver accounts. Restaurant, customer, and admin accounts cannot open driver routes.</p>
        <button className="driver-button" onClick={onLogout}>Use another account</button>
      </section>
    </main>
  );
}
