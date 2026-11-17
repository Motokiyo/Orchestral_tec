// Images des plans HORS du JSON des concerts envoyé au compte (lot 5).
//
// Lot 6 : sur le téléphone aussi, les images sont rangées à part (magasin IndexedDB « images », voir
// localImages.js) et les concerts locaux portent la référence « orkimg:<empreinte de l'original> ».
// Les fonctions d'envoi ci-dessous acceptent donc les deux formes : image dans le concert (ancien format,
// concert pas encore rangé) et référence dont l'image est dans le magasin local (option `local`).
// L'ENVOI au compte :
//   1. chaque image (voir isExternalImage : data:image/…, data:application/octet-stream qui est une
//      image, ou tout data: d'au moins 2 Ko rangé dans les plans) est remplacée par une référence
//      stable « orkimg:<sha256 hex> » ;
//   2. le compte dit d'abord quelles images il a déjà (une petite requête) : c'est lui qui fait foi ;
//   3. chaque image manquante part seule, une par requête (/api/plan-image), puis les concerts.
// Une image trop lourde (> 3,9 Mo) ou mal formée part sous forme d'une COPIE réduite ou nettoyée,
// sous l'empreinte de cette copie ; l'original reste intact sur le téléphone, et la table locale
// « copie → original » (registre, par compte) permet de le retrouver à la réception.
// Un plan ne bloque jamais l'envoi des concerts pour toujours : en dernier recours, l'image reste
// dans le JSON si ça tient, sinon elle est remplacée par « orkimg-local:<sha256> » (gardée sur ce
// téléphone seulement) et une pastille le dit.
// Une image refusée pour une raison passagère est réessayée avec une attente croissante
// (1, 5, 15, puis 60 min) ; pendant l'attente, les concerts attendent aussi (pas de référence orpheline).

export const IMAGE_REF_PREFIX = "orkimg:";
export const UNSENT_REF_PREFIX = "orkimg-local:";
// En dessous (une icône, une miniature), l'image reste dans le JSON : une requête de plus coûterait plus cher.
export const MIN_EXTERNAL_IMAGE_CHARS = 2048;
// Limite du serveur pour UNE image (la plateforme refuse les corps de plus de 4,5 Mo).
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Au-delà, le téléphone envoie une copie réduite (marge pour l'enveloppe JSON).
export const SEND_LIMIT_BYTES = Math.floor(3.9 * 1024 * 1024);
// Taille visée à l'import d'un plan (largement sous la limite d'envoi).
export const PLAN_TARGET_BYTES = 3 * 1024 * 1024;
export const PLAN_MAX_SIDE = 2400;
// Nombre maximal d'empreintes dans une demande « lesquelles as-tu ? ».
export const MAX_HAVE_HASHES = 200;
const HAVE_CHUNK = 100;
export const RETRY_DELAYS_MS = [1, 5, 15, 60].map((min) => min * 60 * 1000);
export const PLAN_IMAGE_URL = "/api/plan-image";
const PLAN_IMAGE_TIMEOUT_MS = 90000;
// Marge pour removedIds et l'enveloppe quand on décide de laisser une image dans le JSON.
const JSON_MARGIN_BYTES = 64 * 1024;

const REF_PATTERN = /^orkimg:[0-9a-f]{64}$/;
const UNSENT_PATTERN = /^orkimg-local:[0-9a-f]{64}$/;
// data:<type>/<sous-type>[;nom=valeur…][;base64],
const DATA_HEAD = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?((?:;[a-z0-9.+_-]+=[^;,]*)*)(;base64)?,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const PLAN_KEYS = new Set(["plans", "planDataUrl", "planDataUrls"]);

// ── Références ──
export function isImageRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value);
}

export function isUnsentRef(value) {
  return typeof value === "string" && UNSENT_PATTERN.test(value);
}

// Référence d'une image qui n'est pas dans le concert (sur le compte, ou gardée sur un autre téléphone).
export function isAnyImageRef(value) {
  return isImageRef(value) || isUnsentRef(value);
}

export function refOf(hash) {
  return `${IMAGE_REF_PREFIX}${hash}`;
}

export function unsentRefOf(hash) {
  return `${UNSENT_REF_PREFIX}${hash}`;
}

