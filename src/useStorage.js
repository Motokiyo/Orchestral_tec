import { useState, useEffect, useRef, useCallback } from "react";
import { openDB } from "idb";

const DB_NAME = "orkmap-db";
const DB_VERSION = 4;
const STORE = "concerts";
const PHOTOS_STORE = "photos";
const OMR_STORE = "omr-scores";
const DEBOUNCE_MS = 500;
const LOCAL_LOAD_TIMEOUT_MS = 4000;
const REMOTE_LOAD_TIMEOUT_MS = 8000;
const REMOTE_SAVE_TIMEOUT_MS = 90000;
const RETRY_INTERVAL_MS = 60000;
const ENABLE_REMOTE_CONCERT_PULL = true;
const ENABLE_REMOTE_PHOTO_SYNC = true;
const ENABLE_REMOTE_OMR_SYNC = true;
// Adresse du propriétaire historique (données locales sans ownerEmail) :
// variable VITE_OWNER_EMAIL, injectée au build par Vite.
const ALEX_EMAIL = String(import.meta.env.VITE_OWNER_EMAIL || "").trim().toLowerCase();

const SYNC_TYPES = {
  concerts: "concerts",
  photos: "photos",
  omrScores: "omr-scores",
};

export const RECOVERY_STORES = {
  concerts: STORE,
  photos: PHOTOS_STORE,
  omrScores: OMR_STORE,
};

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function belongsToUser(item, email) {
  return item?.ownerEmail === email || (email === ALEX_EMAIL && !item?.ownerEmail);
}

function withOwner(item, email) {
  return item?.ownerEmail === email ? item : { ...item, ownerEmail: email };
}

function photosKey(email) {
  return `all-photos:${email}`;
}

function concertsBackupKey(email) {
  return `orkmap-concerts-backup:${email}`;
}

function writeConcertsBackup(email, data) {
  if (!email || !Array.isArray(data) || data.length === 0) return;
  try {
    localStorage.setItem(concertsBackupKey(email), JSON.stringify(data));
  } catch (err) {
    console.warn("[OrkMap] Concert backup failed:", err);
  }
}

function readConcertsBackup(email) {
  if (!email) return [];
  try {
    const raw = localStorage.getItem(concertsBackupKey(email));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[OrkMap] Concert backup read failed:", err);
    return [];
  }
}

function mergeConcerts(localData, remoteData, email) {
  const merged = new Map();
  for (const item of remoteData || []) {
    if (item?.id) merged.set(item.id, withOwner(item, email));
  }
  for (const item of localData || []) {
    if (!item?.id) continue;
    const remote = merged.get(item.id);
    merged.set(item.id, remote ? { ...remote, ...item, ownerEmail: email } : withOwner(item, email));
  }
  return Array.from(merged.values());
}

function remoteConcertPayload(data, email) {
  return data.map((item) => withOwner(item, email));
}

function mergeRecordsById(localData, remoteData, email) {
  const merged = new Map();
  for (const item of remoteData || []) {
    if (item?.id) merged.set(item.id, withOwner(item, email));
  }
  for (const item of localData || []) {
    if (item?.id) merged.set(item.id, withOwner(item, email));
  }
  return Array.from(merged.values());
}

