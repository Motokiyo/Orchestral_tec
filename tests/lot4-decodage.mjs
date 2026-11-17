// LOT 4C : qui fait foi pour l'effectif (texte du PDF, puis cartouche recopié, puis IA), timbales à vérifier,
// ligne d'effectif gardée en entier à la lecture locale. Réponses IA simulées, aucun réseau, aucune donnée privée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const P = await imp('src/pdfParser.js');
const AI = await imp('src/aiImport.js');
const deps = { decodeEffectif: P.decodeEffectif, orchestreFromEffectif: P.orchestreFromEffectif, formatEffectifDaniels: P.formatEffectifDaniels, memeDetail: P.memeDetail };

const CARTOUCHE_BON = '7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe';
const ORDRE_BON = '2.1.2.1 / 3.2.2.0 / T+1 / 1hp / 7.6.5.4.3';
// Réponse fautive réelle du moteur : bonne copie (à une erreur près), mauvais décodage.
const IA_FAUTIVE = {
  titre: 'Pièce', chef: 'Un Chef', sansChef: false,
  cartoucheBrut: '7.6.5.4.3 / 2.1.0.1 / 3.2.2.0 / 1timb.1perc.1harpe',
  effectif: '7.6.5.4.3 / 2.1.0.1 / 3.2.2.0 / 1.1.1.0',
  orchestre: { bois: ['7 Flûtes', '6 Hautbois', '5 Clarinettes', '4 Bassons', '3 Contrebassons'], cuivres: [], cordes: [], autres: [] },
  percus: [], mobilierObserve: [], aiMeta: { warnings: [], percusStatut: 'aucune', pages: { total: 1, analysed: 1, skipped: [] } },
};
const sansTexte = () => ({ titre: '', effectif: '', percus: [], orchestre: null });
const nbPar = (o, k) => (o && o[k] ? o[k].length : 0);

test('a. la ligne de la couche texte du PDF fait foi, l\'IA ne l\'écrase pas, les deux sont montrés', () => {
  const local = { titre: '', effectif: CARTOUCHE_BON, percus: [], orchestre: null };
  local.effectifDetail = P.decodeEffectif(local.effectif);
  const m = AI.mergeAiIntoLocal(local, { ...IA_FAUTIVE, cartoucheBrut: '' }, deps);
  assert.equal(m.effectifDetail.cordes['Violon I'], 7);
  assert.equal(m.effectifPercus.timbaliers, 1);
  assert.equal(m.orchestre.cordes.length > 0, true);
  assert.equal(nbPar(m.orchestre, 'bois') > 0 && m.orchestre.bois.some((x) => /7 Fl/.test(x)), false);
  const w = m.aiStatus.warnings.join('\n');
  assert.match(w, /effectif différent/);
  assert.match(w, /2\.1\.2\.1/);
  assert.match(w, /1\.1\.1\.0/);
  assert.equal(m.aiStatus.state, 'partial');
});

test('b. sans texte, le cartouche recopié par l\'IA est décodé LOCALEMENT (réponse fautive réelle)', () => {
  const ia = { ...IA_FAUTIVE, cartoucheBrut: CARTOUCHE_BON };
  const m = AI.mergeAiIntoLocal(sansTexte(), ia, deps);
  assert.equal(m.effectif, ORDRE_BON);
  assert.equal(m.effectifBrut, CARTOUCHE_BON);
  assert.deepEqual(m.effectifPercus, { timbaliers: 1, percussionnistes: 1 });
  assert.equal(m.effectifDetail.cordes['Contrebasse'], 3);
  // les cordes ne sont pas dans les bois
  assert.equal(m.orchestre.bois.some((x) => /Violon|Alto|Violoncelle|Contrebasse/i.test(x)), false);
  assert.equal(m.orchestre.bois.some((x) => /7 Fl/.test(x)), false);
  assert.ok(m.orchestre.cordes.length > 0);
  const w = m.aiStatus.warnings.join('\n');
  assert.match(w, /effectif différent/);
  assert.match(w, /1\.1\.1\.0/);
  assert.doesNotMatch(w, /sans pouvoir le vérifier/);
});

