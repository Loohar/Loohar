import { useEffect, useMemo, useState } from "react";
import { fallbackDeliveries, fallbackDriver, fallbackEarnings, fallbackHistory } from "../data.js";
import {
  acceptDelivery,
  getAssignedDeliveries,
  getDeliveryHistory,
  getDriverEarnings,
  getDriverMe,
  setDriverAvailability,
  updateDeliveryStatus
} from "../services/driverApi.js";
import { isActiveDelivery } from "../utils/status.js";

export function useDriverData({ apiOnline, token, authorized }) {
  const [driver, setDriver] = useState(fallbackDriver);
  const [deliveries, setDeliveries] = useState(fallbackDeliveries);
  const [history, setHistory] = useState(fallbackHistory);
  const [earnings, setEarnings] = useState(fallbackEarnings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeDelivery = useMemo(() => deliveries.find(isActiveDelivery) || null, [deliveries]);

  async function loadDriverData() {
    if (!apiOnline) {
      setDriver(fallbackDriver);
      setDeliveries(fallbackDeliveries);
      setHistory(fallbackHistory);
      setEarnings(fallbackEarnings);
      return;
    }
    if (!token || !authorized) return;
    setLoading(true);
    setError("");
    try {
      const [mePayload, deliveryPayload, historyPayload, earningsPayload] = await Promise.all([
        getDriverMe(token),
        getAssignedDeliveries(token),
        getDeliveryHistory(token),
        getDriverEarnings(token)
      ]);
      setDriver(mePayload.driver);
      setDeliveries(deliveryPayload.deliveries || []);
      setHistory(historyPayload.deliveries || []);
      setEarnings(earningsPayload);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDriverData();
  }, [apiOnline, token, authorized]);

  async function toggleAvailability() {
    const next = !driver.available;
    setDriver((current) => ({ ...current, available: next }));
    if (!apiOnline || !token) return;
    try {
      const payload = await setDriverAvailability(token, next);
      setDriver((current) => ({ ...current, ...payload.driver }));
    } catch (availabilityError) {
      setError(availabilityError.message);
    }
  }

  async function acceptAssignedDelivery(deliveryId) {
    if (!apiOnline) {
      setDeliveries((current) => current.map((delivery) => delivery.id === deliveryId ? { ...delivery, status: "ACCEPTED" } : delivery));
      return;
    }
    try {
      await acceptDelivery(token, deliveryId);
      await loadDriverData();
    } catch (acceptError) {
      setError(acceptError.message);
    }
  }

  async function setDeliveryStatus(deliveryId, status) {
    if (!apiOnline) {
      setDeliveries((current) => current.map((delivery) => delivery.id === deliveryId ? { ...delivery, status } : delivery));
      return;
    }
    try {
      await updateDeliveryStatus(token, deliveryId, status);
      await loadDriverData();
    } catch (statusError) {
      setError(statusError.message);
    }
  }

  return {
    activeDelivery,
    deliveries,
    driver,
    earnings,
    error,
    history,
    loading,
    acceptAssignedDelivery,
    loadDriverData,
    setDeliveryStatus,
    toggleAvailability
  };
}
