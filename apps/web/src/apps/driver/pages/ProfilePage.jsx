import { Phone, ShieldCheck } from "lucide-react";

export function ProfilePage({ driver }) {
  return (
    <div className="driver-page">
      <section className="driver-profile-card">
        <div className="driver-avatar">{driver?.user?.name?.slice(0, 1) || "D"}</div>
        <h2>{driver?.user?.name || "Driver"}</h2>
        <p>{driver?.user?.email}</p>
        {driver?.user?.phone ? <a href={`tel:${driver.user.phone}`}><Phone size={16} />{driver.user.phone}</a> : null}
      </section>
      <section className="driver-settings-card">
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>Secure driver access</strong>
            <span>Only assigned deliveries are visible in this app.</span>
          </div>
        </div>
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>Mobile ready</strong>
            <span>This PWA is structured for a future React Native or Expo app.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
