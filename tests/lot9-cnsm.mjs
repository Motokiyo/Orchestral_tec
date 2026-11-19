// LOT 9 (retours du plateau, 19/11/2026) : cartouches CNSM réels de l'atelier de composition du 18/11.
// Deux lignes recopiées ensemble, crochets contre les noms, ondes Martenot, « soit N mus ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const P = await imp('src/pdfParser.js');
const AI = await imp('src/aiImport.js');
const deps = { decodeEffectif: P.decodeEffectif, orchestreFromEffectif: P.orchestreFromEffectif, formatEffectifDaniels: P.formatEffectifDaniels, memeDetail: P.memeDetail };

const LANGUE = '2[Il+Pic] 1[I+CA] 2[Il+ClB] 0 -1 1 1 0 - 2Perc-Hp[Prép] Pno[Prép] - Sax[S+Bar] - Ondes - Acc- Cordes[2.1.2.2.1] - soit 23 mus';
const HORIZON = '2[II+Pic] 1 2[II+ClB] 1[I+Cbn] -1 1 1 0 - 2Perc Pno[Droitl] - Sax[A] - Ondes - Cordes[3.2.2.2.1] - soit 24 mus';
const CODE_NOIR = 'Effectif :2 1 2 1 -1 1 1 0 - 2Perc-Hp[Prép] Pno[Prép] - Sax[A] - Ondes - Acc - Cordes[3.2.2.2.1] - soit 26 mus';

const total = (o) => [o.bois, o.cuivres, o.cordes, o.autres].flat()
  .filter((x) => !/^\[/.test(x)).reduce((s, x) => s + (parseInt(x, 10) || 0), 0);

test('CNSM : « Quand ma langue aura fondu » se décode, cuivres 1.1.1.0 (un cor, pas de tuba), aucun timbalier', () => {
  const d = P.decodeEffectif(LANGUE);
  assert.ok(d);
  assert.deepEqual(d.cuivres, { Cor: 1, Trompette: 1, Trombone: 1 });
  assert.equal(d.cuivres.Tuba, undefined);
  assert.deepEqual(d.effectifPercus, { timbaliers: 0, percussionnistes: 2 });
  assert.equal(d.autres['Ondes Martenot'], 1);
  assert.equal(d.autres['Accordéon'], 1);
  assert.equal(d.cordes['Violon I'], 2);
  // 23 musiciens annoncés par le cartouche : 2 percussionnistes + le reste de l'orchestre
  assert.equal(total(P.orchestreFromEffectif(d)) + 2, 23);
});

test('CNSM : les deux autres pièces de l\'atelier (24 et 26 musiciens)', () => {
  const h = P.decodeEffectif(HORIZON);
  assert.ok(h);
  assert.equal(h.bois['Saxophone alto'], 1);
  assert.equal(total(P.orchestreFromEffectif(h)) + 2, 24);
  const c = P.decodeEffectif(CODE_NOIR);
  assert.ok(c);
  assert.equal(total(P.orchestreFromEffectif(c)) + 2, 26);
});

test('CNSM : les ondes Martenot vont dans « Autres », jamais dans les percussions', () => {
  const d = P.decodeEffectif(LANGUE);
  assert.equal(Object.keys(d.percussions).some((k) => /onde/i.test(k)), false);
  assert.ok(P.orchestreFromEffectif(d).autres.includes('1 Ondes Martenot'));
});

test('CNSM : l\'écriture ordonnée se relit telle quelle (ondes comprises)', () => {
  const ordre = P.formatEffectifDaniels(P.decodeEffectif(LANGUE));
  assert.match(ordre, /1ondes/);
  assert.ok(P.decodeEffectif(ordre));
});

test('CNSM : le cartouche recopié l\'emporte sur l\'effectif mal décodé par l\'IA (cas réel du 18/11)', () => {
  const ia = {
    titre: 'Quand ma langue aura fondu...', chef: 'S. Proust', sansChef: false,
    cartoucheBrut: LANGUE,
    effectif: '2.1.2.0 / 0.1.1.1 / 2.2.1.1 / 2.1.2.2.1',
    orchestre: { bois: [], cuivres: ['1 Trompette', '1 Trombone', '1 Tuba'], cordes: [], autres: [] },
    percus: [], mobilierObserve: [], aiMeta: { warnings: [], percusStatut: 'aucune', pages: { total: 1, analysed: 1, skipped: [] } },
  };
  const m = AI.mergeAiIntoLocal({ titre: '', effectif: '', percus: [], orchestre: null }, ia, deps);
  assert.equal(m.effectifPercus.timbaliers, 0);
  assert.ok(m.orchestre.cuivres.includes('1 Cor'));
  assert.equal(m.orchestre.cuivres.some((x) => /Tuba/.test(x)), false);
  assert.match(m.aiStatus.warnings.join('\n'), /effectif différent/);
});
