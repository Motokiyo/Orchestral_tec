// Export des photos (filigrane compris) et téléchargement / partage d'un fichier, hors de App.jsx (lot 7 et 8).
// Rôle : tout ce qui sort des photos du téléphone sous forme de zip, plus l'enregistrement dans Téléchargements
// (téléchargement du navigateur : sur Android Chrome le fichier va dans « Téléchargements ») et la feuille de
// partage. Génération PHOTO PAR PHOTO : une seule image est décodée à la fois, rendue au navigateur entre deux.
import JSZip from "jszip";
import { BARNIER } from "./data.js";
import { applyWatermark } from "./utils.js";
import { octetsDeDataUrl, extensionDeMime } from "./archiveImages.js";
import { nomSur, nomDossierPiece, nomPhoto } from "./archive.js";

// ── Aides images ──
// Filigrane incrusté dans l'image (même rendu que les zips d'origine).
export function bakeWatermark(rawDataUrl, watermarkOpts) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      applyWatermark(canvas, ctx, watermarkOpts);
      const out = canvas.toDataURL("image/jpeg", 0.85);
      canvas.width = 0; canvas.height = 0; // rend la mémoire de l'image tout de suite
      resolve(out);
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

export function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Nom de fichier d'origine (zips d'origine) : espaces en « _ », caractères interdits en « _ ».
export function sanitize(str) {
  return (str || "Sans_titre").replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
}

// Options du filigrane d'une photo.
export function optionsFiligrane(piece, ph, i, total) {
  const percu = piece.percus?.find((r) => r.id === ph.percuId);
  return {
    percu,
    opts: {
      titre: piece.titre || "",
      percuNom: percu?.nom || "",
      zone: ph.zone || "",
      num: ph.num || i + 1,
      total: ph.total || total,
      couleur: BARNIER[piece.couleur] || BARNIER.blanc,
    },
  };
}

const respirer = () => new Promise((r) => setTimeout(r, 0));

// ── Enregistrer / partager ──
/** Enregistre un fichier dans Téléchargements (téléchargement du navigateur, fonctionne hors ligne). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Vrai si la feuille de partage du téléphone accepte ce fichier (Android Chrome). */
export function peutPartager(blob, filename) {
  try {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function" || typeof navigator.share !== "function") return false;
    return !!navigator.canShare({ files: [new File([blob], filename, { type: blob.type || "application/zip" })] });
  } catch { return false; }
}

/** Ouvre la feuille de partage. Renvoie false si l'utilisateur la referme sans partager (ce n'est pas une erreur). */
export async function partagerFichier(blob, filename, title = "") {
  try {
    await navigator.share({ files: [new File([blob], filename, { type: blob.type || "application/zip" })], title });
    return true;
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    throw err;
  }
}

// ── Zips d'origine (une pièce, un concert) ──
export async function downloadPiecePhotosZip(piece, photosList, onProgress) {
  if (!photosList || photosList.length === 0) return;
  const zip = new JSZip();
  for (let i = 0; i < photosList.length; i++) {
    const ph = photosList[i];
    const { percu, opts } = optionsFiligrane(piece, ph, i, photosList.length);
    const baked = await bakeWatermark(ph.dataUrl, opts);
    const fname = `${sanitize(piece.titre)}_${sanitize(percu?.nom || "Percu")}_${sanitize(ph.zone || "Photo")}_${i + 1}.jpg`;
    zip.file(fname, dataUrlToBlob(baked));
    if (onProgress) onProgress(i + 1, photosList.length);
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), `${sanitize(piece.titre)}_photos.zip`);
}

export async function downloadConcertPhotosZip(concert, pieces, photos, selectedPieceIds, onProgress) {
  const zip = new JSZip();
  let total = 0;
  let done = 0;
  for (const pid of selectedPieceIds) total += (photos[pid] || []).length;
  if (total === 0) return;
  for (const pid of selectedPieceIds) {
    const piece = pieces.find((p) => p.id === pid);
    if (!piece) continue;
    const piecePhotos = photos[pid] || [];
    if (piecePhotos.length === 0) continue;
    const folder = zip.folder(sanitize(piece.titre));
    for (let i = 0; i < piecePhotos.length; i++) {
      const ph = piecePhotos[i];
      const { percu, opts } = optionsFiligrane(piece, ph, i, piecePhotos.length);
      const baked = await bakeWatermark(ph.dataUrl, opts);
      folder.file(`${sanitize(piece.titre)}_${sanitize(percu?.nom || "Percu")}_${sanitize(ph.zone || "Photo")}_${i + 1}.jpg`, dataUrlToBlob(baked));
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), `${sanitize(concert.titre)}_photos.zip`);
}

