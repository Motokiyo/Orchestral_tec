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
const ENABLE_REMOTE_CONCERT_PULL = true;
const ENABLE_REMOTE_PHOTO_SYNC = true;
const ENABLE_REMOTE_OMR_SYNC = true;
const ALEX_EMAIL = "alexferran@gmail.com";

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

async function saveRemote(type, data) {
  const resp = await fetch("/api/sync", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data }),
  });
  if (resp.status === 503) return false;
  if (!resp.ok) throw new Error(`Remote save failed: ${resp.status}`);
  return true;
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
  const [concerts, setConcerts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const email = normalizeEmail(userEmail);

  const saveLocal = useCallback(async (data) => {
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
    const newIds = new Set(data.map((c) => c.id));
    for (const key of existingKeys) {
      const existing = await tx.store.get(key);
      if (belongsToUser(existing, email) && !newIds.has(key)) await tx.store.delete(key);
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
      if (ENABLE_REMOTE_CONCERT_PULL) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.concerts), REMOTE_LOAD_TIMEOUT_MS, "Concert sync load");
          if (remote.available && Array.isArray(remote.data)) {
            const mergedData = mergeConcerts(localData, remote.data, email);
            setConcerts(mergedData);
            writeConcertsBackup(email, mergedData);
            await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "Concert cache save");
            if (canSeedRemoteFromLocal && JSON.stringify(remote.data) !== JSON.stringify(remoteConcertPayload(mergedData, email))) {
              await withTimeout(saveRemote(SYNC_TYPES.concerts, remoteConcertPayload(mergedData, email)), REMOTE_LOAD_TIMEOUT_MS, "Concert merged sync save");
            }
          } else if (remote.available && canSeedRemoteFromLocal && localData.length > 0) {
            await withTimeout(
              saveRemote(SYNC_TYPES.concerts, remoteConcertPayload(localData, email)),
              REMOTE_LOAD_TIMEOUT_MS,
              "Concert initial sync save"
            );
          }
        } catch (err) {
          console.warn("[OrkMap] Concert sync load failed, using local cache:", err);
        }
      } else if (!ENABLE_REMOTE_CONCERT_PULL && canSeedRemoteFromLocal && localData.length > 0) {
        saveRemote(SYNC_TYPES.concerts, remoteConcertPayload(localData, email)).catch((err) => {
          console.warn("[OrkMap] Concert background sync save failed:", err);
        });
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email, saveLocal]);

  // Auto-save to IndexedDB + account sync (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    const owned = data.map((item) => withOwner(item, email));
    writeConcertsBackup(email, owned);
    try {
      await saveLocal(owned);
    } catch (err) {
      console.warn("[OrkMap] IndexedDB save failed:", err);
    }
    try {
      await saveRemote(SYNC_TYPES.concerts, remoteConcertPayload(owned, email));
    } catch (err) {
      console.warn("[OrkMap] Concert sync save failed:", err);
    }
  }, [email, saveLocal]);

  // Wrap setConcerts to trigger debounced save
  const setConcertsAndSave = useCallback((fn) => {
    setConcerts((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      // Debounced save
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
      return next;
    });
  }, [save]);

  return [concerts, setConcertsAndSave, loaded && loadedFor === email];
}

/**
 * Hook: persistent photos state backed by IndexedDB.
 * Photos are stored as { [pieceKey]: photoData[] }.
 * Returns [photos, setPhotos, loaded] — same API as useState.
 */
