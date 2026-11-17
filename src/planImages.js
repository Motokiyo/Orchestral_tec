// Images des plans HORS du JSON des concerts envoyé au compte (lot 5).
//
// Sur le téléphone, rien ne change : IndexedDB garde les concerts AVEC leurs images (data URL),
// tout s'affiche hors ligne comme avant. Seul l'ENVOI au compte change :
//   1. chaque image (data URL « data:image/… » d'au moins MIN_EXTERNAL_IMAGE_CHARS caractères,
//      où qu'elle soit dans les concerts : plans[], planDataUrl, etc.) est remplacée par une
//      référence stable « orkimg:<sha256 hex du data URL> » ;
//   2. chaque image pas encore connue du compte part seule, une par requête (/api/plan-image) ;
//   3. les concerts ne partent qu'une fois TOUTES leurs images parties (jamais de référence orpheline).
// À la réception, une référence est remplacée par l'image trouvée sur le téléphone (même empreinte),
// sinon téléchargée ; introuvable (hors ligne), elle reste telle quelle et l'écran affiche un cadre
// « Plan non disponible hors ligne ».

export const IMAGE_REF_PREFIX = "orkimg:";
// En dessous (une icône, une miniature), l'image reste dans le JSON : une requête de plus coûterait plus cher.
export const MIN_EXTERNAL_IMAGE_CHARS = 2048;
export const PLAN_IMAGE_URL = "/api/plan-image";
const PLAN_IMAGE_TIMEOUT_MS = 90000;
const DATA_IMAGE_HEAD = /^data:image\/[a-z0-9.+-]+;base64,/i;
const REF_PATTERN = /^orkimg:[0-9a-f]{64}$/;

export function isImageRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value);
}

export function refOf(hash) {
  return `${IMAGE_REF_PREFIX}${hash}`;
}

export function hashOfRef(ref) {
  return isImageRef(ref) ? ref.slice(IMAGE_REF_PREFIX.length) : null;
}

// Une image assez grosse pour voyager à part.
export function isExternalImage(value) {
  return typeof value === "string" && value.length >= MIN_EXTERNAL_IMAGE_CHARS && DATA_IMAGE_HEAD.test(value.slice(0, 80));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Empreinte SHA-256 (hex) du texte du data URL, en UTF-8 : la même que celle recalculée par le serveur.
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Empreinte d'image impossible sur cet appareil (crypto.subtle absent)");
  return toHex(await subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}

// Cache data URL → empreinte : recalculer 20 Mo d'empreintes à chaque envoi serait inutile.
// Il est reconstruit à chaque passage pour ne garder que les images encore présentes (pas de fuite mémoire).
let hashCache = new Map();

async function hashAll(strings) {
  const next = new Map();
  for (const text of strings) {
    if (next.has(text)) continue;
    next.set(text, hashCache.get(text) ?? (await sha256Hex(text)));
  }
  return next;
}

function walkStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walkStrings(value[key], visit);
  }
}

// Copie de `value` où chaque texte passe par `fn`. Les branches inchangées sont rendues telles quelles
// (même objet), ce qui permet de savoir à coup sûr si quelque chose a changé.
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = mapStrings(item, fn);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out = {};
    for (const key of Object.keys(value)) {
      const next = mapStrings(value[key], fn);
      if (next !== value[key]) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

// Remplace les images par leur référence. Renvoie { data, images: Map<empreinte, data URL> }.
export async function externalizeImages(data) {
  const found = [];
  walkStrings(data, (text) => { if (isExternalImage(text)) found.push(text); });
  const hashes = await hashAll(found);
  hashCache = hashes;
  const images = new Map();
  for (const [text, hash] of hashes) images.set(hash, text);
  const out = mapStrings(data, (text) => (hashes.has(text) ? refOf(hashes.get(text)) : text));
  return { data: out, images };
}

// Index empreinte → data URL des images présentes dans `data` (les concerts du téléphone).
export async function buildImageIndex(data) {
  const { images } = await externalizeImages(data);
  return images;
}

// Empreintes de toutes les références contenues dans `data`.
export function collectImageRefs(data) {
  const out = new Set();
  walkStrings(data, (text) => { if (isImageRef(text)) out.add(hashOfRef(text)); });
  return out;
}

// Remplace les références connues de `index` par leur image. Une référence inconnue est GARDÉE telle
// quelle (jamais effacée). Renvoie { data, missing: Set<empreinte>, changed }.
export function rehydrateImages(data, index) {
  const missing = new Set();
  const out = mapStrings(data, (text) => {
    if (!isImageRef(text)) return text;
    const hash = hashOfRef(text);
    const dataUrl = index?.get(hash);
    if (typeof dataUrl === "string") return dataUrl;
    missing.add(hash);
    return text;
  });
  return { data: out, missing, changed: out !== data };
}

// ── Images déjà connues du compte (par compte, sur ce téléphone) ──
// Si localStorage refuse l'écriture (plein), la liste reste en mémoire pour la session : au pire
// une image est renvoyée une fois de plus (le serveur répond « déjà là »), jamais perdue.
const SENT_PREFIX = "orkmap-plan-images-sent:";
const memorySent = new Map();

export function sentImagesKey(email) {
  return `${SENT_PREFIX}${email}`;
}

export function readSentImages(email) {
  const out = new Set(memorySent.get(email) || []);
  try {
    const raw = localStorage.getItem(sentImagesKey(email));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) for (const hash of parsed) out.add(String(hash));
  } catch {
    // illisible : la copie mémoire suffit
  }
  return out;
}

