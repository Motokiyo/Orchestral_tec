// LOT 9 (retours du plateau, 19/11/2026) : corriger les percussions sur place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const E = await imp('src/percuEdit.js');
const U = await imp('src/utils.js');

const piece = () => ({
  id: 'x',
  orchestre: { bois: [], cuivres: [], cordes: [], autres: ['1 Harpe', '1 Waterphone'] },
  percus: [
    { id: 'p1', nom: 'Percu 1', items: [{ cat: 'Claviers', nom: 'Vibraphone', notes: '' }, { cat: 'Accessoires', nom: 'Ondes Martenot', notes: '' }] },
    { id: 'p2', nom: 'Percu 2', items: [{ cat: 'Grosses pièces', nom: 'Tam-tam', notes: '', checked: true }] },
  ],
});

test('un instrument passe de Percu 1 à Percu 2 (catégorie et support changés en même temps)', () => {
  const p = E.modifierItem(piece(), 'p1', 0, { nom: 'Vibraphone', cat: 'Claviers', support: 'grande', vers: 'p2' });
  assert.deepEqual(p.percus[0].items.map((i) => i.nom), ['Ondes Martenot']);
  assert.deepEqual(p.percus[1].items.map((i) => i.nom), ['Tam-tam', 'Vibraphone']);
  assert.equal(p.percus[1].items[1].support, 'grande');
});

test('les ondes Martenot sortent des percus et vont dans « Autres musiciens »', () => {
  const p = E.modifierItem(piece(), 'p1', 1, { nom: 'Ondes Martenot', vers: E.VERS_AUTRES });
  assert.deepEqual(p.percus[0].items.map((i) => i.nom), ['Vibraphone']);
  assert.ok(p.orchestre.autres.includes('Ondes Martenot'));
});

test('une ligne « Autres » devient un instrument de poste (« 1 Waterphone » → « Waterphone »)', () => {
  const p = E.autresVersPoste(piece(), 1, 'p2');
  assert.deepEqual(p.orchestre.autres, ['1 Harpe']);
  assert.equal(p.percus[1].items.at(-1).nom, 'Waterphone');
});

test('échanger Percu 1 et Percu 2 : les noms et l\'ordre changent, les instruments (et photos) restent à leur poste', () => {
  const p = E.echangerPostes(piece(), 'p1', 'p2');
  assert.deepEqual(p.percus.map((r) => [r.id, r.nom]), [['p2', 'Percu 1'], ['p1', 'Percu 2']]);
  assert.equal(p.percus[0].items[0].nom, 'Tam-tam');
  assert.equal(p.percus[0].items[0].checked, true);
});

test('modification sans changer de poste : coche et notes gardées', () => {
  const p = E.modifierItem(piece(), 'p2', 0, { nom: 'Tam-tam 125', cat: 'Grosses pièces', support: '', vers: 'p2' });
  assert.equal(p.percus[1].items[0].nom, 'Tam-tam 125');
  assert.equal(p.percus[1].items[0].checked, true);
});

test('nom vide ou index inconnu : rien ne change', () => {
  const p0 = piece();
  assert.equal(E.modifierItem(p0, 'p1', 0, { nom: '  ' }), p0);
  assert.equal(E.modifierItem(p0, 'p1', 9, { nom: 'X' }), p0);
  assert.equal(E.modifierItem(p0, 'p1', 0, { nom: 'X', vers: 'inconnu' }), p0);
});

test('catégorie devinée au lieu de « Accessoires » d\'office', () => {
  assert.equal(E.devinerCategorie('tam 125'), 'Grosses pièces');
  assert.equal(E.devinerCategorie('cymbale ride 22 istanbul'), 'Grosses pièces');
  assert.equal(E.devinerCategorie('Grande tablette'), 'Stands & supports');
  assert.equal(E.devinerCategorie('Pied de crotales'), 'Stands & supports');
  assert.equal(E.devinerCategorie('Marimba 5 octaves'), 'Claviers');
});

test('pieds et tablettes à prévoir, et dans le texte des percus', () => {
  let p = E.ajouterItem(piece(), 'p1', { nom: 'Grande tablette' });
  p = E.ajouterItem(p, 'p2', { nom: 'Crotales', support: 'pied' });
  p = E.ajouterItem(p, 'p2', { nom: 'Guiro', support: 'petite' });
  assert.deepEqual(E.supportsAPrevoir(p.percus), { 'Grande tablette': 1, 'Cadre de tam-tam': 1, Pied: 1, 'Petite tablette': 1 });
  assert.equal(E.texteSupports(p.percus), '1 × grande tablette, 1 × cadre de tam-tam, 1 × pied, 1 × petite tablette');
  const txt = U.generatePercusGlobalText(p.percus);
  assert.match(txt, /Crotales \(\+ pied\)/);
  assert.match(txt, /Guiro \(sur petite tablette\)/);
});