export function hashOfRef(ref) {
  if (isImageRef(ref)) return ref.slice(IMAGE_REF_PREFIX.length);
  if (isUnsentRef(ref)) return ref.slice(UNSENT_REF_PREFIX.length);
  return null;
}

// ── Reconnaissance des images ──
export function parseDataUrlHead(text) {
  if (typeof text !== "string" || !text.startsWith("data:")) return null;
  const m = DATA_HEAD.exec(text.slice(0, 512));
  if (!m) return null;
  return { mime: (m[1] || "").toLowerCase(), base64: Boolean(m[3]), bodyStart: m[0].length };
}

function decodeBase64Start(b64) {
  try {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, "").slice(0, 32);
    const usable = clean.slice(0, clean.length - (clean.length % 4));
    const bin = atob(usable);
    return Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return [];
  }
}

// Signature d'image en tête du contenu : JPEG, PNG, GIF, WEBP, HEIC/HEIF/AVIF.
export function sniffImage(b64Start) {
  const b = decodeBase64Start(b64Start);
  if (b.length < 12) return false;
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return true;
  if (ascii(0, 4) === "GIF8") return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  if (ascii(4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(ascii(8, 12))) return true;
  return false;
}

// Une image assez grosse pour voyager à part. `inPlan` : le texte est rangé dans plans[] / planDataUrl,
// où tout data: de plus de 2 Ko est traité comme une image de plan.
export function isExternalImage(value, inPlan = false) {
  if (typeof value !== "string" || value.length < MIN_EXTERNAL_IMAGE_CHARS) return false;
  const head = parseDataUrlHead(value);
  if (!head) return false;
  if (head.mime.startsWith("image/") || inPlan) return true;
  return head.base64 && sniffImage(value.slice(head.bodyStart, head.bodyStart + 48));
}

// Forme acceptée par le serveur (même fonction des deux côtés) : data URL en base64 propre.
export function isValidImageDataUrl(value) {
  const head = parseDataUrlHead(value);
  if (!head || !head.base64) return false;
  return BASE64_BODY.test(value.slice(head.bodyStart));
}

// Nettoyage sans perte : retours à la ligne et espaces retirés du base64. null si rien de mieux.
export function normalizeDataUrl(value) {
  const head = parseDataUrlHead(value);
  if (!head || !head.base64) return null;
  const body = value.slice(head.bodyStart).replace(/\s+/g, "");
  const out = value.slice(0, head.bodyStart) + body;
  return out !== value && isValidImageDataUrl(out) ? out : null;
}

// ── Empreintes ──
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Empreinte SHA-256 (hex) du texte du data URL, en UTF-8 : la même que celle recalculée par le serveur.
export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Empreinte d'image impossible sur cet appareil (crypto.subtle absent)");
  return toHex(await subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}

// Cache data URL → empreinte, reconstruit à chaque passage (pas de fuite mémoire).
let hashCache = new Map();

async function hashAll(strings) {
  const next = new Map();
  for (const text of strings) {
    if (next.has(text)) continue;
    next.set(text, hashCache.get(text) ?? (await sha256Hex(text)));
  }
  return next;
}

// ── Parcours ──
function walkStrings(value, visit, inPlan = false) {
  if (typeof value === "string") {
    visit(value, inPlan);
  } else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, inPlan);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walkStrings(value[key], visit, inPlan || PLAN_KEYS.has(key));
  }
}

