// Images du dossier d'archive (lot 8) : lire un data URL, et fournir au PDF un JPEG (canvas du navigateur seulement
// quand l'image n'est pas déjà un JPEG utilisable). Rôle unique : les images. Aucun réseau.
import { jpegInfo } from "./pdfWriter.js";

/** { mime, bytes } d'une image en data URL base64, ou null (pas une image, pas du base64, vide). */
export function octetsDeDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(dataUrl);
  if (!m || !m[2]) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.length ? { mime: m[1].toLowerCase(), bytes } : null;
  } catch { return null; }
}

export function extensionDeMime(mime) {
  if (/png/.test(mime)) return "png";
  if (/webp/.test(mime)) return "webp";
  if (/gif/.test(mime)) return "gif";
  if (/hei[cf]/.test(mime)) return "heic";
  return "jpg";
}

function chargerImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Un JPEG prêt pour le PDF : { bytes, width, height, components } ou null si l'image est illisible.
 * Un JPEG (1 ou 3 composantes) est repris tel quel. PNG, WebP, HEIC, JPEG CMYK : redessinés sur fond blanc via
 * un canvas et réencodés en JPEG ; au-delà de `maxSide` pixels la grande image est réduite (PDF raisonnable).
 */
export async function jpegPourPdf(dataUrl, { maxSide = 2400, qualite = 0.88 } = {}) {
  const brut = octetsDeDataUrl(dataUrl);
  if (!brut) return null;
  const info = jpegInfo(brut.bytes);
  if (info && (info.components === 1 || info.components === 3)) return { bytes: brut.bytes, ...info };
  const img = await chargerImage(dataUrl);
  if (!img || !img.naturalWidth || !img.naturalHeight) return null;
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = octetsDeDataUrl(canvas.toDataURL("image/jpeg", qualite));
  canvas.width = 0; canvas.height = 0;
  const converti = out && jpegInfo(out.bytes);
  return converti ? { bytes: out.bytes, ...converti } : null;
}
