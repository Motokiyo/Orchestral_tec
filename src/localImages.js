// Lot 6 : les images des plans rangées À PART sur le téléphone (magasin IndexedDB « images »).
//
// Pourquoi : les concerts du régisseur pesaient ~20 Mo dans IndexedDB, presque tout en images de plans.
// Chaque ouverture et chaque modification relisait, recopiait, comparait et hachait ces 20 Mo.
// Désormais un concert local porte « orkimg:<sha256 du data URL> » (même référence que l'envoi du lot 5)
// et l'image est dans le magasin « images », sous la clé <sha256>, valeur = le data URL lui-même.
//
// Choix du data URL (et non d'un Blob) : l'empreinte est calculée sur le TEXTE du data URL (c'est celle
// du compte, voir planImages.js) ; le garder tel quel permet de relire et revérifier l'empreinte à
// l'octet près, sans reconversion (un Blob perdrait les paramètres d'en-tête, « ;name=… », et changerait
// l'empreinte). L'affichage, le filigrane, la lecture IA, l'export et l'envoi consomment déjà des data URL.
//
// Pas de cloisonnement par compte dans ce magasin : la clé EST l'empreinte du contenu. Connaître la clé,
// c'est déjà avoir l'image ; deux comptes qui ont la même image partagent la même entrée sans rien
// apprendre l'un de l'autre. Le cloisonnement reste celui des concerts (ownerEmail) : l'export d'un compte
// ne contient que les images citées par SES concerts.
//
// Règle de sûreté : un concert n'est réécrit avec une référence qu'APRÈS que son image a été écrite,
// relue et revérifiée (même empreinte). Une écriture qui échoue (place) laisse le concert tel quel.
// Aucune image n'est jamais effacée de ce magasin (copies de sécurité et copies de secours les citent).

import {
  findImageHashes, hashOfRef, isAnyImageRef, isExternalImage, listInlineImages, mapImageStrings, refOf, sha256Hex,
} from "./planImages.js";

export const IMAGES_STORE = "images";

function storeExists(db, name) {
  const names = db?.objectStoreNames;
  if (!names) return false;
  if (typeof names.contains === "function") return names.contains(name);
  return Array.from(names).includes(name);
}

export function hasImagesStore(db) {
  return storeExists(db, IMAGES_STORE);
}

export async function listStoredHashes(db) {
  if (!hasImagesStore(db)) return new Set();
  return new Set((await db.getAllKeys(IMAGES_STORE)).map(String));
}

export async function readStoredImage(db, hash) {
  if (!hasImagesStore(db) || !hash) return null;
  const value = await db.get(IMAGES_STORE, hash);
  return typeof value === "string" ? value : null;
}

// Écrit UNE image, la relit et revérifie son empreinte. true seulement si l'image relue est la bonne.
// Déjà présente et identique : rien n'est réécrit. Une entrée abîmée (empreinte fausse) est remplacée.
export async function writeVerifiedImage(db, hash, dataUrl) {
  if (!hasImagesStore(db) || typeof dataUrl !== "string" || !hash) return false;
  try {
    const existing = await db.get(IMAGES_STORE, hash);
    if (existing === dataUrl) return true;
    await db.put(IMAGES_STORE, dataUrl, hash);
    const back = await db.get(IMAGES_STORE, hash);
    if (typeof back === "string" && (await sha256Hex(back)) === hash) return true;
    // Relue différente : l'entrée est retirée (jamais une image fausse sous cette empreinte).
    try { await db.delete(IMAGES_STORE, hash); } catch { /* rien de plus à faire */ }
    return false;
  } catch (err) {
    console.warn("[OrkMap] Plan image not stored on this phone:", err?.name || err?.message || err);
    return false;
  }
}

