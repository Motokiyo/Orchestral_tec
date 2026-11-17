// LOT 4C : logique pure des écrans du mobilier (réglages, fusion des chaises spéciales, ajout de postes).
// Lancer : node --test tests/lot4-ecrans.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const UI = await imp('src/mobilierUi.js');
const M = await imp('src/mobilier.js');
const AI = await imp('src/aiImport.js');
const { reglagesEffectifs, optionsMobilier, fusionChaisesSpeciales, recalculerMobilier, instrumentsPartageables,
  appliquerReglages, ajouterPoles, ecartsPourAffichage, origineReglages } = UI;

const ORCH = {
  bois: ['4 Flûtes', '1 Piccolo', '3 Hautbois', '3 Clarinettes', '4 Bassons'],
  cuivres: ['4 Cors', '4 Trompettes', '4 Trombones', '1 Tuba'],
  cordes: ['16 Violons I', '14 Violons II', '12 Altos', '10 Violoncelles', '8 Contrebasses'],
  autres: ['2 Harpes'],
};
const piece = (extra = {}) => ({ id: 'a', titre: 'Pièce', orchestre: ORCH, percus: [], sansChef: false, effectifPercus: { timbaliers: 1, percussionnistes: 2 }, ...extra });

test('réglages : défaut de l\'ensemble, puis concert, puis pièce', () => {
  const c = { id: 'c', orchestre: 'Orchestre National de France', pieces: [] };
  assert.equal(reglagesEffectifs(piece(), c).chaisesHautes.contrebasses, 'Kolberg');
  assert.equal(reglagesEffectifs(piece(), c).chaisesHautes.percussions, 'R&S');
  assert.equal(origineReglages(piece(), c), 'defaut');
  const c2 = { ...c, reglagesMobilier: { standPourDeux: ['flute'], chaisesHautes: { contrebasses: 'R&S', percussions: 'Kolberg' } } };
  assert.equal(reglagesEffectifs(piece(), c2).chaisesHautes.percussions, 'Kolberg');
  assert.equal(origineReglages(piece(), c2), 'concert');
  const p = piece({ reglagesMobilier: { standPourDeux: [], chaisesHautes: { contrebasses: 'R&S', percussions: 'R&S' } } });
  assert.equal(reglagesEffectifs(p, c2).chaisesHautes.percussions, 'R&S');
  assert.equal(origineReglages(p, c2), 'piece');
});

test('réglages : sans concert ni réglages, R&S partout', () => {
  const r = reglagesEffectifs(piece(), undefined);
  assert.deepEqual(r, { standPourDeux: [], chaisesHautes: { contrebasses: 'R&S', percussions: 'R&S' } });
});

test('options : chef, réglages et effectif des percussions réunis', () => {
  const o = optionsMobilier(piece(), { orchestre: '' });
  assert.equal(o.hasChef, true);
  assert.deepEqual(o.effectifPercus, { timbaliers: 1, percussionnistes: 2 });
  assert.ok(o.reglages.chaisesHautes);
  const inconnu = optionsMobilier(piece({ sansChef: null }), null);
  assert.equal(inconnu.chefInconnu, true);
});

test('fusion : la chaise timbalier calculée remplace l\'ancienne, les lignes à la main restent', () => {
  const calc = [{ type: 'Chaise timbalier', qty: 1 }];
  const vieux = [{ type: 'Chaise timbalier', qty: 3 }, { type: 'Chaise piano', qty: 1 }];
  const f = fusionChaisesSpeciales(calc, vieux);
  assert.equal(f.filter((s) => /timbalier/i.test(s.type)).length, 1);
  assert.equal(f.find((s) => /timbalier/i.test(s.type)).qty, 1);
  assert.ok(f.find((s) => s.type === 'Chaise piano'));
  // le calcul ne donne rien : une chaise timbalier ajoutée à la main est gardée
  assert.deepEqual(fusionChaisesSpeciales([], [{ type: 'Chaise timbalier', qty: 1 }]), [{ type: 'Chaise timbalier', qty: 1 }]);
  assert.deepEqual(fusionChaisesSpeciales(calc, undefined), calc);
  assert.deepEqual(fusionChaisesSpeciales(undefined, 5), []);
});

test('recalcul : retrouve la chaise timbalier perdue, garde la chaise ajoutée et le stand perso, sans doublon', () => {
  const p = piece({ mobilier: { general: { chaisesSpeciales: [{ type: 'Chaise piano', qty: 1 }] }, stands: { autresCustom: [{ type: 'Lutrin', qty: 2 }] } } });
  const r = recalculerMobilier(p, { orchestre: '' });
  const cs = r.mobilier.general.chaisesSpeciales;
  assert.equal(cs.filter((s) => /timbalier/i.test(s.type)).length, 1);
  assert.ok(cs.find((s) => s.type === 'Chaise piano'));
  assert.deepEqual(r.mobilier.stands.autresCustom, [{ type: 'Lutrin', qty: 2 }]);
  // deux recalculs de suite : toujours une seule chaise timbalier
  const r2 = recalculerMobilier(r, { orchestre: '' });
  assert.equal(r2.mobilier.general.chaisesSpeciales.filter((s) => /timbalier/i.test(s.type)).length, 1);
  assert.doesNotMatch(JSON.stringify(r2.mobilier), /tabouret/i);
});

