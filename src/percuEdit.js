// Corrections des percussions sur le plateau (retours du 19/11/2026) : changer un instrument de
// percussionniste ou de catégorie, le passer dans « Autres musiciens » (ondes, piano…) ou l'inverse,
// échanger Percu 1 et Percu 2, noter pied et tablettes. Fonctions pures, testées dans tests/lot9-percus.mjs.
// Les fonctions renvoient une NOUVELLE pièce ; App.jsx recalcule ensuite le texte global et la nomenclature.
import { categorizeInstrument } from "./pdfParser.js";

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
  if (support === "pied" || support === "grande" || support === "petite") it.support = support;
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

/** Pieds et tablettes à prévoir sur l'ensemble des postes (instruments marqués + éléments ajoutés tels quels). */
export function supportsAPrevoir(percus) {
  const c = { pied: 0, grande: 0, petite: 0 };
  for (const r of percus || []) {
    for (const it of (r && r.items) || []) {
      if (!it || typeof it !== "object") continue;
      if (c[it.support] !== undefined) c[it.support] += 1;
      const n = clean(it.nom).toLowerCase();
      if (/^grande tablette\b/.test(n)) c.grande += 1;
      else if (/^petite tablette\b/.test(n)) c.petite += 1;
      else if (/^pied\b/.test(n)) c.pied += 1;
    }
  }
  return c;
}

export function texteSupports(percus) {
  const c = supportsAPrevoir(percus);
  const parts = [];
  if (c.pied) parts.push(`${c.pied} pied${c.pied > 1 ? "s" : ""}`);
  if (c.grande) parts.push(`${c.grande} grande${c.grande > 1 ? "s" : ""} tablette${c.grande > 1 ? "s" : ""}`);
  if (c.petite) parts.push(`${c.petite} petite${c.petite > 1 ? "s" : ""} tablette${c.petite > 1 ? "s" : ""}`);
  return parts.join(", ");
}
