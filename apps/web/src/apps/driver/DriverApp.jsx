import { useState } from "react";
import { DriverLogin } from "./components/DriverLogin.jsx";
import { DriverShell } from "./components/DriverShell.jsx";
import { DriverError, DriverLoading, DriverRestricted } from "./components/DriverStates.jsx";
import { useDriverData } from "./hooks/useDriverData.js";
import { useDriverSession } from "./hooks/useDriverSession.js";
import { EarningsPage } from "./pages/EarningsPage.jsx";
import { HistoryPage } from "./pages/HistoryPage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";
import { TodayPage } from "./pages/TodayPage.jsx";
import "./styles.css";

export default function DriverApp({ apiOnline }) {
  const [page, setPage] = useState("today");
  const { authError, authLoading, isAuthorized, login, logout, token, user } = useDriverSession();
  const driverData = useDriverData({ apiOnline, token, authorized: isAuthorized || !apiOnline });

  if (apiOnline && (!token || !user)) {
    return <DriverLogin apiOnline={apiOnline} authError={authError} authLoading={authLoading} login={login} />;
  }

  if (apiOnline && !isAuthorized) {
    return <DriverRestricted onLogout={logout} />;
  }

  function renderPage() {
    if (driverData.loading) return <DriverLoading />;
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