test('recalcul : un mobilier modifié à la main n\'est pas touché', () => {
  const p = piece({ mobilier: { _edited: true, general: { pupitres: 99 } } });
  assert.equal(recalculerMobilier(p, {}), p);
});

test('instruments partageables : vents seulement, ni piccolo ni cordes ni harpes', () => {
  const cles = instrumentsPartageables({ ...ORCH, bois: [...ORCH.bois, '1 Contrebasson', '1 Clarinette basse'] }).map((i) => i.key);
  assert.ok(cles.includes('flute') && cles.includes('cor') && cles.includes('contrebasson') && cles.includes('clarinette_basse'));
  assert.ok(!cles.includes('piccolo') && !cles.includes('harpe') && !cles.includes('contrebasse'));
  assert.equal(new Set(cles).size, cles.length);
  assert.deepEqual(instrumentsPartageables(null), []);
});

test('réglages enregistrés sur la pièce : stand pour deux et Kolberg se voient dans le calcul', () => {
  const concert = { id: 'c', orchestre: '', pieces: [piece(), piece({ id: 'b' })] };
  const r = { standPourDeux: ['flute'], chaisesHautes: { contrebasses: 'Kolberg', percussions: 'R&S' } };
  const c2 = appliquerReglages(concert, 'a', r, false);
  const a = c2.pieces.find((p) => p.id === 'a');
  const b = c2.pieces.find((p) => p.id === 'b');
  assert.equal(a.mobilier.stands.bois.find((s) => /fl[uû]te/i.test(s.type)).qty, 2);
  assert.equal(a.mobilier.general.chaisesHautesModele.contrebasses, 'Kolberg');
  assert.equal(b.mobilier, undefined, 'l\'autre pièce n\'est pas touchée');
  assert.equal(concert.pieces[0].mobilier, undefined, 'rien n\'est modifié sur place');
});

test('réglages pour tout le concert : les pièces sans réglages propres suivent, celles qui en ont les gardent', () => {
  const propre = { standPourDeux: [], chaisesHautes: { contrebasses: 'R&S', percussions: 'R&S' } };
  const concert = { id: 'c', orchestre: '', pieces: [piece({ reglagesMobilier: propre }), piece({ id: 'b' }), piece({ id: 'e', mobilier: { _edited: true, general: { pupitres: 7 } } }), piece({ id: 'z', reglagesMobilier: propre })] };
  const r = { standPourDeux: [], chaisesHautes: { contrebasses: 'Kolberg', percussions: 'Kolberg' } };
  const c2 = appliquerReglages(concert, 'a', r, true);
  assert.deepEqual(c2.reglagesMobilier.chaisesHautes, { contrebasses: 'Kolberg', percussions: 'Kolberg' });
  const get = (id) => c2.pieces.find((p) => p.id === id);
  assert.equal(get('a').reglagesMobilier, undefined, 'la pièce suit désormais le concert');
  assert.equal(get('a').mobilier.general.chaisesHautesModele.percussions, 'Kolberg');
  assert.equal(get('b').mobilier.general.chaisesHautesModele.contrebasses, 'Kolberg');
  assert.equal(get('e').mobilier.general.pupitres, 7, 'modifié à la main : intact');
  assert.equal(get('z').reglagesMobilier, propre);
  assert.equal(get('z').mobilier, undefined);
});

test('ajout de postes : sans remplacer, sans id en double, sans doublon identique', () => {
  const existants = [{ id: 'p1', nom: 'Timbalier', items: [{ cat: 'x', nom: 'Timbale 1' }] }, { id: 'p2', nom: 'Percu 1', items: [] }];
  let n = 0;
  const neufs = [
    { id: 'p1', nom: 'Percu 2', items: [{ cat: 'x', nom: 'Caisse claire' }] },   // id déjà pris
    { nom: 'Timbalier', items: [{ cat: 'x', nom: 'Timbale 1' }] },               // identique à un existant
    { id: 'p9', nom: 'Percu 3', items: [], nonVerifie: true },
  ];
  const r = ajouterPoles(existants, neufs, () => `n${++n}`);
  assert.equal(r.ajoutes, 2);
  assert.equal(r.ignores, 1);
  assert.equal(r.percus.length, 4);
  assert.deepEqual(r.percus.slice(0, 2), existants);
  const ids = r.percus.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(r.percus.find((p) => p.nom === 'Percu 3').nonVerifie, true);
  assert.equal(existants.length, 2, 'la liste d\'origine n\'est pas modifiée');
  // deux fois la même liste : rien de plus
  assert.equal(ajouterPoles(r.percus, neufs, () => `m${++n}`).ajoutes, 0);
  assert.equal(ajouterPoles(undefined, undefined).percus.length, 0);
});

