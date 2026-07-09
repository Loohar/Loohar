import { useEffect, useState } from "react";
import { DriverLogin } from "./components/DriverLogin.jsx";
import { DriverShell } from "./components/DriverShell.jsx";
import { DriverError, DriverLoading, DriverRestricted } from "./components/DriverStates.jsx";
import { useDriverData } from "./hooks/useDriverData.js";
import { useDriverSession } from "./hooks/useDriverSession.js";
import { EarningsPage } from "./pages/EarningsPage.jsx";
import { HistoryPage } from "./pages/HistoryPage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { TodayPage } from "./pages/TodayPage.jsx";
import { claimDriverOrder, getDriverOrder, updateDriverOrderStatus } from "./services/driverApi.js";
import { deliveryStatuses, formatStatus, money } from "./utils/status.js";
import "./styles.css";

function scannedOrderId() {
  const match = window.location.pathname.match(/^\/(?:driver\/)?order\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function DriverOrderClaimPage({ token, orderId, onClaimed }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadOrder() {
    setLoading(true);
    setError("");
    try {
      const next = await getDriverOrder(token, orderId);
      setPayload(next);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function claimOrder() {
    setError("");
    try {
      const next = await claimDriverOrder(token, orderId);
      setPayload((current) => ({ ...current, delivery: next.delivery, claimable: true }));
      onClaimed?.();
    } catch (claimError) {
      setError(claimError.message);
    }
  }

  async function updateStatus(status) {
    setError("");
    try {
      const next = await updateDriverOrderStatus(token, orderId, status);
      setPayload((current) => ({ ...current, delivery: next.delivery }));
      onClaimed?.();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  useEffect(() => {
    loadOrder();
  }, [token, orderId]);

  if (loading) return <DriverLoading />;
  const order = payload?.order || payload?.delivery?.order;
  const delivery = payload?.delivery;
  return (
    <div className="driver-page">
      {error ? <div className="driver-error">{error}</div> : null}
      <section className="driver-delivery-card">
        <div className="driver-card-head">
          <div>
            <span>Scanned delivery</span>
            <h2>#{order?.orderNumber || orderId}</h2>
          </div>
          <strong>{money((delivery?.baseEarningsCents || 0) + (delivery?.tipCents || order?.driverTipCents || order?.tipCents || 0))}</strong>
        </div>
        <div className="driver-stop">
          <strong>Pickup</strong>
          <p>{order?.restaurant?.businessName || order?.restaurant?.name}</p>
          <p>{delivery?.pickupAddress || order?.restaurant?.address}</p>
        </div>
        <div className="driver-stop">
          <strong>Dropoff</strong>
          <p>{order?.customer?.name || "Customer"}</p>
          <p>{delivery?.dropoffAddress || order?.deliveryAddress}</p>
        </div>
        {delivery ? <p className="driver-status-note">Current status: {formatStatus(delivery.status)}</p> : null}
        {!delivery?.driverId ? <button className="driver-button" onClick={claimOrder}>Accept delivery</button> : null}
        {delivery?.driverId ? (
          <div className="driver-status-grid">
            {deliveryStatuses.map((status) => (
              <button key={status.value} className={delivery.status === status.value ? "active" : ""} onClick={() => updateStatus(status.value)}>
                {status.label}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function DriverApp({ apiOnline }) {
  const [page, setPage] = useState("today");
  const orderId = scannedOrderId();
  const { authError, authLoading, isAuthorized, login, loginDemo, logout, token, user } = useDriverSession();
  const driverData = useDriverData({ apiOnline, token, authorized: isAuthorized || !apiOnline });

  if (apiOnline && (!token || !user)) {
    return <DriverLogin apiOnline={apiOnline} authError={authError} authLoading={authLoading} login={login} loginDemo={loginDemo} />;
  }

  if (apiOnline && !isAuthorized) {
    return <DriverRestricted onLogout={logout} />;
  }

  function renderPage() {
    if (driverData.loading) return <DriverLoading />;
    if (orderId && apiOnline) return <DriverOrderClaimPage token={token} orderId={orderId} onClaimed={driverData.loadDriverData} />;
    if (page === "earnings") return <EarningsPage earnings={driverData.earnings} />;
    if (page === "history") return <HistoryPage history={driverData.history} />;
    if (page === "profile") return <ProfilePage driver={driverData.driver} />;
    return (
      <TodayPage
        activeDelivery={driverData.activeDelivery}
        deliveries={driverData.deliveries}
        earnings={driverData.earnings}
        onAccept={driverData.acceptAssignedDelivery}
        onUpdate={driverData.setDeliveryStatus}
      />
    );
  }

  return (
    <DriverShell
      apiOnline={apiOnline}
      currentPage={page}
      driver={driverData.driver}
      onLogout={logout}
      onNavigate={setPage}
      onToggleAvailability={driverData.toggleAvailability}
    >
      <DriverError message={authError || driverData.error} />
      {renderPage()}
    </DriverShell>
  );
}
