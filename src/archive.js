// Dossier d'archive d'un concert pour les salles (lot 8) : LE CONTENU des fiches, sans réseau ni navigateur.
// Une fiche est une liste de « blocs » (titre, paragraphe, liste, lignes clé : valeur, image). Les mêmes blocs
// servent à écrire le TXT (blocsEnTxt) et le PDF (blocsEnPdf) : les deux fiches disent donc la même chose.
// Rôle de ce fichier : calculs et textes. L'assemblage du zip est dans archiveBuilder.js, les images dans
// archiveImages.js, l'écran dans ArchiveUi.jsx. Aucun tiret cadratin dans les textes produits (cleanText).
import { BARNIER } from "./data.js";
import { calculateMobilier } from "./mobilier.js";
import { optionsMobilier, ecartsPourAffichage } from "./mobilierUi.js";
import { generateMobilierText, generateOrchestreText, generateMobilierObserveText, generatePercusGlobalText, countOrchestreMusicians, formatMusicianTotal } from "./utils.js";
import { PdfDocument, cleanText } from "./pdfWriter.js";

export const PLAN_ABSENT = "plan non disponible sur ce téléphone";

// ── Noms de fichiers sûrs ──────────────────────────────────────────────────────────────
/** Un morceau de nom de fichier : pas de / \ : * ? " < > | %, pas de point en tête, espaces en « _ », longueur limitée. */
export function nomSur(value, { repli = "Sans_titre", max = 60 } = {}) {
  let s = cleanText(value).replace(/\n/g, " ");
  s = s.replace(/[\/\\:*?"<>|%#&{}$!'`@+=^~;,\[\]()’‘“”«»]/g, " ");
  s = s.replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  if (s.length > max) s = s.slice(0, max).replace(/[._-]+$/, "");
  return s || repli;
}

/** Les plans d'une pièce : la liste `plans`, sinon l'ancien champ `planDataUrl`. */
export function plansDeLaPiece(piece) {
  if (Array.isArray(piece && piece.plans) && piece.plans.length > 0) return piece.plans.filter((p) => typeof p === "string" && p);
  return piece && typeof piece.planDataUrl === "string" && piece.planDataUrl ? [piece.planDataUrl] : [];
}

const num2 = (n) => String(n).padStart(2, "0");

/** Dossier d'une pièce : « 01_Titre ». Le numéro est la position dans le dossier (ordre du concert). */
export function nomDossierPiece(rang, piece) {
  return `${num2(rang)}_${nomSur(piece && piece.titre, { repli: "Piece", max: 50 })}`;
}

export function nomZipDossier(concert) {
  return `${nomSur(concert && concert.titre, { repli: "Concert", max: 50 })}_${nomSur(concert && concert.date, { repli: "sans_date", max: 30 })}_dossier.zip`;
}

export function nomZipPhotosConcert(concert) {
  return `${nomSur(concert && concert.titre, { repli: "Concert", max: 50 })}_${nomSur(concert && concert.date, { repli: "sans_date", max: 30 })}_photos.zip`;
}

export function nomZipPhotosTout(date = new Date()) {
  return `OrkMap_photos_${date.getFullYear()}-${num2(date.getMonth() + 1)}-${num2(date.getDate())}.zip`;
}

/** Nom d'une photo : « Photo_01_Percu_2_Zone.jpg » (ext : jpg, png...). Lisible, unique grâce au numéro. */
export function nomPhoto(rang, photo, percuNom, ext = "jpg") {
  const morceaux = [`Photo_${num2(rang)}`];
  if (percuNom) morceaux.push(nomSur(percuNom, { max: 30 }));
  if (photo && photo.zone) morceaux.push(nomSur(photo.zone, { max: 30 }));
  return `${morceaux.join("_")}.${ext}`;
}

// ── Mobilier d'une pièce et total du concert ───────────────────────────────────────────
/** Le mobilier d'une pièce, comme partout dans l'app : celui qui est enregistré, sinon le calcul. */
export function mobilierDePiece(piece, concert) {
  if (piece && piece.mobilier) return piece.mobilier;
  if (!piece || !piece.orchestre) return null;
  return calculateMobilier(piece.orchestre, piece.percus, optionsMobilier(piece, concert));
}

const quantite = (q) => (Number.isInteger(q) && q >= 0 ? q : null);

/** Éléments d'un mobilier à plat : [{ cle, label, qte }] (qte null = quantité inconnue). */
export function elementsMobilier(mob) {
  const out = [];
  if (!mob) return out;
  const g = mob.general || {};
  const ajoute = (label, q) => { if (q === null || q > 0) out.push({ cle: label.toLowerCase(), label, qte: q }); };
  ajoute("Pupitres de musiciens", quantite(g.pupitres) ?? 0);
  ajoute("Chaises normales", quantite(g.chaisesNormales) ?? 0);
  ajoute("Chaises hautes", quantite(g.chaisesHautes) ?? 0);
  ajoute("Banquettes", quantite(g.banquettes) ?? 0);
  if (Array.isArray(g.chaisesSpeciales)) for (const s of g.chaisesSpeciales) if (s && s.type) ajoute(String(s.type), quantite(s.qty));
  const st = mob.stands || {};
  for (const section of ["cordes", "bois", "cuivres", "percus", "speciaux", "autres", "autresCustom"]) {
    for (const s of Array.isArray(st[section]) ? st[section] : []) if (s && s.type) ajoute(String(s.type), quantite(s.qty));
  }
  return out;
}

/**
 * Total du mobilier du concert, présenté de deux façons :
 * - somme : toutes les pièces additionnées (chaque pièce a son propre montage) ;
 * - maximum : pour chaque élément, la plus grande quantité demandée par une seule pièce (les pièces se suivent,
 *   le matériel reste sur scène).
 * Une quantité inconnue n'est jamais comptée comme zéro en silence : `inconnues` dit combien de lignes manquent.
 */
export function totalMobilierConcert(pieces, concert) {
  const parCle = new Map();
  let inconnues = 0;
  let sansMobilier = 0;
  for (const piece of pieces) {
    const mob = mobilierDePiece(piece, concert);
    if (!mob) { sansMobilier++; continue; }
    const dansCettePiece = new Map();
    for (const e of elementsMobilier(mob)) {
      if (e.qte === null) { inconnues++; if (!parCle.has(e.cle)) parCle.set(e.cle, { label: e.label, somme: 0, max: 0, ordre: parCle.size }); continue; }
      const cur = dansCettePiece.get(e.cle) || { label: e.label, qte: 0 };
      cur.qte += e.qte;
      dansCettePiece.set(e.cle, cur);
    }
    for (const [cle, v] of dansCettePiece) {
      const t = parCle.get(cle) || { label: v.label, somme: 0, max: 0, ordre: parCle.size };
      t.somme += v.qte;
      t.max = Math.max(t.max, v.qte);
      parCle.set(cle, t);
    }
  }
  const lignes = [...parCle.values()].sort((a, b) => a.ordre - b.ordre).map(({ label, somme, max }) => ({ label, somme, max }));
  return { lignes, inconnues, sansMobilier, nbPieces: pieces.length };
}

// ── Texte brut converti en blocs (on réutilise les générateurs de texte de l'app) ──────
// Les lignes de décor (──, ══) sont retirées, « • x » et « - x » deviennent des puces, une ligne toute en
// majuscules devient un sous-titre.
export function texteEnBlocs(texte) {
  const blocs = [];
  for (const brut of cleanText(texte).split("\n")) {
    const ligne = brut.trim();
    if (!ligne || /^[-=_\s]+$/.test(ligne)) continue;
    const puce = ligne.match(/^[•*-]\s+(.*)$/);
    if (puce) { blocs.push({ t: "b", text: puce[1] }); continue; }
    if (/^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇŒ0-9'’ &/().-]{3,}$/.test(ligne) && /[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇŒ]{3}/.test(ligne)) { blocs.push({ t: "h3", text: ligne }); continue; }
    blocs.push({ t: "p", text: ligne });
  }
  return blocs;
}

// ── Fiche d'une pièce ──────────────────────────────────────────────────────────────────
/**
 * Les blocs de la fiche d'une pièce.
 * `plans` : un tableau de { present: bool, fichier?: "Plans/Plan_1.jpg" } dans l'ordre des plans de la pièce.
 * `nbPhotos` : nombre de photos mises dans le dossier (null = « sans photos »).
 * `imagePlan` : nom de l'image du plan à mettre en pleine largeur (clé du jeu d'images du PDF), ou null.
 */
export function blocsFichePiece({ piece, concert, rang, plans = [], nbPhotos = null, imagePlan = null }) {
  const couleur = BARNIER[piece.couleur];
  const total = formatMusicianTotal(countOrchestreMusicians(piece.orchestre));
  const blocs = [{ t: "title", text: `${num2(rang)}. ${piece.titre || "Sans titre"}` }];
  const sous = [piece.compositeur, piece.duree].filter(Boolean).join(", ");
  if (sous) blocs.push({ t: "sub", text: sous });
  const chef = piece.chef || (concert && concert.chef) || "";
  blocs.push({
    t: "kv",
    rows: [
      ["Concert", (concert && concert.titre) || ""],
      ["Date", piece.date || (concert && concert.date) || ""],
      ["Lieu", piece.salle || (concert && concert.lieu) || ""],
      ["Chef", chef],
      ["Orchestre", (concert && concert.orchestre) || ""],
      ["Effectif (Daniels)", piece.effectif || "non renseigné"],
      ["Nombre de musiciens", piece.orchestre ? total : "non renseigné"],
      ["Couleur Barnier", couleur ? couleur.name : piece.couleur || ""],
      ["Photos", nbPhotos === null ? "non incluses dans ce dossier" : String(nbPhotos)],
    ],
  });
  if (imagePlan) blocs.push({ t: "img", name: imagePlan, caption: "Plan 1 (les autres plans sont dans le dossier Plans)" });

  blocs.push({ t: "h", text: "Orchestre" });
  const orch = piece.orchestre ? texteEnBlocs(generateOrchestreText(piece.orchestre)) : [{ t: "p", text: "Aucun orchestre enregistré." }];
  blocs.push(...orch);

  blocs.push({ t: "h", text: "Mobilier calculé" });
  const mob = mobilierDePiece(piece, concert);
  if (mob) blocs.push(...texteEnBlocs(generateMobilierText(mob)));
  else blocs.push({ t: "p", text: "Aucun mobilier : l'orchestre n'est pas renseigné." });

  const observe = generateMobilierObserveText(piece.mobilierObserve);
  blocs.push({ t: "h", text: "Mobilier observé sur le plan" });
  if (observe) {
    const lignes = texteEnBlocs(observe).filter((b) => b.t === "b");
    blocs.push({ t: "p", text: "Lu sur le plan par l'IA, non calculé. À vérifier." });
    blocs.push(...lignes);
    const ecarts = mob ? ecartsPourAffichage(mob, piece.mobilierObserve) : [];
    blocs.push({ t: "h3", text: "ÉCARTS ENTRE LE PLAN ET LE CALCUL" });
    if (ecarts.length === 0) blocs.push({ t: "p", text: "Aucun écart relevé." });
    else for (const e of ecarts) blocs.push({ t: "b", text: e.texte });
  } else {
    blocs.push({ t: "p", text: "Rien n'a été lu sur le plan." });
  }

  blocs.push({ t: "h", text: "Percussions par pôle" });
  const percus = piece.percusGlobalText || generatePercusGlobalText(piece.percus);
  const percusBlocs = percus ? texteEnBlocs(percus) : [];
  if (percusBlocs.length) {
    // « Pôle 1 : Nom » devient un sous-titre.
    for (const b of percusBlocs) blocs.push(b.t === "p" && /^P[ôo]le\s/i.test(b.text) ? { t: "h3", text: b.text } : b);
  } else blocs.push({ t: "p", text: "Aucune percussion." });

  blocs.push({ t: "h", text: "Plans" });
  if (plans.length === 0) blocs.push({ t: "p", text: "Aucun plan enregistré pour cette pièce." });
  plans.forEach((pl, i) => {
    blocs.push({ t: "b", text: pl.present ? `Plan ${i + 1} : fichier ${pl.fichier}` : `Plan ${i + 1} : ${PLAN_ABSENT}` });
  });

  blocs.push({ t: "h", text: "Notes de la pièce" });
  blocs.push({ t: "p", text: (piece.notes || "").trim() || "Aucune note." });
  return blocs;
}

// ── Fiche du concert ───────────────────────────────────────────────────────────────────
/** `pieces` : les pièces incluses dans le dossier, dans l'ordre du concert. `nbTotal` : nombre de pièces du concert. */
export function blocsFicheConcert({ concert, pieces, nbTotal = null }) {
  const blocs = [{ t: "title", text: concert.titre || "Concert sans titre" }];
  blocs.push({ t: "sub", text: "Fiche du concert" });
  blocs.push({
    t: "kv",
    rows: [
      ["Date", concert.date || ""],
      ["Lieu", concert.lieu || ""],
      ["Chef", concert.chef || ""],
      ["Orchestre", concert.orchestre || ""],
      ["Pièces dans ce dossier", nbTotal !== null && nbTotal !== pieces.length ? `${pieces.length} sur ${nbTotal}` : String(pieces.length)],
    ],
  });

  blocs.push({ t: "h", text: "Pièces, dans l'ordre du concert" });
  if (pieces.length === 0) blocs.push({ t: "p", text: "Aucune pièce dans ce dossier." });
  else {
    blocs.push({
      t: "kv",
      rows: pieces.map((p, i) => [`${i + 1}. ${p.titre || "Sans titre"}${p.compositeur ? " (" + p.compositeur + ")" : ""}`, p.effectif ? "Daniels " + p.effectif : "effectif non renseigné"]),
    });
  }

  const tot = totalMobilierConcert(pieces, concert);
  blocs.push({ t: "h", text: "Mobilier du concert" });
  if (tot.lignes.length === 0) blocs.push({ t: "p", text: "Aucun mobilier calculé : les orchestres ne sont pas renseignés." });
  else {
    blocs.push({ t: "h3", text: "SI CHAQUE PIÈCE A SON PROPRE MONTAGE : TOTAL DES PIÈCES ADDITIONNÉES" });
    blocs.push({ t: "p", text: "Chaque pièce est comptée en entier, l'une après l'autre. C'est le total à prévoir si on démonte et remonte entre les pièces." });
    blocs.push({ t: "kv", rows: tot.lignes.map((l) => [l.label, String(l.somme)]) });
    blocs.push({ t: "h3", text: "SI LES PIÈCES SE SUIVENT : MAXIMUM PAR ÉLÉMENT" });
    blocs.push({ t: "p", text: "Pour chaque élément, la plus grande quantité demandée par une seule pièce. C'est ce qu'il faut avoir en scène au plus, si le matériel reste en place d'une pièce à l'autre." });
    blocs.push({ t: "kv", rows: tot.lignes.map((l) => [l.label, String(l.max)]) });
    if (tot.inconnues > 0) blocs.push({ t: "p", text: `Attention : ${tot.inconnues} ligne${tot.inconnues > 1 ? "s" : ""} de mobilier sans quantité ${tot.inconnues > 1 ? "ne sont pas comptées" : "n'est pas comptée"}.` });
    if (tot.sansMobilier > 0) blocs.push({ t: "p", text: `Attention : ${tot.sansMobilier} pièce${tot.sansMobilier > 1 ? "s" : ""} sans orchestre renseigné, non comptée${tot.sansMobilier > 1 ? "s" : ""}.` });
  }

  blocs.push({ t: "h", text: "Notes du concert" });
  blocs.push({ t: "p", text: (concert.notes || "").trim() || "Aucune note." });
  return blocs;
}

// ── Blocs vers TXT et vers PDF ─────────────────────────────────────────────────────────
/** Le texte brut d'une fiche (UTF-8, sans tiret cadratin ni emoji). */
export function blocsEnTxt(blocs) {
  const out = [];
  for (const b of blocs) {
    switch (b.t) {
      case "title": out.push(cleanText(b.text), "=".repeat(Math.min(60, Math.max(8, cleanText(b.text).length))), ""); break;
      case "sub": out.push(cleanText(b.text), ""); break;
      case "h": out.push("", cleanText(b.text).toUpperCase(), "-".repeat(Math.min(60, Math.max(8, cleanText(b.text).length)))); break;
      case "h3": out.push("", cleanText(b.text)); break;
      case "p": out.push(cleanText(b.text)); break;
      case "b": out.push("- " + cleanText(b.text)); break;
      case "kv": for (const [k, v] of b.rows) out.push(`${cleanText(k)} : ${cleanText(v === "" || v == null ? "-" : v)}`); break;
      case "img": break; // l'image n'existe que dans le PDF
      default: break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Le PDF d'une fiche (Uint8Array). `images` : { nom: { bytes (JPEG), width, height, components } } pour les blocs « img ».
 * Une image absente est ignorée sans erreur (la ligne du plan dit déjà qu'il manque).
 */
export function blocsEnPdf(blocs, { titre = "", images = {}, pied = "OrkMap" } = {}) {
  const doc = new PdfDocument({ title: titre, footer: pied });
  for (const b of blocs) {
    switch (b.t) {
      case "title": doc.title_(b.text); break;
      case "sub": doc.subtitle(b.text); break;
      case "h": doc.heading(b.text); break;
      case "h3": doc.subheading(b.text); break;
      case "p": doc.paragraph(b.text); break;
      case "b": doc.bullet(b.text); break;
      case "kv": doc.keyValues(b.rows); break;
      case "img": if (images[b.name]) doc.image(images[b.name], { fullWidth: true, caption: b.caption }); break;
      default: break;
    }
  }
  return doc.build();
}
