// LOT 4A : calcul du mobilier (règles du régisseur, docs/audit/lot4-regles-mobilier.md).
// Les chiffres viennent de plans réels, recopiés ici en dur (aucun fichier privé lu).
// Lancer : node --test tests/lot4-mobilier.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp } from './lot2-helpers.mjs';

const M = await imp('src/mobilier.js');
const U = await imp('src/utils.js');
const { calculateMobilier, reglagesParDefaut, comparerMobilier, identifierInstrument, INSTRUMENTS } = M;

const stand = (m, re) => [...m.stands.bois, ...m.stands.cuivres].find((s) => re.test(s.type));
const sp = (m, re) => m.stands.speciaux.find((s) => re.test(s.type));
const chaiseSpec = (m, re) => m.general.chaisesSpeciales.find((s) => re.test(s.type));
const textes = (m) => JSON.stringify(m) + '\n' + U.generateMobilierStandaloneText({ titre: 'T', mobilier: m });

// ── Plan Barbe-Bleue : 4.3.3.4 / 4.4.4.1 / T+2 / 2 harpes, célesta, orgue / 16.14.12.10.8 ──
const BARBE = {
  bois: ['4 Flûtes', '3 Hautbois', '3 Clarinettes', '4 Bassons'],
  cuivres: ['4 Cors', '4 Trompettes', '4 Trombones', '1 Tuba'],
  cordes: ['16 Violons I', '14 Violons II', '12 Altos', '10 Violoncelles', '8 Contrebasses'],
  autres: ['2 Harpes', '1 Célesta', '1 Orgue'],
};
test('Barbe-Bleue : T+2 donne 1 timbalier et 2 percussionnistes, chaises hautes = 8 CB + 2 percus + chef', () => {
  const m = calculateMobilier(BARBE, [], { hasChef: true, effectifPercus: { timbaliers: 1, percussionnistes: 2 } });
  assert.equal(m.general.chaisesNormales, 16 + 14 + 12 + 10 + 27);
  assert.equal(m.general.chaisesHautes, 8 + 2 + 1);
  assert.deepEqual(m.general.chaisesHautesParRole, { contrebasses: 8, percussions: 2, chef: 1 });
  assert.equal(m.general.chaisesHautesParRole.contrebasses, 8, 'nb chaises de CB = nb de contrebasses');
  // pupitres : cordes 8+7+6+5+4 = 30, vents 27, harpes et claviers 4, 3 percus dont le timbalier, chef 1
  assert.equal(m.general.pupitres, 30 + 27 + 4 + 3 + 1);
  assert.equal(m.general.banquettes, 4, '2 harpes + célesta + orgue');
  assert.equal(chaiseSpec(m, /timbalier/i).qty, 1);
  assert.ok(!m.general.chaisesHautesDetail.includes('timbalier'), 'la chaise timbalier n\'est pas une chaise haute');
});