export function rememberSentImages(email, hashes) {
  if (!email) return;
  const list = Array.from(hashes || []).filter(Boolean).map(String);
  if (!list.length) return;
  const all = readSentImages(email);
  let added = false;
  for (const hash of list) if (!all.has(hash)) { all.add(hash); added = true; }
  if (!added) return;
  try {
    localStorage.setItem(sentImagesKey(email), JSON.stringify(Array.from(all)));
    memorySent.delete(email);
  } catch (err) {
    memorySent.set(email, all);
    console.warn("[OrkMap] Plan image list kept in memory only:", err?.name || err);
  }
}

// ── Réseau ──
async function timedFetch(url, init, timeoutMs = PLAN_IMAGE_TIMEOUT_MS) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { credentials: "include", ...init, signal: controller?.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Envoie UNE image. Lève une erreur si le compte ne l'a pas acceptée.
export async function uploadPlanImage(hash, dataUrl, { onUnauthorized } = {}) {
  const resp = await timedFetch(PLAN_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash, dataUrl }),
  });
  if (resp.status === 401) onUnauthorized?.();
  if (!resp.ok) {
    const error = new Error(`Plan image upload failed: ${resp.status}`);
    error.status = resp.status;
    error.imageFailed = true;
    throw error;
  }
  return true;
}

// Télécharge UNE image du compte. null = le compte ne l'a pas (404) ; erreur = réseau ou serveur.
// L'image reçue est vérifiée : son empreinte doit être celle demandée.
export async function downloadPlanImage(hash, { onUnauthorized } = {}) {
  const resp = await timedFetch(`${PLAN_IMAGE_URL}?hash=${encodeURIComponent(hash)}`, { method: "GET" });
  if (resp.status === 404) return null;
  if (resp.status === 401) onUnauthorized?.();
  if (!resp.ok) {
    const error = new Error(`Plan image download failed: ${resp.status}`);
    error.status = resp.status;
    throw error;
  }
  const body = await resp.json();
  const dataUrl = body?.dataUrl;
  if (typeof dataUrl !== "string" || (await sha256Hex(dataUrl)) !== hash) {
    throw new Error("Image reçue illisible ou différente de celle demandée");
  }
  return dataUrl;
}

// Prépare l'envoi des concerts : images d'abord, une par requête, puis le JSON allégé.
// - Une image déjà connue du compte n'est pas renvoyée.
// - Une image trop lourde pour une requête (> maxBytes) : erreur `tooLarge` (rien ne part).
// - Un échec d'envoi d'image : erreur, les concerts ne partent pas (réessai plus tard via la file).
// Chaque image acceptée est notée tout de suite : après une coupure, on reprend où on en était.
export async function prepareConcertsUpload(email, payload, { maxBytes, onUnauthorized, upload = uploadPlanImage } = {}) {
  const { data, images } = await externalizeImages(payload);
  const sent = readSentImages(email);
  for (const [hash, dataUrl] of images) {
    if (sent.has(hash)) continue;
    // Base64 = ASCII : un caractère = un octet ; + l'enveloppe JSON.
    const bytes = dataUrl.length + hash.length + 32;
    if (maxBytes && bytes > maxBytes) {
      const error = new Error(`Plan image too large: ${bytes} bytes`);
      error.tooLarge = true;
      error.bytes = bytes;
      error.what = "plan";
      throw error;
    }
    await upload(hash, dataUrl, { onUnauthorized });
    rememberSentImages(email, [hash]);
  }
  return data;
}