test('b. la copie fautive du cartouche (2.1.0.1) est décodée telle quelle, pas corrigée en silence', () => {
  const m = AI.mergeAiIntoLocal(sansTexte(), IA_FAUTIVE, deps);
  assert.equal(m.effectifBrut, IA_FAUTIVE.cartoucheBrut);
  assert.equal(m.effectif, P.formatEffectifDaniels(IA_FAUTIVE.cartoucheBrut));
});

test('c. ni texte ni cartouche décodable : effectif IA gardé avec l\'avertissement « sans pouvoir le vérifier »', () => {
  const ia = { ...IA_FAUTIVE, cartoucheBrut: '', effectif: '3.3.3.3 / 4.3.3.1 / 2perc.1hp / 14.12.10.8.6', effectifBrut: undefined };
  const m = AI.mergeAiIntoLocal(sansTexte(), ia, deps);
  assert.equal(m.effectif, ia.effectif);
  assert.match(m.aiStatus.warnings.join('\n'), /sans pouvoir le vérifier/);
  assert.equal(m.aiStatus.state, 'partial');
  // cartouche illisible : même chemin
  const m2 = AI.mergeAiIntoLocal(sansTexte(), { ...ia, cartoucheBrut: 'illisible' }, deps);
  assert.match(m2.aiStatus.warnings.join('\n'), /sans pouvoir le vérifier/);
});

test('priorité : le texte du PDF l\'emporte sur le cartouche, qui l\'emporte sur l\'IA', () => {
  const local = { titre: '', effectif: '3.3.3.3 / 4.3.3.1 / 14.12.10.8.6', percus: [], orchestre: null };
  local.effectifDetail = P.decodeEffectif(local.effectif);
  const m = AI.mergeAiIntoLocal(local, { ...IA_FAUTIVE, cartoucheBrut: CARTOUCHE_BON }, deps);
  assert.equal(m.effectif, '3.3.3.3 / 4.3.3.1 / 14.12.10.8.6');
  assert.match(m.aiStatus.warnings.join('\n'), /effectif différent/);
});

test('identique : pas d\'avertissement de divergence quand l\'IA donne le même effectif', () => {
  const ia = { ...IA_FAUTIVE, cartoucheBrut: CARTOUCHE_BON, effectif: ORDRE_BON, effectifBrut: CARTOUCHE_BON };
  const m = AI.mergeAiIntoLocal(sansTexte(), ia, deps);
  assert.doesNotMatch(m.aiStatus.warnings.join('\n'), /effectif différent|sans pouvoir/);
  assert.equal(m.effectif, ORDRE_BON);
});