function mergePhotoGroups(localData, remoteData) {
  const merged = { ...(remoteData || {}) };
  for (const [pieceId, photos] of Object.entries(localData || {})) {
    const byId = new Map();
    for (const photo of merged[pieceId] || []) {
      if (photo?.id) byId.set(photo.id, photo);
    }
    for (const photo of photos || []) {
      if (photo?.id) byId.set(photo.id, photo);
    }
    merged[pieceId] = Array.from(byId.values());
  }
  return merged;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function loadRemote(type) {
  const resp = await fetch(`/api/sync?type=${encodeURIComponent(type)}`, {
    credentials: "include",
  });
  if (resp.status === 503) return { available: false, data: null };
  if (!resp.ok) throw new Error(`Remote load failed: ${resp.status}`);
  const payload = await resp.json();
  return { available: true, data: payload.data };
}

async function saveRemote(type, data, removedIds = []) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REMOTE_SAVE_TIMEOUT_MS) : null;
  try {
    const resp = await fetch("/api/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data, removedIds }),
      signal: controller?.signal,
    });
    if (resp.status === 503) return false;
    if (resp.status === 401) setSessionExpired(true);
    if (!resp.ok) {
      const error = new Error(`Remote save failed: ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    return true;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Offline queue ──
// Every local change marks its type as "pending" in localStorage (with the ids
// explicitly deleted). The pending mark survives closing the app. It is cleared
// only once the server has accepted the full current state, so a change made in
// a concert hall without network is sent later instead of being lost.
const PENDING_PREFIX = "orkmap-pending:";

function pendingKey(email, type) {
  return `${PENDING_PREFIX}${email}:${type}`;
}

function readPending(email, type) {
  try {
    const raw = localStorage.getItem(pendingKey(email, type));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { rev: Number(parsed.rev || 0), removedIds: Array.isArray(parsed.removedIds) ? parsed.removedIds : [] };
  } catch {
    return null;
  }
}

function markPending(email, type, removedIds = []) {
  if (!email) return;
  const current = readPending(email, type) || { rev: 0, removedIds: [] };
  const ids = Array.from(new Set([...current.removedIds, ...removedIds.map(String)]));
  try {
    localStorage.setItem(pendingKey(email, type), JSON.stringify({ rev: current.rev + 1, removedIds: ids, since: Date.now() }));
  } catch (err) {
    console.warn("[OrkMap] Pending mark failed:", err);
  }
  notifySyncStatus();
}

// Clear only what was actually sent: if another change arrived during the
// upload (rev moved on), keep the mark so the next attempt sends it too.
function settlePending(email, type, sent) {
  const current = readPending(email, type);
  if (!current) return;
  try {
    if (current.rev === sent.rev) {
      localStorage.removeItem(pendingKey(email, type));
    } else {
      const sentIds = new Set(sent.removedIds);
      const rest = current.removedIds.filter((id) => !sentIds.has(id));
      localStorage.setItem(pendingKey(email, type), JSON.stringify({ rev: current.rev, removedIds: rest, since: Date.now() }));
    }
  } catch (err) {
    console.warn("[OrkMap] Pending clear failed:", err);
  }
  notifySyncStatus();
}

function withoutRemoved(list, removedIds) {
  if (!Array.isArray(list) || !removedIds?.length) return list;
  const removed = new Set(removedIds.map(String));
  return list.filter((item) => !removed.has(String(item?.id)));
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// One upload at a time per (email, type); a request arriving meanwhile is
// replayed once the current one ends.
const inflight = new Map();
async function runExclusive(key, fn) {
  const state = inflight.get(key);
  if (state) {
    state.again = true;
    return;
  }
  const own = { again: false };
  inflight.set(key, own);
  try {
    do {
      own.again = false;
      await fn();
    } while (own.again);
  } finally {
    inflight.delete(key);
  }
}

// Send the latest full state + pending deletions. On 409 (the server knows
// records this device does not have yet), pull them in with `absorbRemote`,
// then try once more. Never throws.
function pushPending({ email, type, getPayload, absorbRemote }) {
  return runExclusive(`${email}:${type}`, async () => {
    const pending = readPending(email, type);
    if (!pending || isOffline()) return;
    // Payload is null while this account's local data is still loading: never
    // send another account's (or an empty) list in its place.
    const payload = getPayload();
    if (payload === null) return;
    try {
      await saveRemote(type, payload, pending.removedIds);
      settlePending(email, type, pending);
    } catch (err) {
      if (err.status !== 409 || !absorbRemote) {
        console.warn(`[OrkMap] ${type} sync deferred:`, err.message);
        return;
      }
      try {
        const remote = await withTimeout(loadRemote(type), REMOTE_LOAD_TIMEOUT_MS, `${type} conflict load`);
        if (remote.available) await absorbRemote(remote.data, pending.removedIds);
        const merged = getPayload();
        if (merged === null) return;
        await saveRemote(type, merged, pending.removedIds);
        settlePending(email, type, pending);
      } catch (retryErr) {
        console.warn(`[OrkMap] ${type} sync conflict unresolved:`, retryErr.message);
      }
    }
  });
}

// Re-run pending uploads when the network comes back, when the app returns to
// the foreground, on explicit request (after a login) and every minute.
function useSyncRetry(email, flush) {
  useEffect(() => {
    if (!email) return undefined;
    const run = () => { flush(); };
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener("online", run);
    window.addEventListener(SYNC_RETRY_EVENT, run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(run, RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", run);
      window.removeEventListener(SYNC_RETRY_EVENT, run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [email, flush]);
}

// When the app goes to the background (screen locked, app switched, closed),
// run the debounced save right away: on a phone the page may never come back.
function useSaveOnHide(runNow) {
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") runNow(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", runNow);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", runNow);
    };
  }, [runNow]);
}

async function deleteLocalNow(storeName, ids, email) {
  if (!ids.length) return;
  try {
    const db = await getDB();
    const tx = db.transaction(storeName, "readwrite");
    for (const id of ids) {
      const existing = await tx.store.get(id);
      if (existing && belongsToUser(existing, email)) await tx.store.delete(id);
    }
    await tx.done;
  } catch (err) {
    console.warn("[OrkMap] Immediate local delete failed:", err);
  }
}

// ── Sync status (read by the banner) ──
const SYNC_RETRY_EVENT = "orkmap-sync-retry";
const statusListeners = new Set();
let sessionExpired = false;

function notifySyncStatus() {
  for (const listener of statusListeners) listener();
}

export function setSessionExpired(value) {
  if (sessionExpired === Boolean(value)) return;
  sessionExpired = Boolean(value);
  notifySyncStatus();
}

export function requestSyncRetry() {
  window.dispatchEvent(new Event(SYNC_RETRY_EVENT));
}

function countPending() {
  let count = 0;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      if (String(localStorage.key(index)).startsWith(PENDING_PREFIX)) count += 1;
    }
  } catch {
    return 0;
  }
  return count;
}

function readSyncStatus() {
  return { online: !isOffline(), pending: countPending(), sessionExpired };
}

export function useSyncStatus() {
  const [status, setStatus] = useState(readSyncStatus);
  useEffect(() => {
    const update = () => setStatus(readSyncStatus());
    statusListeners.add(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      statusListeners.delete(update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return status;
}

// Ask the browser not to evict our data (IndexedDB) under storage pressure.
export function requestPersistentStorage() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Unsupported: nothing to do.
  }
}

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        db.createObjectStore(PHOTOS_STORE);
      }
      if (!db.objectStoreNames.contains(OMR_STORE)) {
        db.createObjectStore(OMR_STORE, { keyPath: "id" });
      }
    },
  });
}

export async function exportLocalDataForRecovery() {
  const db = await getDB();
  const concerts = await db.getAll(STORE);
  const photosKeys = await db.getAllKeys(PHOTOS_STORE);
  const photos = [];
  for (const key of photosKeys) {
    photos.push({ key, value: await db.get(PHOTOS_STORE, key) });
  }
  const omrScores = await db.getAll(OMR_STORE);
  const stores = [];
  for (const storeName of Array.from(db.objectStoreNames)) {
    const keys = await db.getAllKeys(storeName);
    const records = [];
    for (const key of keys) {
      records.push({ key, value: await db.get(storeName, key) });
    }
    stores.push({ name: storeName, records });
  }
  const localStorageItems = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      localStorageItems.push({ key, value: localStorage.getItem(key) });
    }
  } catch (err) {
    localStorageItems.push({ key: "__localStorage_error__", value: err.message });
  }
  return {
    version: 1,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    userAgent: navigator.userAgent,
    concerts,
    photos,
    omrScores,
    stores,
    localStorage: localStorageItems,
  };
}

/**
 * Hook: persistent concerts state backed by IndexedDB.
 * Returns [concerts, setConcerts, loaded] — same API as useState.
 * Auto-saves to IndexedDB on every change (debounced).
 */
export function useConcerts(initialConcerts, userEmail) {
  const [concerts, setConcertsState] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const latestRef = useRef([]);
  const removalsRef = useRef([]);
  const readyRef = useRef("");
  const email = normalizeEmail(userEmail);
  const setConcerts = useCallback((data) => {
    latestRef.current = data;
    setConcertsState(data);
  }, []);

  // Surgical save: upsert everything in `data`, and delete ONLY ids the user
  // explicitly removed this session (removedIds). A stale/empty/reduced `data`
  // can no longer wipe concerts it never knew about — that was the data-loss bug.
  const saveLocal = useCallback(async (data, removedIds = []) => {
    if (!email) return;
    const db = await getDB();
    const tx = db.transaction(STORE, "readwrite");
    const existingKeys = await tx.store.getAllKeys();
    const existingForUser = [];
    for (const key of existingKeys) {
      const existing = await tx.store.get(key);
      if (belongsToUser(existing, email)) existingForUser.push(withOwner(existing, email));
    }
    writeConcertsBackup(email, existingForUser);
    for (const id of removedIds) {
      const existing = await tx.store.get(id);
      if (existing && belongsToUser(existing, email)) await tx.store.delete(id);
    }
    for (const c of data) {
      await tx.store.put(withOwner(c, email));
    }
    await tx.done;
  }, [email]);

  // Load from IndexedDB first, then prefer the account sync when available.
  useEffect(() => {
    (async () => {
      if (!email) {
        setConcerts([]);
        setLoaded(true);
        setLoadedFor("");
        return;
      }
      // Another account was shown: clear it at once, never show or edit its
      // list under the new account while this one loads.
      if (readyRef.current && readyRef.current !== email) setConcerts([]);
      readyRef.current = "";
      setLoaded(false);
      setLoadedFor("");
      let localData = [];
      let canSeedRemoteFromLocal = false;
      try {
        await withTimeout((async () => {
        const db = await getDB();
        const all = await db.getAll(STORE);
        const matching = all.filter((item) => belongsToUser(item, email));
        const needsMigration = email === ALEX_EMAIL && matching.some((item) => !item.ownerEmail);
        const owned = matching.map((item) => withOwner(item, email));
        if (owned.length > 0) {
          localData = owned;
          canSeedRemoteFromLocal = true;
          if (needsMigration) {
            const tx = db.transaction(STORE, "readwrite");
            for (const c of owned) await tx.store.put(c);
            await tx.done;
          }
        } else if (email === ALEX_EMAIL && initialConcerts && initialConcerts.length > 0) {
          const seeded = initialConcerts.map((item) => withOwner(item, email));
          localData = seeded;
          const tx = db.transaction(STORE, "readwrite");
          for (const c of seeded) {
            await tx.store.put(c);
          }
          await tx.done;
        }
        })(), LOCAL_LOAD_TIMEOUT_MS, "Concert IndexedDB load");
        if (localData.length === 0) {
          localData = readConcertsBackup(email).map((item) => withOwner(item, email));
          canSeedRemoteFromLocal = localData.length > 0;
        }
        // A deletion made offline and not yet sent must not come back through
        // the backup copy (e.g. after deleting the last concert).
        localData = withoutRemoved(localData, readPending(email, SYNC_TYPES.concerts)?.removedIds || []);
        // Keep anything edited while the local database was opening.
        if (latestRef.current.length) localData = mergeConcerts(latestRef.current, localData, email);
        writeConcertsBackup(email, localData);
        setConcerts(localData);
      } catch (err) {
        console.warn("[OrkMap] IndexedDB load failed, using memory:", err);
        localData = readConcertsBackup(email).map((item) => withOwner(item, email));
        if (localData.length > 0) {
          canSeedRemoteFromLocal = true;
          setConcerts(localData);
        }
        if (email === ALEX_EMAIL && initialConcerts) {
          const fallback = initialConcerts.map((item) => withOwner(item, email));
          if (localData.length === 0) {
            localData = fallback;
            setConcerts(localData);
          }
        }
      }
      if (ENABLE_REMOTE_CONCERT_PULL && !isOffline()) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.concerts), REMOTE_LOAD_TIMEOUT_MS, "Concert sync load");
          if (remote.available && Array.isArray(remote.data)) {
            await absorbRemote(remote.data, readPending(email, SYNC_TYPES.concerts)?.removedIds || []);
            if (canSeedRemoteFromLocal && JSON.stringify(remote.data) !== JSON.stringify(remoteConcertPayload(latestRef.current, email))) {
              markPending(email, SYNC_TYPES.concerts);
            }
          } else if (remote.available && canSeedRemoteFromLocal && localData.length > 0) {
            markPending(email, SYNC_TYPES.concerts);
          }
        } catch (err) {
          console.warn("[OrkMap] Concert sync load failed, using local cache:", err);
        }
      }
      readyRef.current = email;
      setLoaded(true);
      setLoadedFor(email);
      flush();
    })();
  }, [email, saveLocal]);

  // Bring server records into the current list (local version wins on the same
  // id), skipping the ones deleted on this device and not yet synced. Built on
  // the latest list, so an edit made while the server answered is kept.
  const absorbRemote = useCallback(async (remoteData, removedIds = []) => {
    if (!Array.isArray(remoteData)) return;
    const mergedData = mergeConcerts(latestRef.current, withoutRemoved(remoteData, removedIds), email);
    setConcerts(mergedData);
    writeConcertsBackup(email, mergedData);
    await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "Concert cache save");
  }, [email, saveLocal, setConcerts]);

  const flush = useCallback(() => pushPending({
    email,
    type: SYNC_TYPES.concerts,
    getPayload: () => (readyRef.current === email ? remoteConcertPayload(latestRef.current, email) : null),
    absorbRemote,
  }), [email, absorbRemote]);

  useSyncRetry(email, flush);

  // Auto-save to IndexedDB, then queue + send to the account (debounced)
  const save = useCallback(async (data, removedIds = []) => {
    if (!email) return;
    const owned = data.map((item) => withOwner(item, email));
    writeConcertsBackup(email, owned);
    try {
      await saveLocal(owned, removedIds);
    } catch (err) {
      console.warn("[OrkMap] IndexedDB save failed:", err);
    }
    markPending(email, SYNC_TYPES.concerts, removedIds);
    await flush();
  }, [email, saveLocal, flush]);

  const runSaveNow = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const removals = removalsRef.current;
    removalsRef.current = [];
    save(latestRef.current, removals);
  }, [save]);

  useSaveOnHide(runSaveNow);

  // Wrap setConcerts to trigger debounced save. Deletions are derived from the
  // previous in-memory list (prev -> next), so only genuinely removed concerts
  // are deleted; never "everything not in the list".
  const setConcertsAndSave = useCallback((fn) => {
    const prev = latestRef.current;
    const next = typeof fn === "function" ? fn(prev) : fn;
    const nextIds = new Set(next.map((c) => c.id));
    const removedIds = prev.filter((c) => c && c.id && !nextIds.has(c.id)).map((c) => c.id);
    setConcerts(next);
    // Deletions are recorded at once (not at the debounced save), so a quick
    // second edit cannot make them disappear from the queue.
    if (removedIds.length) {
      markPending(email, SYNC_TYPES.concerts, removedIds);
      removalsRef.current = [...removalsRef.current, ...removedIds];
      deleteLocalNow(STORE, removedIds, email);
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSaveNow, DEBOUNCE_MS);
  }, [email, setConcerts, runSaveNow]);

  return [concerts, setConcertsAndSave, loaded && loadedFor === email];
}

/**
 * Hook: persistent photos state backed by IndexedDB.
 * Photos are stored as { [pieceKey]: photoData[] }.
 * Returns [photos, setPhotos, loaded] — same API as useState.
 */
export function usePhotos(userEmail) {
  const [photos, setPhotosState] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const latestRef = useRef({});
  const readyRef = useRef("");
  const email = normalizeEmail(userEmail);
  const setPhotos = useCallback((data) => {
    latestRef.current = data;
    setPhotosState(data);
  }, []);

  const saveLocal = useCallback(async (data) => {
    if (!email) return;
    const db = await getDB();
    await db.put(PHOTOS_STORE, data, photosKey(email));
  }, [email]);

  // Load from IndexedDB first, then prefer the account sync when available.
  useEffect(() => {
    (async () => {
      if (!email) {
        setPhotos({});
        setLoaded(true);
        setLoadedFor("");
        return;
      }
      if (readyRef.current && readyRef.current !== email) setPhotos({});
      readyRef.current = "";
      setLoaded(false);
      setLoadedFor("");
      let localData = {};
      try {
        await withTimeout((async () => {
        const db = await getDB();
        let stored = await db.get(PHOTOS_STORE, photosKey(email));
        if (!stored && email === ALEX_EMAIL) {
          stored = await db.get(PHOTOS_STORE, "all-photos");
          if (stored) await db.put(PHOTOS_STORE, stored, photosKey(email));
        }
        if (stored) {
          localData = stored;
        }
        })(), LOCAL_LOAD_TIMEOUT_MS, "Photos IndexedDB load");
        if (Object.keys(latestRef.current).length) localData = mergePhotoGroups(latestRef.current, localData);
        setPhotos(localData);
      } catch (err) {
        console.warn("[OrkMap] Photos load failed:", err);
      }
      if (ENABLE_REMOTE_PHOTO_SYNC && !isOffline()) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.photos), REMOTE_LOAD_TIMEOUT_MS, "Photo sync load");
          if (remote.available && remote.data && typeof remote.data === "object" && !Array.isArray(remote.data)) {
            await absorbRemote(remote.data);
            if (Object.keys(localData).length > 0 && JSON.stringify(remote.data) !== JSON.stringify(latestRef.current)) {
              markPending(email, SYNC_TYPES.photos);
            }
          } else if (remote.available && Object.keys(localData).length > 0) {
            markPending(email, SYNC_TYPES.photos);
          }
        } catch (err) {
          console.warn("[OrkMap] Photo sync load failed, using local cache:", err);
        }
      }
      readyRef.current = email;
      setLoaded(true);
      setLoadedFor(email);
      if (ENABLE_REMOTE_PHOTO_SYNC) flush();
    })();
  }, [email, saveLocal]);

  const absorbRemote = useCallback(async (remoteData) => {
    if (!remoteData || typeof remoteData !== "object" || Array.isArray(remoteData)) return;
    const mergedData = mergePhotoGroups(latestRef.current, remoteData);
    setPhotos(mergedData);
    await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "Photo cache save");
  }, [saveLocal, setPhotos]);

  const flush = useCallback(() => pushPending({
    email,
    type: SYNC_TYPES.photos,
    getPayload: () => (readyRef.current === email ? latestRef.current : null),
    absorbRemote,
  }), [email, absorbRemote]);

  useSyncRetry(ENABLE_REMOTE_PHOTO_SYNC ? email : "", flush);

  // Auto-save to IndexedDB, then queue + send to the account (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    try {
      await saveLocal(data);
    } catch (err) {
      console.warn("[OrkMap] Photos save failed:", err);
    }
    if (ENABLE_REMOTE_PHOTO_SYNC) {
      markPending(email, SYNC_TYPES.photos);
      await flush();
    }
  }, [email, saveLocal, flush]);

  const runSaveNow = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    save(latestRef.current);
  }, [save]);

  useSaveOnHide(runSaveNow);

  // Wrap setPhotos to trigger debounced save
  const setPhotosAndSave = useCallback((fn) => {
    const next = typeof fn === "function" ? fn(latestRef.current) : fn;
    setPhotos(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSaveNow, DEBOUNCE_MS);
  }, [setPhotos, runSaveNow]);

  return [photos, setPhotosAndSave, loaded && loadedFor === email];
}

/**
 * Hook: persistent OMR scores backed by IndexedDB.
 * Returns [scores, setScores, loaded] — same API as useState.
 */
export function useOmrScores(userEmail) {
  const [scores, setScoresState] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const latestRef = useRef([]);
  const removalsRef = useRef([]);
  const readyRef = useRef("");
  const email = normalizeEmail(userEmail);
  const setScores = useCallback((data) => {
    latestRef.current = data;
    setScoresState(data);
  }, []);

  // Surgical save (same safety as concerts): upsert `data`, delete only the
  // explicitly removed score ids. Protects the score library from accidental wipes.
  const saveLocal = useCallback(async (data, removedIds = []) => {
    if (!email) return;
    const db = await getDB();
    const tx = db.transaction(OMR_STORE, "readwrite");
    for (const id of removedIds) {
      const existing = await tx.store.get(id);
      if (existing && belongsToUser(existing, email)) await tx.store.delete(id);
    }
    for (const score of data) {
      await tx.store.put(withOwner(score, email));
    }
    await tx.done;
  }, [email]);

  useEffect(() => {
    (async () => {
      if (!email) {
        setScores([]);
        setLoaded(true);
        setLoadedFor("");
        return;
      }
      if (readyRef.current && readyRef.current !== email) setScores([]);
      readyRef.current = "";
      setLoaded(false);
      setLoadedFor("");
      let localData = [];
      try {
        await withTimeout((async () => {
        const db = await getDB();
        const all = await db.getAll(OMR_STORE);
        const matching = all.filter((item) => belongsToUser(item, email));
        const needsMigration = email === ALEX_EMAIL && matching.some((item) => !item.ownerEmail);
        const owned = matching.map((item) => withOwner(item, email));
        localData = withoutRemoved(owned, readPending(email, SYNC_TYPES.omrScores)?.removedIds || []);
        if (latestRef.current.length) localData = mergeRecordsById(latestRef.current, localData, email);
        setScores(localData);
        if (needsMigration) {
          const tx = db.transaction(OMR_STORE, "readwrite");
          for (const score of owned) await tx.store.put(score);
          await tx.done;
        }
        })(), LOCAL_LOAD_TIMEOUT_MS, "OMR IndexedDB load");
      } catch (err) {
        console.warn("[OrkMap] OMR scores load failed:", err);
      }
      if (ENABLE_REMOTE_OMR_SYNC && !isOffline()) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.omrScores), REMOTE_LOAD_TIMEOUT_MS, "OMR sync load");
          if (remote.available && Array.isArray(remote.data)) {
            await absorbRemote(remote.data, readPending(email, SYNC_TYPES.omrScores)?.removedIds || []);
            if (localData.length > 0 && JSON.stringify(remote.data) !== JSON.stringify(latestRef.current)) {
              markPending(email, SYNC_TYPES.omrScores);
            }
          } else if (remote.available && localData.length > 0) {
            markPending(email, SYNC_TYPES.omrScores);
          }
        } catch (err) {
          console.warn("[OrkMap] OMR sync load failed, using local cache:", err);
        }
      }
      readyRef.current = email;
      setLoaded(true);
      setLoadedFor(email);
      if (ENABLE_REMOTE_OMR_SYNC) flush();
    })();
  }, [email, saveLocal]);

  const absorbRemote = useCallback(async (remoteData, removedIds = []) => {
    if (!Array.isArray(remoteData)) return;
    const mergedData = mergeRecordsById(latestRef.current, withoutRemoved(remoteData, removedIds), email);
    setScores(mergedData);
    await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "OMR cache save");
  }, [email, saveLocal, setScores]);

  const flush = useCallback(() => pushPending({
    email,
    type: SYNC_TYPES.omrScores,
    getPayload: () => (readyRef.current === email ? latestRef.current.map((item) => withOwner(item, email)) : null),
    absorbRemote,
  }), [email, absorbRemote]);

  useSyncRetry(ENABLE_REMOTE_OMR_SYNC ? email : "", flush);

  const save = useCallback(async (data, removedIds = []) => {
    if (!email) return;
    const owned = data.map((item) => withOwner(item, email));
    try {
      await saveLocal(owned, removedIds);
    } catch (err) {
      console.warn("[OrkMap] OMR scores save failed:", err);
    }
    if (ENABLE_REMOTE_OMR_SYNC) {
      markPending(email, SYNC_TYPES.omrScores, removedIds);
      await flush();
    }
  }, [email, saveLocal, flush]);

  const runSaveNow = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const removals = removalsRef.current;
    removalsRef.current = [];
    save(latestRef.current, removals);
  }, [save]);

  useSaveOnHide(runSaveNow);

  const setScoresAndSave = useCallback((fn) => {
    const prev = latestRef.current;
    const next = typeof fn === "function" ? fn(prev) : fn;
    const nextIds = new Set(next.map((s) => s.id));
    const removedIds = prev.filter((s) => s && s.id && !nextIds.has(s.id)).map((s) => s.id);
    setScores(next);
    if (removedIds.length) {
      if (ENABLE_REMOTE_OMR_SYNC) markPending(email, SYNC_TYPES.omrScores, removedIds);
      removalsRef.current = [...removalsRef.current, ...removedIds];
      deleteLocalNow(OMR_STORE, removedIds, email);
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSaveNow, DEBOUNCE_MS);
  }, [email, setScores, runSaveNow]);

  return [scores, setScoresAndSave, loaded && loadedFor === email];
}
