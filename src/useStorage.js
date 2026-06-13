import { useState, useEffect, useRef, useCallback } from "react";
import { openDB } from "idb";

const DB_NAME = "orkmap-db";
const DB_VERSION = 4;
const STORE = "concerts";
const PHOTOS_STORE = "photos";
const OMR_STORE = "omr-scores";
const DEBOUNCE_MS = 500;
const ALEX_EMAIL = "alexferran@gmail.com";

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

  // Load from IndexedDB on mount
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
      try {
        const db = await getDB();
        const all = await db.getAll(STORE);
        const matching = all.filter((item) => belongsToUser(item, email));
        const needsMigration = email === ALEX_EMAIL && matching.some((item) => !item.ownerEmail);
        const owned = matching.map((item) => withOwner(item, email));
        if (owned.length > 0) {
          setConcerts(owned);
          if (needsMigration) {
            const tx = db.transaction(STORE, "readwrite");
            for (const c of owned) await tx.store.put(c);
            await tx.done;
          }
        } else if (email === ALEX_EMAIL && initialConcerts && initialConcerts.length > 0) {
          // First launch: seed with demo data
          const seeded = initialConcerts.map((item) => withOwner(item, email));
          setConcerts(seeded);
          // Save demo data to DB
          const tx = db.transaction(STORE, "readwrite");
          for (const c of seeded) {
            await tx.store.put(c);
          }
          await tx.done;
        } else {
          setConcerts([]);
        }
      } catch (err) {
        console.warn("[OrkMap] IndexedDB load failed, using memory:", err);
        if (email === ALEX_EMAIL && initialConcerts) setConcerts(initialConcerts.map((item) => withOwner(item, email)));
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email]);

  // Auto-save to IndexedDB (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    try {
      const db = await getDB();
      const tx = db.transaction(STORE, "readwrite");
      // Get existing IDs in DB
      const existingKeys = await tx.store.getAllKeys();
      const newIds = new Set(data.map((c) => c.id));
      // Delete removed concerts
      for (const key of existingKeys) {
        const existing = await tx.store.get(key);
        if (belongsToUser(existing, email) && !newIds.has(key)) await tx.store.delete(key);
      }
      // Put all current concerts
      for (const c of data) {
        await tx.store.put(withOwner(c, email));
      }
      await tx.done;
    } catch (err) {
      console.warn("[OrkMap] IndexedDB save failed:", err);
    }
  }, [email]);

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

  // Load from IndexedDB on mount
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
      try {
        const db = await getDB();
        let stored = await db.get(PHOTOS_STORE, photosKey(email));
        if (!stored && email === ALEX_EMAIL) {
          stored = await db.get(PHOTOS_STORE, "all-photos");
          if (stored) await db.put(PHOTOS_STORE, stored, photosKey(email));
        }
        if (stored) {
          setPhotos(stored);
        } else {
          setPhotos({});
        }
      } catch (err) {
        console.warn("[OrkMap] Photos load failed:", err);
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email]);

  // Auto-save to IndexedDB (debounced)
  const save = useCallback(async (data) => {
    if (!email) return;
    try {
      const db = await getDB();
      await db.put(PHOTOS_STORE, data, photosKey(email));
    } catch (err) {
      console.warn("[OrkMap] Photos save failed:", err);
    }
  }, [email]);

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
      try {
        const db = await getDB();
        const all = await db.getAll(OMR_STORE);
        const matching = all.filter((item) => belongsToUser(item, email));
        const needsMigration = email === ALEX_EMAIL && matching.some((item) => !item.ownerEmail);
        const owned = matching.map((item) => withOwner(item, email));
        setScores(owned);
        if (needsMigration) {
          const tx = db.transaction(OMR_STORE, "readwrite");
          for (const score of owned) await tx.store.put(score);
          await tx.done;
        }
      } catch (err) {
        console.warn("[OrkMap] OMR scores load failed:", err);
      }
      setLoaded(true);
      setLoadedFor(email);
    })();
  }, [email]);

  const save = useCallback(async (data) => {
    if (!email) return;
    try {
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
    } catch (err) {
      console.warn("[OrkMap] OMR scores save failed:", err);
    }
  }, [email]);

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
