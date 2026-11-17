// LOT 2, point 6 : une quantité absente reste inconnue (null), jamais 1.
// Vérifie aussi que tous les consommateurs (totaux, export TXT, mobilier) ne produisent ni NaN ni plantage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, rd, findBadNumbers } from './lot2-helpers.mjs';

const U = await imp('src/utils.js');
const { extractNumberFromItem, calculateMobilier, generatePieceText, generateTxt, generateMobilierStandaloneText, generatePercuTxt } = U;

test('extractNumberFromItem : absent => null (plus 1)', () => {
  assert.equal(extractNumberFromItem('Flûte'), null);
  assert.equal(extractNumberFromItem('Célesta'), null);
  assert.equal(extractNumberFromItem('Violons I'), null);
  assert.equal(extractNumberFromItem(''), null);
  assert.equal(extractNumberFromItem(null), null);
  assert.equal(extractNumberFromItem(undefined), null);
  assert.equal(extractNumberFromItem(12), null);
  assert.equal(extractNumberFromItem({ nom: 'x' }), null);
});
test('extractNumberFromItem : formes écrites avec un nombre', () => {
  assert.equal(extractNumberFromItem('14 Violons I'), 14);
  assert.equal(extractNumberFromItem('3 Flûtes'), 3);
  assert.equal(extractNumberFromItem('4Flûtes'), 4, 'nombre collé au nom');
  assert.equal(extractNumberFromItem('Violons I : 16'), 16, 'nombre en fin après deux-points');
  assert.equal(extractNumberFromItem('Violons I x 16'), 16);
  assert.equal(extractNumberFromItem('Un piano'), 1, '« un » écrit en toutes lettres est une quantité lue');
  assert.equal(extractNumberFromItem('0 Tubas'), 0);
});
test('extractNumberFromItem : une notation brute n\'est pas une quantité', () => {
  assert.equal(extractNumberFromItem('4.3.3.1'), null);
  assert.equal(extractNumberFromItem('16.14.12.10.8'), null);
});

const ORCH_INCONNU = {
  bois: ['3 Flûtes', 'Hautbois', '2 Clarinettes'],
  cuivres: ['4 Cors', 'Trompettes'],
  cordes: ['16 Violons I', 'Violons II', '12 Altos', '10 Violoncelles', '8 Contrebasses'],
  autres: ['Célesta', '2 Harpes'],
};

test('calculateMobilier : aucune quantité inconnue ne devient 1, ni NaN', () => {
  const m = calculateMobilier(ORCH_INCONNU, [{ nom: 'Timbalier', items: [] }], { hasChef: true });
  assert.deepEqual(findBadNumbers(m), []);
  const hb = m.stands.bois.find((s) => /hautbois/i.test(s.type));
  assert.equal(hb.qty, null, 'stand des hautbois : quantité inconnue');
  const tp = m.stands.cuivres.find((s) => /trompette/i.test(s.type));
  assert.equal(tp.qty, null);
  assert.ok(m.general.quantitesInconnues >= 2, 'le nombre de lignes sans quantité est exposé : ' + m.general.quantitesInconnues);
  // La ligne « Violons II » sans quantité ne doit pas être comptée comme un musicien
  assert.equal(m.general.chaisesNormales, 16 + 12 + 10 + 3 + 2 + 4, 'seules les quantités lues sont additionnées');
});
test('calculateMobilier : orchestre entièrement connu => aucun champ d\'inconnu', () => {
  const m = calculateMobilier({ bois: ['3 Flûtes'], cuivres: [], cordes: ['8 Contrebasses'], autres: [] }, [], { hasChef: true });
  assert.ok(!m.general.quantitesInconnues, 'zéro ligne sans quantité');
  assert.equal(m.stands.bois[0].qty, 3);
});

function pieceInconnue(extra = {}) {
  return { titre: 'Test', compositeur: 'X', couleur: 'blanc', orchestre: ORCH_INCONNU, percus: [{ id: 'p1', nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }], effectif: '', ...extra };
}
test('TXT : « Nombre de musiciens » ne compte pas 1 pour une ligne sans quantité et l\'écrit', () => {
  for (const txt of [generatePieceText(pieceInconnue()), generateTxt(pieceInconnue())]) {
    assert.ok(!/NaN|undefined/.test(txt), 'pas de NaN/undefined :\n' + txt);
    const line = /Nombre de musiciens : (.*)/.exec(txt)[1];
    // 3+2+4+16+12+10+8+2 = 57 connus ; Hautbois, Trompettes, Violons II, Célesta = 4 lignes inconnues
    assert.match(line, /^57\b/, line);
    assert.match(line, /\?/, 'le signe ? apparaît : ' + line);
  }
});
test('TXT mobilier : une quantité inconnue s\'affiche « ? »', () => {
  const txt = generateMobilierStandaloneText(pieceInconnue());
  assert.ok(!/NaN|undefined|null/.test(txt), txt);
  assert.match(txt, /hautbois : \?/i);
  assert.match(txt, /trompettes : \?/i);
});
test('TXT : concert entièrement connu, totaux inchangés (pas de « ? » parasite)', () => {
  const p = { titre: 'Sym', couleur: 'blanc', orchestre: { bois: ['3 Flûtes'], cuivres: ['4 Cors'], cordes: ['16 Violons I'], autres: ['2 Harpes'] }, percus: [], effectif: '' };
  const line = /Nombre de musiciens : (.*)/.exec(generateTxt(p))[1];
  assert.equal(line.trim(), '25');
});
test('TXT : pièce sans orchestre ou orchestre à lignes vides, aucun plantage', () => {
  assert.doesNotThrow(() => generateTxt({ titre: 'A', couleur: 'blanc', orchestre: null, percus: [] }));
  assert.doesNotThrow(() => generatePieceText({ titre: 'A', orchestre: { bois: [''], cuivres: [null], cordes: [], autres: [] }, percus: [] }));
});

test('App.jsx : les consommateurs de quantités gèrent null (Daniels, total, stands)', () => {
  const app = rd('src/App.jsx');
  // calculateTotalMusicians ne renvoie plus un simple nombre qui absorbe l'inconnu
  const total = /function calculateTotalMusicians[\s\S]*?\n}\n/.exec(app)[0];
  assert.match(total, /unknown|inconnu/i, total);
  // matchSection suit les lignes inconnues
  const ms = /function matchSection[\s\S]*?\n}\n/.exec(app)[0];
  assert.match(ms, /unknown|inconnu|null/i, ms);
  // l'édition de stand ne passe pas null à un <input value>
  assert.doesNotMatch(app, /value=\{stand\.qty\}/);
  // la vue lecture n'écarte pas silencieusement un stand de quantité inconnue
  assert.match(app, /qty === null/);
});
