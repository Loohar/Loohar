// Tells an installed Loohar app that a newer build is available to download.
//
// Loohar distributes its Android apps directly rather than through a store, so nothing tells a
// restaurant that a new version exists. Without this, a till keeps running a build from months ago
// and nobody knows — including the restaurant, who would have no way to find out.
//
// The app compares itself with the manifest published beside each APK at loohar.com/download. There
// is no auto-install: Android will not let an app replace itself silently, and it should not. The
// most this does is say a newer version exists and open the download.
//
// Three rules this follows, in order of importance:
//
//   1. It must never interrupt service. A till mid-order does not care about a new version. Every
//      failure is swallowed, the check is never awaited by anything on screen, and the result is
//      only ever a dismissible notice.
//   2. It must never claim an update that is not newer. Comparing versionCode numerically is the
//      only ordering Android itself honours.
//   3. It must not chatter. One check per interval, remembered across launches.

export const UPDATE_MANIFESTS = Object.freeze({
  "com.loohar.pos": "loohar-pos.apk",
  "com.loohar.driver": "loohar-driver.apk",
  "com.loohar.restaurant": "loohar-restaurant.apk"
});

export const DOWNLOAD_ORIGIN = "https://loohar.com";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = "loohar_update_last_check";
const DISMISSED_KEY = "loohar_update_dismissed_code";

// Digits only, deliberately. Number.parseInt("1.2.3") is 1 and Number.parseInt("12abc") is 12, so
// parsing alone would read a malformed version as a plausible one and could offer an "update" that
// is really a downgrade. An Android versionCode is an integer and nothing else.
function asVersionCode(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// Deliberately strict. An unreadable version on either side means "do not claim an update": telling
// someone to reinstall what they already have wastes their time and costs trust in the notice.
export function updateAvailable(installed, published) {
  const mine = asVersionCode(installed?.versionCode);
  const theirs = asVersionCode(published?.versionCode);
  if (mine === null || theirs === null) return false;
  if (theirs <= mine) return false;
  // A published build for a different app is not an update to this one.
  if (installed?.package && published?.package && installed.package !== published.package) return false;
  // Never offer a build made for another environment: it would point the till at the wrong API.
  if (installed?.environment && published?.environment && installed.environment !== published.environment) return false;
  return true;
}

function readStorage(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Storage throws in some privacy modes. A forgotten timestamp only means one extra check.
    return null;
  }
}
function writeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* not worth reporting */
  }
}

export function dueForCheck(now = Date.now(), lastCheck = readStorage(LAST_CHECK_KEY)) {
  const previous = Number.parseInt(String(lastCheck ?? ""), 10);
  if (!Number.isFinite(previous)) return true;
  return now - previous >= CHECK_INTERVAL_MS;
}

export function dismissUpdate(versionCode) {
  writeStorage(DISMISSED_KEY, String(versionCode));
}
export function isDismissed(versionCode) {
  return readStorage(DISMISSED_KEY) === String(versionCode);
}

export function downloadUrlFor(packageName) {
  const file = UPDATE_MANIFESTS[packageName];
  return file ? `${DOWNLOAD_ORIGIN}/download/${file}` : `${DOWNLOAD_ORIGIN}/download`;
}

/**
 * Returns the published build when it is newer than the installed one, otherwise null.
 * Never throws: every failure path returns null, because a failed update check must not surface
 * to someone serving customers.
 */
export async function checkForUpdate({
  installed,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  force = false
} = {}) {
  try {
    if (!installed?.package || !UPDATE_MANIFESTS[installed.package]) return null;
    if (!force && !dueForCheck(now)) return null;

    const file = UPDATE_MANIFESTS[installed.package];
    const response = await fetchImpl(`${DOWNLOAD_ORIGIN}/download/${file}.json`, {
      cache: "no-store",
      // The manifest is public metadata; sending credentials to it would be pointless and worse.
      credentials: "omit"
    });
    writeStorage(LAST_CHECK_KEY, String(now));
    if (!response?.ok) return null;

    const published = await response.json();
    if (!updateAvailable(installed, published)) return null;
    if (isDismissed(published.versionCode)) return null;

    return {
      versionCode: String(published.versionCode),
      versionName: String(published.versionName || ""),
      bytes: Number(published.bytes) || 0,
      url: downloadUrlFor(installed.package)
    };
  } catch {
    // Offline, blocked, malformed — all the same answer: say nothing.
    return null;
  }
}
