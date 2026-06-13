import { useState, useEffect, useRef, useCallback } from "react";
import { openDB } from "idb";

const DB_NAME = "orkmap-db";
const DB_VERSION = 4;
const STORE = "concerts";
const PHOTOS_STORE = "photos";
const OMR_STORE = "omr-scores";
const BACKUP_STORE = "migration-backups";
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
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
      }
    },
  });
}

export async function exportLocalDataForMigration() {
  const db = await getDB();
  const concerts = (await db.getAll(STORE)).filter((item) => belongsToUser(item, ALEX_EMAIL));
  const legacyPhotos = await db.get(PHOTOS_STORE, "all-photos");
  const alexPhotos = await db.get(PHOTOS_STORE, photosKey(ALEX_EMAIL));
  const omrScores = (await db.getAll(OMR_STORE)).filter((item) => belongsToUser(item, ALEX_EMAIL));
  return {
    version: 1,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    ownerEmail: ALEX_EMAIL,
    exportedAt: new Date().toISOString(),
    concerts,
    photos: alexPhotos || legacyPhotos || {},
    omrScores,
  };
}

export async function importMigratedDataForUser(payload, userEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) throw new Error("Utilisateur manquant.");
  if (payload?.version !== 1 || payload?.dbName !== DB_NAME) throw new Error("Format de migration invalide.");
  const concerts = Array.isArray(payload?.concerts) ? payload.concerts : [];
  const omrScores = Array.isArray(payload?.omrScores) ? payload.omrScores : [];
  const photos = payload?.photos && typeof payload.photos === "object" ? payload.photos : {};
  const db = await getDB();

  const existingConcerts = (await db.getAll(STORE)).filter((item) => belongsToUser(item, email));
  const existingPhotos = (await db.get(PHOTOS_STORE, photosKey(email))) || {};
  const existingOmrScores = (await db.getAll(OMR_STORE)).filter((item) => belongsToUser(item, email));
  await db.put(BACKUP_STORE, {
    id: `backup:${email}:${Date.now()}`,
    ownerEmail: email,
    createdAt: new Date().toISOString(),
    concerts: existingConcerts,
    photos: existingPhotos,
    omrScores: existingOmrScores,
  });

  const mergedConcerts = new Map();
  for (const concert of existingConcerts) {
    if (concert?.id && !(concert.id === "demo" && concerts.length > 0)) {
      mergedConcerts.set(concert.id, withOwner(concert, email));
    }
  }
  for (const concert of concerts) {
    if (concert?.id) mergedConcerts.set(concert.id, withOwner(concert, email));
  }

  const concertTx = db.transaction(STORE, "readwrite");
  const concertKeys = await concertTx.store.getAllKeys();
  for (const key of concertKeys) {
    const existing = await concertTx.store.get(key);
    if (belongsToUser(existing, email)) await concertTx.store.delete(key);
  }
  for (const concert of mergedConcerts.values()) {
    await concertTx.store.put(concert);
  }
  await concertTx.done;

  await db.put(PHOTOS_STORE, { ...existingPhotos, ...photos }, photosKey(email));

  const mergedOmrScores = new Map();
  for (const score of existingOmrScores) {
    if (score?.id) mergedOmrScores.set(score.id, withOwner(score, email));
  }
  for (const score of omrScores) {
    if (score?.id) mergedOmrScores.set(score.id, withOwner(score, email));
  }

  const omrTx = db.transaction(OMR_STORE, "readwrite");
  const omrKeys = await omrTx.store.getAllKeys();
  for (const key of omrKeys) {
    const existing = await omrTx.store.get(key);
    if (belongsToUser(existing, email)) await omrTx.store.delete(key);
  }
  for (const score of mergedOmrScores.values()) {
    await omrTx.store.put(score);
  }
  await omrTx.done;

  return {
    concerts: mergedConcerts.size,
    photoGroups: Object.keys(photos).length,
    omrScores: mergedOmrScores.size,
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