// ── Plan Red Bull : 7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1 timb, 1 perc, 1 harpe ──
const REDBULL = {
  bois: ['2 Flûtes', '1 Hautbois', '2 Clarinettes', '1 Basson'],
  cuivres: ['3 Cors', '2 Trompettes', '2 Trombones'],
  cordes: ['7 Violons I', '6 Violons II', '5 Altos', '4 Violoncelles', '3 Contrebasses'],
  autres: ['1 Harpe'],
};
const POLES_RB = [{ nom: 'Timbalier', items: [{ nom: 'Timbales' }] }, { nom: 'Percussion 1', items: [] }];
test('Red Bull : chiffres du plan (pôles de percussion, un chef)', () => {
  const m = calculateMobilier(REDBULL, POLES_RB, { hasChef: true });
  assert.equal(m.general.chaisesNormales, 22 + 6 + 7);
  assert.equal(m.general.chaisesHautes, 3 + 1 + 1);
  assert.equal(m.general.chaisesHautesDetail, '3 (contrebasses, R&S) + 1 (percussions, R&S) + 1 (chef) = 5');
  assert.equal(m.general.pupitres, (4 + 3 + 3 + 2 + 2) + 13 + 1 + 1 + 1 + 1);
  assert.equal(m.general.banquettes, 1);
  assert.equal(chaiseSpec(m, /timbalier/i).qty, 1);
  assert.deepEqual(m.stands.autres.map((s) => s.type), ['Podium chef', 'Pupitre chef']);
});
test('timbales présentes : chaise timbalier automatique, jamais comptée dans les chaises hautes', () => {
  const sans = calculateMobilier(REDBULL, [{ nom: 'Percussion 1', items: [] }], { hasChef: false });
  assert.equal(sans.general.chaisesSpeciales.length, 0);
  const avec = calculateMobilier(REDBULL, [{ nom: 'Percussion 1', items: [{ nom: 'Timbales' }] }], { hasChef: false });
  assert.equal(chaiseSpec(avec, /timbalier/i).qty, 1, 'un pôle qui contient des timbales implique un timbalier');
  assert.equal(avec.general.chaisesHautes, 3, '3 CB seulement, ni timbalier ni percus');
  assert.ok(avec.infos.some((t) => /timbalier/i.test(t)));
});

// ── Plan LSO : 2220 / 0400 / 2 percus, 2 pianos, guitare basse / 10.8.6.6.0 ──
test('LSO : pas de contrebasse, 2 pianos sur banquette, aucune chaise timbalier', () => {
  const o = {
    bois: ['2 Flûtes', '2 Hautbois', '2 Clarinettes', '0 Bassons'],
    cuivres: ['4 Trompettes'],
    cordes: ['10 Violons I', '8 Violons II', '6 Altos', '6 Violoncelles'],
    autres: ['2 Pianos', '1 Guitare basse'],
  };
  const m = calculateMobilier(o, [], { hasChef: true, effectifPercus: { timbaliers: 0, percussionnistes: 2 } });
  assert.equal(m.general.banquettes, 2);
  assert.equal(m.general.chaisesHautes, 0 + 2 + 1);
  assert.equal(m.general.chaisesSpeciales.length, 0);
  assert.equal(m.general.chaisesNormales, 10 + 8 + 6 + 6 + 6 + 4 + 1, 'les pianos ne sont pas sur chaise, la guitare basse oui');
  assert.equal(m.stands.cordes.some((s) => /contrebasse/i.test(s.type)), false);
});

// ── Plans à claviers et jazz ──
test('claviers : piano, célesta, clavecin, orgue positif, synthé = une banquette chacun, jamais « tabouret »', () => {
  const o = { bois: [], cuivres: [], cordes: [], autres: ['4 Pianos', '3 Claviers', '1 Célesta', '1 Clavecin', '1 Orgue positif', '2 Synthétiseurs', '1 Harpe'] };
  const m = calculateMobilier(o, [], { hasChef: true });
  assert.equal(m.general.banquettes, 13);
  assert.equal(m.general.chaisesNormales, 0, 'rien de ces instruments n\'est sur chaise normale');
  assert.equal(m.general.pupitres, 13 + 1);
  assert.ok(!/tabouret/i.test(textes(m)), textes(m));
});
test('jazz : un piano, aucune contrebasse écrite, aucune chaise de contrebasse inventée', () => {
  const m = calculateMobilier({ bois: ['1 Flûte'], cuivres: ['1 Trompette', '1 Trombone'], cordes: [], autres: ['1 Piano'] }, [], { hasChef: false });
  assert.equal(m.general.banquettes, 1);
  assert.equal(m.general.chaisesHautesParRole.contrebasses, 0);
  assert.equal(m.general.chaisesNormales, 3);
});

