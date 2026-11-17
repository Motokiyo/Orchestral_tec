// LOT 2 : compatibilité. Un concert enregistré avant le lot (sans aiStatus, mobilierObserve,
// sansChef, quantité inconnue) doit toujours s'ouvrir, se calculer et s'exporter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, impOrNull, rd, findBadNumbers } from './lot2-helpers.mjs';

const U = await imp('src/utils.js');
const AI = await impOrNull('src/aiImport.js');

// Concert tel qu'enregistré par l'ancienne version (champs de rapport-fond.md §4, aucun champ du LOT 2).
const ANCIEN_CONCERT = () => ({
  id: 'c-old', titre: 'Concert 2026', date: '12 mars 2026', lieu: 'Salle Pleyel', orchestre: 'ONF', chef: 'A. Dupont', ownerEmail: 'x@example.invalid',
  pieces: [
    {
      id: 'pc1', titre: 'Symphonie n°1', compositeur: 'Mahler', duree: '55', salle: 'Pleyel', chef: 'A. Dupont', date: '12 mars 2026',
      effectif: '4.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8', effectifDetail: { raw: 'x', summary: [] },
      orchestre: { bois: ['4 Flûtes', '3 Hautbois', 'Clarinette basse'], cuivres: ['4 Cors', '3 Trompettes'], cordes: ['16 Violons I', '14 Violons II', '12 Altos', '10 Violoncelles', '8 Contrebasses'], autres: ['2 Harpes', 'Célesta'] },
      sansChef: false,
      mobilier: { general: { pupitres: 40, chaisesNormales: 70, chaisesHautes: 12, chaisesHautesDetail: '8 (CB) + 1 (chef) + 3 (percus) = 12', chaisesSpeciales: [{ type: 'Tabouret piano', qty: 1 }] }, stands: { cordes: [{ type: 'Stands de contrebasse', qty: 8 }], bois: [{ type: 'Stands pour flûtes', qty: 4 }], cuivres: [], percus: [{ type: 'Chaise timbalier', qty: 1 }], autres: [{ type: 'Podium chef', qty: 1 }], autresCustom: [] }, _edited: true },
      plans: ['data:image/jpeg;base64,AAAA'], planDataUrl: 'data:image/jpeg;base64,AAAA', couleur: 'bleu',
      percus: [{ id: 'p1', nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: '4 Timbales', checked: true }] }, { id: 'p2', nom: 'Percu 1', items: [{ cat: 'Accessoires', nom: 'Triangle', notes: 'avec baguette' }] }],
      percusGlobalText: 'Pôle 1 : Timbalier\n  • 4 Timbales\n',
    },
    // Ancienne pièce créée à la main : pas d'orchestre, pas de mobilier
    { id: 'pc2', titre: 'Pièce vide', compositeur: '', effectif: '', orchestre: null, percus: [], plans: [], couleur: 'blanc' },
    // Très ancien format : chaisesSpeciales numérique
    { id: 'pc3', titre: 'Très ancienne', orchestre: { bois: ['2 Flûtes'], cuivres: [], cordes: ['8 Violons I'], autres: [] }, percus: [], couleur: 'blanc', mobilier: { general: { pupitres: 4, chaisesNormales: 10, chaisesHautes: 0, chaisesHautesDetail: '0', chaisesSpeciales: 2 }, stands: { cordes: [], bois: [], cuivres: [], percus: [], autres: [] } } },
  ],
});

test('ancien concert : exports TXT, mobilier, pôles et calculs sans erreur ni NaN', () => {
  const c = ANCIEN_CONCERT();
  const avant = JSON.stringify(c);
  for (const p of c.pieces) {
    const outs = [U.generateTxt(p), U.generatePieceText(p), U.generateMobilierStandaloneText(p)];
    for (const t of outs) assert.ok(typeof t === 'string' && !/NaN|undefined/.test(t), p.titre + ' : ' + t.slice(0, 200));
    for (const r of p.percus) assert.doesNotThrow(() => U.generatePercuTxt(p, r.id));
    assert.doesNotThrow(() => U.generatePercusGlobalText(p.percus));
    if (p.orchestre) assert.deepEqual(findBadNumbers(U.calculateMobilier(p.orchestre, p.percus, { hasChef: !p.sansChef })), []);
    assert.doesNotThrow(() => U.ensureMobilierStructure(p.mobilier));
  }
  assert.equal(JSON.stringify(c), avant, 'aucune fonction ne modifie le concert enregistré');
});
test('ancien concert : le total de musiciens et le mobilier enregistré restent identiques', () => {
  const p = ANCIEN_CONCERT().pieces[0];
  const txt = U.generateTxt(p);
  // 4+3+4+3+16+14+12+10+8+2 = 76 ; « Clarinette basse » et « Célesta » : quantité non écrite => inconnue
  assert.match(/Nombre de musiciens : (.*)/.exec(txt)[1], /^76\b.*\?/);
  assert.match(txt, /MODIFIÉ MANUELLEMENT/);
  assert.match(txt, /Pupitres : 40/);
  assert.match(txt, /Tabouret piano : 1/);
  assert.match(txt, /Stands pour flûtes : 4/);
});
test('ancien concert : pièce sans les nouveaux champs => aucun bandeau IA', () => {
  assert.ok(AI, 'src/aiImport.js doit exister');
  for (const p of ANCIEN_CONCERT().pieces) {
    assert.equal(AI.aiBannerInfo(p), null);
    assert.equal(AI.aiBannerInfo({ ...p, aiStatus: null }), null);
    assert.equal(AI.aiBannerInfo({ ...p, aiStatus: {} }), null, 'état incomplet : ignoré proprement');
  }
});
test('un concert nouveau format survit à l\'aller-retour JSON (champs additifs)', () => {
  assert.ok(AI, 'src/aiImport.js doit exister');
  const p = { ...ANCIEN_CONCERT().pieces[0] };
  const nouveau = AI.failedAiLocal({ ...p, percus: p.percus, planDataUrls: [] }, new Error('x'));
  const rt = JSON.parse(JSON.stringify({ ...p, aiStatus: nouveau.aiStatus, mobilierObserve: [{ type: 'Chaise', qte: null }], sansChef: null }));
  assert.ok(AI.aiBannerInfo(rt));
  assert.doesNotThrow(() => U.generateTxt(rt));
  assert.match(U.generateTxt(rt), /MOBILIER OBSERVÉ/i, 'le mobilier observé est exporté à part');
  assert.match(U.generateTxt(rt), /Chaise : \?/);
  // et le mobilier calculé n'a pas absorbé l'observé
  assert.doesNotMatch(JSON.stringify(rt.mobilier), /Chaise\b(?! timbalier)/);
});
test('App.jsx : les lectures des nouveaux champs sont gardées (anciens concerts sans ces champs)', () => {
  const app = rd('src/App.jsx');
  assert.doesNotMatch(app, /piece\.aiStatus\.[a-zA-Z]/, 'aucun accès direct non gardé à piece.aiStatus.x');
  assert.doesNotMatch(app, /piece\.mobilierObserve\.(map|filter|length)/, 'toujours via (… || [])');
});
