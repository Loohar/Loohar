export const POS_CONNECTION_STATE = Object.freeze({
  CONNECTING: "CONNECTING",
  RECONNECTING: "RECONNECTING",
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR"
});

export const POS_CONFIG_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR"
});

export const POS_STARTUP_FAILURE = Object.freeze({
  NETWORK: "NETWORK_FAILURE",
  SERVER: "SERVER_FAILURE",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  AUTH_FORBIDDEN: "AUTH_FORBIDDEN",
  CONFIGURATION: "CONFIGURATION_ERROR"
});

export function classifyPosStartupError(error) {
  const code = String(error?.payload?.code || error?.code || "");
  const status = Number(error?.status || error?.payload?.status || 0);
  if (status === 401) return POS_STARTUP_FAILURE.AUTH_EXPIRED;
  if (status === 403) return POS_STARTUP_FAILURE.AUTH_FORBIDDEN;
  if (status >= 500 || [408, 425, 429].includes(status)) return POS_STARTUP_FAILURE.SERVER;
  if (code === "API_REQUEST_TIMEOUT" || (!status && ["AbortError", "NetworkError", "TimeoutError", "TypeError"].includes(String(error?.name || "")))) {
    return POS_STARTUP_FAILURE.NETWORK;
  }
  return POS_STARTUP_FAILURE.CONFIGURATION;
}

export function isTransientPosStartupError(error) {
  return [POS_STARTUP_FAILURE.NETWORK, POS_STARTUP_FAILURE.SERVER].includes(classifyPosStartupError(error));
}

export function isAuthoritativePosConfig(payload) {
  return Boolean(
    payload
    && typeof payload === "object"
    && payload.restaurant?.id
    && Object.prototype.hasOwnProperty.call(payload, "device")
    && Object.prototype.hasOwnProperty.call(payload, "shift")
    && Array.isArray(payload.locations)
    && Array.isArray(payload.cashDrawers)
    && Array.isArray(payload.permissions)
    && payload.pinStatus
    && typeof payload.pinStatus === "object"
  );
}

export function posRegisterSnapshotStorageKey(restaurantKey) {
  return `loohar-pos-register-snapshot:${String(restaurantKey || "unknown")}`;
}

export function loadPosRegisterSnapshot(restaurantKey, storage) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return null;
    const parsed = JSON.parse(target.getItem(posRegisterSnapshotStorageKey(restaurantKey)) || "null");
    if (!parsed || typeof parsed !== "object" || !parsed.deviceName) return null;
    return {
      restaurantName: String(parsed.restaurantName || ""),
      deviceName: String(parsed.deviceName || ""),
      locationName: String(parsed.locationName || ""),
      shiftStatus: ["OPEN", "CLOSED"].includes(parsed.shiftStatus) ? parsed.shiftStatus : "",
      updatedAt: String(parsed.updatedAt || "")
    };
  } catch {
    return null;
  }
}

export function savePosRegisterSnapshot(restaurantKey, config, storage) {
  if (!isAuthoritativePosConfig(config)) return null;
  try {
    const target = storage || globalThis.localStorage;
    if (!target) return null;
    const key = posRegisterSnapshotStorageKey(restaurantKey);
    if (!config.device?.id) {
      target.removeItem(key);
      return null;
    }
    const location = config.locations.find((row) => row.id === config.device.locationId) || config.locations[0];
    const snapshot = {
      restaurantName: String(config.restaurant?.name || ""),
      deviceName: String(config.device.name || "Register"),
      locationName: String(location?.name || ""),
      shiftStatus: String(config.shift?.status || ""),
      updatedAt: new Date().toISOString()
    };
    target.setItem(key, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

export function posStartupDisplay({ apiMode, apiOnline, configState, connectionFailed, reconnecting = false, failureKind = "", device, location, shift, lastKnownRegister }) {
  let state = POS_CONNECTION_STATE.CONNECTING;
  if (reconnecting || apiMode === "RECONNECTING") state = POS_CONNECTION_STATE.RECONNECTING;
  else if (apiMode === "CHECKING" && !connectionFailed) state = POS_CONNECTION_STATE.CONNECTING;
  else if (!apiOnline || connectionFailed) state = POS_CONNECTION_STATE.OFFLINE;
  else if (configState === POS_CONFIG_STATE.ERROR) state = POS_CONNECTION_STATE.CONFIGURATION_ERROR;
  else if (configState === POS_CONFIG_STATE.READY) state = POS_CONNECTION_STATE.ONLINE;
  else if (apiMode !== "CHECKING") state = POS_CONNECTION_STATE.CONNECTING;

  const configResolved = configState === POS_CONFIG_STATE.READY;
  const knownDeviceName = device?.name || lastKnownRegister?.deviceName || "";
  const knownLocationName = location?.name || lastKnownRegister?.locationName || "";
  const knownShiftStatus = shift?.status || lastKnownRegister?.shiftStatus || "";
  const labels = {
    [POS_CONNECTION_STATE.CONNECTING]: "Connecting to Loohar...",
    [POS_CONNECTION_STATE.RECONNECTING]: "Reconnecting...",
    [POS_CONNECTION_STATE.ONLINE]: "Online",
    [POS_CONNECTION_STATE.OFFLINE]: "Offline",
    [POS_CONNECTION_STATE.CONFIGURATION_ERROR]: failureKind === POS_STARTUP_FAILURE.AUTH_FORBIDDEN ? "Access forbidden" : "Configuration error"
  };

  return {
    state,
    connectionLabel: labels[state],
    connectionClass: state === POS_CONNECTION_STATE.ONLINE
      ? "online"
      : [POS_CONNECTION_STATE.CONNECTING, POS_CONNECTION_STATE.RECONNECTING].includes(state)
        ? "connecting"
        : state === POS_CONNECTION_STATE.CONFIGURATION_ERROR
          ? "configuration-error"
          : "offline",
    registerLabel: knownDeviceName || (configResolved ? "Register not configured" : "Loading register..."),
    locationLabel: knownLocationName || (configResolved ? "Location unavailable" : "Loading location..."),
    shiftLabel: knownShiftStatus === "OPEN" ? "Shift open" : knownShiftStatus === "CLOSED" || configResolved ? "Shift closed" : "Checking shift...",
    isOnline: state === POS_CONNECTION_STATE.ONLINE
  };
}
