export function getNavigationUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function normalizeLocationUpdate({ lat, lng }) {
  return { lat: Number(lat), lng: Number(lng), receivedAt: new Date().toISOString() };
}

