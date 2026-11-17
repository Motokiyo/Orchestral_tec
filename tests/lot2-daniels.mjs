// LOT 2, point 7 : décodeur Daniels (src/pdfParser.js, fonction réelle importée).
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const { decodeEffectif, orchestreFromEffectif } = await imp('src/pdfParser.js');

const CORDES_16 = { 'Violon I': 16, 'Violon II': 14, 'Alto': 12, 'Violoncelle': 10, 'Contrebasse': 8 };
const SYMPHONIQUE = {
  bois: { 'Flûte': 3, 'Hautbois': 3, 'Clarinette': 3, 'Basson': 3 },
  cuivres: { 'Cor': 4, 'Trompette': 3, 'Trombone': 3, 'Tuba': 1 },
  percussions: { 'Timbales': 1, 'Percussion': 3, 'Harpe': 2, 'Clavier': 1 },
  cordes: CORDES_16,
};
const sansTotal = (p) => { const { total, ...r } = p || {}; return r; };
function assertSymphonique(d, label) {
  assert.ok(d, label + ' : doit être décodé');
  assert.deepEqual(d.bois, SYMPHONIQUE.bois, label + ' bois');
  assert.deepEqual(d.cuivres, SYMPHONIQUE.cuivres, label + ' cuivres');
  assert.deepEqual(sansTotal(d.percussions), SYMPHONIQUE.percussions, label + ' percussions');
  assert.deepEqual(d.cordes, SYMPHONIQUE.cordes, label + ' cordes');
}

