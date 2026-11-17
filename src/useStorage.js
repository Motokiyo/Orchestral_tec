import { useState, useEffect, useRef, useCallback } from "react";
import { openDB } from "idb";
import {
  buildImageIndex, collectImageRefs, createImageRegistry, downloadPlanImage, hasInlineImages, hashOfRef,
  isAnyImageRef, isImageRef, mapImageStrings, outgoingForm, prepareConcertsUpload, refOf, rehydrateImages,
  RETRY_DELAYS_MS,
} from "./planImages.js";
import {
  applyStoredRefs, createImageCache, IMAGES_STORE, inlineStoredImages, listStoredHashes, readStoredImage,
  storeInlineImages, writeVerifiedImage,
} from "./localImages.js";

const DB_NAME = "orkmap-db";
// 5 (lot 6) : magasin « images » (images des plans rangées à part, clé = empreinte sha256).
const DB_VERSION = 5;
const STORE = "concerts";
const PHOTOS_STORE = "photos";
const OMR_STORE = "omr-scores";
const DEBOUNCE_MS = 500;
const LOCAL_LOAD_TIMEOUT_MS = 4000;
// Si IndexedDB ne répond pas dans le délai ci-dessus, on passe en mode dégradé
// (lecture seule côté serveur) et on relit patiemment : jamais d'envoi ni
// d'écriture dans IndexedDB tant qu'une lecture n'a pas réussi.
export const LOCAL_RETRY_TIMEOUTS_MS = [15000, 30000, 60000];
const LOCAL_RETRY_PAUSE_MS = 5000;
// Vercel refuse tout corps de requête au-delà de 4,5 Mo : on s'arrête à 4 Mo
// (mesure en octets) et on le dit, au lieu d'un faux « Envoi en cours ».
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
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
  images: IMAGES_STORE,
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

function concertsBackupPrevKey(email) {
  return `orkmap-concerts-backup-prev:${email}`;
}

// ── État partagé lu par le bandeau (voir useSyncStatus) ──
// backupFailed : le téléphone n'arrive plus à écrire dans son stockage de secours
//   (quota plein) : la copie de secours ou la file d'attente peut être périmée.
// degraded : IndexedDB est lent ou en échec ; rien n'est envoyé au serveur.
// oversize : types de données trop volumineux pour l'envoi (limite Vercel).
// upgradeBlocked : une autre fenêtre OrkMap (ancienne version) empêche la mise à jour de la base.
const syncFlags = { backupFailed: false, degraded: false, upgradeBlocked: false };
const oversize = new Map();
// imageRetry : une image de plan n'a pas pu partir, nouvel essai plus tard (les concerts attendent).
// unsentPlans : plans gardés sur ce téléphone seulement (trop lourds ou illisibles pour le compte).
const imageRetry = new Map();
const unsentPlans = new Map();

function setImageRetry(email, nextAt) {
  const key = String(email);
  if (nextAt === null) {
    if (imageRetry.delete(key)) notifySyncStatus();
    return;
  }
  imageRetry.set(key, nextAt);
  notifySyncStatus();
}

function setUnsentPlans(email, count) {
  const key = String(email);
  const previous = unsentPlans.get(key) || 0;
  if (count > 0) unsentPlans.set(key, count);
  else unsentPlans.delete(key);
  if (previous !== count) notifySyncStatus();
}

function setSyncFlag(name, value) {
  if (syncFlags[name] === value) return;
  syncFlags[name] = value;
  notifySyncStatus();
}

const backupIdsCache = new Map();

function idsOf(list) {
  return new Set((Array.isArray(list) ? list : []).map((item) => item?.id).filter(Boolean));
}

// Copie de secours des concerts. Jamais écrasée en silence :
// - un échec d'écriture (quota) est exposé via l'état « backupFailed » ;
// - si la nouvelle liste perd des concerts sans suppression explicite, l'ancienne
//   copie est gardée dans une seconde clé (« -prev ») avant d'être remplacée.
export function writeConcertsBackup(email, data, { removedIds = [] } = {}) {
  if (!email || !Array.isArray(data)) return { ok: true, skipped: true };
  const key = concertsBackupKey(email);
  // Une liste vide n'écrase la copie que si TOUS les concerts de la copie ont été supprimés
  // explicitement (suppression du dernier concert) : sinon une liste vide vient d'un chargement
  // raté ou d'un état transitoire, et elle est ignorée comme avant.
  const emptying = data.length === 0;
  if (emptying && removedIds.length === 0) return { ok: true, skipped: true };
  try {
    const nextIds = idsOf(data);
    let previousIds = backupIdsCache.get(email);
    if (!previousIds) {
      try {
        const rawPrevious = localStorage.getItem(key);
        previousIds = idsOf(rawPrevious ? JSON.parse(rawPrevious) : []);
      } catch {
        previousIds = new Set();
      }
    }
    const explicit = new Set(removedIds.map(String));
    if (emptying && (previousIds.size === 0 || Array.from(previousIds).some((id) => !explicit.has(String(id))))) {
      return { ok: true, skipped: true };
    }
    const lost = Array.from(previousIds).filter((id) => !nextIds.has(id) && !explicit.has(String(id)));
    if (lost.length > 0 || emptying) {
      try {
        const rawPrevious = localStorage.getItem(key);
        if (rawPrevious) localStorage.setItem(concertsBackupPrevKey(email), rawPrevious);
      } catch {
        // pas de place pour la génération précédente : on continue, l'échec principal sera signalé s'il y en a un
      }
    }
    localStorage.setItem(key, JSON.stringify(data));
    backupIdsCache.set(email, nextIds);
    setSyncFlag("backupFailed", false);
    return { ok: true };
  } catch (err) {
    console.warn("[OrkMap] Concert backup failed:", err);
    setSyncFlag("backupFailed", true);
    return { ok: false, reason: String(err?.name || err?.message || err) };
  }
}