// ── Stands ──
test('stands : un par musicien, pas par ligne d\'effectif', () => {
  const m = calculateMobilier({ bois: ['3 Flûtes', '2 Hautbois'], cuivres: ['4 Cors'], cordes: [], autres: [] }, [], {});
  assert.equal(stand(m, /fl[uû]tes/i).qty, 3);
  assert.equal(stand(m, /hautbois/i).qty, 2);
  assert.equal(stand(m, /cors/i).qty, 4);
});
test('standPourDeux : divise par deux (arrondi supérieur) pour les instruments listés seulement', () => {
  const o = { bois: ['3 Flûtes', '4 Clarinettes', '2 Hautbois'], cuivres: [], cordes: [], autres: [] };
  const m = calculateMobilier(o, [], { reglages: { standPourDeux: ['flute', 'clarinette'] } });
  assert.equal(stand(m, /fl[uû]tes/i).qty, 2);
  assert.equal(stand(m, /clarinettes/i).qty, 2);
  assert.equal(stand(m, /hautbois/i).qty, 2, 'hautbois non listés : un par musicien');
  const m2 = calculateMobilier(o, [], { reglages: { standPourDeux: ['Flûtes'] } });
  assert.equal(stand(m2, /fl[uû]tes/i).qty, 2, 'clé tolérante (pluriel, accent, majuscule)');
  assert.equal(m2.general.pupitres, 9, 'les pupitres restent un par musicien');
});
test('contrebasson et clarinette basse : stands spéciaux distincts des stands courants', () => {
  const o = { bois: ['2 Clarinettes', '1 Clarinette basse', '2 Bassons', '1 Contrebasson'], cuivres: [], cordes: [], autres: [] };
  const m = calculateMobilier(o, [], {});
  assert.equal(sp(m, /contrebasson/i).qty, 1);
  assert.equal(sp(m, /clarinette basse/i).qty, 1);
  assert.equal(stand(m, /clarinettes/i).qty, 2, 'la clarinette basse n\'est pas dans les clarinettes');
  assert.equal(stand(m, /bassons/i).qty, 2);
  assert.equal(m.stands.bois.length, 2);
  assert.equal(m.general.chaisesNormales, 6);
});
test('piccolo : aucun stand, ligne d\'info sur la tablette du pupitre d\'harmonie', () => {
  const m = calculateMobilier({ bois: ['3 Flûtes', '1 Piccolo'], cuivres: [], cordes: [], autres: [] }, [], {});
  assert.equal(m.stands.bois.length, 1);
  assert.equal(stand(m, /piccolo/i), undefined);
  assert.ok(m.infos.includes("Piccolo : sur la tablette du pupitre d'harmonie (aucun stand)."));
  assert.equal(m.general.pupitres, 4);
  assert.match(U.generateMobilierStandaloneText({ titre: 'T', mobilier: m }), /Piccolo : sur la tablette du pupitre d'harmonie/);
});

// ── Chaises hautes, R&S et Kolberg ──
test('réglages par défaut : R&S partout ; ONF et Philhar acceptent casse et accents', () => {
  assert.deepEqual(reglagesParDefaut('Orchestre de Chambre'), { standPourDeux: [], chaisesHautes: { contrebasses: 'R&S', percussions: 'R&S' } });
  assert.deepEqual(reglagesParDefaut().chaisesHautes, { contrebasses: 'R&S', percussions: 'R&S' });
  for (const n of ['ONF', 'onf', 'Orchestre National de France', 'ORCHESTRE NATIONAL DE FRANCE']) {
    assert.deepEqual(reglagesParDefaut(n).chaisesHautes, { contrebasses: 'Kolberg', percussions: 'R&S' }, n);
  }
  for (const n of ['Philhar', 'Orchestre Philharmonique de Radio France', 'OPRF', 'orchestre philharmonique de radio-france'.replace('-', ' ')]) {
    assert.deepEqual(reglagesParDefaut(n).chaisesHautes, { contrebasses: 'R&S', percussions: 'Kolberg' }, n);
  }
  assert.equal(reglagesParDefaut('Orchestre Philharmonique de Strasbourg').chaisesHautes.percussions, 'R&S');
});
test('chaises hautes : modèle par rôle, Kolberg pour les CB (ONF) ou pour les percus (Philhar)', () => {
  const poles = [{ nom: 'Percussion 1', items: [] }, { nom: 'Percussion 2', items: [] }];
  const onf = calculateMobilier(REDBULL, poles, { hasChef: false, reglages: reglagesParDefaut('ONF') });
  assert.deepEqual(onf.general.chaisesHautesModele, { contrebasses: 'Kolberg', percussions: 'R&S', chef: 'R&S' });
  assert.equal(onf.general.chaisesHautes, 3 + 2);
  assert.equal(onf.general.chaisesHautesDetail, '3 (contrebasses, Kolberg) + 2 (percussions, R&S) = 5');
  const ph = calculateMobilier(REDBULL, poles, { hasChef: false, reglages: reglagesParDefaut('Philhar') });
  assert.deepEqual(ph.general.chaisesHautesModele, { contrebasses: 'R&S', percussions: 'Kolberg', chef: 'R&S' });
  assert.match(U.generateMobilierStandaloneText({ titre: 'T', mobilier: ph }), /Kolberg.*percussions/);
  const defaut = calculateMobilier(REDBULL, poles, {});
  assert.deepEqual(defaut.general.chaisesHautesModele, { contrebasses: 'R&S', percussions: 'R&S', chef: 'R&S' });
});

// ── Chef ──
test('chef : présent = podium, pupitre, chaise haute ; absent = rien ; inconnu = rien et à confirmer', () => {
  const o = { bois: ['2 Flûtes'], cuivres: [], cordes: ['6 Violons I', '2 Contrebasses'], autres: [] };
  const present = calculateMobilier(o, [], U.chefOptions(false));
  const absent = calculateMobilier(o, [], U.chefOptions(true));
  const inconnu = calculateMobilier(o, [], U.chefOptions(null));
  assert.equal(present.general.pupitres, absent.general.pupitres + 1);
  assert.equal(present.general.chaisesHautes, absent.general.chaisesHautes + 1);
  assert.deepEqual(present.stands.autres.map((s) => s.type), ['Podium chef', 'Pupitre chef']);
  assert.deepEqual(absent.stands.autres, []);
  assert.equal(absent.general.chefAConfirmer, undefined);
  assert.deepEqual(inconnu.stands.autres, []);
  assert.equal(inconnu.general.chefAConfirmer, true);
  assert.equal(inconnu.general.chaisesHautes, absent.general.chaisesHautes);
});

// ── Quantités inconnues ──
test('quantité inconnue : stand à null, jamais 1, ligne signalée', () => {
  const o = { bois: ['3 Flûtes', 'Hautbois', 'Contrebasson'], cuivres: ['Trompettes'], cordes: ['8 Violons I'], autres: ['Harpe', '[Cel/Pno]'] };
  const m = calculateMobilier(o, [], {});
  assert.equal(stand(m, /hautbois/i).qty, null);
  assert.equal(stand(m, /trompettes/i).qty, null);
  assert.equal(sp(m, /contrebasson/i).qty, null);
  assert.equal(m.general.quantitesInconnues, 4, 'hautbois, contrebasson, trompettes, harpe ; l\'annotation entre crochets n\'est pas comptée');
  assert.equal(m.general.banquettes, 0, 'une harpe sans quantité n\'est pas comptée 1');
  assert.equal(m.general.banquettesDetail[0].qty, null);
  assert.equal(m.general.pupitres, 4 + 3);
  assert.match(U.generateMobilierStandaloneText({ titre: 'T', mobilier: m }), /hautbois : \?/i);
  assert.equal(JSON.stringify(m).includes('NaN'), false);
});
test('effectifPercus : null retombe sur les pôles, jamais sur 1', () => {
  const m = calculateMobilier(REDBULL, [], { effectifPercus: { timbaliers: null, percussionnistes: null } });
  assert.equal(m.general.chaisesHautes, 3);
  assert.equal(m.general.chaisesSpeciales.length, 0);
});

// ── Noms baroques et anglais ──
const famille = (nom) => { const i = identifierInstrument(nom); return i && i.key; };
test('noms baroques reconnus dans la bonne famille', () => {
  assert.equal(famille('2 Traverso'), 'flute');
  assert.equal(famille('2 Hautbois baroques'), 'hautbois');
  assert.equal(famille('1 Basson baroque'), 'basson');
  assert.equal(famille('1 Théorbe'), 'theorbe');
  assert.equal(famille('1 Archiluth'), 'theorbe');
  assert.equal(famille('1 Luth'), 'theorbe');
  assert.equal(famille('3 Violes de gambe'), 'viole_de_gambe');
  assert.equal(famille('1 Violone'), 'viole_de_gambe');
  assert.equal(famille('1 Clavecin'), 'clavecin');
  assert.equal(famille('1 Orgue positif'), 'orgue');
  assert.equal(famille('2 Cornets à bouquin'), 'cornet_a_bouquin');
  assert.equal(famille('3 Sacqueboutes'), 'sacqueboute');
  assert.equal(famille('2 Cors naturels'), 'cor_naturel');
  assert.equal(famille('2 Trompettes naturelles'), 'trompette_naturelle');
});
test('noms anglais reconnus', () => {
  const att = { flute: 'flute', oboe: 'hautbois', bassoon: 'basson', contrabassoon: 'contrebasson', 'bass clarinet': 'clarinette_basse', clarinet: 'clarinette',
    horn: 'cor', trumpet: 'trompette', trombone: 'trombone', tuba: 'tuba', harp: 'harpe', piano: 'piano', celesta: 'celesta', keyboard: 'clavier',
    synth: 'clavier', 'double bass': 'contrebasse', cello: 'violoncelle', 'english horn': 'cor_anglais', 'bass guitar': 'guitare_basse' };
  for (const [nom, cle] of Object.entries(att)) assert.equal(famille('2 ' + nom), cle, nom);
  assert.ok(Array.isArray(INSTRUMENTS) && INSTRUMENTS.length > 30);
});
test('plan baroque : théorbe, clavecin et violes sont sur chaise ou banquette, jamais en stand de vent', () => {
  const o = { bois: ['2 Traverso', '2 Hautbois baroques', '1 Basson baroque'], cuivres: [], cordes: ['6 Violons I', '3 Violes de gambe', '1 Violone', '1 Théorbe'], autres: ['1 Clavecin', '1 Orgue positif'] };
  const m = calculateMobilier(o, [], {});
  assert.equal(stand(m, /traverso/i).qty, 2);
  assert.equal(m.general.banquettes, 2);
  assert.equal(m.general.chaisesNormales, 6 + 5 + 5);
  assert.equal(m.general.chaisesHautes, 0, 'le violone n\'est pas une contrebasse moderne');
});
test('plan en anglais : mêmes chiffres qu\'en français', () => {
  const fr = calculateMobilier({ bois: ['2 Flûtes', '1 Contrebasson'], cuivres: ['2 Cors'], cordes: ['6 Violons I', '2 Contrebasses'], autres: ['1 Harpe'] }, [], {});
  const en = calculateMobilier({ bois: ['2 Flutes', '1 Contrabassoon'], cuivres: ['2 Horns'], cordes: ['6 Violins I', '2 Double basses'], autres: ['1 Harp'] }, [], {});
  assert.equal(en.general.pupitres, fr.general.pupitres);
  assert.equal(en.general.chaisesNormales, fr.general.chaisesNormales);
  assert.equal(en.general.chaisesHautes, fr.general.chaisesHautes);
  assert.equal(en.general.banquettes, fr.general.banquettes);
  assert.equal(en.stands.speciaux.length, 1);
});

// ── Comparaison calcul / plan ──
test('comparerMobilier : un écart réel est montré, rien n\'est tranché', () => {
  const m = calculateMobilier(REDBULL, POLES_RB, { hasChef: true });
  const observe = [
    { type: 'Chaises hautes', qte: 4, source: 'plan', details: null },
    { type: 'Pupitres', qte: m.general.pupitres, source: 'plan', details: null },
    { type: 'Chaise d\'orchestre', qte: 35 },
    { type: 'Piano stool', qte: 2 },
    { type: 'Praticables', qte: 9 },
  ];
  const e = comparerMobilier(m, observe);
  const hautes = e.find((x) => x.element === 'Chaises hautes');
  assert.equal(hautes.calcule, 5);
  assert.equal(hautes.observe, 4);
  assert.match(hautes.message, /5.*4/);
  assert.match(hautes.message, /rien n'est corrigé/);
  assert.ok(e.find((x) => x.element === 'Banquettes'), 'piano stool = banquette (calcul : 1, plan : 2)');
  assert.equal(e.find((x) => x.element === 'Pupitres'), undefined, 'mêmes chiffres : pas d\'écart');
  assert.equal(e.find((x) => x.element === 'Chaises normales'), undefined, '« chaise d\'orchestre » = chaise normale, 35 = 35');
  assert.equal(e.find((x) => x.element === 'Praticables'), undefined, 'les praticables ne sont pas calculés : rien à comparer');
  assert.equal(e.length, 2);
});
test('comparerMobilier : synonymes, pluriels, accents, quantité lue absente', () => {
  const m = calculateMobilier(REDBULL, POLES_RB, { hasChef: true });
  const e = comparerMobilier(m, [
    { type: 'Music stands', qte: 10 },
    { type: 'Tabouret', qte: 3 },
    { type: 'Podium', qte: 2 },
    { type: 'Chaises hautes', qte: null },
    { type: 'Chaise timbalier', qte: 1 },
    { type: 'Riser', qte: 4 },
  ]);
  assert.deepEqual(e.map((x) => x.element).sort(), ['Banquettes', 'Podium', 'Pupitres']);
  assert.equal(e.find((x) => x.element === 'Pupitres').observe, 10);
  assert.deepEqual(comparerMobilier(m, null), []);
  assert.deepEqual(comparerMobilier(null, [{ type: 'Pupitre', qte: 1 }]), []);
});
test('comparerMobilier : chef à confirmer, le podium n\'est pas comparé', () => {
  const m = calculateMobilier(REDBULL, POLES_RB, U.chefOptions(null));
  assert.equal(comparerMobilier(m, [{ type: 'Podium', qte: 1 }]).length, 0);
});

// ── Compatibilité ──
test('compatibilité : forme historique conservée, utils.js ré-exporte, aucun cadratin ni NaN', () => {
  assert.equal(U.calculateMobilier, calculateMobilier);
  const m = calculateMobilier(BARBE, POLES_RB, { hasChef: true });
  for (const k of ['pupitres', 'chaisesNormales', 'chaisesHautes', 'chaisesHautesDetail', 'chaisesSpeciales']) assert.ok(k in m.general, k);
  for (const k of ['cordes', 'bois', 'cuivres', 'percus', 'autres']) assert.ok(Array.isArray(m.stands[k]), k);
  const t = textes(m);
  assert.ok(!/NaN|undefined/.test(t), t);
  assert.ok(!/—/.test(t.split('\n').filter((l) => !/MOBILIER/.test(l)).join('\n')), 'aucun cadratin dans les phrases du calcul');
  assert.match(t, /Banquettes : 4 \(harpe 2/);
  assert.equal(calculateMobilier(null, [], {}), null);
  const rec = U.ensureMobilierStructure(m);
  assert.equal(rec.general.banquettes, 4);
});
