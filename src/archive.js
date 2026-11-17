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

// ── Mobilier d'une pièce (jamais de total entre œuvres : les salles veulent chaque œuvre séparée) ───────────────────────────────────────────
/** Le mobilier d'une pièce, comme partout dans l'app : celui qui est enregistré, sinon le calcul. */
export function mobilierDePiece(piece, concert) {
  if (piece && piece.mobilier) return piece.mobilier;
  if (!piece || !piece.orchestre) return null;
  return calculateMobilier(piece.orchestre, piece.percus, optionsMobilier(piece, concert));
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

/** Le décompte d'une œuvre : mobilier calculé (avec ses détails), mobilier observé et écarts, percussions par pôle. Le même dans sa fiche et dans la fiche du concert. */
export function blocsDecompte(piece, concert) {
  const blocs = [];
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

  blocs.push(...blocsDecompte(piece, concert));

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
// Demande du régisseur (17/11/2026) : la salle veut chaque œuvre séparée, jamais de total entre œuvres.
// La fiche du concert = l'en-tête, un SOMMAIRE (numéro, titre, compositeur, effectif, dossier, page), les notes,
// puis une section par œuvre (nouvelle page) avec son décompte complet.
export function blocsFicheConcert({ concert, pieces, nbTotal = null }) {
  const blocs = [{ t: "title", text: concert.titre || "Concert sans titre" }];
  blocs.push({ t: "sub", text: "Sommaire du dossier" });
  blocs.push({
    t: "kv",
    rows: [
      ["Date", concert.date || ""],
      ["Lieu", concert.lieu || ""],
      ["Chef", concert.chef || ""],
      ["Orchestre", concert.orchestre || ""],
      ["Œuvres dans ce dossier", nbTotal !== null && nbTotal !== pieces.length ? `${pieces.length} sur ${nbTotal}` : String(pieces.length)],
    ],
  });

  blocs.push({ t: "h", text: "Sommaire : œuvres dans l'ordre du concert" });
  if (pieces.length === 0) blocs.push({ t: "p", text: "Aucune œuvre dans ce dossier." });
  else {
    blocs.push({
      t: "toc",
      entries: pieces.map((p, i) => ({
        id: `oeuvre${i + 1}`,
        numero: num2(i + 1),
        titre: p.titre || "Sans titre",
        compositeur: p.compositeur || "",
        effectif: p.effectif || "",
        dossier: nomDossierPiece(i + 1, p) + "/",
      })),
    });
  }

  blocs.push({ t: "h", text: "Notes du concert" });
  blocs.push({ t: "p", text: (concert.notes || "").trim() || "Aucune note." });

  pieces.forEach((p, i) => {
    blocs.push({ t: "section", id: `oeuvre${i + 1}`, text: `${num2(i + 1)}. ${p.titre || "Sans titre"}` });
    if (p.compositeur) blocs.push({ t: "sub", text: p.compositeur });
    blocs.push({
      t: "kv",
      rows: [
        ["Effectif (Daniels)", p.effectif || "non renseigné"],
        ["Nombre de musiciens", p.orchestre ? formatMusicianTotal(countOrchestreMusicians(p.orchestre)) : "non renseigné"],
        ["Dossier de l'œuvre", nomDossierPiece(i + 1, p) + "/"],
      ],
    });
    blocs.push(...blocsDecompte(p, concert));
  });
  return blocs;
}

/** Les mots-clés du PDF du concert : « 01 Titre (Compositeur); 02 ... ». */
export function motsClesOeuvres(pieces) {
  return pieces.map((p, i) => `${num2(i + 1)} ${p.titre || "Sans titre"}${p.compositeur ? " (" + p.compositeur + ")" : ""}`).join("; ");
}

/** Métadonnées (/Info) du PDF du concert. */
export function infoPdfConcert(concert, pieces) {
  return {
    title: `${concert.titre || "Concert"}${concert.date ? ", " + concert.date : ""}`,
    subject: "Dossier pour la salle",
    keywords: motsClesOeuvres(pieces),
  };
}

/** Métadonnées (/Info) du PDF d'une œuvre. */
export function infoPdfPiece(concert, piece, rang) {
  return {
    title: `${num2(rang)}. ${piece.titre || "Sans titre"}${piece.compositeur ? ", " + piece.compositeur : ""}`,
    subject: `${concert.titre || "Concert"}${concert.date ? ", " + concert.date : ""}`,
    keywords: [piece.compositeur, piece.effectif].filter(Boolean).join("; "),
  };
}

/**
 * Le fichier 00_Sommaire.json : de quoi retrouver chaque œuvre par un logiciel ou une recherche.
 * `details` : [{ nbPlans, nbPhotos }] dans l'ordre des œuvres ; `pagesFiche` : { oeuvreN: page du PDF du concert }.
 */
export function sommaireJson({ concert, pieces, details = [], pagesFiche = {}, nbTotal = null }) {
  return JSON.stringify({
    dossier_pour_la_salle: true,
    genere_par: "OrkMap",
    concert: {
      titre: concert.titre || "",
      date: concert.date || "",
      lieu: concert.lieu || "",
      chef: concert.chef || "",
      orchestre: concert.orchestre || "",
      nombre_oeuvres_dans_le_dossier: pieces.length,
      nombre_oeuvres_du_concert: nbTotal === null ? pieces.length : nbTotal,
    },
    fiche_concert: { pdf: "00_Fiche_concert.pdf", txt: "00_Fiche_concert.txt" },
    oeuvres: pieces.map((p, i) => ({
      numero: i + 1,
      titre: p.titre || "",
      compositeur: p.compositeur || "",
      effectif: p.effectif || "",
      dossier: nomDossierPiece(i + 1, p) + "/",
      fiche_pdf: `${nomDossierPiece(i + 1, p)}/Fiche.pdf`,
      fiche_txt: `${nomDossierPiece(i + 1, p)}/Fiche.txt`,
      page_dans_fiche_concert: pagesFiche[`oeuvre${i + 1}`] || null,
      nombre_plans: (details[i] && details[i].nbPlans) || 0,
      nombre_photos: (details[i] && details[i].nbPhotos) || 0,
    })),
  }, null, 2) + "\n";
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
      case "toc":
        for (const e of b.entries) {
          out.push(`${e.numero}. ${cleanText(e.titre)}${e.compositeur ? " (" + cleanText(e.compositeur) + ")" : ""}`);
          out.push(`    Effectif Daniels : ${cleanText(e.effectif) || "non renseigné"}`);
          out.push(`    Dossier : ${cleanText(e.dossier)}`, "");
        }
        break;
      case "section": out.push("", "", cleanText(b.text).toUpperCase(), "=".repeat(Math.min(60, Math.max(8, cleanText(b.text).length))), ""); break;
      case "img": break; // l'image n'existe que dans le PDF
      default: break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Le PDF d'une fiche : { bytes, pages }. `images` : { nom: { bytes (JPEG), width, height, components } } pour les blocs « img ».
 * `info` : { title, subject, keywords } du dictionnaire /Info. Les blocs « section » ouvrent une page et un signet PDF ;
 * le bloc « toc » (sommaire) indique la page de chaque section : le PDF est écrit deux fois pour connaître ces pages.
 */
export function blocsEnPdfDetail(blocs, { titre = "", info = {}, images = {}, pied = "OrkMap" } = {}) {
  const rendre = (pages) => {
    const doc = new PdfDocument({ title: info.title || titre, subject: info.subject || "", keywords: info.keywords || "", footer: pied });
    const trouvees = {};
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
        case "toc":
          for (const e of b.entries) {
            doc.paragraph(`${e.numero}  ${e.titre}${e.compositeur ? ", " + e.compositeur : ""}`, { bold: true, size: 10.5 });
            doc.paragraph(`Effectif Daniels : ${e.effectif || "non renseigné"}. Dossier : ${e.dossier}. Page ${pages[e.id] || "?"} de cette fiche.`, { size: 9, indent: 18, gray: 0.35 });
            doc.gap(3);
          }
          break;
        case "section":
          doc.pageBreak();
          trouvees[b.id] = doc.bookmark(b.text) + 1;
          doc.title_(b.text);
          break;
        default: break;
      }
    }
    return { doc, trouvees };
  };
  let pages = {};
  let r = rendre(pages);
  for (let essai = 0; essai < 3 && JSON.stringify(r.trouvees) !== JSON.stringify(pages); essai++) {
    pages = r.trouvees;
    r = rendre(pages);
  }
  return { bytes: r.doc.build(), pages: r.trouvees };
}

/** Le PDF d'une fiche (Uint8Array). */
export function blocsEnPdf(blocs, options = {}) {
  return blocsEnPdfDetail(blocs, options).bytes;
}
