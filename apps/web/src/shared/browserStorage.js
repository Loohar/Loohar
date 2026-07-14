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

export const authStorage = {
  getItem(key) {
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
    const storage = browserStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures so auth state can still clear in memory.
    }
  }
};
