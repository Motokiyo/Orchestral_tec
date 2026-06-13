import { useState, useEffect, useRef, useCallback } from "react";
import { openDB } from "idb";

const DB_NAME = "orkmap-db";
const DB_VERSION = 3;
const STORE = "concerts";
const PHOTOS_STORE = "photos";
const OMR_STORE = "omr-scores";
const DEBOUNCE_MS = 500;

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
export function useConcerts(initialConcerts) {
  const [concerts, setConcerts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const all = await db.getAll(STORE);
        if (all.length > 0) {
          setConcerts(all);
        } else if (initialConcerts && initialConcerts.length > 0) {
          // First launch: seed with demo data
          setConcerts(initialConcerts);
          // Save demo data to DB
          const tx = db.transaction(STORE, "readwrite");
          for (const c of initialConcerts) {
            await tx.store.put(c);
          }
          await tx.done;
        }
      } catch (err) {
        console.warn("[OrkMap] IndexedDB load failed, using memory:", err);
        if (initialConcerts) setConcerts(initialConcerts);
      }
      setLoaded(true);
    })();
  }, []);

  // Auto-save to IndexedDB (debounced)
  const save = useCallback(async (data) => {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE, "readwrite");
      // Get existing IDs in DB
      const existingKeys = await tx.store.getAllKeys();
      const newIds = new Set(data.map((c) => c.id));
      // Delete removed concerts
      for (const key of existingKeys) {
        if (!newIds.has(key)) await tx.store.delete(key);
      }
      // Put all current concerts
      for (const c of data) {
        await tx.store.put(c);
      }
      await tx.done;
    } catch (err) {
      console.warn("[OrkMap] IndexedDB save failed:", err);
    }
  }, []);

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

  return [concerts, setConcertsAndSave, loaded];
}

/**
 * Hook: persistent photos state backed by IndexedDB.
 * Photos are stored as { [pieceKey]: photoData[] }.
 * Returns [photos, setPhotos, loaded] — same API as useState.
 */
export function usePhotos() {
  const [photos, setPhotos] = useState({});
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const stored = await db.get(PHOTOS_STORE, "all-photos");
        if (stored) {
          setPhotos(stored);
        }
      } catch (err) {
        console.warn("[OrkMap] Photos load failed:", err);
      }
      setLoaded(true);
    })();
  }, []);

  // Auto-save to IndexedDB (debounced)
  const save = useCallback(async (data) => {
    try {
      const db = await getDB();
      await db.put(PHOTOS_STORE, data, "all-photos");
    } catch (err) {
      console.warn("[OrkMap] Photos save failed:", err);
    }
  }, []);

  // Wrap setPhotos to trigger debounced save
  const setPhotosAndSave = useCallback((fn) => {
    setPhotos((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
      return next;
    });
  }, [save]);

  return [photos, setPhotosAndSave, loaded];
}

/**
 * Hook: persistent OMR scores backed by IndexedDB.
 * Returns [scores, setScores, loaded] — same API as useState.
 */
export function useOmrScores() {
  const [scores, setScores] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const db = await getDB();
        const all = await db.getAll(OMR_STORE);
        setScores(all);
      } catch (err) {
        console.warn("[OrkMap] OMR scores load failed:", err);
      }
      setLoaded(true);
    })();
  }, []);

  const save = useCallback(async (data) => {
    try {
      const db = await getDB();
      const tx = db.transaction(OMR_STORE, "readwrite");
      const existingKeys = await tx.store.getAllKeys();
      const newIds = new Set(data.map((score) => score.id));
      for (const key of existingKeys) {
        if (!newIds.has(key)) await tx.store.delete(key);
      }
      for (const score of data) {
        await tx.store.put(score);
      }
      await tx.done;
    } catch (err) {
      console.warn("[OrkMap] OMR scores save failed:", err);
    }
  }, []);

  const setScoresAndSave = useCallback((fn) => {
    setScores((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), DEBOUNCE_MS);
      return next;
    });
  }, [save]);

  return [scores, setScoresAndSave, loaded];
}
