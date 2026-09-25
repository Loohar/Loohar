// When an installed Loohar app should say a newer build exists — and, mostly, when it must not.
//
//   node --test scripts/native-app-update-test.mjs
//
// This runs on a till while someone is serving customers. A wrong "update available" sends a
// restaurant to reinstall something they already have, and a check that throws could take the
// register down. Nearly every case below is therefore about staying quiet.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const module = "../apps/web/src/shared/nativeAppUpdate.js";

// localStorage does not exist in Node, and the module must survive that too.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v))
};
afterEach(() => storage.clear());

const {
  checkForUpdate, updateAvailable, dueForCheck, dismissUpdate, downloadUrlFor
} = await import(module);
// Whether this is a native app at all is answered by shared/nativeApp.js, which asks Capacitor
// directly rather than guessing from the origin, so it is not duplicated here. That module reads
// import.meta.env and therefore only loads under Vite; the browser surface gate covers it.

const INSTALLED = { package: "com.loohar.pos", versionCode: "120", environment: "production" };
const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

test("a higher versionCode is an update", () => {
  assert.equal(updateAvailable(INSTALLED, { package: "com.loohar.pos", versionCode: "121", environment: "production" }), true);
});

test("the same build is not an update", () => {
  assert.equal(updateAvailable(INSTALLED, { package: "com.loohar.pos", versionCode: "120", environment: "production" }), false);
});

test("an older build is never offered, which is what stops a downgrade", () => {
  assert.equal(updateAvailable(INSTALLED, { package: "com.loohar.pos", versionCode: "119", environment: "production" }), false);
});

test("versions are compared as numbers, not as text", () => {
  // "9" > "120" as strings. Getting this wrong would offer an older build to every till.
  const installedNine = { ...INSTALLED, versionCode: "9" };
  assert.equal(updateAvailable(installedNine, { ...INSTALLED, versionCode: "120" }), true);
  assert.equal(updateAvailable(INSTALLED, { ...INSTALLED, versionCode: "9" }), false);
});

test("a build for a different app is not an update to this one", () => {
  assert.equal(updateAvailable(INSTALLED, { package: "com.loohar.driver", versionCode: "999", environment: "production" }), false);
});

test("a build for another environment is never offered", () => {
  // Installing it would silently repoint the till at a different API.
  assert.equal(updateAvailable(INSTALLED, { package: "com.loohar.pos", versionCode: "999", environment: "staging" }), false);
});

test("an unreadable version on either side means say nothing", () => {
  for (const bad of [undefined, null, "", "abc", "1.2.3", "-4", "0", Number.NaN]) {
    assert.equal(updateAvailable(INSTALLED, { ...INSTALLED, versionCode: bad }), false, `published ${String(bad)}`);
    assert.equal(updateAvailable({ ...INSTALLED, versionCode: bad }, { ...INSTALLED, versionCode: "999" }), false, `installed ${String(bad)}`);
  }
});

test("being offline is silent, not an error on the till", async () => {
  const offline = async () => { throw new Error("Failed to fetch"); };
  assert.equal(await checkForUpdate({ installed: INSTALLED, fetchImpl: offline, force: true }), null);
});

test("a server error, or nonsense in place of the manifest, is silent", async () => {
  assert.equal(await checkForUpdate({ installed: INSTALLED, fetchImpl: async () => jsonResponse({}, false), force: true }), null);
  const brokenJson = async () => ({ ok: true, json: async () => { throw new Error("not json"); } });
  assert.equal(await checkForUpdate({ installed: INSTALLED, fetchImpl: brokenJson, force: true }), null);
});

test("a newer build comes back with what the notice needs to say", async () => {
  const published = { package: "com.loohar.pos", versionCode: "121", versionName: "1.0.121", environment: "production", bytes: 5166180 };
  const result = await checkForUpdate({ installed: INSTALLED, fetchImpl: async () => jsonResponse(published), force: true });
  assert.equal(result.versionCode, "121");
  assert.equal(result.versionName, "1.0.121");
  assert.equal(result.bytes, 5166180);
  assert.equal(result.url, "https://loohar.com/download/loohar-pos.apk");
});

test("the manifest is fetched without credentials", async () => {
  let seen = null;
  await checkForUpdate({
    installed: INSTALLED,
    fetchImpl: async (url, options) => { seen = { url, options }; return jsonResponse({ ...INSTALLED, versionCode: "121" }); },
    force: true
  });
  assert.match(seen.url, /^https:\/\/loohar\.com\/download\/loohar-pos\.apk\.json$/);
  assert.equal(seen.options.credentials, "omit", "public metadata must not carry credentials");
  assert.equal(seen.options.cache, "no-store", "a cached manifest would hide a new release");
});

test("a dismissed version stays dismissed", async () => {
  const published = { package: "com.loohar.pos", versionCode: "121", environment: "production" };
  const fetchImpl = async () => jsonResponse(published);
  assert.ok(await checkForUpdate({ installed: INSTALLED, fetchImpl, force: true }));
  dismissUpdate("121");
  assert.equal(await checkForUpdate({ installed: INSTALLED, fetchImpl, force: true }), null);
  // But a later build is offered again, so dismissing once does not mute Loohar forever.
  const later = async () => jsonResponse({ ...published, versionCode: "122" });
  assert.ok(await checkForUpdate({ installed: INSTALLED, fetchImpl: later, force: true }));
});

test("it does not check on every launch", () => {
  const now = Date.UTC(2026, 8, 25, 12, 0, 0);
  assert.equal(dueForCheck(now, null), true, "the first run checks");
  assert.equal(dueForCheck(now, String(now - 60_000)), false, "a minute later it does not");
  assert.equal(dueForCheck(now, String(now - 7 * 60 * 60 * 1000)), true, "hours later it does");
  assert.equal(dueForCheck(now, "not-a-number"), true, "unreadable means check");
});

test("an unknown package is never offered a download", async () => {
  assert.equal(await checkForUpdate({ installed: { package: "com.example.other", versionCode: "1" }, force: true }), null);
  assert.match(downloadUrlFor("com.example.other"), /\/download$/);
});