test('ajout de postes : un nom déjà pris est renuméroté', () => {
  const ex = [{ id: 'p1', nom: 'Timbalier', items: [] }, { id: 'p2', nom: 'Percu 1', items: [] }, { id: 'p3', nom: 'Percu 2', items: [] }];
  const r = ajouterPoles(ex, [{ nom: 'Timbalier', items: [{ cat: 'x', nom: 'Timbale 1' }] }, { nom: 'Percu 1', items: [{ cat: 'x', nom: 'Gong' }] }, { nom: 'Percu 2', items: [{ cat: 'x', nom: 'Tam-tam' }] }], () => `i${Math.random()}`);
  assert.deepEqual(r.percus.slice(3).map((p) => p.nom), ['Timbalier 2', 'Percu 3', 'Percu 4']);
});

test('ajout d\'un plan de percussions : le mobilier se recalcule avec les nouveaux postes', () => {
  const p = piece({ effectifPercus: undefined, percus: [], mobilier: { general: { chaisesSpeciales: [] }, stands: {} } });
  const r = ajouterPoles(p.percus, [{ nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }, { nom: 'Percu 1', items: [{ cat: 'x', nom: 'Caisse claire' }] }]);
  const apres = recalculerMobilier({ ...p, percus: r.percus }, {});
  assert.equal(apres.mobilier.general.chaisesSpeciales.find((s) => /timbalier/i.test(s.type)).qty, 1);
  assert.equal(apres.mobilier.general.chaisesHautesParRole.percussions, 1);
});

test('écarts plan / calcul : phrase claire, rien n\'est tranché', () => {
  const p = recalculerMobilier(piece(), {});
  const e = ecartsPourAffichage(p.mobilier, [{ type: 'Chaises normales', qte: 10 }, { type: 'Pupitres', qte: p.mobilier.general.pupitres }]);
  assert.equal(e.length, 1);
  assert.match(e[0].texte, /le plan montre 10, le calcul donne \d+ : à vérifier/);
  assert.doesNotMatch(e[0].texte, /—/);
  assert.deepEqual(ecartsPourAffichage(p.mobilier, []), []);
});

test('lecture IA : l\'effectif remis en ordre Daniels, la ligne écrite et les percussionnistes sont gardés', () => {
  const local = { titre: 'L', effectif: '', percus: [], orchestre: null };
  const ai = { effectif: '2.2.2.0 / 3.2.2.0 / T+1 / 2hp / 7.6.5.4.3', effectifBrut: '7.6.5.4.3 / 2.2.2.0 / 3.2.2.0 / 1timb.1perc.2hp', effectifPercus: { timbaliers: 1, percussionnistes: 1 },
    orchestre: { bois: ['2 Flûtes'], cuivres: [], cordes: [], autres: [] }, percus: [], aiMeta: { percusStatut: 'aucune' } };
  const m = AI.mergeAiIntoLocal(local, ai, {});
  assert.equal(m.effectifBrut, ai.effectifBrut);
  assert.deepEqual(m.effectifPercus, ai.effectifPercus);
  assert.equal(m.detailPercussion, false);
  // sans ligne d'effectif lue par l'IA, on garde ce que la lecture locale avait
  const m2 = AI.mergeAiIntoLocal({ ...local, effectif: '1.1.1.1', effectifBrut: 'x', effectifPercus: { timbaliers: 1, percussionnistes: 0 } }, { ...ai, effectif: '', effectifBrut: undefined, effectifPercus: null }, {});
  assert.equal(m2.effectifBrut, 'x');
  assert.deepEqual(m2.effectifPercus, { timbaliers: 1, percussionnistes: 0 });
  // une ancienne ligne écrite ne survit pas à un effectif lu par l'IA
  const m3 = AI.mergeAiIntoLocal({ ...local, effectifBrut: 'ancien' }, { ...ai, effectifBrut: undefined }, {});
  assert.equal('effectifBrut' in m3, false);
});

test('lecture IA : un plan de détail percussion est signalé', () => {
  const ai = { effectif: '', orchestre: null, detailPercussion: true, percus: [{ nom: 'Percu 1', items: [{ cat: 'x', nom: 'Caisse claire' }] }], aiMeta: {} };
  const m = AI.mergeAiIntoLocal({ titre: '', percus: [] }, ai, {});
  assert.equal(m.detailPercussion, true);
  assert.equal(m.percus.length, 1);
});

test('aucun mot « tabouret » ni tiret cadratin dans les textes de l\'écran', async () => {
  const { rd } = await imp('tests/lot2-helpers.mjs');
  for (const f of ['src/MobilierBlocs.jsx', 'src/mobilierUi.js']) assert.doesNotMatch(rd(f), /tabouret|—/i, f);
});