// Range dans le magasin les images contenues dans `list` (concerts, ancien format).
// Renvoie Map texte de l'image → empreinte, pour les SEULES images écrites, relues et vérifiées.
// `known` : empreintes déjà présentes dans le magasin (vérifiées à leur écriture) : ni relues ni réécrites.
// `shouldTry(empreinte)` : faux pendant l'attente après un refus (place) ; `onFailed(empreinte)` à chaque refus.
// `onStored(empreinte)` : appelé pour chaque image vérifiée (mise à jour de l'index en mémoire).
export async function storeInlineImages(db, list, { onStored, onFailed, known = null, shouldTry = () => true } = {}) {
  const verified = new Map();
  if (!hasImagesStore(db)) return verified;
  const hashes = await findImageHashes(list);
  for (const [text, hash] of hashes) {
    if (known?.has(hash)) { verified.set(text, hash); continue; }
    if (!shouldTry(hash)) continue;
    if (await writeVerifiedImage(db, hash, text)) {
      verified.set(text, hash);
      onStored?.(hash);
    } else onFailed?.(hash);
  }
  return verified;
}

// Remplace, dans chaque concert de `list`, ses images par leur référence — seulement si TOUTES les images
// de ce concert sont dans `verified`. Sinon le concert est laissé tel quel (règle « tout ou rien » par
// concert). Fonction pure et synchrone : peut s'appliquer à la liste la plus récente sans rien perdre.
// Renvoie { data, changed, kept } (kept : nombre de concerts laissés avec leurs images).
export function applyStoredRefs(list, verified) {
  if (!Array.isArray(list) || !verified?.size) return { data: list, changed: false, kept: 0 };
  let changed = false;
  let kept = 0;
  const data = list.map((concert) => {
    const texts = listInlineImages(concert);
    if (!texts.size) return concert;
    for (const text of texts) {
      if (!verified.has(text)) { kept += 1; return concert; }
    }
    const next = mapImageStrings(concert, (text, inPlan) => (isExternalImage(text, inPlan) && verified.has(text) ? refOf(verified.get(text)) : text));
    if (next !== concert) changed = true;
    return next;
  });
  return { data: changed ? data : list, changed, kept };
}

// Remet les vraies images à la place des références (export « toutes mes données », lecture IA…).
// `originalOf(empreinte)` : copie réduite connue du registre → original du téléphone.
// Une référence dont l'image n'est pas sur ce téléphone reste une référence (`missing` : nombre d'images
// distinctes absentes).
export async function inlineStoredImages(db, data, { originalOf = () => null } = {}) {
  const wanted = new Set();
  mapImageStrings(data, (text) => { if (isAnyImageRef(text)) wanted.add(text); return text; });
  if (!wanted.size) return { data, missing: 0 };
  const found = new Map();
  for (const ref of wanted) {
    const hash = hashOfRef(ref);
    let image = await readStoredImage(db, hash);
    if (image === null) {
      const original = originalOf(hash);
      if (original) image = await readStoredImage(db, original);
    }
    if (image !== null) found.set(ref, image);
  }
  const out = mapImageStrings(data, (text) => (isAnyImageRef(text) && found.has(text) ? found.get(text) : text));
  const missing = new Set(Array.from(wanted).filter((ref) => !found.has(ref)).map(hashOfRef)).size;
  return { data: out, missing };
}

// Cache mémoire des images affichées : peu d'entrées et une taille plafonnée (un téléphone n'a pas
// 20 Mo de texte à garder en mémoire pour rien). La plus anciennement utilisée part la première.
export function createImageCache({ maxEntries = 8, maxChars = 24 * 1024 * 1024 } = {}) {
  const entries = new Map();
  let chars = 0;
  return {
    get(hash) {
      if (!entries.has(hash)) return undefined;
      const value = entries.get(hash);
      entries.delete(hash);
      entries.set(hash, value);
      return value;
    },
    set(hash, value) {
      if (entries.has(hash)) { chars -= entries.get(hash).length; entries.delete(hash); }
      entries.set(hash, value);
      chars += value.length;
      while (entries.size > 1 && (entries.size > maxEntries || chars > maxChars)) {
        const [oldest, old] = entries.entries().next().value;
        entries.delete(oldest);
        chars -= old.length;
      }
    },
    get size() { return entries.size; },
    get chars() { return chars; },
    clear() { entries.clear(); chars = 0; },
  };
}
