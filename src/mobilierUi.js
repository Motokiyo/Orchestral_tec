// Logique pure des écrans du mobilier (lot 4C) : réglages, fusion des chaises spéciales, ajout de postes
// de percussion, écarts plan / calcul. Aucun React, aucun réseau : testé en Node (tests/lot4-ecrans.mjs).
import { calculateMobilier, comparerMobilier, reglagesParDefaut, identifierInstrument } from './mobilier.js';
import { chefOptions } from './utils.js';

const estObjet = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const MODELES = ['R&S', 'Kolberg'];
const modele = (v, repli) => (MODELES.includes(v) ? v : repli);

/** Réglages utilisables : ceux de la pièce, sinon ceux du concert, sinon ceux de l'ensemble (par défaut). */
export function reglagesEffectifs(piece, concert) {
  const defaut = reglagesParDefaut((concert && concert.orchestre) || '');
  const source = [piece && piece.reglagesMobilier, concert && concert.reglagesMobilier].find(estObjet);
  if (!source) return defaut;
  const ch = estObjet(source.chaisesHautes) ? source.chaisesHautes : {};
  return {
    standPourDeux: Array.isArray(source.standPourDeux) ? [...source.standPourDeux] : [],
    chaisesHautes: {
      contrebasses: modele(ch.contrebasses, defaut.chaisesHautes.contrebasses),
      percussions: modele(ch.percussions, defaut.chaisesHautes.percussions),
    },
  };
}

/** Où viennent les réglages affichés : "piece", "concert" ou "defaut". */
export function origineReglages(piece, concert) {
  if (piece && estObjet(piece.reglagesMobilier)) return 'piece';
  if (concert && estObjet(concert.reglagesMobilier)) return 'concert';
  return 'defaut';
}

/** Les options de calculateMobilier pour une pièce (une seule fonction, partout). */
export function optionsMobilier(piece, concert) {
  return {
    ...chefOptions(piece ? piece.sansChef : null),
    reglages: reglagesEffectifs(piece, concert),
    effectifPercus: (piece && piece.effectifPercus) || undefined,
  };
}

/**
 * Chaises spéciales après un recalcul : les lignes calculées, plus les lignes ajoutées à la main.
 * « Chaise timbalier » n'est jamais dupliquée : si le calcul en donne une, l'ancienne est remplacée.
 */
export function fusionChaisesSpeciales(calculees, anciennes) {
  const neuves = Array.isArray(calculees) ? calculees : [];
  const vieilles = Array.isArray(anciennes) ? anciennes : [];
  const types = new Set(neuves.map((s) => String(s.type).trim().toLowerCase()));
  const calculTimbalier = neuves.some((s) => /timbal/i.test(s.type || ''));
  const gardees = vieilles.filter((s) => s && typeof s.type === 'string'
    && !types.has(s.type.trim().toLowerCase())
    && !(calculTimbalier && /timbal/i.test(s.type)));
  return [...neuves, ...gardees];
}

/** Recalcule le mobilier d'une pièce (sauf s'il a été modifié à la main). Garde les lignes ajoutées à la main. */
export function recalculerMobilier(piece, concert) {
  if (piece.mobilier && piece.mobilier._edited === true) return piece;
  const neuf = calculateMobilier(piece.orchestre, piece.percus, optionsMobilier(piece, concert));
  if (!neuf) return piece;
  const prev = piece.mobilier || {};
  neuf.general.chaisesSpeciales = fusionChaisesSpeciales(neuf.general.chaisesSpeciales, prev.general && prev.general.chaisesSpeciales);
  if (prev.stands && prev.stands.autresCustom) neuf.stands.autresCustom = prev.stands.autresCustom;
  return { ...piece, mobilier: neuf };
}

/** Instruments présents dans l'effectif qui peuvent partager un stand à deux (ni piccolo, ni cordes, ni claviers). */
export function instrumentsPartageables(orchestre) {
  const vus = new Map();
  if (!orchestre) return [];
  for (const section of ['bois', 'cuivres', 'autres']) {
    for (const ligne of Array.isArray(orchestre[section]) ? orchestre[section] : []) {
      const inst = typeof ligne === 'string' ? identifierInstrument(ligne) : null;
      if (!inst || inst.stand === 'aucun' || (inst.famille !== 'bois' && inst.famille !== 'cuivres')) continue;
      if (!vus.has(inst.key)) vus.set(inst.key, { key: inst.key, label: inst.label });
    }
  }
  return [...vus.values()];
}