test('supports obligés : cymbale suspendue, glock valise, caisse claire (pied), cymbales frappées (support)', () => {
  assert.equal(U.supportEffectif({ nom: 'Cymbale suspendue' }), 'pied');
  assert.equal(U.supportEffectif({ nom: 'cymbale ride 22 istanbul' }), 'pied');
  assert.equal(U.supportEffectif({ nom: 'Glockenspiel valise' }), 'pied');
  assert.equal(U.supportEffectif({ nom: 'Caisse claire + clés' }), 'pied');
  assert.equal(U.supportEffectif({ nom: 'Cymbales frappées' }), 'support');
  assert.equal(U.supportEffectif({ nom: 'Glockenspiel' }), '');
  assert.equal(U.supportEffectif({ nom: 'Cymbale (grand)' }), '');
  assert.equal(U.supportEffectif({ nom: 'Cymbale suspendue (posée sur la timbale)' }), '');
  assert.equal(U.supportEffectif({ nom: 'Cymbale suspendue', support: 'grande' }), 'grande');
});

test('le support obligé suit l\'instrument quand on le déplace, et on peut le retirer', () => {
  let p = E.ajouterItem(piece(), 'p1', { nom: 'Cymbale suspendue' });
  const idx = p.percus[0].items.length - 1;
  assert.equal(p.percus[0].items[idx].support, undefined);
  p = E.modifierItem(p, 'p1', idx, { nom: 'Cymbale suspendue', cat: 'Grosses pièces', support: 'pied', vers: 'p2' });
  const j = p.percus[1].items.length - 1;
  assert.equal(U.supportEffectif(p.percus[1].items[j]), 'pied');
  assert.equal(E.supportsAPrevoir(p.percus)['Pied de cymbale'], 1);
  p = E.modifierItem(p, 'p2', j, { nom: 'Cymbale suspendue', cat: 'Grosses pièces', support: '', vers: 'p2' });
  assert.equal(p.percus[1].items[j].support, 'aucun');
  assert.equal(E.supportsAPrevoir(p.percus)['Pied de cymbale'], undefined);
});

test('noms anglais remis en français à l\'import', () => {
  assert.equal(U.franciserNom('Snare drum (prepared with metallic keys)'), 'Caisse claire (préparée avec des clés métalliques)');
  assert.equal(U.franciserNom('2 singing glasses (D#5, D#6)'), '2 verres chantants (D#5, D#6)');
  assert.equal(U.franciserNom('Contrabass bow'), 'Archet de contrebasse');
  assert.equal(U.franciserNom('bass drum'), 'Grosse caisse');
  assert.equal(U.franciserNom('very large tam-tam'), 'Très grand tam-tam');
  assert.equal(U.franciserNom('Marimba 5 octaves'), 'Marimba 5 octaves');
  assert.equal(U.franciserNom('Tam-tam (grand)'), 'Tam-tam (grand)');
});

test('les instruments du 18/11 sortent leurs supports par nom', () => {
  const percus = [
    { id: 'p1', nom: 'Percu 1', items: [{ nom: 'Cymbale suspendue' }, { nom: 'Grosse-caisse' }, { nom: 'Caisse claire + clés' }, { nom: 'Vibraphone' }, { nom: 'Crotale (D4) sur caisse claire' }] },
    { id: 'p2', nom: 'Percu 2', items: [{ nom: 'Tam-tam (grand)' }, { nom: 'Cymbale suspendue (posée sur la timbale)' }, { nom: 'cymbale ride 22 istanbul' }, { nom: 'Glockenspiel valise' }] },
  ];
  assert.deepEqual(E.supportsAPrevoir(percus), {
    'Pied de cymbale': 2, 'Support de grosse caisse': 1, 'Pied de caisse claire': 1, 'Cadre de tam-tam': 1, 'Pied de glockenspiel': 1,
  });
  assert.match(U.generatePercusGlobalText(percus), /Cymbale suspendue \(\+ pied de cymbale\)/);
});