// Copie où chaque texte passe par `fn`. Les branches inchangées sont rendues telles quelles (même objet).
function mapStrings(value, fn, inPlan = false) {
  if (typeof value === "string") return fn(value, inPlan);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = mapStrings(item, fn, inPlan);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out = {};
    for (const key of Object.keys(value)) {
      const next = mapStrings(value[key], fn, inPlan || PLAN_KEYS.has(key));
      if (next !== value[key]) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}

async function findImages(data) {
  const found = [];
  walkStrings(data, (text, inPlan) => { if (isExternalImage(text, inPlan)) found.push(text); });
  const hashes = await hashAll(found);
  hashCache = hashes;
  return hashes; // Map texte → empreinte
}

// Map texte de l'image → empreinte, pour les images rangées DANS `data` (ancien format).
export const findImageHashes = findImages;

// Textes des images rangées dans `data` (sans calcul d'empreinte : parcours seulement).
export function listInlineImages(data) {
  const found = new Set();
  walkStrings(data, (text, inPlan) => { if (isExternalImage(text, inPlan)) found.add(text); });
  return found;
}

export function hasInlineImages(data) {
  let found = false;
  walkStrings(data, (text, inPlan) => { if (!found && isExternalImage(text, inPlan)) found = true; });
  return found;
}

// Copie de `data` où chaque texte passe par `fn(texte, dansUnPlan)` ; branches inchangées rendues telles quelles.
export const mapImageStrings = (data, fn) => mapStrings(data, fn);

// Empreintes des références dont l'image est sur ce téléphone (magasin local, `local.has`).
function collectLocalRefs(data, local) {
  const out = new Set();
  if (!local) return out;
  walkStrings(data, (text) => {
    if (!isAnyImageRef(text)) return;
    const hash = hashOfRef(text);
    if (local.has(hash)) out.add(hash);
  });
  return out;
}

// Remplace les images par leur référence (empreinte de l'ORIGINAL). Renvoie { data, images }.
export async function externalizeImages(data) {
  const hashes = await findImages(data);
  const images = new Map();
  for (const [text, hash] of hashes) images.set(hash, text);
  const out = mapStrings(data, (text) => (hashes.has(text) ? refOf(hashes.get(text)) : text));
  return { data: out, images };
}

// Index empreinte → data URL des images présentes dans `data` (les concerts du téléphone).
export async function buildImageIndex(data) {
  return (await externalizeImages(data)).images;
}

// Empreintes des références « orkimg: » (téléchargeables). `includeUnsent` : aussi « orkimg-local: ».
export function collectImageRefs(data, { includeUnsent = false } = {}) {
  const out = new Set();
  walkStrings(data, (text) => {
    if (isImageRef(text) || (includeUnsent && isUnsentRef(text))) out.add(hashOfRef(text));
  });
  return out;
}

// Remplace les références connues par leur image. `registry` : une référence vers une copie réduite
// retrouve l'ORIGINAL du téléphone. Une référence inconnue est GARDÉE telle quelle.
// Renvoie { data, missing: Set<empreinte téléchargeable>, changed }.
export function rehydrateImages(data, index, registry = null) {
  const missing = new Set();
  const out = mapStrings(data, (text) => {
    if (!isAnyImageRef(text)) return text;
    const hash = hashOfRef(text);
    const original = registry?.originalOf(hash);
    const dataUrl = index?.get(hash) ?? (original ? index?.get(original) : undefined);
    if (typeof dataUrl === "string") return dataUrl;
    if (isImageRef(text)) missing.add(hash);
    return text;
  });
  return { data: out, missing, changed: out !== data };
}

// ── Registre par compte (copies réduites, refus définitifs, attentes) ──
// `persist(état)` : rangement durable (IndexedDB, voir useStorage.js). Si le rangement échoue, le
// registre reste en mémoire : au pire une copie est refaite, le serveur fait foi pour le reste.
export function createImageRegistry(initial = null, { persist = null } = {}) {
  const state = {
    variants: { ...(initial?.variants || {}) },
    rejected: { ...(initial?.rejected || {}) },
    retry: { ...(initial?.retry || {}) },
  };
  let dirty = false;
  const touch = () => { dirty = true; };
  return {
    variantOf: (hash) => state.variants[hash] || null,
    originalOf(hash) {
      for (const [original, variant] of Object.entries(state.variants)) if (variant === hash) return original;
      return null;
    },
    setVariant(hash, variant) {
      if (state.variants[hash] !== variant) { state.variants[hash] = variant; touch(); }
    },
    isRejected: (hash) => Boolean(state.rejected[hash]),
    reject(hash) {
      if (!state.rejected[hash]) { state.rejected[hash] = Date.now(); touch(); }
    },
    retryDue(hash, now = Date.now()) {
      const r = state.retry[hash];
      return !r || r.nextAt <= now;
    },
    failed(hash, now = Date.now()) {
      const failures = (state.retry[hash]?.failures || 0) + 1;
      state.retry[hash] = { failures, nextAt: now + RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1] };
      touch();
      return state.retry[hash];
    },
    succeeded(hash) {
      if (state.retry[hash]) { delete state.retry[hash]; touch(); }
    },
    earliestRetry() {
      const times = Object.values(state.retry).map((r) => r.nextAt);
      return times.length ? Math.min(...times) : null;
    },
    snapshot: () => structuredClone(state),
    async save() {
      if (!dirty || !persist) return;
      try {
        await persist(structuredClone(state));
        dirty = false;
      } catch (err) {
        console.warn("[OrkMap] Plan image registry kept in memory only:", err?.name || err);
      }
    },
  };
}

