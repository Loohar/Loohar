const memoryStorage = new Map();

function canUseStorage(storage) {
  if (!storage) return false;
  const testKey = "__loohar_storage_test__";
  try {
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function windowStorage(name) {
  try {
    return globalThis.window?.[name] || null;
  } catch {
    return null;
  }
}

function browserStorage() {
  const localStorage = windowStorage("localStorage");
  if (canUseStorage(localStorage)) return localStorage;
  const sessionStorage = windowStorage("sessionStorage");
  if (canUseStorage(sessionStorage)) return sessionStorage;
  return null;
}

// The native POS and Driver apps keep credentials in the platform keystore (iOS Keychain, Android
// Keystore) instead of WebView storage. Reads stay synchronous: while a keystore is attached, these
// keys are held in memory, written through to the keystore, and loaded back before the app renders.
// They never touch localStorage there.
const SECURE_KEYS = new Set(["accessToken", "refreshToken"]);
let secureStore = null;

function isSecureKey(key) {
  return Boolean(secureStore) && SECURE_KEYS.has(key);
}

// `store` is { get(key) -> Promise<string|null>, set(key, value) -> Promise, remove(key) -> Promise }.
// Tokens an earlier build left in WebView storage move into the keystore once and are then deleted.
export async function attachSecureStore(store, legacyStorage = browserStorage()) {
  secureStore = store;
  for (const key of SECURE_KEYS) {
    let value = "";
    try {
      value = (await store.get(key)) || "";
    } catch {
      value = "";
    }
    let legacy = "";
    try {
      legacy = legacyStorage?.getItem(key) || "";
    } catch {
      legacy = "";
    }
    if (!value && legacy) {
      value = legacy;
      try {
        await store.set(key, legacy);
      } catch {
        // Keystore unavailable: keep the token in memory for this launch only.
      }
    }
    if (legacy) {
      try {
        legacyStorage.removeItem(key);
      } catch {
        // Ignore: the keystore copy is authoritative from now on.
      }
    }
    if (value) memoryStorage.set(key, value);
    else memoryStorage.delete(key);
  }
}

// Used when the keystore cannot be opened: credentials stay in memory and the user signs in again
// next launch, rather than falling back to WebView storage.
export const memoryOnlySecureStore = Object.freeze({
  async get() { return ""; },
  async set() {},
  async remove() {}
});

export const authStorage = {
  getItem(key) {
    if (isSecureKey(key)) return memoryStorage.get(key) || "";
    const storage = browserStorage();
    if (!storage) return memoryStorage.get(key) || "";
    try {
      return storage.getItem(key) || "";
    } catch {
      return memoryStorage.get(key) || "";
    }
  },
  setItem(key, value) {
    const stringValue = String(value);
    if (isSecureKey(key)) {
      memoryStorage.set(key, stringValue);
      secureStore.set(key, stringValue).catch(() => {});
      return;
    }
    const storage = browserStorage();
    memoryStorage.set(key, stringValue);
    if (!storage) return;
    try {
      storage.setItem(key, stringValue);
    } catch {
      // Safari private/strict contexts can reject persistent storage. Keep memory fallback.
    }
  },
  removeItem(key) {
    memoryStorage.delete(key);
    if (isSecureKey(key)) {
      secureStore.remove(key).catch(() => {});
      return;
    }
    const storage = browserStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures so auth state can still clear in memory.
    }
  }
};