// ── Lot 7 : « Enregistrer mes photos dans Téléchargements » ──
/** Un nom de dossier qui n'existe pas encore dans `used` (ajoute _2, _3...). */
export function nomUnique(nom, used) {
  let candidat = nom;
  for (let n = 2; used.has(candidat.toLowerCase()); n++) candidat = `${nom}_${n}`;
  used.add(candidat.toLowerCase());
  return candidat;
}

/** Compte les photos qui seront écrites. `groupes` : [{ concert, pieceIds? }]. */
export function compterPhotos(groupes, photos) {
  let n = 0;
  for (const g of groupes) {
    for (const p of g.concert.pieces || []) {
      if (g.pieceIds && !g.pieceIds.includes(p.id)) continue;
      n += (photos[p.id] || []).length;
    }
  }
  return n;
}

/**
 * Écrit les photos d'UNE pièce (filigrane compris) dans `dossier`, une photo à la fois : une seule image est décodée
 * à un instant donné. Renvoie le nombre de photos écrites. `bake` : filigrane (remplaçable pour les tests).
 */
export async function ecrirePhotosPiece(dossier, piece, liste, { bake = bakeWatermark, onPhoto = () => {} } = {}) {
  let ecrites = 0;
  for (let i = 0; i < liste.length; i++) {
    const ph = liste[i];
    const { percu, opts } = optionsFiligrane(piece, ph, i, liste.length);
    const baked = await bake(ph.dataUrl, opts);
    // STORE : une photo JPEG ne se recompresse pas, on évite le calcul et la mémoire.
    const brut = octetsDeDataUrl(baked) || octetsDeDataUrl(ph.dataUrl);
    if (!brut) continue; // image illisible : ignorée, jamais un fichier cassé
    dossier.file(nomPhoto(i + 1, ph, percu?.nom || "", extensionDeMime(brut.mime)), brut.bytes, { compression: "STORE" });
    ecrites++;
    onPhoto(ecrites);
    await respirer();
  }
  return ecrites;
}

/**
 * Remplit `zip` avec les photos d'un concert : un dossier « 01_Titre » par pièce qui a des photos.
 * `racine` : sous-dossier du zip (« Concert_date ») ou null. Renvoie le nombre de photos écrites.
 */
export async function ajouterPhotosAuZip(zip, { concert, pieceIds = null, photos, racine = null, bake = bakeWatermark, onPhoto = () => {} }) {
  const base = racine ? zip.folder(racine) : zip;
  const pieces = (concert.pieces || []).filter((p) => (!pieceIds || pieceIds.includes(p.id)) && (photos[p.id] || []).length > 0);
  let ecrites = 0;
  for (let r = 0; r < pieces.length; r++) {
    const piece = pieces[r];
    const avant = ecrites;
    ecrites += await ecrirePhotosPiece(base.folder(nomDossierPiece(r + 1, piece)), piece, photos[piece.id] || [], { bake, onPhoto: (n) => onPhoto(avant + n) });
  }
  return ecrites;
}

/**
 * Le zip des photos de un ou plusieurs concerts : « Concert_date/01_Titre/Photo_01_Percu_Zone.jpg ».
 * Un seul concert et `sansDossierConcert` : pas de dossier de concert. Renvoie { blob, count } (blob null si aucune photo).
 */
export async function construireZipPhotos({ groupes, photos, sansDossierConcert = false, bake = bakeWatermark, onProgress = () => {} }) {
  const total = compterPhotos(groupes, photos);
  if (total === 0) return { blob: null, count: 0 };
  const zip = new JSZip();
  const noms = new Set();
  let fait = 0;
  for (const g of groupes) {
    if (compterPhotos([g], photos) === 0) continue;
    const racine = sansDossierConcert ? null : nomUnique(`${nomSur(g.concert.titre, { repli: "Concert", max: 50 })}_${nomSur(g.concert.date, { repli: "sans_date", max: 30 })}`, noms);
    const base = fait;
    await ajouterPhotosAuZip(zip, { ...g, photos, racine, bake, onPhoto: (n) => { fait = base + n; onProgress(fait, total); } });
  }
  const blob = await zip.generateAsync({ type: "blob", streamFiles: true });
  return { blob, count: total };
}
