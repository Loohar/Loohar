export const POS_CONNECTION_STATE = Object.freeze({
  CONNECTING: "CONNECTING",
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR"
});

export const POS_CONFIG_STATE = Object.freeze({
  LOADING: "LOADING",
  READY: "READY",
  ERROR: "ERROR"
});

export function posStartupDisplay({ apiMode, apiOnline, configState, connectionFailed, device, shift }) {
  let state = POS_CONNECTION_STATE.CONNECTING;
  if (!apiOnline || connectionFailed) state = POS_CONNECTION_STATE.OFFLINE;
  else if (configState === POS_CONFIG_STATE.ERROR) state = POS_CONNECTION_STATE.CONFIGURATION_ERROR;
  else if (configState === POS_CONFIG_STATE.READY) state = POS_CONNECTION_STATE.ONLINE;
  else if (apiMode !== "CHECKING") state = POS_CONNECTION_STATE.CONNECTING;

  const configResolved = configState === POS_CONFIG_STATE.READY;
  const labels = {
    [POS_CONNECTION_STATE.CONNECTING]: "Connecting to Loohar...",
    [POS_CONNECTION_STATE.ONLINE]: "Online",
    [POS_CONNECTION_STATE.OFFLINE]: "Offline",
    [POS_CONNECTION_STATE.CONFIGURATION_ERROR]: "Configuration error"
  };

  return {
    state,
    connectionLabel: labels[state],
    connectionClass: state === POS_CONNECTION_STATE.ONLINE
      ? "online"
      : state === POS_CONNECTION_STATE.CONNECTING
        ? "connecting"
        : state === POS_CONNECTION_STATE.CONFIGURATION_ERROR
          ? "configuration-error"
          : "offline",
    registerLabel: device?.name || (configResolved ? "Register not configured" : "Loading register..."),
    shiftLabel: shift?.status === "OPEN" ? "Shift open" : configResolved ? "Shift closed" : "Checking shift...",
    isOnline: state === POS_CONNECTION_STATE.ONLINE
  };
}