test('timbales dessinées lues par l\'IA : avertissement et poste marqué non vérifié', () => {
  const timb = { nom: 'Timbalier', items: [1, 2, 3, 4].map((n) => ({ cat: 'Timbales & Peaux', nom: `Timbale ${n}` })) };
  const ia = { ...IA_FAUTIVE, cartoucheBrut: CARTOUCHE_BON, percus: [timb, { nom: 'Percussion 1', items: [{ cat: 'Peaux', nom: 'Caisse claire' }] }], mobilierObserve: [{ type: 'Timbales', qte: 4 }], aiMeta: { ...IA_FAUTIVE.aiMeta, percusStatut: 'lues' } };
  const m = AI.mergeAiIntoLocal(sansTexte(), ia, deps);
  assert.match(m.aiStatus.warnings.join('\n'), /Nombre de timbales lu sur le dessin par l'IA : à vérifier/);
  assert.equal(m.percus.find((p) => p.nom === 'Timbalier').nonVerifie, true);
  assert.equal(m.percus.find((p) => p.nom === 'Percussion 1').nonVerifie, undefined);
  assert.equal(m.aiStatus.state, 'partial');
  // la même quantité lue dans le texte du PDF est une autre source : pas de marque nonVerifie
  const local = { ...sansTexte(), percus: [{ nom: 'Timbalier', items: [1, 2, 3, 4].map((n) => ({ cat: 'x', nom: `Timbale ${n}` })) }] };
  const m2 = AI.mergeAiIntoLocal(local, ia, deps);
  assert.equal(m2.percus.find((p) => p.nom === 'Timbalier').nonVerifie, undefined);
  assert.match(m2.aiStatus.warnings.join('\n'), /timbales/);
  // sans timbale : rien
  const m3 = AI.mergeAiIntoLocal(sansTexte(), { ...IA_FAUTIVE, cartoucheBrut: CARTOUCHE_BON }, deps);
  assert.doesNotMatch(m3.aiStatus.warnings.join('\n'), /timbales/);
});

test('le client garde cartoucheBrut renvoyé par le serveur', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ effectif: '', cartoucheBrut: CARTOUCHE_BON, percus: [], meta: { percusStatut: 'aucune', pages: { analysed: 1, skipped: [] } } }) });
  try {
    const r = await P.extractWithGemini(['data:image/jpeg;base64,AAAA'], 'concert');
    assert.equal(r.cartoucheBrut, CARTOUCHE_BON);
  } finally { globalThis.fetch = realFetch; }
});

// ── Lecture locale : la ligne entière est gardée (bug de troncature après deux groupes) ──
async function lire(texte) { return P.extractFromTxt({ name: 'plan.txt', text: async () => texte }); }

test('troncature corrigée : « 4.3.3.4 / 4.4.4.1 / T+2 / 2hp / 16.14.12.10.8 » gardée en entier et décodée', async () => {
  const r = await lire('Effectif : 4.3.3.4 / 4.4.4.1 / T+2 / 2hp / 16.14.12.10.8');
  assert.equal(r.effectif, '4.3.3.4 / 4.4.4.1 / T+2 / 2hp / 16.14.12.10.8');
  assert.ok(r.effectifDetail);
  assert.deepEqual(r.effectifPercus, { timbaliers: 1, percussionnistes: 2 });
  assert.equal(r.effectifDetail.cordes['Violon I'], 16);
});
test('troncature corrigée : forme avec tirets, claviers et cordes', async () => {
  const r = await lire('Nomenclature : 4.3.3.4 - 4.4.4.1 -T+2 -2hp -cel -orgue / 16.14.12.10.8');
  assert.ok(r.effectifDetail);
  assert.equal(r.effectifDetail.cordes['Contrebasse'], 8);
});
test('forme Red Bull : cordes d\'abord, « 1timb.1perc.1harpe » collé, remise en ordre Daniels', async () => {
  const r = await lire(CARTOUCHE_BON);
  assert.equal(r.effectif, ORDRE_BON);
  assert.equal(r.effectifBrut, CARTOUCHE_BON);
  assert.deepEqual(r.effectifPercus, { timbaliers: 1, percussionnistes: 1 });
});
test('forme LSO « 2220/0400/0T 2P 0H 2Pno » trouvée et décodée', async () => {
  const r = await lire('Effectif 2220/0400/0T 2P 0H 2Pno');
  assert.ok(r.effectifDetail);
  assert.equal(r.effectif, '2.2.2.0 / 0.4.0.0 / 2perc / 2pno');
  assert.equal(r.effectifBrut, '2220/0400/0T 2P 0H 2Pno');
});
test('une ligne simple à trois groupes n\'est pas modifiée', async () => {
  const r = await lire('Effectif : 3.3.3.3 - 4.3.3.1 - 14.12.10.8.6');
  assert.equal(r.effectif, '3.3.3.3 / 4.3.3.1 / 14.12.10.8.6');
});
