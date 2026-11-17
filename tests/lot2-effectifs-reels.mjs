// LOT 2, point 7 (complément du coordinateur) : lignes d'effectif RÉELLES du corpus local.
// Chaque ligne doit être décodée exactement, ou refusée proprement : jamais de percussion, de harpe ni
// de clavier fantôme, jamais « 2220 flûtes », jamais des cordes lues comme des bois.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';
import { LIGNES_REELLES, normaliser, attenduNormalise, fantomes } from './lot2-fixtures-effectifs.mjs';

const { decodeEffectif, orchestreFromEffectif } = await imp('src/pdfParser.js');

for (const l of LIGNES_REELLES) {
  test(`${l.id} : ${l.ligne.slice(0, 70)}`, () => {
    const d = decodeEffectif(l.ligne);
    assert.ok(d, 'la ligne doit être décodée (pas null)');
    assert.deepEqual(normaliser(d), attenduNormalise(l));
    assert.equal(fantomes(d, l), 0, 'aucune percussion, harpe ou clavier fantôme');
  });
}

test('LSO : « 2220 » = 2 flûtes, 2 hautbois, 2 clarinettes, 0 basson (jamais « 2220 flûtes »)', () => {
  const d = decodeEffectif('2220 / 0400 / 0T 2P 2 x Vibraphones 0H 2Pno / 1BassGuitar Electric / FULL ORCHESTRA STRINGS: 10.8.6.6.0 (split)');
  assert.deepEqual(Object.keys(d.bois), ['Flûte', 'Hautbois', 'Clarinette']);
  assert.ok(!JSON.stringify([d.bois, d.cuivres, d.percussions, d.cordes]).includes('2220'));
});
test('LSO : « 2 x Vibraphones » n\'est pas « 2 harpes » (0H = 0 harpe)', () => {
  const d = decodeEffectif('2220 / 0400 / 0T 2P 2 x Vibraphones 0H 2Pno / 1BassGuitar Electric / 10.8.6.6.0');
  assert.equal(d.percussions['Harpe'], undefined);
  assert.equal(d.percussions['Percussion'], 2);
});
test('Red Bull : « 7.6.5.4.3 / 2.1.2.1 / … » = cordes en premier, pas 7 flûtes', () => {
  const d = decodeEffectif('7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe');
  assert.equal(d.bois['Flûte'], 2);
  assert.equal(d.cordes['Violon I'], 7);
  assert.equal(Object.values(d.percussions).filter((v) => typeof v === 'number').length, 4, '3 familles + total');
});
test('Barbe Bleue : « T+2 » = 1 timbalier + 2 percussionnistes, sans 62 fantômes', () => {
  const d = decodeEffectif('4.3.3.4 - 4.4.4.1 -T+2 -2hp -cel -orgue +Banda 16.14.12.10.8');
  assert.equal(d.percussions.total, 1 + 2 + 2 + 2);
  assert.deepEqual(d.cordes, { 'Violon I': 16, 'Violon II': 14, 'Alto': 12, 'Violoncelle': 10, 'Contrebasse': 8 });
  assert.ok(d.remarques.includes('Banda'), 'la banda est notée, pas comptée');
});
test('ambigu : « 2 timb. » (2 timbaliers ou 2 timbales ?) => refus, pas de devinette', () => {
  assert.equal(decodeEffectif('3.3.3.3 - 4.3.3.1 - 2 timb. 7 percs - 2 harpes - cél/orgue'), null);
});
test('mot inconnu dans une ligne nommée => refus', () => {
  assert.equal(decodeEffectif('3.3.3.3 - 4.3.3.1 - 2hp - machin'), null);
});
test('orchestreFromEffectif : guitare basse, accordéon, soprano et auxiliaires apparaissent, rien d\'autre', () => {
  const o = orchestreFromEffectif(decodeEffectif('5.0.3.0 - 0.6.4.2 -3sax -guitbasse -3perc 0/0/0/0/0'));
  assert.ok(o.autres.some((x) => /Guitare basse/.test(x)), JSON.stringify(o));
  assert.equal(o.cordes.length, 0);
});
