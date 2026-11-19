// Corrections des percussions sur le plateau (retours du 19/11/2026) : changer un instrument de
// percussionniste ou de catégorie, le passer dans « Autres musiciens » (ondes, piano…) ou l'inverse,
// échanger Percu 1 et Percu 2, noter pied et tablettes. Fonctions pures, testées dans tests/lot9-percus.mjs.
// Les fonctions renvoient une NOUVELLE pièce ; App.jsx recalcule ensuite le texte global et la nomenclature.
import { categorizeInstrument } from "./pdfParser.js";
import { supportEffectif, supportOblige, standDe } from "./utils.js";

export const VERS_AUTRES = "autres";

// Éléments tout prêts proposés à l'ajout (catégorie « Stands & supports »).
export const SUPPORTS_RAPIDES = [
  "Grande tablette", "Petite tablette", "Pied de cymbale", "Pied de cymbale perche",
  "Pied de crotales", "Pied de caisse claire", "Pupitre percu", "Table à baguettes",
];

/** Catégorie probable d'un nom tapé à la main (au lieu de « Accessoires » d'office). */
export function devinerCategorie(nom) {
  const n = String(nom || "").trim();
  if (/^(?:grande |petite )?tablette|^pied\b|^pupitre|^table\b|^stand|^support|^si[eè]ge|^r[aâ]teau/i.test(n)) return "Stands & supports";
  if (/cymbale|crash|ride|charleston|hi-?hat|^tam\b|tam-?tam|gong/i.test(n)) return "Grosses pièces";
  return categorizeInstrument(n);
}

const clean = (v) => String(v || "").trim();
const sansQuantiteUn = (nom) => clean(nom).replace(/^1\s+(?=\D)/, "");

function nettoyerItem({ nom, cat, support, notes, checked }) {
  const it = { cat: cat || devinerCategorie(nom), nom: clean(nom), notes: notes || "" };
  if (support === "pied" || support === "support" || support === "grande" || support === "petite") {
    // Le support obligé reste implicite (il suit le nom) ; un autre choix est enregistré.
    if (support !== supportOblige(it.nom)) it.support = support;
  }
  // « Rien » choisi sur un instrument qui a d'office son support : on retient le retrait (sinon il reviendrait).
  // (support non fourni = rien choisi : le support obligé reste implicite.)
  else if (support !== undefined && supportOblige(it.nom)) it.support = "aucun";
  if (checked) it.checked = true;
  return it;
}

/** Ajoute un instrument à un poste. */
export function ajouterItem(piece, poleId, champs) {
  if (!clean(champs && champs.nom)) return piece;
  const item = nettoyerItem(champs);
  return { ...piece, percus: (piece.percus || []).map((r) => (r.id === poleId ? { ...r, items: [...(r.items || []), item] } : r)) };
}

/**
 * Modifie l'instrument n° idx du poste poleId : nom, catégorie, support, et destination
 * (`vers` = id d'un autre poste, ou VERS_AUTRES pour l'envoyer dans « Autres musiciens » de l'orchestre).
 */
export function modifierItem(piece, poleId, idx, champs) {
  const source = (piece.percus || []).find((r) => r.id === poleId);
  const ancien = source && source.items ? source.items[idx] : undefined;
  if (!ancien || !clean(champs && champs.nom)) return piece;
  const nouveau = nettoyerItem({ ...ancien, ...champs });
  const vers = champs.vers || poleId;
  if (vers === poleId) {
    return { ...piece, percus: piece.percus.map((r) => (r.id === poleId ? { ...r, items: r.items.map((it, i) => (i === idx ? nouveau : it)) } : r)) };
  }
  const percus = piece.percus.map((r) => (r.id === poleId ? { ...r, items: r.items.filter((_, i) => i !== idx) } : r));
  if (vers === VERS_AUTRES) {
    const orch = piece.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] };
    return { ...piece, percus, orchestre: { ...orch, autres: [...(orch.autres || []), nouveau.nom] } };
  }
  if (!percus.some((r) => r.id === vers)) return piece;
  return { ...piece, percus: percus.map((r) => (r.id === vers ? { ...r, items: [...(r.items || []), nouveau] } : r)) };
}

/** Passe la ligne n° idx de « Autres » (orchestre) dans un poste de percussion (« 1 Waterphone » → « Waterphone »). */
export function autresVersPoste(piece, idx, poleId) {
  const orch = piece.orchestre;
  const ligne = orch && Array.isArray(orch.autres) ? orch.autres[idx] : undefined;
  if (ligne === undefined || !(piece.percus || []).some((r) => r.id === poleId)) return piece;
  const nom = sansQuantiteUn(ligne);
  return {
    ...piece,
    orchestre: { ...orch, autres: orch.autres.filter((_, i) => i !== idx) },
    percus: piece.percus.map((r) => (r.id === poleId ? { ...r, items: [...(r.items || []), nettoyerItem({ nom })] } : r)),
  };
}

/**
 * Échange deux postes : chacun prend le nom et la place de l'autre. Les instruments et les photos
 * restent attachés à leur poste (les photos sont rangées par poste), seul « qui est Percu 1 » change.
 */
export function echangerPostes(piece, idA, idB) {
  const percus = piece.percus || [];
  const ia = percus.findIndex((r) => r.id === idA);
  const ib = percus.findIndex((r) => r.id === idB);
  if (ia < 0 || ib < 0 || ia === ib) return piece;
  const arr = [...percus];
  const a = percus[ia]; const b = percus[ib];
  arr[ia] = { ...b, nom: a.nom };
  arr[ib] = { ...a, nom: b.nom };
  return { ...piece, percus: arr };
}

/**
 * Supports à sortir pour l'ensemble des postes, par nom : ceux attachés aux instruments (d'office ou choisis)
 * et les éléments ajoutés tels quels (« Grande tablette », « Pied de crotales »). Ex. { "Pied de cymbale": 2 }.
 */
export function supportsAPrevoir(percus) {
  const c = {};
  const add = (k) => { c[k] = (c[k] || 0) + 1; };
  for (const r of percus || []) {
    for (const it of (r && r.items) || []) {
      if (!it || typeof it !== "object") continue;
      const st = standDe(it);
      if (st) add(st);
      else if (it.cat === "Stands & supports" && /^(?:grande |petite )?tablette|^pied\b|^support|^cadre|^pupitre|^table\b/i.test(clean(it.nom))) add(clean(it.nom).charAt(0).toUpperCase() + clean(it.nom).slice(1));
    }
  }
  return c;
}

export function texteSupports(percus) {
  return Object.entries(supportsAPrevoir(percus)).map(([k, n]) => `${n} × ${k.toLowerCase()}`).join(", ");
}
