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
  assert.deepEqual(E.supportsAPrevoir(p.percus), { pied: 1, grande: 1, petite: 1 });
  assert.equal(E.texteSupports(p.percus), '1 pied, 1 grande tablette, 1 petite tablette');
  const txt = U.generatePercusGlobalText(p.percus);
  assert.match(txt, /Crotales \(sur pied\)/);
  assert.match(txt, /Guiro \(sur petite tablette\)/);
});
