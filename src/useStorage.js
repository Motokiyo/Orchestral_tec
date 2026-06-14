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
const ALEX_EMAIL = "alexferran@gmail.com";

const SYNC_TYPES = {
  concerts: "concerts",
  photos: "photos",
  omrScores: "omr-scores",
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
        setConcerts(localData);
      } catch (err) {
        console.warn("[OrkMap] IndexedDB load failed, using memory:", err);
        if (email === ALEX_EMAIL && initialConcerts) {
          localData = initialConcerts.map((item) => withOwner(item, email));
          setConcerts(localData);
        }
      }
      try {
        const remote = await withTimeout(loadRemote(SYNC_TYPES.concerts), REMOTE_LOAD_TIMEOUT_MS, "Concert sync load");
        if (remote.available && Array.isArray(remote.data)) {
          const remoteData = remote.data.map((item) => withOwner(item, email));
          setConcerts(remoteData);
          await withTimeout(saveLocal(remoteData), LOCAL_LOAD_TIMEOUT_MS, "Concert cache save");
        } else if (remote.available && canSeedRemoteFromLocal && localData.length > 0) {
          await withTimeout(
            saveRemote(SYNC_TYPES.concerts, localData.map((item) => withOwner(item, email))),
            REMOTE_LOAD_TIMEOUT_MS,
            "Concert initial sync save"
          );
        }
      } catch (err) {
        console.warn("[OrkMap] Concert sync load failed, using local cache:", err);
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email, saveLocal]);

  // Auto-save to IndexedDB + account sync (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    const owned = data.map((item) => withOwner(item, email));
    try {
      await saveLocal(owned);
    } catch (err) {
      console.warn("[OrkMap] IndexedDB save failed:", err);
    }
    try {
      await saveRemote(SYNC_TYPES.concerts, owned);
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
      try {
        const remote = await withTimeout(loadRemote(SYNC_TYPES.photos), REMOTE_LOAD_TIMEOUT_MS, "Photo sync load");
        if (remote.available && remote.data && typeof remote.data === "object" && !Array.isArray(remote.data)) {
          setPhotos(remote.data);
          await withTimeout(saveLocal(remote.data), LOCAL_LOAD_TIMEOUT_MS, "Photo cache save");
        } else if (remote.available && Object.keys(localData).length > 0) {
          await withTimeout(saveRemote(SYNC_TYPES.photos, localData), REMOTE_LOAD_TIMEOUT_MS, "Photo initial sync save");
        }
      } catch (err) {
        console.warn("[OrkMap] Photo sync load failed, using local cache:", err);
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
    try {
      await saveRemote(SYNC_TYPES.photos, data);
    } catch (err) {
      console.warn("[OrkMap] Photo sync save failed:", err);
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
      try {
        const remote = await withTimeout(loadRemote(SYNC_TYPES.omrScores), REMOTE_LOAD_TIMEOUT_MS, "OMR sync load");
        if (remote.available && Array.isArray(remote.data)) {
          const remoteData = remote.data.map((item) => withOwner(item, email));
          setScores(remoteData);
          await withTimeout(saveLocal(remoteData), LOCAL_LOAD_TIMEOUT_MS, "OMR cache save");
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
    try {
      await saveRemote(SYNC_TYPES.omrScores, owned);
    } catch (err) {
      console.warn("[OrkMap] OMR sync save failed:", err);
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