export function readConcertsBackup(email) {
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

// Forme canonique (clés triées à tous les niveaux) : le serveur (jsonb) réordonne les clés, donc
// comparer le texte JSON brut dirait « différent » à chaque ouverture et renverrait tout.
export function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const out = {};
      for (const key of Object.keys(v).sort()) out[key] = sort(v[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function sameData(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// ── Registre des images de plans, par compte (copies réduites, refus, attentes) ──
// Rangé dans IndexedDB (magasin « photos », clé à part, jamais exportée comme une photo). Le compte
// fait foi sur « quelles images a-t-il » ; ce registre ne garde que ce que le téléphone a décidé.
const IMAGE_REGISTRY_PREFIX = "orkmap-image-registry:";
const imageRegistries = new Map();

export function imageRegistryKey(email) {
  return `${IMAGE_REGISTRY_PREFIX}${email}`;
}

export function getImageRegistry(email) {
  if (!imageRegistries.has(email)) {
    imageRegistries.set(email, (async () => {
      let initial = null;
      try {
        initial = (await withTimeout(getDB().then((db) => db.get(PHOTOS_STORE, imageRegistryKey(email))), LOCAL_LOAD_TIMEOUT_MS, "Image registry load")) || null;
      } catch (err) {
        console.warn("[OrkMap] Plan image registry unreadable, starting empty:", err?.message || err);
      }
      return createImageRegistry(initial, {
        persist: async (state) => { const db = await getDB(); await db.put(PHOTOS_STORE, state, imageRegistryKey(email)); },
      });
    })());
  }
  return imageRegistries.get(email);
}

// ── Magasin local des images (lot 6, voir localImages.js) ──
// Index en mémoire des empreintes présentes dans le magasin « images » de ce téléphone : lu une fois
// (liste des clés, quelques octets par image), tenu à jour à chaque écriture vérifiée.
let storedHashes = null;

export async function ensureStoredHashes() {
  if (storedHashes) return storedHashes;
  try {
    const hashes = await withTimeout(getDB().then(listStoredHashes), LOCAL_LOAD_TIMEOUT_MS, "Plan images index");
    storedHashes = storedHashes || hashes;
    return storedHashes;
  } catch (err) {
    console.warn("[OrkMap] Plan images index unreadable for now:", err?.message || err);
    return new Set();
  }
}

function noteStored(hash) {
  if (storedHashes) storedHashes.add(hash);
}

// Rangement des images (relecture du lot 6, S3) : une image déjà dans le magasin n'est ni relue ni
// réécrite ; une image refusée (place) attend 1, 5, 15 puis 60 min avant un nouvel essai.
const storeRetry = new Map();

export async function storeImagesOnce(list, { now = () => Date.now() } = {}) {
  const known = await ensureStoredHashes();
  return storeInlineImages(await getDB(), list, {
    known,
    shouldTry: (hash) => !(storeRetry.get(hash)?.nextAt > now()),
    onStored: (hash) => { noteStored(hash); storeRetry.delete(hash); },
    onFailed: (hash) => {
      const failures = (storeRetry.get(hash)?.failures || 0) + 1;
      storeRetry.set(hash, { failures, nextAt: now() + RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1] });
    },
  });
}

// Source « images du téléphone » pour l'envoi (planImages.js) : has() sans attente, get() lit le magasin.
async function localImageSource() {
  const hashes = await ensureStoredHashes();
  return {
    has: (hash) => hashes.has(hash),
    get: async (hash) => readStoredImage(await getDB(), hash),
  };
}

// Compte dont les écrans affichent les plans (registre des copies réduites pour retrouver un original).
let activeImageEmail = "";
const PLAN_IMAGE_EVENT = "orkmap-plan-image";
const displayCache = createImageCache();
const imageLoads = new Map();

// Image téléchargée du compte : gardée en mémoire pour l'affichage, rangée dans le magasin (vérifiée),
// et les cadres « Plan non disponible » qui l'attendaient sont prévenus.
async function storeDownloaded(hash, dataUrl) {
  displayCache.set(hash, dataUrl);
  try {
    if (await writeVerifiedImage(await getDB(), hash, dataUrl)) noteStored(hash);
  } catch (err) {
    console.warn("[OrkMap] Downloaded plan image kept in memory only:", err?.message || err);
  }
  try {
    window.dispatchEvent(Object.assign(new Event(PLAN_IMAGE_EVENT), { hash }));
  } catch {
    // pas de fenêtre (tests) : rien à prévenir
  }
}

export function onPlanImageStored(listener) {
  if (typeof window === "undefined" || !window.addEventListener) return () => {};
  const handler = (event) => listener(event?.hash);
  window.addEventListener(PLAN_IMAGE_EVENT, handler);
  return () => window.removeEventListener(PLAN_IMAGE_EVENT, handler);
}

// Image à afficher (ou à envoyer à la lecture IA) pour une valeur de plans[] : un data URL est rendu tel
// quel ; une référence est lue dans le cache mémoire, sinon dans le magasin local (ou l'original d'une copie
// réduite), sinon téléchargée du compte si le réseau est là (`download`). null : pas disponible.
// Délai au-delà duquel le plan n'attend plus (cadre avec message, nouvel essai à l'arrivée de l'image).
export const PLAN_LOAD_TIMEOUT_MS = 20000;

export async function loadPlanImage(value, { download = true, timeoutMs = PLAN_LOAD_TIMEOUT_MS } = {}) {
  if (typeof value !== "string") return null;
  if (!isAnyImageRef(value)) return value;
  const hash = hashOfRef(value);
  const cached = displayCache.get(hash);
  if (cached) return cached;
  const key = `${hash}:${download && isImageRef(value) ? 1 : 0}`;
  if (imageLoads.has(key)) return imageLoads.get(key);
  const job = (async () => {
    try {
      const db = await getDB();
      let image = await readStoredImage(db, hash);
      if (image === null && activeImageEmail) {
        const original = (await getImageRegistry(activeImageEmail)).originalOf(hash);
        if (original) image = await readStoredImage(db, original);
      }
      if (image === null && download && isImageRef(value) && !isOffline()) {
        await downloadMissingImages([hash], { email: activeImageEmail, onFound: storeDownloaded });
        image = displayCache.get(hash) ?? null;
      }
      if (image !== null) displayCache.set(hash, image);
      return image;
    } catch (err) {
      console.warn("[OrkMap] Plan image unavailable:", err?.message || err);
      return null;
    } finally {
      imageLoads.delete(key);
    }
  })();
  imageLoads.set(key, job);
  // Jamais « Chargement du plan… » sans fin : passé le délai, null (le téléchargement peut finir ensuite ;
  // il range l'image et prévient l'écran).
  return withTimeout(job, timeoutMs, "Plan image load").catch(() => null);
}

// Toutes les images d'une liste de plans, pour la lecture IA : seules celles disponibles sont rendues.
export async function loadPlanImages(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const image = await loadPlanImage(value);
    if (typeof image === "string") out.push(image);
  }
  return out;
}

// ── Images des plans reçues du compte (références « orkimg: », voir planImages.js) ──
// Lot 6 : une référence dont l'image est dans le magasin du téléphone (même empreinte, ou copie réduite
// d'un original du téléphone, ou « orkimg-local: » d'une image d'ici) devient « orkimg:<original> », la
// forme des concerts locaux. Une référence dont l'image est encore DANS un concert du téléphone (ancien
// format, pas encore rangé : `localSources`) redevient cette image. Les autres restent des références.
export async function resolveImagesFromDevice(remoteData, localSources, email) {
  if (!collectImageRefs(remoteData, { includeUnsent: true }).size) return remoteData;
  const stored = await ensureStoredHashes();
  const registry = email ? await getImageRegistry(email) : null;
  const localHash = (hash) => {
    if (stored.has(hash)) return hash;
    const original = registry?.originalOf(hash);
    return original && stored.has(original) ? original : null;
  };
  let remaining = false;
  const canonical = mapImageStrings(remoteData, (text) => {
    if (!isAnyImageRef(text)) return text;
    const hash = localHash(hashOfRef(text));
    if (hash) return refOf(hash);
    remaining = true;
    return text;
  });
  if (!remaining) return canonical;
  const index = new Map(Array.from(await buildImageIndex(localSources)).filter(([hash]) => !stored.has(hash)));
  if (!index.size) return canonical;
  return rehydrateImages(canonical, index, registry).data;
}

// Après une fusion locale (mode mémoire lente, rechargement) : une référence ne remplace JAMAIS une
// image présente sur le téléphone (magasin local, ou encore dans un concert de `sources`).
async function keepDeviceImages(list, sources, email) {
  return resolveImagesFromDevice(list, sources, email);
}

// Références d'une liste dont l'image n'est PAS sur ce téléphone (à télécharger du compte).
export async function refsNotOnDevice(data, { includeUnsent = false } = {}) {
  const stored = await ensureStoredHashes();
  return new Set(Array.from(collectImageRefs(data, { includeUnsent })).filter((hash) => !stored.has(hash)));
}

// Attentes croissantes des téléchargements en échec, par image (mémoire de la session).
const downloadRetry = new Map();

// Télécharge les images manquantes, une par une. Une erreur sur une image ne bloque pas les suivantes :
// cette image attend (1, 5, 15, puis 60 min) avant un nouvel essai. Une image absente du compte (404)
// est notée dans `gone`. Hors ligne : arrêt. Renvoie Map<empreinte, data URL>.
// `onFound(empreinte, image)` : appelé à chaque image reçue (rangement dans le magasin local) ; l'image
// n'est alors pas gardée dans la Map rendue (valeur true), pour ne pas tenir 20 Mo en mémoire.
export async function downloadMissingImages(hashes, { email, gone = new Set(), stillValid = () => true, now = () => Date.now(), onFound = null } = {}) {
  const found = new Map();
  for (const hash of hashes) {
    if (gone.has(hash)) continue;
    if (isOffline() || !stillValid()) break;
    const key = `${email}:${hash}`;
    const wait = downloadRetry.get(key);
    if (wait && wait.nextAt > now()) continue;
    try {
      const dataUrl = await downloadPlanImage(hash, { onUnauthorized: () => setSessionExpired(true) });
      downloadRetry.delete(key);
      if (dataUrl === null) gone.add(hash);
      else if (onFound) {
        await onFound(hash, dataUrl);
        found.set(hash, true);
      } else found.set(hash, dataUrl);
    } catch (err) {
      const failures = (wait?.failures || 0) + 1;
      downloadRetry.set(key, { failures, nextAt: now() + RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1] });
      console.warn("[OrkMap] Plan image download deferred:", err?.message || err);
    }
  }
  return found;
}

function prepareConcerts(email) {
  return async (list) => prepareConcertsUpload(email, list, {
    maxBytes: MAX_PAYLOAD_BYTES,
    registry: await getImageRegistry(email),
    local: await localImageSource(),
    onUnauthorized: () => setSessionExpired(true),
    onUnsent: (count) => setUnsentPlans(email, count),
  });
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
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
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

export function measureBytes(text) {
  return new TextEncoder().encode(String(text)).byteLength;
}

async function saveRemote(type, data, removedIds = []) {
  const body = JSON.stringify({ type, data, removedIds });
  const bytes = measureBytes(body);
  if (bytes > MAX_PAYLOAD_BYTES) {
    const error = new Error(`Payload too large: ${bytes} bytes`);
    error.tooLarge = true;
    error.bytes = bytes;
    throw error;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REMOTE_SAVE_TIMEOUT_MS) : null;
  try {
    const resp = await fetch("/api/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body,
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

// Si l'écriture dans localStorage échoue (quota plein), la marque reste en
// mémoire pour la session en cours : l'envoi a lieu quand même, et l'état
// « backupFailed » prévient que la marque ne survivra pas à une fermeture.
const memoryPending = new Map();

export function readPending(email, type) {
  try {
    const raw = localStorage.getItem(pendingKey(email, type));
    if (raw) {
      const parsed = JSON.parse(raw);
      return { rev: Number(parsed.rev || 0), removedIds: Array.isArray(parsed.removedIds) ? parsed.removedIds : [] };
    }
  } catch {
    // illisible : on regarde la copie mémoire
  }
  return memoryPending.get(pendingKey(email, type)) || null;
}

export function markPending(email, type, removedIds = []) {
  if (!email) return;
  const current = readPending(email, type) || { rev: 0, removedIds: [] };
  const ids = Array.from(new Set([...current.removedIds, ...removedIds.map(String)]));
  const record = { rev: current.rev + 1, removedIds: ids };
  try {
    localStorage.setItem(pendingKey(email, type), JSON.stringify({ ...record, since: Date.now() }));
    memoryPending.delete(pendingKey(email, type));
  } catch (err) {
    console.warn("[OrkMap] Pending mark failed:", err);
    memoryPending.set(pendingKey(email, type), record);
    setSyncFlag("backupFailed", true);
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
      memoryPending.delete(pendingKey(email, type));
    } else {
      const sentIds = new Set(sent.removedIds);
      const rest = current.removedIds.filter((id) => !sentIds.has(id));
      const record = { rev: current.rev, removedIds: rest };
      memoryPending.delete(pendingKey(email, type));
      try {
        localStorage.setItem(pendingKey(email, type), JSON.stringify({ ...record, since: Date.now() }));
      } catch (err) {
        memoryPending.set(pendingKey(email, type), record);
        throw err;
      }
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
export function hasUploadInFlight(email, type) {
  return inflight.has(`${email}:${type}`);
}
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

// what : « plan » quand c'est une seule image de plan qui dépasse (et non le JSON entier).
function setOversize(email, type, bytes, rev, what = null) {
  oversize.set(`${email}:${type}`, { type, bytes, rev, what });
  notifySyncStatus();
}

function clearOversize(email, type) {
  if (oversize.delete(`${email}:${type}`)) notifySyncStatus();
}

// Send the latest full state + pending deletions. On 409 (the server knows
// records this device does not have yet), pull them in with `absorbRemote`,
// then try once more. Never throws.
// Trop volumineux (> MAX_PAYLOAD_BYTES) : rien n'est envoyé, la marque « en
// attente » est gardée (les données restent sur l'appareil) et l'état est exposé.
// Tant que rien n'a changé (même révision), on ne recalcule pas toutes les minutes.
// `prepare` (concerts) : transforme la liste avant envoi (images des plans envoyées une par une et
// remplacées par leur référence, voir planImages.js). S'il échoue, rien n'est envoyé, la marque reste.
export function pushPending({ email, type, getPayload, absorbRemote, prepare }) {
  return runExclusive(`${email}:${type}`, async () => {
    const pending = readPending(email, type);
    if (!pending || isOffline()) return;
    if (oversize.get(`${email}:${type}`)?.rev === pending.rev) return;
    // Payload is null while this account's local data is still loading: never
    // send another account's (or an empty) list in its place.
    const payload = getPayload();
    if (payload === null) return;
    const send = async (list) => saveRemote(type, prepare ? await prepare(list) : list, pending.removedIds);
    try {
      await send(payload);
      clearOversize(email, type);
      setImageRetry(email, null);
      settlePending(email, type, pending);
    } catch (err) {
      if (err.imageRetry) {
        console.warn(`[OrkMap] ${type} waiting for plan images (next try ${new Date(err.nextAt || Date.now()).toISOString()})`);
        setImageRetry(email, err.nextAt || Date.now());
        return;
      }
      if (err.tooLarge) {
        console.warn(`[OrkMap] ${type} too large to sync (${err.bytes} bytes), kept on device`);
        setOversize(email, type, err.bytes, pending.rev, err.what);
        return;
      }
      if (err.status !== 409 || !absorbRemote) {
        console.warn(`[OrkMap] ${type} sync deferred:`, err.message);
        return;
      }
      try {
        const remote = await withTimeout(loadRemote(type), REMOTE_LOAD_TIMEOUT_MS, `${type} conflict load`);
        if (remote.available) await absorbRemote(remote.data, pending.removedIds);
        const merged = getPayload();
        if (merged === null) return;
        await send(merged);
        clearOversize(email, type);
        setImageRetry(email, null);
        settlePending(email, type, pending);
      } catch (retryErr) {
        if (retryErr.imageRetry) {
          setImageRetry(email, retryErr.nextAt || Date.now());
          return;
        }
        if (retryErr.tooLarge) {
          setOversize(email, type, retryErr.bytes, pending.rev, retryErr.what);
          return;
        }
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
    pendingWriters.add(runNow);
    return () => { pendingWriters.delete(runNow); };
  }, [runNow]);
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

// Un type bloqué « trop lourd » n'est pas compté : rien n'est en cours d'envoi pour lui, et le bandeau
// ne doit pas afficher « Envoi des modifications… » pour toujours (cas des photos, jamais envoyées).
function countPending() {
  const blocked = (key) => oversize.has(String(key).slice(PENDING_PREFIX.length));
  let count = 0;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = String(localStorage.key(index));
      if (key.startsWith(PENDING_PREFIX) && !memoryPending.has(key) && !blocked(key)) count += 1;
    }
  } catch {
    count = 0;
  }
  for (const key of memoryPending.keys()) if (!blocked(key)) count += 1;
  return count;
}

export function readSyncStatus() {
  return {
    online: !isOffline(),
    pending: countPending(),
    sessionExpired,
    backupFailed: syncFlags.backupFailed,
    degraded: syncFlags.degraded,
    upgradeBlocked: syncFlags.upgradeBlocked,
    oversize: Array.from(oversize.values()).map(({ type, bytes, what }) => ({ type, bytes, what })),
    imageRetry: imageRetry.size > 0,
    unsentPlans: Array.from(unsentPlans.values()).reduce((sum, n) => sum + n, 0),
  };
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

// Une SEULE connexion IndexedDB, gardée (avant le lot 6 : une connexion neuve à chaque appel, jamais
// fermée ; une mise à jour de la base dans un autre onglet restait alors bloquée en silence).
// - blocking : une version plus récente de l'app (autre fenêtre) veut monter la base. On écrit ce qui
//   attend (enregistrements différés, 2 s au plus), on ferme la connexion et on recharge la page, qui
//   repart sur la nouvelle version.
// - blocked : c'est NOUS qui attendons qu'une ancienne fenêtre se ferme : message clair à l'écran.
// - terminated : le navigateur a coupé la connexion ; la suivante sera rouverte.
// Retour arrière : la base est en version 5 ; une version de l'app antérieure au lot 6 (version 4) ne
// peut plus l'ouvrir (voir DECISIONS.md, 17/11/2026).
const pendingWriters = new Set(); // enregistrements différés à faire tout de suite (fermeture, mise à jour)
let dbPromise = null;
const UPGRADE_FLUSH_MS = 2000;
const defaultReload = () => { try { window.location.reload(); } catch { /* pas de page (tests) */ } };
let reloadPage = defaultReload;
// Pour les tests : remplace le rechargement de la page.
export function setPageReloader(fn) { reloadPage = fn || defaultReload; }

async function closeForUpgrade() {
  const current = dbPromise;
  try {
    const writes = Array.from(pendingWriters, (run) => Promise.resolve().then(run));
    await Promise.race([Promise.allSettled(writes), new Promise((r) => setTimeout(r, UPGRADE_FLUSH_MS))]);
  } catch {
    // rien de plus à écrire
  }
  try { (await current)?.close(); } catch { /* déjà fermée */ }
  if (dbPromise === current) dbPromise = null;
  reloadPage();
}

function getDB() {
  if (dbPromise) return dbPromise;
  const opening = openDB(DB_NAME, DB_VERSION, {
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
      // Lot 6 : ajout seulement, rien n'est déplacé ici (la migration se fait en arrière-plan, voir useConcerts).
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE);
      }
    },
    blocked() {
      setSyncFlag("upgradeBlocked", true);
    },
    blocking() {
      closeForUpgrade();
    },
    terminated() {
      if (dbPromise === opening) dbPromise = null;
    },
  }).then((db) => {
    setSyncFlag("upgradeBlocked", false);
    return db;
  }, (err) => {
    if (dbPromise === opening) dbPromise = null;
    throw err;
  });
  dbPromise = opening;
  return opening;
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

// ───────────────────────────────────────────────────────────────────────────
// Export local SANS envoi : un fichier JSON complet de ce que contient l'appareil
// (concerts + photos + partitions), pour garder une sauvegarde à la main.
// Contrairement à exportLocalDataForRecovery, rien n'est dupliqué dans le fichier
// et rien n'est envoyé au serveur.
// ───────────────────────────────────────────────────────────────────────────
const SAFETY_COPY_PREFIX = "orkmap-safety-copy:";

// Nombre réel de photos d'un enregistrement { [pièce]: photo[] } (et non le nombre de clés).
function countPhotosIn(value) {
  if (!value || typeof value !== "object") return 0;
  let n = 0;
  for (const list of Object.values(value)) if (Array.isArray(list)) n += list.length;
  return n;
}

// Lot 6 : les concerts du téléphone portent des références d'images ; le fichier, lui, doit se suffire :
// chaque référence dont l'image est sur ce téléphone (magasin « images », ou original d'une copie réduite)
// est remplacée par la vraie image. Une image absente du téléphone (compte jamais téléchargé) reste une
// référence, comptée dans `plansNonInclus`.
// `email` : n'exporte que les données de ce compte (concerts, photos, partitions). Sans lui, tout
// ce qui est sur l'appareil est exporté. Dans les deux cas, les copies de sécurité du rechargement
// (clés « orkmap-safety-copy:… » rangées dans le magasin photos) ne sont JAMAIS exportées : ce ne
// sont ni des photos ni des données à garder dans un fichier.
export async function buildLocalSnapshot(db, { email } = {}) {
  const database = db || (await getDB());
  const account = normalizeEmail(email);
  const allConcerts = await database.getAll(STORE);
  const ownConcerts = account ? allConcerts.filter((item) => belongsToUser(item, account)) : allConcerts;
  // Table copie réduite → original : celle du compte demandé, sinon celles des comptes des concerts exportés.
  const owners = account ? [account] : Array.from(new Set(ownConcerts.map((c) => normalizeEmail(c?.ownerEmail || ALEX_EMAIL)).filter(Boolean)));
  const registries = [];
  for (const owner of owners) {
    try { registries.push(createImageRegistry(await database.get(PHOTOS_STORE, imageRegistryKey(owner)))); } catch { /* illisible : sans */ }
  }
  const { data: concerts, missing: plansNonInclus } = await inlineStoredImages(database, ownConcerts, {
    originalOf: (hash) => registries.map((r) => r.originalOf(hash)).find(Boolean) || null,
  });
  const photoKeys = await database.getAllKeys(PHOTOS_STORE);
  const photos = [];
  for (const key of photoKeys) {
    if (String(key).startsWith(SAFETY_COPY_PREFIX) || String(key).startsWith(IMAGE_REGISTRY_PREFIX)) continue;
    if (account && key !== photosKey(account)) continue;
    photos.push({ key, value: await database.get(PHOTOS_STORE, key) });
  }
  const allScores = await database.getAll(OMR_STORE);
  const omrScores = account ? allScores.filter((item) => belongsToUser(item, account)) : allScores;
  return {
    kind: "orkmap-local-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    origin: typeof window !== "undefined" ? window.location?.origin : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    dbName: DB_NAME,
    dbVersion: DB_VERSION,
    counts: {
      concerts: concerts.length,
      photos: photos.reduce((sum, entry) => sum + countPhotosIn(entry.value), 0),
      omrScores: omrScores.length,
    },
    plansNonInclus,
    concerts,
    photos,
    omrScores,
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function localExportFilename(date = new Date()) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `orkmap-sauvegarde-locale-${d}-${t}.json`;
}

// Déclenche le téléchargement d'un fichier texte dans le navigateur.
export function downloadTextFile(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportLocalDataToFile({ db, download = downloadTextFile, email } = {}) {
  const snapshot = await buildLocalSnapshot(db, { email });
  const text = JSON.stringify(snapshot);
  const filename = localExportFilename();
  download(filename, text);
  return { filename, bytes: measureBytes(text), counts: snapshot.counts, plansNonInclus: snapshot.plansNonInclus };
}

// ───────────────────────────────────────────────────────────────────────────
// C1 : « Recharger depuis le compte » sans jamais rien détruire.
// Règles : refuser si la réponse serveur est vide/invalide, refuser s'il reste
// des modifications à envoyer, mettre la version locale de côté AVANT tout
// remplacement, ne remplacer que les concerts présents des deux côtés, garder
// les concerts locaux absents du serveur, ne calculer aucun removedIds.
// ───────────────────────────────────────────────────────────────────────────
function refuse(raison) {
  return { refus: true, raison };
}

// keepLocal : ids dont la version du compte a des plans restés sans image (téléchargement impossible) :
// la version du téléphone est gardée pour eux (« plansManquants »), jamais une référence à la place d'une image.
export function planSafeReload({ serverData, localConcerts, email, keepLocal = new Set() }) {
  if (!Array.isArray(serverData)) return refuse("Réponse du serveur invalide : rien n'a été changé.");
  if (serverData.length === 0) return refuse("Le compte ne contient aucun concert : rien n'a été changé (tes concerts locaux sont intacts).");
  for (const item of serverData) {
    if (!item || typeof item !== "object" || item.id === undefined || item.id === null || item.id === "") {
      return refuse("Réponse du serveur invalide (concert sans identifiant) : rien n'a été changé.");
    }
  }
  const serverById = new Map(serverData.map((item) => [String(item.id), item]));
  const local = Array.isArray(localConcerts) ? localConcerts : [];
  const localIds = new Set();
  const merged = [];
  let remplaces = 0;
  let conserves = 0;
  let plansManquants = 0;
  for (const item of local) {
    if (!item || item.id === undefined || item.id === null) continue;
    const id = String(item.id);
    localIds.add(id);
    const fromServer = serverById.get(id);
    if (fromServer && keepLocal.has(id)) {
      merged.push(item);
      plansManquants += 1;
    } else if (fromServer) {
      merged.push(withOwner(fromServer, email));
      remplaces += 1;
    } else {
      merged.push(item);
      conserves += 1;
    }
  }
  let ajoutes = 0;
  for (const [id, item] of serverById) {
    if (localIds.has(id)) continue;
    merged.push(withOwner(item, email));
    ajoutes += 1;
  }
  return { refus: false, merged, "remplacés": remplaces, "conservés": conserves, "ajoutés": ajoutes, plansManquants };
}

// Copie de secours horodatée, jamais écrasée (clé unique à chaque appel).
// Dans IndexedDB d'abord (grand quota, relue pour vérifier) ; localStorage
// seulement si IndexedDB refuse, pour ne pas manger le quota de la copie courante.
let safetyCopyCounter = 0;
export const SAFETY_COPIES_KEPT = 3;

// Une clé de copie = « orkmap-safety-copy:<email>:<date ISO>:<compteur> ». Tri du plus récent au plus ancien.
function compareSafetyCopies(a, b) {
  const split = (cle) => {
    const i = cle.lastIndexOf(":");
    return { at: cle.slice(0, i), n: Number(cle.slice(i + 1)) || 0 };
  };
  const x = split(a.cle);
  const y = split(b.cle);
  if (x.at !== y.at) return x.at < y.at ? 1 : -1;
  return y.n - x.n;
}

// Ne garde que les `keep` copies les plus récentes DE CE COMPTE (IndexedDB et localStorage réunis).
// Ne touche jamais aux copies d'un autre compte, ni aux photos, ni aux concerts.
export async function pruneSafetyCopies(email, { db, keep = SAFETY_COPIES_KEPT } = {}) {
  const prefix = `${SAFETY_COPY_PREFIX}${email}:`;
  const entries = [];
  const database = db || (await getDB());
  for (const cle of await database.getAllKeys(PHOTOS_STORE)) {
    if (String(cle).startsWith(prefix)) entries.push({ cle: String(cle), where: "idb" });
  }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const cle = localStorage.key(i);
      if (cle && cle.startsWith(prefix)) entries.push({ cle, where: "ls" });
    }
  } catch {
    // localStorage illisible : on ne purge que IndexedDB
  }
  entries.sort(compareSafetyCopies);
  let removed = 0;
  for (const entry of entries.slice(keep)) {
    try {
      if (entry.where === "idb") await database.delete(PHOTOS_STORE, entry.cle);
      else localStorage.removeItem(entry.cle);
      removed += 1;
    } catch (err) {
      console.warn("[OrkMap] Old safety copy could not be removed:", err);
    }
  }
  return removed;
}

export async function saveSafetyCopy(email, concerts, { db } = {}) {
  safetyCopyCounter += 1;
  const savedAt = new Date().toISOString();
  const cle = `${SAFETY_COPY_PREFIX}${email}:${savedAt}:${safetyCopyCounter}`;
  const record = { kind: "orkmap-safety-copy", email, savedAt, count: concerts.length, concerts };
  let idb = false;
  let ls = false;
  let database = db || null;
  try {
    database = database || (await getDB());
    await database.put(PHOTOS_STORE, record, cle);
    const back = await database.get(PHOTOS_STORE, cle);
    idb = Boolean(back) && Array.isArray(back.concerts) && back.concerts.length === concerts.length;
  } catch (err) {
    console.warn("[OrkMap] Safety copy (IndexedDB) failed:", err);
  }
  if (!idb) {
    try {
      localStorage.setItem(cle, JSON.stringify(record));
      ls = true;
    } catch (err) {
      console.warn("[OrkMap] Safety copy (localStorage) failed:", err);
    }
  }
  if (!idb && !ls) throw new Error("Impossible de mettre la version locale de côté.");
  // La nouvelle copie est écrite et relue : seulement alors, les plus anciennes (au-delà de 3) sont purgées.
  try {
    if (database) await pruneSafetyCopies(email, { db: database });
  } catch (err) {
    console.warn("[OrkMap] Safety copies purge failed:", err);
  }
  return { cle, idb, ls, copies: concerts.length };
}

export async function runSafeReload({
  email, isOffline: offline, hasUnsavedEdits, hasPending, getLocal,
  fetchServer, saveSafetyCopy: saveCopy, download, apply, keepLocalIds = () => new Set(),
}) {
  if (offline()) return refuse("Pas de réseau : le rechargement attendra le retour du réseau. Tes concerts restent sur le téléphone.");
  const busy = () => (hasUnsavedEdits() ? "Une modification vient d'être faite et n'est pas encore enregistrée : réessaie dans un instant." : hasPending() ? "Des modifications n'ont pas encore été envoyées au compte : attends la fin de l'envoi (ou le retour du réseau), puis réessaie. Rien n'a été changé." : "");
  let why = busy();
  if (why) return refuse(why);

  let serverData;
  try {
    serverData = await fetchServer();
  } catch (err) {
    return refuse(`Le compte est injoignable (${err?.message || err}) : rien n'a été changé.`);
  }
  why = busy();
  if (why) return refuse(why);

  const local = getLocal();
  const plan = planSafeReload({ serverData, localConcerts: local, email, keepLocal: keepLocalIds() });
  if (plan.refus) return plan;

  let copie = null;
  if (local.length > 0) {
    try {
      copie = await saveCopy(local);
    } catch (err) {
      return refuse(`Impossible de mettre ta version locale de côté (${err?.message || err}) : rien n'a été changé.`);
    }
  }
  let fichier = null;
  if (download) {
    try {
      fichier = await download(local);
    } catch (err) {
      console.warn("[OrkMap] Export file before reload failed:", err);
    }
  }
  why = busy();
  if (why) return refuse(why);

  try {
    await apply(plan.merged);
  } catch (err) {
    return refuse(`Écriture locale impossible (${err?.message || err}) : rien n'a été changé.`);
  }
  return {
    "remplacés": plan["remplacés"],
    "conservés": plan["conservés"],
    "ajoutés": plan["ajoutés"],
    plansManquants: plan.plansManquants,
    copie: copie?.cle ?? null,
    fichier,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// I1 : chargement local, mode dégradé et relecture patiente.
// ───────────────────────────────────────────────────────────────────────────
// `read` lit IndexedDB et renvoie { localData, canSeed }. Si la lecture échoue ou
// dépasse le délai, on passe en mode dégradé : on affiche la copie de secours,
// mais elle ne sert JAMAIS à alimenter le serveur (canSeed = false).
export async function loadLocalWithFallback({
  email, read, timeoutMs = LOCAL_LOAD_TIMEOUT_MS,
  readBackup = () => readConcertsBackup(email).map((item) => withOwner(item, email)),
  removedIds = readPending(email, SYNC_TYPES.concerts)?.removedIds || [],
}) {
  try {
    const result = await withTimeout(read(), timeoutMs, "Concert IndexedDB load");
    return { degraded: false, localData: result.localData, canSeed: result.canSeed };
  } catch (error) {
    console.warn("[OrkMap] IndexedDB load failed, degraded mode:", error);
    return { degraded: true, localData: withoutRemoved(readBackup(), removedIds), canSeed: false, error };
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Relit IndexedDB avec des délais de plus en plus patients. Renvoie le résultat de
// `read`, ou null si le compte affiché a changé entre-temps (isCurrent faux).
export async function retryLocalRead({
  read, isCurrent, timeouts = LOCAL_RETRY_TIMEOUTS_MS, sleep = defaultSleep, pauseMs = LOCAL_RETRY_PAUSE_MS,
}) {
  for (let attempt = 0; ; attempt += 1) {
    if (!isCurrent()) return null;
    const timeout = timeouts[Math.min(attempt, timeouts.length - 1)];
    try {
      const result = await withTimeout(read(), timeout, "Concert IndexedDB retry");
      return isCurrent() ? result : null;
    } catch (err) {
      console.warn("[OrkMap] IndexedDB retry failed:", err?.message || err);
    }
    await sleep(pauseMs);
  }
}

export function signaturesOf(list) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (item?.id) map.set(String(item.id), canonicalJson(item));
  }
  return map;
}

// Ids créés ou modifiés depuis l'affichage de départ (base = signaturesOf(copie affichée)).
export function changedIds(baseSig, current) {
  const out = [];
  for (const item of Array.isArray(current) ? current : []) {
    if (!item?.id) continue;
    if (baseSig.get(String(item.id)) !== canonicalJson(item)) out.push(String(item.id));
  }
  return out;
}

// Réunit ce que contient IndexedDB et ce qui a été fait pendant le mode dégradé :
// ce qui a été modifié/créé à ce moment-là gagne, tout le reste vient d'IndexedDB,
// et rien de ce qu'IndexedDB contient ne disparaît (hors suppression explicite).
export function reconcileAfterDegraded({ editedIds, current, idb, removedIds = [] }) {
  const edited = new Set(Array.from(editedIds || []).map(String));
  const removed = new Set((removedIds || []).map(String));
  const byId = new Map();
  for (const item of idb || []) if (item?.id) byId.set(String(item.id), item);
  for (const item of current || []) {
    if (!item?.id) continue;
    const id = String(item.id);
    if (edited.has(id) || !byId.has(id)) byId.set(id, item);
  }
  return Array.from(byId.values()).filter((item) => !removed.has(String(item.id)));
}

// Ids présents dans la liste de départ (signatures) et absents de la liste actuelle : supprimés depuis.
export function idsMissingFrom(baseSig, current) {
  const present = new Set((Array.isArray(current) ? current : []).filter((item) => item?.id).map((item) => String(item.id)));
  return Array.from(baseSig.keys()).filter((id) => !present.has(id));
}

// Nombre maximal de passes quand l'utilisateur continue de modifier pendant une écriture longue.
const MAX_REBASE_PASSES = 20;

// Marqueur persistant : ce qui a été modifié pendant un mode dégradé et qui n'est
// pas encore revenu dans IndexedDB (survit à la fermeture de l'application).
function degradedMarkerKey(email) {
  return `orkmap-degraded-edits:${email}`;
}

export function readDegradedMarker(email) {
  try {
    const raw = localStorage.getItem(degradedMarkerKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      editedIds: Array.isArray(parsed.editedIds) ? parsed.editedIds.map(String) : [],
      removedIds: Array.isArray(parsed.removedIds) ? parsed.removedIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function writeDegradedMarker(email, { editedIds = [], removedIds = [] }) {
  try {
    localStorage.setItem(degradedMarkerKey(email), JSON.stringify({
      editedIds: Array.from(new Set(editedIds.map(String))),
      removedIds: Array.from(new Set(removedIds.map(String))),
      at: Date.now(),
    }));
  } catch (err) {
    console.warn("[OrkMap] Degraded marker write failed:", err);
    setSyncFlag("backupFailed", true);
  }
}

export function clearDegradedMarker(email) {
  try {
    localStorage.removeItem(degradedMarkerKey(email));
  } catch {
    // rien à faire
  }
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
  // Mode dégradé (IndexedDB lent ou en échec) : rien n'est envoyé au serveur ni
  // écrit dans IndexedDB tant qu'une lecture n'a pas réussi.
  const degradedRef = useRef(false);
  const degradedBaseRef = useRef(new Map());
  const loadTokenRef = useRef(0);
  // Images des plans à télécharger : un seul passage à la fois, pas pendant un rechargement.
  const hydratingRef = useRef(false);
  const reloadingRef = useRef(false);
  const goneImagesRef = useRef(new Set());
  // Rangement des images dans le magasin local (lot 6) : un seul passage à la fois.
  const movingRef = useRef(null);
  const email = normalizeEmail(userEmail);
  const setConcerts = useCallback((data) => {
    latestRef.current = data;
    setConcertsState(data);
  }, []);

  // Surgical save: upsert everything in `data`, and delete ONLY ids the user
  // explicitly removed this session (removedIds). A stale/empty/reduced `data`
  // can no longer wipe concerts it never knew about — that was the data-loss bug.
  // (La copie de secours localStorage est écrite par `save` et `absorbRemote`
  // avec la liste à jour ; elle n'est plus réécrite ici avec l'ancien état.)
  const saveLocal = useCallback(async (data, removedIds = []) => {
    if (!email) return;
    const db = await getDB();
    const tx = db.transaction(STORE, "readwrite");
    for (const id of removedIds) {
      const existing = await tx.store.get(id);
      if (existing && belongsToUser(existing, email)) await tx.store.delete(id);
    }
    for (const c of data) {
      await tx.store.put(withOwner(c, email));
    }
    await tx.done;
  }, [email]);

  // ── File d'écriture (relecture du lot 6, B1) ──
  // Toutes les écritures de la liste complète par ce hook (enregistrement, migration des images) passent
  // l'une après l'autre, et chacune écrit la liste LA PLUS RÉCENTE au moment où elle s'exécute : une
  // écriture lente ne peut plus finir après une plus récente avec une version périmée.
  const writeChainRef = useRef(Promise.resolve());
  const enqueueWrite = useCallback((job) => {
    const run = writeChainRef.current.then(job).catch((err) => console.warn("[OrkMap] Local write failed:", err?.message || err));
    writeChainRef.current = run;
    return run;
  }, []);

  // Lot 6 : range dans le magasin « images » les images encore DANS les concerts (écrites, relues, empreinte
  // revérifiée ; déjà rangées ou en attente après un refus : pas de nouvelle lecture, voir storeImagesOnce),
  // puis convertit la liste affichée la plus récente (tout ou rien par concert, voir localImages.js) et
  // l'écrit par la file. Aucune modification de l'utilisateur n'est perdue : seules les images vérifiées
  // sont remplacées par leur référence, sur la liste à jour.
  // Migration de l'ancien format : en arrière-plan, jamais bloquante, UNE seule à la fois (un appel pendant
  // qu'elle tourne la relance à la fin). Interrompue n'importe où (application fermée) : IndexedDB garde
  // soit l'ancien concert (images dedans), soit le nouveau (références dont l'image est déjà dans le
  // magasin) ; le lancement suivant reprend. Idempotente.
  const migrateImages = useCallback((allowed) => {
    if (movingRef.current) {
      movingRef.current.again = true;
      return movingRef.current.job;
    }
    if (!email || !hasInlineImages(latestRef.current)) return Promise.resolve();
    const state = { again: false, job: null };
    state.job = (async () => {
      do {
        state.again = false;
        if (!allowed() || !hasInlineImages(latestRef.current)) break;
        let verified;
        try {
          verified = await storeImagesOnce(latestRef.current);
        } catch (err) {
          console.warn("[OrkMap] Plan images not moved to the image store yet:", err?.message || err);
          break;
        }
        if (!verified.size) continue;
        await enqueueWrite(async () => {
          if (!allowed()) return;
          const { data, changed } = applyStoredRefs(latestRef.current, verified);
          if (!changed) return;
          setConcerts(data);
          writeConcertsBackup(email, data);
          try {
            await withTimeout(saveLocal(data), LOCAL_LOAD_TIMEOUT_MS * 4, "Plan images migration save");
          } catch (err) {
            // Les images sont rangées et vérifiées ; les concerts seront réécrits au prochain enregistrement.
            console.warn("[OrkMap] Concerts not rewritten with image references yet:", err?.message || err);
          }
        });
      } while (state.again);
    })().finally(() => { movingRef.current = null; });
    movingRef.current = state;
    return state.job;
  }, [email, enqueueWrite, saveLocal, setConcerts]);

  // Load from IndexedDB first, then prefer the account sync when available.
  useEffect(() => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    const isCurrent = () => loadTokenRef.current === token;
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
      degradedRef.current = false;
      goneImagesRef.current = new Set();
      activeImageEmail = email;
      setSyncFlag("degraded", false);
      setLoaded(false);
      setLoadedFor("");

      // Lecture d'IndexedDB (migration et concert de démonstration compris).
      const readIdb = async () => {
        let localData = [];
        let canSeedRemoteFromLocal = false;
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
        return { localData, canSeed: canSeedRemoteFromLocal };
      };

      // Ce qui a été fait pendant un mode dégradé précédent et pas encore revenu
      // dans IndexedDB (application fermée entre-temps) est réintégré ici.
      const reintegrate = async (idbList) => {
        const marker = readDegradedMarker(email);
        if (!marker) return idbList;
        const backup = readConcertsBackup(email).map((item) => withOwner(item, email));
        // Une référence (copie de secours) ne remplace jamais une image qu'IndexedDB contient.
        const merged = await keepDeviceImages(reconcileAfterDegraded({
          editedIds: marker.editedIds,
          current: backup,
          idb: idbList,
          removedIds: marker.removedIds,
        }), [idbList, backup], email);
        try {
          await withTimeout(saveLocal(merged, marker.removedIds), LOCAL_LOAD_TIMEOUT_MS, "Concert degraded merge save");
          markPending(email, SYNC_TYPES.concerts, marker.removedIds);
          clearDegradedMarker(email);
        } catch (err) {
          // Écriture impossible pour l'instant : on affiche quand même le résultat
          // réuni, et le marqueur reste en place pour une prochaine tentative.
          console.warn("[OrkMap] Degraded edits could not be written back yet:", err);
        }
        return merged;
      };

      const pullRemote = async (canSeedRemoteFromLocal, localCount) => {
        if (!ENABLE_REMOTE_CONCERT_PULL || isOffline()) return;
        try {
          const remote = await withTimeout(loadRemote(SYNC_TYPES.concerts), REMOTE_LOAD_TIMEOUT_MS, "Concert sync load");
          if (remote.available && Array.isArray(remote.data)) {
            await absorbRemote(remote.data, readPending(email, SYNC_TYPES.concerts)?.removedIds || []);
            // Le compte garde des références d'images : on compare avec ce qui PARTIRAIT (images
            // remplacées par leur référence), sinon chaque ouverture renverrait tout.
            if (canSeedRemoteFromLocal) {
              const registry = await getImageRegistry(email);
              const outgoing = await outgoingForm(remoteConcertPayload(latestRef.current, email), registry, { maxBytes: MAX_PAYLOAD_BYTES, local: await localImageSource() });
              if (!sameData(remote.data, outgoing)) markPending(email, SYNC_TYPES.concerts);
            }
          } else if (remote.available && canSeedRemoteFromLocal && localCount > 0) {
            markPending(email, SYNC_TYPES.concerts);
          }
        } catch (err) {
          console.warn("[OrkMap] Concert sync load failed, using local cache:", err);
        }
      };

      const first = await loadLocalWithFallback({ email, read: readIdb });
      let localData = first.localData;
      let canSeedRemoteFromLocal = first.canSeed;

      if (first.degraded) {
        // Mode dégradé : on montre la copie de secours (jamais le concert de
        // démonstration), on n'envoie rien, on n'écrit pas dans IndexedDB, et on
        // relit IndexedDB patiemment en arrière-plan.
        degradedRef.current = true;
        degradedBaseRef.current = signaturesOf(localData);
        setSyncFlag("degraded", true);
        if (latestRef.current.length) localData = mergeConcerts(latestRef.current, localData, email);
        setConcerts(localData);
        readyRef.current = email;
        setLoaded(true);
        setLoadedFor(email);
        (async () => {
          const result = await retryLocalRead({ read: readIdb, isCurrent });
          if (!result || !isCurrent()) return;
          try {
            // L'écriture de réintégration peut durer (IndexedDB est lent) : pendant ce temps, l'utilisateur
            // peut modifier ou supprimer. Après chaque écriture on vérifie que la liste affichée n'a pas
            // bougé ; sinon on refait le calcul avec ces modifications, jusqu'à ce que plus rien ne bouge.
            // Le marqueur n'est effacé qu'à ce moment-là, sans aucune attente entre la vérification et la fin.
            let idbList = result.localData;
            let outcome = null;
            for (let pass = 0; pass < MAX_REBASE_PASSES && !outcome; pass += 1) {
              const snapshot = latestRef.current;
              const stored = readDegradedMarker(email) || { editedIds: [], removedIds: [] };
              const editedIds = Array.from(new Set([...stored.editedIds, ...changedIds(degradedBaseRef.current, snapshot)]));
              const removedIds = Array.from(new Set([...stored.removedIds, ...idsMissingFrom(degradedBaseRef.current, snapshot)]));
              const merged = await keepDeviceImages(reconcileAfterDegraded({ editedIds, current: snapshot, idb: idbList, removedIds }), [idbList, snapshot], email);
              await withTimeout(saveLocal(merged, removedIds), LOCAL_LOAD_TIMEOUT_MS * 4, "Concert degraded recovery save");
              if (!isCurrent()) return;
              if (latestRef.current === snapshot) outcome = { merged, editedIds, removedIds };
              else idbList = merged;
            }
            if (!outcome) throw new Error("Des modifications continuent d'arriver : réintégration reportée");
            const { merged, editedIds, removedIds } = outcome;
            setConcerts(merged);
            writeConcertsBackup(email, merged, { removedIds });
            if (editedIds.length || removedIds.length) markPending(email, SYNC_TYPES.concerts, removedIds);
            clearDegradedMarker(email);
            degradedRef.current = false;
            setSyncFlag("degraded", false);
            await pullRemote(result.canSeed, merged.length);
            flush();
          } catch (err) {
            // Écriture impossible : on reste en mode dégradé, rien n'est perdu (copie + marqueur).
            console.warn("[OrkMap] Degraded recovery failed, staying degraded:", err);
          }
        })();
        return;
      }

      localData = await reintegrate(localData);
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
      // Ancien format (images dans les concerts) : rangement en arrière-plan, l'affichage n'attend pas.
      migrateImages(() => isCurrent() && !degradedRef.current && !reloadingRef.current);

      await pullRemote(canSeedRemoteFromLocal, localData.length);
      readyRef.current = email;
      setLoaded(true);
      setLoadedFor(email);
      flush();
    })();
    return () => { loadTokenRef.current += 1; };
  }, [email, saveLocal]);

  // Bring server records into the current list (local version wins on the same
  // id), skipping the ones deleted on this device and not yet synced. Built on
  // the latest list, so an edit made while the server answered is kept.
  // Les références d'images reçues sont d'abord remplacées par les images du téléphone.
  const absorbRemote = useCallback(async (remoteData, removedIds = []) => {
    if (!Array.isArray(remoteData)) return;
    const resolved = await resolveImagesFromDevice(remoteData, latestRef.current, email);
    const mergedData = mergeConcerts(latestRef.current, withoutRemoved(resolved, removedIds), email);
    setConcerts(mergedData);
    writeConcertsBackup(email, mergedData, { removedIds });
    await withTimeout(saveLocal(mergedData), LOCAL_LOAD_TIMEOUT_MS, "Concert cache save");
  }, [email, saveLocal, setConcerts]);

  // Références dont l'image n'est pas sur ce téléphone (concerts venus du compte, téléphone hors ligne à ce
  // moment-là) : téléchargées en arrière-plan quand le réseau est là et rangées dans le magasin local.
  // Les concerts ne changent pas (ils portent déjà la référence) ; les cadres « Plan non disponible » sont
  // prévenus et affichent l'image.
  const hydrateMissing = useCallback(async () => {
    if (hydratingRef.current || !email || isOffline()) return;
    const usable = () => readyRef.current === email && !degradedRef.current && !reloadingRef.current;
    if (!usable()) return;
    const wanted = Array.from(await refsNotOnDevice(latestRef.current)).filter((hash) => !goneImagesRef.current.has(hash));
    if (!wanted.length) return;
    hydratingRef.current = true;
    try {
      await downloadMissingImages(wanted, { email, gone: goneImagesRef.current, stillValid: usable, onFound: storeDownloaded });
    } finally {
      hydratingRef.current = false;
    }
  }, [email]);

  const flush = useCallback(async () => {
    const usable = () => readyRef.current === email && !degradedRef.current && !reloadingRef.current;
    if (usable()) await migrateImages(usable);
    await pushPending({
      email,
      type: SYNC_TYPES.concerts,
      getPayload: () => (readyRef.current === email && !degradedRef.current ? remoteConcertPayload(latestRef.current, email) : null),
      absorbRemote,
      prepare: prepareConcerts(email),
    });
    hydrateMissing().catch((err) => console.warn("[OrkMap] Plan image hydration failed:", err));
  }, [email, absorbRemote, hydrateMissing, migrateImages]);

  useSyncRetry(email, flush);

  // Auto-save to IndexedDB, then queue + send to the account (debounced)
  // Relecture du lot 6 : les enregistrements passent par la file d'écriture, un à la fois, et chacun écrit
  // la liste la plus récente AU MOMENT où il s'exécute (les suppressions demandées entre-temps sont
  // réunies). Ordre : copie de secours, puis IndexedDB tout de suite (même si un nouveau plan y est encore
  // avec son image : une fermeture par Android juste après ne perd rien), puis seulement le rangement
  // de l'image dans le magasin, qui réécrit le concert avec sa référence par la même file.
  const queuedRemovalsRef = useRef([]);
  const queuedSaveRef = useRef(null);
  const save = useCallback(async (_data, removedIds = []) => {
    if (!email) return;
    queuedRemovalsRef.current.push(...removedIds);
    if (!queuedSaveRef.current) {
      queuedSaveRef.current = enqueueWrite(async () => {
        queuedSaveRef.current = null;
        const removed = Array.from(new Set(queuedRemovalsRef.current.splice(0)));
        const owned = latestRef.current.map((item) => withOwner(item, email));
        writeConcertsBackup(email, owned, { removedIds: removed });
        if (degradedRef.current) {
          // Mode dégradé : IndexedDB n'a pas été relu, on n'y écrit pas (cela pourrait
          // écraser des données plus récentes avec la copie de secours) et on n'envoie
          // rien. Ce qui a changé est noté pour être réintégré dès que IndexedDB répond.
          const previous = readDegradedMarker(email) || { editedIds: [], removedIds: [] };
          writeDegradedMarker(email, {
            editedIds: [...previous.editedIds, ...changedIds(degradedBaseRef.current, owned)],
            removedIds: [...previous.removedIds, ...removed],
          });
          return { degraded: true };
        }
        try {
          await saveLocal(owned, removed);
        } catch (err) {
          console.warn("[OrkMap] IndexedDB save failed:", err);
        }
        markPending(email, SYNC_TYPES.concerts, removed);
        return { degraded: false };
      });
    }
    const outcome = await queuedSaveRef.current;
    if (!outcome || outcome.degraded) return;
    // Envoi (et rangement des nouvelles images) HORS de la file : le réseau ne retarde jamais une écriture locale.
    await flush();
  }, [email, saveLocal, flush, enqueueWrite]);

  const runSaveNow = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const removals = removalsRef.current;
    removalsRef.current = [];
    return save(latestRef.current, removals);
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
      removalsRef.current = [...removalsRef.current, ...removedIds];
      if (degradedRef.current) {
        // Mode dégradé : pas de marque « en attente » ni d'écriture IndexedDB ; la
        // suppression est notée dans le marqueur et appliquée à la relecture réussie.
        const previous = readDegradedMarker(email) || { editedIds: [], removedIds: [] };
        writeDegradedMarker(email, { editedIds: previous.editedIds, removedIds: [...previous.removedIds, ...removedIds] });
      } else {
        markPending(email, SYNC_TYPES.concerts, removedIds);
        deleteLocalNow(STORE, removedIds, email);
      }
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSaveNow, DEBOUNCE_MS);
  }, [email, setConcerts, runSaveNow]);

  // C1 : « Recharger depuis le compte » SANS rien détruire (voir runSafeReload).
  // Options : { download: false } pour ne pas proposer le fichier de sauvegarde.
  // Renvoie { remplacés, conservés, ajoutés, copie, fichier } ou { refus: true, raison }.
  const reloadFromAccountSafe = useCallback(async (options = {}) => {
    if (!email || readyRef.current !== email) return refuse("Les données de ce compte ne sont pas encore chargées.");
    if (degradedRef.current) return refuse("Le stockage du téléphone répond lentement : attends un instant, rien n'a été changé.");
    let reloadBase = [];
    let userChanges = null; // modifications faites par l'utilisateur pendant l'écriture du rechargement
    // Concerts dont la version du compte a des plans non téléchargés : la version du téléphone est gardée.
    let keepLocalIds = new Set();
    reloadingRef.current = true;
    const result = await runSafeReload({
      email,
      isOffline,
      hasUnsavedEdits: () => saveTimer.current !== null,
      hasPending: () => readPending(email, SYNC_TYPES.concerts) !== null || hasUploadInFlight(email, SYNC_TYPES.concerts),
      getLocal: () => {
        reloadBase = latestRef.current;
        return reloadBase;
      },
      fetchServer: async () => {
        const remote = await withTimeout(loadRemote(SYNC_TYPES.concerts), REMOTE_LOAD_TIMEOUT_MS * 2, "Concert reload");
        if (!remote.available) throw new Error("synchronisation indisponible");
        if (!Array.isArray(remote.data)) return remote.data;
        // Images : d'abord celles du téléphone, puis téléchargement des autres. Une image introuvable
        // reste une référence (cadre « Plan non disponible »), le reste du rechargement se fait.
        const local = latestRef.current;
        const resolved = await resolveImagesFromDevice(remote.data, local, email);
        // Images du compte absentes du téléphone : téléchargées et rangées dans le magasin local.
        const missing = await refsNotOnDevice(resolved);
        if (missing.size) await downloadMissingImages(missing, { email, gone: goneImagesRef.current, onFound: storeDownloaded });
        // Un plan du compte resté sans image sur ce téléphone : jamais une référence à la place d'une image
        // du téléphone. Ce concert garde sa version du téléphone, et le compte rendu le signale.
        const localIds = new Set(local.map((c) => String(c?.id)));
        keepLocalIds = new Set();
        for (const c of resolved) {
          if (c && localIds.has(String(c.id)) && (await refsNotOnDevice(c, { includeUnsent: true })).size > 0) keepLocalIds.add(String(c.id));
        }
        return resolved;
      },
      keepLocalIds: () => keepLocalIds,
      saveSafetyCopy: (list) => saveSafetyCopy(email, list),
      download: options.download === false ? null : async () => (await exportLocalDataToFile({ email })).filename,
      apply: async (merged) => {
        // Écriture sans suppression issue du compte (aucun removedIds hérité du serveur). Pendant cette écriture,
        // l'utilisateur peut avoir modifié ou supprimé un concert : ses modifications gagnent toujours sur la
        // version du compte, on refait le calcul tant que la liste affichée bouge, puis seulement on l'affiche.
        const baseSig = signaturesOf(reloadBase);
        const rebased = async (snapshot) => {
          const removedIds = idsMissingFrom(baseSig, snapshot);
          const editedIds = changedIds(baseSig, snapshot);
          if (removedIds.length || editedIds.length) userChanges = { removedIds };
          const list = reconcileAfterDegraded({ editedIds, current: snapshot, idb: merged, removedIds });
          return { removedIds, list: await keepDeviceImages(list, [reloadBase, snapshot], email) };
        };
        for (let pass = 0; pass < MAX_REBASE_PASSES; pass += 1) {
          const snapshot = latestRef.current;
          const { list, removedIds } = await rebased(snapshot);
          await withTimeout(saveLocal(list, removedIds), LOCAL_LOAD_TIMEOUT_MS * 4, "Concert reload save");
          if (latestRef.current === snapshot) {
            setConcerts(list);
            writeConcertsBackup(email, list, { removedIds });
            return;
          }
        }
        // Les modifications n'arrêtent pas : on affiche le résultat à jour sans attendre, la sauvegarde différée
        // (déjà programmée par ces modifications) l'écrira dans IndexedDB.
        const { list, removedIds } = await rebased(latestRef.current);
        setConcerts(list);
        writeConcertsBackup(email, list, { removedIds });
      },
    }).finally(() => { reloadingRef.current = false; });
    // Les concerts gardés parce qu'absents du compte partent vers le compte (ajout, jamais suppression).
    // Même chose si l'utilisateur a modifié pendant l'écriture : un envoi parti entre-temps portait
    // l'ancienne liste, la liste finale est renvoyée.
    if (!result.refus && (result["conservés"] > 0 || userChanges)) {
      markPending(email, SYNC_TYPES.concerts, userChanges?.removedIds || []);
      flush();
    }
    return result;
  }, [email, saveLocal, setConcerts, flush]);

  return [concerts, setConcertsAndSave, loaded && loadedFor === email, { reloadFromAccountSafe }];
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
            if (Object.keys(localData).length > 0 && !sameData(remote.data, latestRef.current)) {
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
            if (localData.length > 0 && !sameData(remote.data, latestRef.current)) {
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