export function usePhotos(userEmail) {
  const [photos, setPhotos] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const email = normalizeEmail(userEmail);

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
        setPhotos(localData);
      } catch (err) {
        console.warn("[OrkMap] Photos load failed:", err);
      }
      if (ENABLE_REMOTE_PHOTO_SYNC) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.photos), REMOTE_LOAD_TIMEOUT_MS, "Photo sync load");
          if (remote.available && remote.data && typeof remote.data === "object" && !Array.isArray(remote.data)) {
            const mergedData = mergePhotoGroups(localData, remote.data);
            setPhotos(mergedData);
            await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "Photo cache save");
            if (Object.keys(localData).length > 0 && JSON.stringify(remote.data) !== JSON.stringify(mergedData)) {
              await withTimeout(saveRemote(SYNC_TYPES.photos, mergedData), REMOTE_LOAD_TIMEOUT_MS, "Photo merged sync save");
            }
          } else if (remote.available && Object.keys(localData).length > 0) {
            await withTimeout(saveRemote(SYNC_TYPES.photos, localData), REMOTE_LOAD_TIMEOUT_MS, "Photo initial sync save");
          }
        } catch (err) {
          console.warn("[OrkMap] Photo sync load failed, using local cache:", err);
        }
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email, saveLocal]);

  // Auto-save to IndexedDB + account sync (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    try {
      await saveLocal(data);
    } catch (err) {
      console.warn("[OrkMap] Photos save failed:", err);
    }
    if (ENABLE_REMOTE_PHOTO_SYNC) {
      try {
        await saveRemote(SYNC_TYPES.photos, data);
      } catch (err) {
        console.warn("[OrkMap] Photo sync save failed:", err);
      }
    }
  }, [email, saveLocal]);

  // Wrap setPhotos to trigger debounced save
  const setPhotosAndSave = useCallback((fn) => {
    setPhotos((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
      return next;
    });
  }, [save]);

  return [photos, setPhotosAndSave, loaded && loadedFor === email];
}

/**
 * Hook: persistent OMR scores backed by IndexedDB.
 * Returns [scores, setScores, loaded] — same API as useState.
 */
export function useOmrScores(userEmail) {
  const [scores, setScores] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const saveTimer = useRef(null);
  const email = normalizeEmail(userEmail);

  const saveLocal = useCallback(async (data) => {
    if (!email) return;
    const db = await getDB();
    const tx = db.transaction(OMR_STORE, "readwrite");
    const existingKeys = await tx.store.getAllKeys();
    const newIds = new Set(data.map((score) => score.id));
    for (const key of existingKeys) {
      const existing = await tx.store.get(key);
      if (belongsToUser(existing, email) && !newIds.has(key)) await tx.store.delete(key);
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
        localData = owned;
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
      if (ENABLE_REMOTE_OMR_SYNC) {
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.omrScores), REMOTE_LOAD_TIMEOUT_MS, "OMR sync load");
          if (remote.available && Array.isArray(remote.data)) {
            const mergedData = mergeRecordsById(localData, remote.data, email);
            setScores(mergedData);
            await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "OMR cache save");
            if (localData.length > 0 && JSON.stringify(remote.data) !== JSON.stringify(mergedData)) {
              await withTimeout(
                saveRemote(SYNC_TYPES.omrScores, mergedData.map((item) => withOwner(item, email))),
                REMOTE_LOAD_TIMEOUT_MS,
                "OMR merged sync save"
              );
            }
          } else if (remote.available && localData.length > 0) {
            await withTimeout(
              saveRemote(SYNC_TYPES.omrScores, localData.map((item) => withOwner(item, email))),
              REMOTE_LOAD_TIMEOUT_MS,
              "OMR initial sync save"
            );
          }
        } catch (err) {
          console.warn("[OrkMap] OMR sync load failed, using local cache:", err);
        }
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email, saveLocal]);

  const save = useCallback(async (data) => {
    if (!email) return;
    const owned = data.map((item) => withOwner(item, email));
    try {
      await saveLocal(owned);
    } catch (err) {
      console.warn("[OrkMap] OMR scores save failed:", err);
    }
    if (ENABLE_REMOTE_OMR_SYNC) {
      try {
        await saveRemote(SYNC_TYPES.omrScores, owned);
      } catch (err) {
        console.warn("[OrkMap] OMR sync save failed:", err);
      }
    }
  }, [email, saveLocal]);

  const setScoresAndSave = useCallback((fn) => {
    setScores((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
      return next;
    });
  }, [save]);

  return [scores, setScoresAndSave, loaded && loadedFor === email];
}