/** Réglages saisis, nettoyés avant d'être enregistrés. */
export function nettoyerReglages(r) {
  const defaut = reglagesParDefaut('');
  const ch = estObjet(r && r.chaisesHautes) ? r.chaisesHautes : {};
  return {
    standPourDeux: [...new Set(Array.isArray(r && r.standPourDeux) ? r.standPourDeux.filter((k) => typeof k === 'string') : [])],
    chaisesHautes: {
      contrebasses: modele(ch.contrebasses, defaut.chaisesHautes.contrebasses),
      percussions: modele(ch.percussions, defaut.chaisesHautes.percussions),
    },
  };
}

/**
 * Enregistre des réglages sur une pièce ou sur tout le concert, puis recalcule le mobilier concerné.
 * pourTout = true : réglages du concert, la pièce n'a plus les siens ; les autres pièces qui ont leurs propres
 * réglages les gardent. Un mobilier modifié à la main n'est pas touché.
 * Renvoie le nouveau concert (rien n'est modifié sur place).
 */
export function appliquerReglages(concert, pieceId, reglages, pourTout) {
  const r = nettoyerReglages(reglages);
  if (pourTout) {
    const suivant = { ...concert, reglagesMobilier: r };
    suivant.pieces = (concert.pieces || []).map((p) => {
      if (p.id === pieceId) {
        const { reglagesMobilier, ...sans } = p;
        return recalculerMobilier(sans, suivant);
      }
      return estObjet(p.reglagesMobilier) ? p : recalculerMobilier(p, suivant);
    });
    return suivant;
  }
  return {
    ...concert,
    pieces: (concert.pieces || []).map((p) => (p.id === pieceId ? recalculerMobilier({ ...p, reglagesMobilier: r }, concert) : p)),
  };
}

const cleItems = (pole) => (Array.isArray(pole && pole.items) ? pole.items : [])
  .map((it) => String(typeof it === 'string' ? it : (it && it.nom) || '').trim().toLowerCase()).sort().join('|');
const memePole = (a, b) => String(a.nom || '').trim().toLowerCase() === String(b.nom || '').trim().toLowerCase() && cleItems(a) === cleItems(b);

// Un nom de poste déjà pris est renuméroté (« Percu 1 » devient « Percu 3 »), pour ne jamais avoir deux postes du même nom.
function nomLibre(nom, existants) {
  const pris = new Set(existants.map((p) => String((p && p.nom) || '').trim().toLowerCase()));
  const base = String(nom || '').trim();
  if (!base || !pris.has(base.toLowerCase())) return base || nom;
  const m = /^(.*?)\s*(\d+)$/.exec(base);
  const racine = m ? m[1] : base;
  for (let n = m ? parseInt(m[2], 10) + 1 : 2; n < 1000; n++) {
    const essai = `${racine} ${n}`;
    if (!pris.has(essai.toLowerCase())) return essai;
  }
  return base;
}

/**
 * Ajoute des postes de percussion à ceux d'une pièce : on ne remplace rien, aucun id en double.
 * Un poste identique (même nom, mêmes instruments) à un poste déjà présent n'est pas ajouté une seconde fois.
 * Le marquage « non vérifié » des postes lus localement est conservé.
 * Renvoie { percus, ajoutes, ignores }.
 */
export function ajouterPoles(existants, nouveaux, creerId) {
  const base = Array.isArray(existants) ? existants : [];
  const ids = new Set(base.map((p) => p && p.id));
  let n = 0;
  const fabrique = typeof creerId === 'function' ? creerId : () => `p${Date.now().toString(36)}${(n++).toString(36)}`;
  const percus = [...base];
  let ajoutes = 0;
  let ignores = 0;
  for (const pole of Array.isArray(nouveaux) ? nouveaux : []) {
    if (!estObjet(pole)) continue;
    if (percus.some((p) => estObjet(p) && memePole(p, pole))) { ignores++; continue; }
    let id = pole.id && !ids.has(pole.id) ? pole.id : null;
    while (!id || ids.has(id)) id = fabrique();
    ids.add(id);
    percus.push({ ...pole, id, nom: nomLibre(pole.nom, percus), items: Array.isArray(pole.items) ? pole.items : [] });
    ajoutes++;
  }
  return { percus, ajoutes, ignores };
}

/** Écarts plan / calcul, en phrases simples. Ne tranche jamais. */
export function ecartsPourAffichage(mobilier, mobilierObserve) {
  const partiel = !!(mobilier && mobilier.general && mobilier.general.quantitesInconnues);
  return comparerMobilier(mobilier, mobilierObserve).map((e) => ({
    ...e,
    texte: `${e.element} : le plan montre ${e.observe}, le calcul donne ${e.calcule} : à vérifier.${partiel ? " (Le calcul est partiel : des lignes de l'effectif n'ont pas de quantité.)" : ''}`,
  }));
}
