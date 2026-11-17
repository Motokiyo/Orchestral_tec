// Calcul du mobilier (lot 4A). Règles du régisseur : docs/audit/lot4-regles-mobilier.md.
// Module sans React ni accès réseau. utils.js le ré-exporte pour ne rien casser.
import { extractNumberFromItem, isAnnotationItem } from './utils.js';

// ── Normalisation : minuscules, sans accents, sans ligature ──
const norm = (s) => String(s == null ? '' : s)
  .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase();

// ─────────────────────────────────────────────────────────────
// Table des instruments (français, anglais, baroques).
// stand : 'normal' (porte-instrument courant), 'special', 'aucun'
// siege : 'chaise' (chaise normale), 'banquette', 'haute' (contrebasse), 'aucun'
// ─────────────────────────────────────────────────────────────
// L'ordre compte : les noms les plus précis passent avant les plus généraux
// (contrebasson avant contrebasse et basson, clarinette basse avant clarinette, cor anglais avant cor...).
export const INSTRUMENTS = [
  // Bois
  { key: 'contrebasson', label: 'contrebasson', famille: 'bois', stand: 'special', siege: 'chaise',
    re: /contre-?\s?basson|contra-?\s?bassoon|double\s?bassoon|kontrafagott/ },
  { key: 'clarinette_basse', label: 'clarinette basse', famille: 'bois', stand: 'special', siege: 'chaise',
    re: /clarinettes?[\s-]+basses?|bass\s?clarinets?|clarinette\s?b\b|clarinetto\s?basso/ },
  { key: 'piccolo', label: 'piccolo', famille: 'bois', stand: 'aucun', siege: 'chaise',
    re: /\bpiccolos?\b|\bpicc\b|petites?\s?flutes?/ },
  { key: 'cor_anglais', label: 'cor anglais', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /cors?[\s-]+anglais|english\s?horns?|corno\s?inglese/ },
  { key: 'flute', label: 'flûte', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /flutes?\b|traverso|flauto|\bfl\b|\bfls\b|recorders?|flute\s?a\s?bec|bansuri/ },
  { key: 'hautbois', label: 'hautbois', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /hautbois|\boboes?\b|\bob\b|\bobs\b|oboe\s?d'?amore/ },
  { key: 'clarinette', label: 'clarinette', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /clarinet|\bcl\b|\bcls\b|\bclar\b/ },
  { key: 'basson', label: 'basson', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /\bbassons?\b|\bbassoons?\b|\bbn\b|\bfagott/ },
  { key: 'saxophone', label: 'saxophone', famille: 'bois', stand: 'normal', siege: 'chaise',
    re: /saxophon|\bsaxos?\b|\bsax\b|sopsax|\bsaxs\b/ },
  // Cuivres (baroques avant les modernes)
  { key: 'cornet_a_bouquin', label: 'cornet à bouquin', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /cornets?\s?a\s?bouquin|zinck?s?\b|cornett/ },
  { key: 'sacqueboute', label: 'sacqueboute', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /sacqueboute|sackbut|saqueboute/ },
  { key: 'cor_naturel', label: 'cor naturel', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /cors?\s?naturels?|natural\s?horns?|waldhorn/ },
  { key: 'trompette_naturelle', label: 'trompette naturelle', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /trompettes?\s?naturelles?|natural\s?trumpets?|baroque\s?trumpets?/ },
  { key: 'trombone', label: 'trombone', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /trombon|\btbns?\b|\btrb\b/ },
  { key: 'trompette', label: 'trompette', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /trompette|trumpet|\btpts?\b|\btpt\b|clairon|\bcornets?\b|flugelhorn|bugle/ },
  { key: 'tuba', label: 'tuba', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /\btubas?\b|euphonium|bombardon|sousaphone|wagner\s?tuba/ },
  { key: 'cor', label: 'cor', famille: 'cuivres', stand: 'normal', siege: 'chaise',
    re: /\bcors?\b|\bhorns?\b|\bhn\b|\bhrn\b|french\s?horn/ },
  // Claviers et harpes (sur banquette)
  { key: 'clavecin', label: 'clavecin', famille: 'clavier', stand: 'aucun', siege: 'banquette',
    re: /clavecin|harpsichord|cembalo|virginal|epinette/ },
  { key: 'orgue', label: 'orgue', famille: 'clavier', stand: 'aucun', siege: 'banquette',
    re: /orgues?\b|organs?\b|organ\b|positif|regale/ },
  { key: 'celesta', label: 'célesta', famille: 'clavier', stand: 'aucun', siege: 'banquette',
    re: /celesta|celeste|\bcel\b/ },
  { key: 'piano', label: 'piano', famille: 'clavier', stand: 'aucun', siege: 'banquette',
    re: /pianos?\b|pianoforte|\bpno\b|\bpf\b/ },
  { key: 'clavier', label: 'clavier', famille: 'clavier', stand: 'aucun', siege: 'banquette',
    re: /claviers?\b|keyboards?|\bkbs?\b|synth|accordeon-?clavier|keys\b/ },
  { key: 'harpe', label: 'harpe', famille: 'harpe', stand: 'aucun', siege: 'banquette',
    re: /\bharpes?\b|\bharps?\b|\bhp\b|arpa|harpe\s?baroque|arpa\s?doppia/ },
  // Cordes (baroques avant les modernes : violone avant violon, viole avant alto)
  { key: 'theorbe', label: 'théorbe', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /theorbes?|archiluths?|chitarrone|\blu(?:th|te)s?\b|\blutes?\b|guitare\s?baroque|vihuela|cistre|cittern/ },
  { key: 'viole_de_gambe', label: 'viole de gambe', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /violes?(?:\s+de\s+gambe)?\b|gambes?\b|viola\s?da\s?gamba|viols?\b|violone|violon\s?basse?\s?baroque/ },
  { key: 'guitare_basse', label: 'guitare basse', famille: 'autre', stand: 'aucun', siege: 'chaise',
    re: /guitares?[\s-]+basses?|bass\s?guitar|bassguitar|basse\s?electrique/ },
  { key: 'guitare', label: 'guitare', famille: 'autre', stand: 'aucun', siege: 'chaise',
    re: /guitar/ },
  { key: 'violon1', label: 'violon I', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /(?:violons?|violins?|vln|vl)\s*(?:i|1|1er|premiers?|first)(?![a-z0-9])/ },
  { key: 'violon2', label: 'violon II', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /(?:violons?|violins?|vln|vl)\s*(?:ii|2|2nd|seconds?|deuxiemes?)(?![a-z0-9])/ },
  { key: 'alto', label: 'alto', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /\baltos?\b|\bviolas?\b|\bvla\b/ },
  { key: 'violoncelle', label: 'violoncelle', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /violoncell|\bcellos?\b|\bvlc\b|\bvcl?\b|\bvcs\b/ },
  { key: 'contrebasse', label: 'contrebasse', famille: 'cordes', stand: 'aucun', siege: 'haute',
    re: /contre-?\s?basse|double\s?bass|\bcbs?\b|contrabass|kontrabass/ },
  { key: 'violon', label: 'violon', famille: 'cordes', stand: 'aucun', siege: 'chaise',
    re: /violons?\b|violins?\b/ },
  // Percussions (comptées par les pôles, pas par l'orchestre)
  { key: 'timbale', label: 'timbalier', famille: 'percussion', stand: 'aucun', siege: 'aucun',
    re: /timbal|timpan|\btimb\b/ },
  { key: 'percussion', label: 'percussion', famille: 'percussion', stand: 'aucun', siege: 'aucun',
    re: /percussion|vibraphon|marimba|xylophon|glockenspiel|batterie|drum/ },
];

/** Reconnaît la famille d'une ligne d'effectif (« 2 Flûtes », « Basson baroque », « Bass clarinet »...). */
export function identifierInstrument(texte) {
  const s = norm(texte);
  if (!s.trim()) return null;
  for (const inst of INSTRUMENTS) if (inst.re.test(s)) return inst;
  return null;
}

// Clé d'instrument tolérante pour les réglages : « Flûtes », "flute", "Clarinette basse" => flute, clarinette_basse.
function cleReglage(k) {
  const s = norm(k).replace(/[\s-]+/g, '_').replace(/s$/, '');
  const direct = INSTRUMENTS.find((i) => i.key === s || norm(i.label).replace(/\s+/g, '_') === s);
  if (direct) return direct.key;
  const found = identifierInstrument(k);
  return found ? found.key : s;
}

// ─────────────────────────────────────────────────────────────
// Réglages par ensemble
// ─────────────────────────────────────────────────────────────
function modeleChaise(v) {
  return /kolberg/i.test(String(v || '')) ? 'Kolberg' : 'R&S';
}

export function reglagesParDefaut(nomEnsemble) {
  const n = norm(nomEnsemble);
  const onf = /\bonf\b|orchestre national de france/.test(n);
  // « Philhar » seul (mot entier) ou le nom complet de Radio France : une autre philharmonie n'est pas concernée.
  const philhar = /\bphilhar\b|\boprf\b|philharmonique de radio france|phil(?:harmonique)? radio france/.test(n);
  return {
    standPourDeux: [],
    chaisesHautes: {
      contrebasses: onf ? 'Kolberg' : 'R&S',
      percussions: philhar ? 'Kolberg' : 'R&S',
    },
  };
}

function lireReglages(reglages) {
  const def = reglagesParDefaut('');
  const r = reglages && typeof reglages === 'object' ? reglages : {};
  const ch = r.chaisesHautes || {};
  return {
    standPourDeux: new Set((Array.isArray(r.standPourDeux) ? r.standPourDeux : []).map(cleReglage)),
    chaisesHautes: {
      contrebasses: modeleChaise(ch.contrebasses || def.chaisesHautes.contrebasses),
      percussions: modeleChaise(ch.percussions || def.chaisesHautes.percussions),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Percussions : effectif écrit (« T+2 ») sinon pôles
// ─────────────────────────────────────────────────────────────
const entierOuNull = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

function poleADesTimbales(pole) {
  const items = Array.isArray(pole && pole.items) ? pole.items : [];
  return items.some((it) => /timbale|timpani/i.test(typeof it === 'string' ? it : (it && it.nom) || ''));
}

function lirePercus(percus, effectifPercus) {
  const poles = Array.isArray(percus) ? percus : [];
  const parNom = poles.filter((p) => /timbal/i.test((p && p.nom) || '')).length;
  const timbalesPresentes = poles.some(poleADesTimbales) || parNom > 0;
  // Un pôle qui contient des timbales sans porter le nom « timbalier » tient lieu de timbalier s'il n'y en a pas d'autre.
  const timbaliersPoles = parNom > 0 ? parNom : (poles.some(poleADesTimbales) ? 1 : 0);
  const percusPoles = Math.max(0, poles.length - timbaliersPoles);

  const ep = effectifPercus && typeof effectifPercus === 'object' ? effectifPercus : {};
  const tEcrit = entierOuNull(ep.timbaliers);
  const pEcrit = entierOuNull(ep.percussionnistes);
  let timbaliers = tEcrit !== null ? tEcrit : timbaliersPoles;
  const percussionnistes = pEcrit !== null ? pEcrit : percusPoles;
  // Des timbales sur le plan : il y a forcément un timbalier.
  if (timbalesPresentes && timbaliers < 1) timbaliers = 1;
  return { timbaliers, percussionnistes, timbalesPresentes };
}

// ─────────────────────────────────────────────────────────────
// Calcul
// ─────────────────────────────────────────────────────────────
function nomAffiche(str) {
  return str.replace(/^\s*\d+\s*(?:x\s*)?/i, '').replace(/\s*(?::|\sx)\s*\d+\s*$/i, '').trim().toLowerCase() || str.trim().toLowerCase();
}

export function calculateMobilier(orchestre, percus, options = {}) {
  if (!orchestre) return null;
  const { hasChef = false, chefInconnu = false, reglages, effectifPercus } = options || {};
  const reg = lireReglages(reglages);

  const infos = [];
  let quantitesInconnues = 0;

  const cordes = { v1: 0, v2: 0, alto: 0, vlc: 0, cb: 0, other: 0 };
  const standsBois = [];
  const standsCuivres = [];
  const speciaux = [];
  const banquettesParType = new Map(); // type => qty (null si inconnue)
  let pupitresVents = 0;       // un par musicien à vent
  let pupitresClaviersHarpes = 0;
  let pupitresAutres = 0;
  let chaisesVentsEtAutres = 0;
  let piccoloVu = false;

  const ajouterBanquette = (type, qty) => {
    if (qty === null) { banquettesParType.set(type, banquettesParType.get(type) ?? null); return; }
    banquettesParType.set(type, (banquettesParType.get(type) || 0) + qty);
  };

  const traiterLigne = (item, section) => {
    const str = typeof item === 'string' ? item : '';
    if (!str.trim() || isAnnotationItem(str)) return;
    const qty = extractNumberFromItem(str);
    if (qty === null) quantitesInconnues++;
    let inst = identifierInstrument(str);
    // Repli sur la section écrite sur le plan quand le nom n'est pas reconnu.
    if (!inst) {
      inst = { key: 'inconnu', label: nomAffiche(str), stand: section === 'bois' || section === 'cuivres' ? 'normal' : 'aucun', siege: 'chaise',
        famille: section === 'bois' ? 'bois' : section === 'cuivres' ? 'cuivres' : section === 'cordes' ? 'cordes' : 'autre' };
    }
    if (inst.famille === 'percussion') return; // les percussions viennent des pôles et de l'effectif

    if (inst.famille === 'cordes') {
      if (qty === null) return;
      if (inst.key === 'violon1' || inst.key === 'violon') cordes.v1 += qty;
      else if (inst.key === 'violon2') cordes.v2 += qty;
      else if (inst.key === 'alto') cordes.alto += qty;
      else if (inst.key === 'violoncelle') cordes.vlc += qty;
      else if (inst.key === 'contrebasse') cordes.cb += qty;
      else cordes.other += qty; // violes de gambe, théorbes, luths...
      return;
    }

    if (inst.famille === 'harpe' || inst.famille === 'clavier') {
      ajouterBanquette(`Banquette ${inst.label}`, qty);
      if (qty !== null) pupitresClaviersHarpes += qty;
      return;
    }

    if (inst.famille === 'autre') {
      if (qty !== null) { pupitresAutres += qty; chaisesVentsEtAutres += qty; }
      return;
    }

    // Vents
    if (qty !== null) { pupitresVents += qty; chaisesVentsEtAutres += qty; }
    if (inst.key === 'piccolo') {
      piccoloVu = true;
      return; // aucun stand
    }
    let q = qty;
    if (q !== null && reg.standPourDeux.has(inst.key)) q = Math.ceil(q / 2);
    const nom = nomAffiche(str);
    if (inst.stand === 'special') {
      speciaux.push({ type: `Stand spécial pour ${nom}`, qty: q });
    } else {
      (inst.famille === 'cuivres' ? standsCuivres : standsBois).push({ type: `Stands pour ${nom}`, qty: q });
    }
  };

  for (const it of orchestre.bois || []) traiterLigne(it, 'bois');
  for (const it of orchestre.cuivres || []) traiterLigne(it, 'cuivres');
  for (const it of orchestre.cordes || []) traiterLigne(it, 'cordes');
  for (const it of orchestre.autres || []) traiterLigne(it, 'autres');

  if (piccoloVu) infos.push("Piccolo : sur la tablette du pupitre d'harmonie (aucun stand).");

  // ── Percussions ──
  const { timbaliers, percussionnistes, timbalesPresentes } = lirePercus(percus, effectifPercus);
  const chaisesSpeciales = [];
  if (timbaliers > 0) {
    chaisesSpeciales.push({ type: 'Chaise timbalier', qty: timbaliers });
    if (timbalesPresentes) infos.push('Chaise timbalier ajoutée automatiquement : il y a des timbales.');
  }

  // ── Chef ──
  const autresStands = [];
  if (hasChef) {
    autresStands.push({ type: 'Podium chef', qty: 1 });
    autresStands.push({ type: 'Pupitre chef', qty: 1 });
  }

  // ── Cordes : stands propres aux contrebasses et violoncelles ──
  const cordesStands = [];
  if (cordes.cb > 0) {
    cordesStands.push({ type: 'Stands de contrebasse', qty: cordes.cb });
    cordesStands.push({ type: 'Planches à pic CB', qty: cordes.cb });
  }
  if (cordes.vlc > 0) cordesStands.push({ type: 'Planches à pic Vlc', qty: cordes.vlc });

  // ── Pupitres ──
  const pupitresCordes = Math.ceil(cordes.v1 / 2) + Math.ceil(cordes.v2 / 2) + Math.ceil(cordes.alto / 2) +
    Math.ceil(cordes.vlc / 2) + Math.ceil(cordes.cb / 2) + cordes.other;
  const pupitres = pupitresCordes + pupitresVents + pupitresClaviersHarpes + pupitresAutres +
    percussionnistes + timbaliers + (hasChef ? 1 : 0);

  // ── Chaises ──
  const chaisesNormales = cordes.v1 + cordes.v2 + cordes.alto + cordes.vlc + cordes.other + chaisesVentsEtAutres;

  // ── Chaises hautes : contrebasses + percussionnistes (+ chef) ──
  const parRole = { contrebasses: cordes.cb, percussions: percussionnistes, chef: hasChef ? 1 : 0 };
  const chaisesHautes = parRole.contrebasses + parRole.percussions + parRole.chef;
  const modele = { contrebasses: reg.chaisesHautes.contrebasses, percussions: reg.chaisesHautes.percussions, chef: 'R&S' };
  const parts = [];
  if (parRole.contrebasses > 0) parts.push(`${parRole.contrebasses} (contrebasses, ${modele.contrebasses})`);
  if (parRole.percussions > 0) parts.push(`${parRole.percussions} (percussions, ${modele.percussions})`);
  if (parRole.chef > 0) parts.push('1 (chef)');
  const chaisesHautesDetail = chaisesHautes === 0 ? '0' : `${parts.join(' + ')} = ${chaisesHautes}`;

  // ── Banquettes ──
  const banquettesDetail = [...banquettesParType.entries()].map(([type, qty]) => ({ type, qty }));
  const banquettes = banquettesDetail.reduce((a, b) => a + (b.qty || 0), 0);

  return {
    general: {
      pupitres,
      chaisesNormales,
      chaisesHautes,
      chaisesHautesDetail,
      chaisesHautesParRole: parRole,
      chaisesHautesModele: modele,
      chaisesSpeciales,
      banquettes,
      banquettesDetail,
      ...(quantitesInconnues > 0 ? { quantitesInconnues } : {}),
      ...(chefInconnu && !hasChef ? { chefAConfirmer: true } : {}),
    },
    stands: {
      cordes: cordesStands,
      bois: standsBois,
      cuivres: standsCuivres,
      percus: [],
      autres: autresStands,
      speciaux,
    },
    infos,
  };
}

// ─────────────────────────────────────────────────────────────
// Comparaison calcul / plan : montre les écarts, ne tranche jamais
// ─────────────────────────────────────────────────────────────
// Rapproche un nom écrit sur le plan d'un élément calculé (clé), ou null si non comparable.
function cleObservee(type) {
  const s = norm(type).replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/tabouret|stool|banquette|bench|banc\b/.test(s)) return 'banquettes';
  if (/praticable|riser|platform|estrade/.test(s)) return 'praticables';
  if (/podium/.test(s)) return 'podium';
  if (/(chaise|chair|siege).*(timbal|timp)|(timbal|timp).*(chaise|chair)/.test(s)) return 'chaiseTimbalier';
  if (/(chaise|chair).*(contrebasse|double bass|\bcb\b)|(contrebasse|\bcb\b).*(chaise|chair)/.test(s)) return 'chaisesContrebasse';
  if (/chaises? hautes?|high chair|bar ?stool|chaise r ?& ?s|chaise tournante|kolberg/.test(s)) return 'chaisesHautes';
  if (/music stand|pupitre|\bdesk\b|stand a musique|stand pupitre/.test(s)) return 'pupitres';
  if (/stands? speciau|special stand|stand special/.test(s)) return 'standsSpeciaux';
  if (/^chaises?( |$)|^chairs?( |$)|chaise d orchestre|chaise normale|chaise standard|chaise simple|orchestra chair|chaise orchestre/.test(s)) {
    // Une chaise « spéciale » (piano, australienne...) n'est pas une chaise normale.
    if (/special|piano|australien|harpe|harp|timbal|kolberg/.test(s)) return null;
    return 'chaisesNormales';
  }
  return null;
}

const NOMS_ELEMENTS = {
  chaisesNormales: 'Chaises normales',
  chaisesHautes: 'Chaises hautes',
  chaisesContrebasse: 'Chaises de contrebasse',
  chaiseTimbalier: 'Chaise timbalier',
  pupitres: 'Pupitres',
  banquettes: 'Banquettes',
  podium: 'Podium',
  standsSpeciaux: 'Stands spéciaux',
  praticables: 'Praticables',
};

function valeursCalculees(calcule) {
  const g = (calcule && calcule.general) || {};
  const st = (calcule && calcule.stands) || {};
  const somme = (l) => (Array.isArray(l) ? l.reduce((a, b) => a + (Number.isInteger(b && b.qty) ? b.qty : 0), 0) : 0);
  const spec = Array.isArray(g.chaisesSpeciales) ? g.chaisesSpeciales : [];
  const podium = (Array.isArray(st.autres) ? st.autres : []).filter((s) => /podium/i.test(s.type || ''));
  const out = {};
  if (Number.isInteger(g.chaisesNormales)) out.chaisesNormales = g.chaisesNormales;
  if (Number.isInteger(g.chaisesHautes)) out.chaisesHautes = g.chaisesHautes;
  if (g.chaisesHautesParRole && Number.isInteger(g.chaisesHautesParRole.contrebasses)) out.chaisesContrebasse = g.chaisesHautesParRole.contrebasses;
  if (Number.isInteger(g.pupitres)) out.pupitres = g.pupitres;
  if (Number.isInteger(g.banquettes)) out.banquettes = g.banquettes;
  if (!g.chefAConfirmer) out.podium = somme(podium);
  if (Array.isArray(st.speciaux)) out.standsSpeciaux = somme(st.speciaux);
  out.chaiseTimbalier = somme(spec.filter((s) => /timbal/i.test(s.type || '')));
  // Praticables : lus sur le dessin, jamais calculés ici.
  return out;
}

export function comparerMobilier(calcule, observe) {
  const liste = Array.isArray(observe) ? observe : [];
  if (!calcule || liste.length === 0) return [];
  const calc = valeursCalculees(calcule);
  const partiel = !!(calcule.general && calcule.general.quantitesInconnues);

  // Regroupe les lignes observées par élément : la somme n'existe que si toutes les quantités sont lues.
  const groupes = new Map();
  for (const o of liste) {
    if (!o || typeof o.type !== 'string') continue;
    const cle = cleObservee(o.type);
    if (!cle) continue;
    const g = groupes.get(cle) || { total: 0, inconnu: false };
    if (Number.isInteger(o.qte)) g.total += o.qte; else g.inconnu = true;
    groupes.set(cle, g);
  }

  const ecarts = [];
  for (const [cle, g] of groupes) {
    if (!(cle in calc)) continue; // rien de calculé pour cet élément : rien à comparer
    if (g.inconnu) continue;     // quantité lue incomplète : on ne conclut pas
    const calcule_ = calc[cle];
    if (calcule_ === g.total) continue;
    const element = NOMS_ELEMENTS[cle] || cle;
    ecarts.push({
      element,
      calcule: calcule_,
      observe: g.total,
      message: `${element} : le calcul donne ${calcule_}, le plan en indique ${g.total}.` +
        (partiel ? ' Le calcul est partiel (des lignes de l\'effectif n\'ont pas de quantité).' : '') +
        ' À vérifier, rien n\'est corrigé automatiquement.',
    });
  }
  return ecarts;
}