// ── Réduction d'une image (navigateur seulement) ──
// Redessine l'image en JPEG, côté max `maxSide`, et resserre (qualité puis taille) jusqu'à tenir sous
// `maxBytes`. `keepIfFits` : l'original est rendu tel quel s'il tient déjà (taille et côté).
// null si l'image est illisible ou si l'environnement n'a pas de canvas.
async function browserShrink(dataUrl, { maxSide = PLAN_MAX_SIDE, quality = 0.85, maxBytes = PLAN_TARGET_BYTES, keepIfFits = false } = {}) {
  if (typeof Image === "undefined" || typeof document?.createElement !== "function") return null;
  const img = await new Promise((resolve) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => resolve(null);
    el.src = dataUrl;
  });
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (keepIfFits && dataUrl.length <= maxBytes && longest <= maxSide) return dataUrl;
  const steps = [[1, quality], [1, 0.75], [0.8, 0.75], [0.65, 0.7], [0.5, 0.65], [0.4, 0.6]];
  for (const [factor, q] of steps) {
    const scale = Math.min(1, (maxSide * factor) / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", q);
    if (out.length <= maxBytes) return out;
  }
  return null;
}

let shrinker = browserShrink;
// Pour les tests (Node n'a pas de canvas) : remplace la fonction de réduction.
export function setImageShrinker(fn) {
  shrinker = fn || browserShrink;
}

export async function shrinkImageDataUrl(dataUrl, options) {
  try {
    return await shrinker(dataUrl, options);
  } catch {
    return null;
  }
}

// À l'IMPORT d'un plan image : réduit pour que l'image stockée tienne largement sous la limite d'envoi
// (côté max 2400 px, qualité 0,85, puis resserre). Illisible : l'original est gardé.
export async function shrinkPlanForStorage(dataUrl) {
  const out = await shrinkImageDataUrl(dataUrl, { maxSide: PLAN_MAX_SIDE, quality: 0.85, maxBytes: PLAN_TARGET_BYTES, keepIfFits: true });
  return out || dataUrl;
}

// Copie envoyable d'une image : nettoyée (sans perte) si ça suffit, sinon réduite. null si impossible.
async function sendableCopy(original) {
  const normalized = normalizeDataUrl(original);
  if (normalized && normalized.length <= SEND_LIMIT_BYTES) return normalized;
  const shrunk = await shrinkImageDataUrl(normalized || original, { maxSide: PLAN_MAX_SIDE, quality: 0.85, maxBytes: PLAN_TARGET_BYTES });
  return shrunk && isValidImageDataUrl(shrunk) && shrunk.length <= SEND_LIMIT_BYTES ? shrunk : null;
}

const sendableAsIs = (text) => isValidImageDataUrl(text) && text.length <= SEND_LIMIT_BYTES;

// ── Assemblage du JSON envoyé ──
// decisions : Map empreinte de l'original → { target } (référence envoyée), { rejected: true } ou
// { keep: true } (référence locale dont l'image a disparu entre-temps : laissée telle quelle).
// Une image refusée reste dans le JSON si l'ensemble tient (plus petites d'abord), sinon elle devient
// « orkimg-local: » (gardée sur ce téléphone seulement). `texts` : empreinte → texte de l'image (les
// images refusées doivent y être). `localRefs` : références dont l'image est dans le magasin local.
// Renvoie { data, unsent }.
function assemble(data, hashes, localRefs, decisions, texts, maxBytes) {
  const inline = new Set();
  const rejected = Array.from(decisions).filter(([, d]) => d.rejected).map(([hash]) => hash);
  const decide = (hash, text) => {
    const d = decisions.get(hash);
    if (!d || d.keep) return text;
    if (d.rejected) return inline.has(hash) ? texts.get(hash) : unsentRefOf(hash);
    return refOf(d.target || hash);
  };
  const build = () => mapStrings(data, (text) => {
    const hash = hashes.get(text);
    if (hash) return decide(hash, text);
    if (isAnyImageRef(text) && localRefs.has(hashOfRef(text))) return decide(hashOfRef(text), text);
    return text;
  });
  if (rejected.length && maxBytes) {
    let size = new TextEncoder().encode(JSON.stringify(build())).byteLength;
    const candidates = rejected.filter((hash) => typeof texts.get(hash) === "string");
    for (const hash of candidates.sort((a, b) => texts.get(a).length - texts.get(b).length)) {
      const extra = texts.get(hash).length - unsentRefOf(hash).length;
      if (size + extra <= maxBytes - JSON_MARGIN_BYTES) {
        inline.add(hash);
        size += extra;
      }
    }
  }
  const unsent = rejected.filter((hash) => !inline.has(hash)).length;
  return { data: build(), unsent };
}

