import { Clock3, History, LogOut, Settings, WalletCards } from "lucide-react";
import { DriverOffline } from "./DriverStates.jsx";

const navItems = [
  { id: "today", label: "Today", icon: Clock3 },
  { id: "earnings", label: "Earnings", icon: WalletCards },
  { id: "history", label: "History", icon: History },
  { id: "profile", label: "Profile", icon: Settings }
];

export function DriverShell({ apiOnline, currentPage, driver, onNavigate, onToggleAvailability, onLogout, children }) {
  return (
    <main className="driver-app">
      <header className="driver-header">
        <div>
          <span>Driver Delivery</span>
          <h1>{driver?.user?.name || "Driver"}</h1>
        </div>
        <button className={driver?.available ? "driver-availability on" : "driver-availability"} onClick={onToggleAvailability}>
          {driver?.available ? "Available" : "Unavailable"}
        </button>
      </header>
      {!apiOnline ? <DriverOffline /> : null}
      <section className="driver-content">{children}</section>
      <nav className="driver-bottom-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button className={currentPage === id ? "active" : ""} key={id} onClick={() => onNavigate(id)}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
        <button onClick={onLogout}>
          <LogOut size={20} />
          <span>Logout</span>
        </button>
      </nav>
    </main>
  );
}