test('points + tirets avec espaces', () => {
  assertSymphonique(decodeEffectif('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8'), 'tirets espacés');
});
test('points + tirets SANS espaces', () => {
  assertSymphonique(decodeEffectif('3.3.3.3-4.3.3.1-1.3.2.1-16.14.12.10.8'), 'tirets collés');
});
test('points + tirets longs (en et em dash)', () => {
  assertSymphonique(decodeEffectif('3.3.3.3 – 4.3.3.1 — 1.3.2.1 – 16.14.12.10.8'), 'tirets typographiques');
});
test('points + slashs, avec et sans espaces', () => {
  assertSymphonique(decodeEffectif('3.3.3.3/4.3.3.1/1.3.2.1/16.14.12.10.8'), 'slash collé');
  assertSymphonique(decodeEffectif('3.3.3.3 / 4.3.3.1 / 1.3.2.1 / 16.14.12.10.8'), 'slash espacé');
});
test('tirets dans les groupes, slashs entre les groupes (exemple du commentaire du code)', () => {
  const d = decodeEffectif('1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1');
  assert.ok(d);
  assert.deepEqual(d.bois, { 'Flûte': 1, 'Hautbois': 1, 'Clarinette': 1, 'Saxophone': 2 });
  assert.deepEqual(d.cuivres, { 'Cor': 2, 'Trompette': 2, 'Trombone': 2, 'Tuba': 1 });
  assert.deepEqual(sansTotal(d.percussions), { 'Timbales': 1, 'Harpe': 1 });
  assert.deepEqual(d.cordes, { 'Violon I': 6, 'Violon II': 4, 'Alto': 2, 'Violoncelle': 2, 'Contrebasse': 1 });
});
test('tout en tirets, groupes séparés par un tiret espacé', () => {
  const d = decodeEffectif('2-2-2-2 - 4-3-3-1 - 1-3-2-1 - 16-14-12-10-8');
  assert.ok(d);
  assert.equal(d.cordes['Contrebasse'], 8);
  assert.equal(d.cuivres['Cor'], 4);
  assert.equal(d.percussions['Percussion'], 3);
});
test('chiffres séparés par des espaces, groupes par slash', () => {
  const d = decodeEffectif('2 2 2 2 / 4 3 3 1 / 1 3 2 1 / 16 14 12 10 8');
  assert.ok(d);
  assert.deepEqual(d.cordes, CORDES_16);
});
test('crochets avec slash [Cel/Pno] : les cordes ne sont plus perdues (exemple 2 du prompt)', () => {
  const d = decodeEffectif('2.2.2.2 / 4.2.3.1 / 1.3.2.1 [Cel/Pno] / 16.14.12.10.8');
  assert.ok(d);
  assert.deepEqual(d.cordes, CORDES_16);
  assert.equal(d.extras, 'Cel/Pno');
  assert.deepEqual(sansTotal(d.percussions), { 'Timbales': 1, 'Percussion': 3, 'Harpe': 2, 'Clavier': 1 });
});
test('crochets avec slash et groupes séparés par des tirets', () => {
  const d = decodeEffectif('3.3.3.3 - 4.3.3.1 - 1.7.2.1 [Cel/Pno] - 16.14.12.10.8');
  assert.ok(d);
  assert.deepEqual(d.cordes, CORDES_16);
  assert.equal(d.extras, 'Cel/Pno');
  assert.equal(d.percussions['Percussion'], 7);
});
test('format mixte « cordes » : slash puis tiret, 3 groupes dont des cordes à 5 pupitres', () => {
  const d = decodeEffectif('3.3.3.3/4.3.3.1 - 14.12.10.8.6');
  assert.ok(d);
  assert.deepEqual(d.cordes, { 'Violon I': 14, 'Violon II': 12, 'Alto': 10, 'Violoncelle': 8, 'Contrebasse': 6 });
  assert.equal(d.percussions, null, 'aucun groupe de percussions n\'est inventé');
});
test('format « cordes » explicite : Cordes[12.10.8.6.4]', () => {
  const d = decodeEffectif('3.3.3.3 / 4.3.3.1 / 1.3.2.1 / Cordes[12.10.8.6.4]');
  assert.ok(d);
  assert.deepEqual(d.cordes, { 'Violon I': 12, 'Violon II': 10, 'Alto': 8, 'Violoncelle': 6, 'Contrebasse': 4 });
});
test('mot « cordes » entre deux groupes', () => {
  const d = decodeEffectif('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - cordes 16.14.12.10.8');
  assert.ok(d);
  assert.deepEqual(d.cordes, CORDES_16);
});
test('baroque à 3 groupes (exemple 1 du prompt) : timbales 1 et 2 claviers, pas de cordes inventées', () => {
  const d = decodeEffectif('0-1-0-1 / 0-2-0-0 / 1-0-0-2');
  assert.ok(d);
  assert.deepEqual(d.bois, { 'Hautbois': 1, 'Basson': 1 });
  assert.deepEqual(d.cuivres, { 'Trompette': 2 });
  assert.deepEqual(sansTotal(d.percussions), { 'Timbales': 1, 'Clavier': 2 });
  assert.equal(d.cordes, null);
});
test('points traînants (fin de ligne et avant séparateur)', () => {
  assertSymphonique(decodeEffectif('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8.'), 'point final');
  assertSymphonique(decodeEffectif('3.3.3.3. - 4.3.3.1. - 1.3.2.1. - 16.14.12.10.8.'), 'points avant tiret');
  assertSymphonique(decodeEffectif('3.3.3.3. / 4.3.3.1. / 1.3.2.1. / 16.14.12.10.8.'), 'points avant slash');
  assertSymphonique(decodeEffectif('  3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8 .  '), 'point isolé et espaces');
});
test('doublures (pic) (eh) conservées, cordes lues', () => {
  const d = decodeEffectif('2(pic).2(eh).2(bcl).2(cbn) - 4.2.3.1 - 1.2 - 8.6.4.4.2');
  assert.ok(d);
  assert.ok(Object.keys(d.bois).some((k) => /Piccolo/.test(k)), JSON.stringify(d.bois));
  assert.deepEqual(d.cordes, { 'Violon I': 8, 'Violon II': 6, 'Alto': 4, 'Violoncelle': 4, 'Contrebasse': 2 });
});
test('groupe de percussions à un seul chiffre', () => {
  const d = decodeEffectif('2.2.2.2 - 2.2.0.0 - 1 - 6.4.3.3.2');
  assert.ok(d);
  assert.equal(d.percussions['Timbales'], 1);
  assert.equal(d.cordes['Contrebasse'], 2);
});
test('refus net (null) plutôt que deviner : texte, 2 groupes, 5 groupes, vide, mauvais type', () => {
  assert.equal(decodeEffectif('3.3.3.3 - 4.3.3.1 - 2 timb. 7 percs - 2 harpes - cél/orgue'), null);
  assert.equal(decodeEffectif('2.2.2.2 / 4.2.3.1'), null);
  assert.equal(decodeEffectif('2.2.2.2 / 4.2.3.1 / 1 / 2 / 3'), null);
  assert.equal(decodeEffectif('7 violes de gambe'), null);
  assert.equal(decodeEffectif(''), null);
  assert.equal(decodeEffectif(null), null);
  assert.equal(decodeEffectif(undefined), null);
  assert.equal(decodeEffectif(42), null);
});
test('orchestreFromEffectif suit : cordes complètes sur les formats corrigés', () => {
  const o = orchestreFromEffectif(decodeEffectif('1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1'));
  assert.equal(o.cordes.length, 5);
  assert.ok(o.cordes.some((c) => /^1 Contrebasse$/.test(c)), JSON.stringify(o.cordes));
});
