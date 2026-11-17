// Lignes d'effectif RÉELLES recopiées (texte seulement, sans nom de personne) du corpus local
// /Users/alexandre/Territoire/Projets/orkmap-corpus (fiches verite/PLAN-NNN.json, BROUILLONS non validés
// par Alexandre). « attendu » = ce que la ligne dit, instrument par instrument ; les zéros sont omis.
// Quand une ligne est illisible par nature (exposants aplatis), le groupe concerné est attendu vide
// (non lu) : refuser vaut mieux qu'inventer.
const C = (a, b, c, d, e) => ({ 'Violon I': a, 'Violon II': b, 'Alto': c, 'Violoncelle': d, 'Contrebasse': e });
const drop0 = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
const cordes = (...n) => drop0(C(...n));

export const LIGNES_REELLES = [
  // ── LSO (notation anglaise lettre-chiffre) ──
  { id: 'PLAN-001a', inv: false, ligne: '104 2sopsax 0 / 0400 / 0T 7P (2 Marimba, 2 Xylo, Vibraphone) 0H 4Pno (two instruments with 4 hands on each) / 2.0.2.2.2',
    attendu: { bois: {}, cuivres: { Trompette: 4 }, percussions: { Percussion: 7, Clavier: 4 }, cordes: cordes(2, 0, 2, 2, 2) } },
  { id: 'PLAN-001b', inv: false, ligne: '0000 / 0000 / 0T 5P (5 x claves) 0H 0Pno / -.-.-.-.-',
    attendu: { percussions: { Percussion: 5 } } },
  { id: 'PLAN-001c', inv: false, ligne: '3300 / 0331 / 0T 0P 0H 2Pno (Pianos* 3Kb ElecOrgans) / 4.4.4.4.2',
    attendu: { bois: { 'Flûte': 3, Hautbois: 3 }, cuivres: { Trompette: 3, Trombone: 3, Tuba: 1 }, percussions: { Clavier: 5 }, cordes: cordes(4, 4, 4, 4, 2) } },
  { id: 'PLAN-002', inv: true, ligne: '4 2p 3 1dc 3 4 1dc1c /4331/0T 5P 2 vibraphones, 2 marimbas, bass drum /0H 4Pno Four players on two pianos/2BassGuitar/12.12.8.8.8',
    attendu: { bois: {}, cuivres: { Cor: 4, Trompette: 3, Trombone: 3, Tuba: 1 }, percussions: { Percussion: 5, Clavier: 4 }, autres: { 'Guitare basse': 2 }, cordes: cordes(12, 12, 8, 8, 8) } },
  { id: 'PLAN-021', inv: true, ligne: '2220 / 0400 / 0T 2P 2 x Vibraphones 0H 2Pno / 1BassGuitar Electric / ENSEMBLE: 2.2.2.2.1 / FULL ORCHESTRA STRINGS: 10.8.6.6.0 (split)',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2 }, cuivres: { Trompette: 4 }, percussions: { Percussion: 2, Clavier: 2 }, autres: { 'Guitare basse': 1 }, cordes: cordes(10, 8, 6, 6, 0) } },
  // ── Daniels français et variantes ──
  { id: 'PLAN-004', inv: false, ligne: '3Perc - Hp - [Cordes 8.8.6.5.3] / 3[III+Pic].2[II+CA].3[III+ClB].2[II+Cbn] - 4.3.4[IV=TbnB].1',
    attendu: { bois: { 'Flûte': 3, Hautbois: 2, Clarinette: 3, Basson: 2 }, cuivres: { Cor: 4, Trompette: 3, Trombone: 4, Tuba: 1 }, percussions: { Percussion: 3, Harpe: 1 }, cordes: cordes(8, 8, 6, 5, 3) } },
  { id: 'PLAN-005', inv: true, ligne: '2 2 2 2 — 2 2 0 0 — T Cordes[12.10.8.6.4]',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2, Basson: 2 }, cuivres: { Cor: 2, Trompette: 2 }, percussions: { Timbales: 1 }, cordes: cordes(12, 10, 8, 6, 4) } },
  { id: 'PLAN-006-Farrenc', inv: true, ligne: '2 2 2 2—2 2 0 0—T Cordes[12.10.8.6.4]',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2, Basson: 2 }, cuivres: { Cor: 2, Trompette: 2 }, percussions: { Timbales: 1 }, cordes: cordes(12, 10, 8, 6, 4) } },
  { id: 'PLAN-006-Mozart', inv: true, ligne: '1 2 2 2—2 0 0 0 Cordes[10.8.6.4.2]',
    attendu: { bois: { 'Flûte': 1, Hautbois: 2, Clarinette: 2, Basson: 2 }, cuivres: { Cor: 2 }, cordes: cordes(10, 8, 6, 4, 2) } },
  { id: 'PLAN-006-globale', inv: false, ligne: '2 2 2 2—2 2 0 0—T ; cordes [12.10.8.6.4]',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2, Basson: 2 }, cuivres: { Cor: 2, Trompette: 2 }, percussions: { Timbales: 1 }, cordes: cordes(12, 10, 8, 6, 4) } },
  { id: 'PLAN-007', inv: true, ligne: '1[pic et sol].1[Eh].1.1-1.1.1.0-1.1.1.0 6-5-4-3-1',
    attendu: { bois: { 'Flûte': 1, Hautbois: 1, Clarinette: 1, Basson: 1 }, cuivres: { Cor: 1, Trompette: 1, Trombone: 1 }, percussions: { Timbales: 1, Percussion: 1, Harpe: 1 }, cordes: cordes(6, 5, 4, 3, 1) } },
  { id: 'PLAN-009', inv: true, ligne: '1-1-1-SaxTénor-SaxBaryton/2-2-2-1/1-0-1-0 / 6-4-2-2-1',
    attendu: { bois: { 'Flûte': 1, Hautbois: 1, Clarinette: 1, 'Saxophone ténor': 1, 'Saxophone baryton': 1 }, cuivres: { Cor: 2, Trompette: 2, Trombone: 2, Tuba: 1 }, percussions: { Timbales: 1, Harpe: 1 }, cordes: cordes(6, 4, 2, 2, 1) } },
  { id: 'PLAN-013', inv: true, ligne: '1 sop - 1 0 1 1 - SaxA - 0 0 2 0 - 3Perc / ClavMIDI - Acc - Hp - Cordes[2.1.2.2.1]',
    attendu: { bois: { 'Flûte': 1, Clarinette: 1, Basson: 1, 'Saxophone alto': 1 }, cuivres: { Trombone: 2 }, percussions: { Percussion: 3, Harpe: 1, Clavier: 1 }, autres: { Soprano: 1, 'Accordéon': 1 }, cordes: cordes(2, 1, 2, 2, 1) } },
  { id: 'PLAN-014', inv: true, ligne: '2.2.2.2+1 - 4.2.3.0 -Timb 10.8.8.7.4',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2, Basson: 2, 'Basson (auxiliaire)': 1 }, cuivres: { Cor: 4, Trompette: 2, Trombone: 3 }, percussions: { Timbales: 1 }, cordes: cordes(10, 8, 8, 7, 4) } },
  { id: 'PLAN-014-cartouche', inv: false, ligne: '2.2.2.2+1 - 4.2.3.0 -Timb / 10 / 8 / 8 / 7 / 4 + soliste',
    attendu: { bois: { 'Flûte': 2, Hautbois: 2, Clarinette: 2, Basson: 2, 'Basson (auxiliaire)': 1 }, cuivres: { Cor: 4, Trompette: 2, Trombone: 3 }, percussions: { Timbales: 1 }, cordes: cordes(10, 8, 8, 7, 4) } },
  { id: 'PLAN-015', inv: true, ligne: '4.3.3.4 - 4.4.4.1 -T+2 -2hp -cel -orgue +Banda 16.14.12.10.8',
    attendu: { bois: { 'Flûte': 4, Hautbois: 3, Clarinette: 3, Basson: 4 }, cuivres: { Cor: 4, Trompette: 4, Trombone: 4, Tuba: 1 }, percussions: { Timbales: 1, Percussion: 2, Harpe: 2, Clavier: 2 }, cordes: cordes(16, 14, 12, 10, 8) } },
  { id: 'PLAN-016', inv: true, ligne: '0-1-0-1/0-2-0-0/1-0-0-2 (Orgue & clavecin) ; 5 dessus, 2 tailles, 1 viole, 1 violoncelle, 1 théorbe, 1 violone',
    attendu: { bois: { Hautbois: 1, Basson: 1 }, cuivres: { Trompette: 2 }, percussions: { Timbales: 1, Clavier: 2 } } },
  { id: 'PLAN-018-OAE', inv: true, ligne: '5.0.3.0 - 0.6.4.2 -3sax -guitbasse -3perc 0/0/0/0/0',
    attendu: { bois: { 'Flûte': 5, Clarinette: 3, Saxophone: 3 }, cuivres: { Trompette: 6, Trombone: 4, Tuba: 2 }, percussions: { Percussion: 3 }, autres: { 'Guitare basse': 1 } } },
  { id: 'PLAN-018-OCL', inv: false, ligne: '1.1.1.1 - 2.1.0 0 1/1/1/1/1',
    attendu: { bois: { 'Flûte': 1, Hautbois: 1, Clarinette: 1, Basson: 1 }, cuivres: { Cor: 2, Trompette: 1 }, cordes: cordes(1, 1, 1, 1, 1) } },
  { id: 'PLAN-019', inv: true, ligne: '6+2.2.5+2.2+3sax / 1+3.4+2.4+0.3+0 / 1.4+0.1.0 / 8.8.6.4.3',
    attendu: { bois: { 'Flûte': 6, 'Flûte (auxiliaire)': 2, Hautbois: 2, Clarinette: 5, 'Clarinette (auxiliaire)': 2, Basson: 2, Saxophone: 3 }, cuivres: { Cor: 1, 'Cor (auxiliaire)': 3, Trompette: 4, 'Trompette (auxiliaire)': 2, Trombone: 4, Tuba: 3 }, percussions: { Timbales: 1, Percussion: 4, Harpe: 1 }, cordes: cordes(8, 8, 6, 4, 3) } },
  { id: 'PLAN-020', inv: true, ligne: '7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe',
    attendu: { bois: { 'Flûte': 2, Hautbois: 1, Clarinette: 2, Basson: 1 }, cuivres: { Cor: 3, Trompette: 2, Trombone: 2 }, percussions: { Timbales: 1, Percussion: 1, Harpe: 1 }, cordes: cordes(7, 6, 5, 4, 3) } },
];

const GROUPES = ['bois', 'cuivres', 'percussions', 'cordes', 'autres'];
/** Résultat du décodeur ramené à { bois, cuivres, percussions, cordes, autres } sans « total » ni zéros ; null => tout vide. */
export function normaliser(detail) {
  const out = {};
  for (const g of GROUPES) {
    const src = detail && detail[g] ? detail[g] : {};
    out[g] = Object.fromEntries(Object.entries(src).filter(([k, v]) => k !== 'total' && typeof v === 'number' && v > 0).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}
export function attenduNormalise(l) {
  const out = {};
  for (const g of GROUPES) out[g] = Object.fromEntries(Object.entries(l.attendu[g] || {}).sort(([a], [b]) => a.localeCompare(b)));
  return out;
}
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
/** Unités de percussion/harpe/clavier lues EN TROP par rapport à l'attendu (fantômes). */
export function fantomes(detail, l) {
  const a = normaliser(detail).percussions; const e = attenduNormalise(l).percussions;
  let extra = 0;
  for (const [k, v] of Object.entries(a)) extra += Math.max(0, v - (e[k] || 0));
  return extra;
}
export { sum };