// Images à considérer pour l'envoi : celles rangées dans `data` (texte connu) et celles du magasin local
// citées par référence (texte lu seulement si besoin). Renvoie { hashes, localRefs, originals }.
async function gatherImages(data, local) {
  const hashes = await findImages(data);
  const originals = new Map(); // empreinte → { text } | { lazy: true }
  for (const [text, hash] of hashes) originals.set(hash, { text });
  const localRefs = collectLocalRefs(data, local);
  for (const hash of localRefs) if (!originals.has(hash)) originals.set(hash, { lazy: true });
  const textOf = async (hash) => {
    const o = originals.get(hash);
    if (!o) return null;
    if (o.text === undefined) {
      try { o.text = (await local.get(hash)) ?? null; } catch { o.text = null; }
    }
    return o.text;
  };
  return { hashes, localRefs, originals, textOf };
}

// Forme envoyée, calculée SANS réseau d'après le registre (pour savoir si le compte est à jour).
// `local` : magasin local ({ has(empreinte), get(empreinte) }) pour les concerts déjà rangés.
export async function outgoingForm(data, registry, { maxBytes, local = null } = {}) {
  const { hashes, localRefs, originals, textOf } = await gatherImages(data, local);
  const decisions = new Map();
  const texts = new Map();
  for (const [hash] of originals) {
    if (registry?.isRejected(hash)) {
      decisions.set(hash, { rejected: true });
      texts.set(hash, await textOf(hash));
    } else decisions.set(hash, { target: registry?.variantOf(hash) || hash });
  }
  return assemble(data, hashes, localRefs, decisions, texts, maxBytes).data;
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

// Envoie UNE image. Lève une erreur (avec .status si le serveur a répondu) si elle n'est pas acceptée.
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
    throw error;
  }
  return true;
}

// Demande au compte lesquelles de ces images il a déjà (le compte fait foi). Renvoie un Set.
export async function checkKnownImages(hashes, { onUnauthorized } = {}) {
  const list = Array.from(hashes);
  const known = new Set();
  for (let i = 0; i < list.length; i += HAVE_CHUNK) {
    const resp = await timedFetch(PLAN_IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ have: list.slice(i, i + HAVE_CHUNK) }),
    }, 20000);
    if (resp.status === 401) onUnauthorized?.();
    if (!resp.ok) {
      const error = new Error(`Plan image check failed: ${resp.status}`);
      error.status = resp.status;
      throw error;
    }
    const body = await resp.json();
    for (const hash of Array.isArray(body?.known) ? body.known : []) known.add(String(hash));
  }
  return known;
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

// Prépare l'envoi des concerts : demande au compte ce qu'il a, envoie les images manquantes une par
// une, puis renvoie le JSON allégé.
// - Image trop lourde ou mal formée : copie réduite ou nettoyée, envoyée sous SON empreinte.
// - Refus définitif (400, 413) ou image irréductible : dernier recours (dans le JSON si ça tient,
//   sinon « orkimg-local: »), jamais renvoyée en boucle.
// - Échec passager : attente croissante pour CETTE image (jamais plus d'un essai par période) ; les
//   autres images sont tentées ; les concerts attendent (erreur `imageRetry`).
// - Lot 6 : une référence dont l'image est dans le magasin local (`local`) est traitée comme une image du
//   téléphone ; son texte n'est lu dans le magasin que si le compte ne l'a pas. Une référence dont l'image
//   n'est pas sur ce téléphone (image du compte pas encore téléchargée) part telle quelle.
// `onUnsent(n)` : nombre de plans gardés sur ce téléphone seulement.
export async function prepareConcertsUpload(email, payload, {
  maxBytes, registry = createImageRegistry(), onUnauthorized, onUnsent, local = null,
  upload = uploadPlanImage, check = checkKnownImages, now = () => Date.now(),
} = {}) {
  const { hashes, localRefs, originals, textOf } = await gatherImages(payload, local);
  const decisions = new Map();
  const copies = new Map(); // empreinte envoyée → data URL (copie faite pendant ce passage)
  const makeCopy = async (hash) => {
    const text = await textOf(hash);
    const copy = typeof text === "string" ? await sendableCopy(text) : null;
    if (!copy) return null;
    const target = await sha256Hex(copy);
    registry.setVariant(hash, target);
    copies.set(target, copy);
    return target;
  };
  for (const [hash, o] of originals) {
    if (registry.isRejected(hash)) { decisions.set(hash, { rejected: true }); continue; }
    const known = registry.variantOf(hash);
    if (known) { decisions.set(hash, { target: known }); continue; }
    // Image du magasin local : on suppose qu'elle part telle quelle ; vérifié seulement si le compte ne l'a pas.
    if (o.lazy) { decisions.set(hash, { target: hash, lazy: true }); continue; }
    if (sendableAsIs(o.text)) { decisions.set(hash, { target: hash }); continue; }
    const target = await makeCopy(hash);
    if (!target) { registry.reject(hash); decisions.set(hash, { rejected: true }); continue; }
    decisions.set(hash, { target });
  }

  const targets = new Set(Array.from(decisions.values()).filter((d) => d.target).map((d) => d.target));
  let blocked = false;
  try {
    const onServer = targets.size ? await check(targets, { onUnauthorized }) : new Set();
    for (const [hash, d] of decisions) {
      if (!d.target || onServer.has(d.target)) continue;
      if (!registry.retryDue(d.target, now())) { blocked = true; continue; }
      let data = d.target === hash ? await textOf(hash) : copies.get(d.target);
      if (d.target === hash && typeof data !== "string") {
        // L'image n'est plus dans le magasin local : la référence part telle quelle (jamais d'image inventée).
        decisions.set(hash, { keep: true });
        continue;
      }
      if (d.lazy && !sendableAsIs(data)) {
        // Image locale trop lourde ou mal formée : copie réduite ou nettoyée, comme pour une image du concert.
        const target = await makeCopy(hash);
        if (!target) { registry.reject(hash); decisions.set(hash, { rejected: true }); continue; }
        d.target = target;
        data = copies.get(target);
        if (onServer.has(target) || !registry.retryDue(target, now())) { if (!onServer.has(target)) blocked = true; continue; }
      }
      if (!data) {
        // Copie connue du registre mais absente du compte : on la refait (elle peut différer d'un octet).
        const target = await makeCopy(hash);
        if (!target) { registry.reject(hash); decisions.set(hash, { rejected: true }); continue; }
        d.target = target;
        data = copies.get(target);
        if (onServer.has(target)) continue;
      }
      try {
        await upload(d.target, data, { onUnauthorized });
        registry.succeeded(d.target);
      } catch (err) {
        if (err?.status === 400 || err?.status === 413) {
          registry.succeeded(d.target);
          registry.reject(hash);
          decisions.set(hash, { rejected: true });
          continue;
        }
        registry.failed(d.target, now());
        blocked = true;
        // Pas de réponse du tout (réseau coupé) : inutile d'essayer les suivantes maintenant.
        if (err?.status === undefined) break;
      }
    }
  } finally {
    await registry.save();
  }
  if (blocked) {
    const error = new Error("Plan image upload deferred");
    error.imageRetry = true;
    error.nextAt = registry.earliestRetry();
    throw error;
  }
  const texts = new Map();
  for (const [hash, d] of decisions) if (d.rejected) texts.set(hash, await textOf(hash));
  const { data, unsent } = assemble(payload, hashes, localRefs, decisions, texts, maxBytes);
  onUnsent?.(unsent);
  return data;
}
