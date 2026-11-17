// LOT 4B : lecture des plans (ordre Daniels, effectif des percussions, noms baroques, plan de détail
// percussion, consignes du prompt). Chaînes recopiées des cartouches réels (texte seulement). Aucun réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imp, callExtract, promptOf, IMG } from './lot2-helpers.mjs';
import { LIGNES_REELLES } from './lot2-fixtures-effectifs.mjs';

const P = await imp('src/pdfParser.js');
const { decodeEffectif, formatEffectifDaniels, classerInstrumentBaroque, lireOrchestreBaroque, lireDetailPercussion, appliquerOrdreDaniels, finaliserLecture } = P;

const REDBULL = '7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe';
const LSO = '2220 / 0400 / 0T 2P 2 x Vibraphones 0H 2Pno / 1BassGuitar Electric / ENSEMBLE: 2.2.2.2.1 / FULL ORCHESTRA STRINGS: 10.8.6.6.0 (split)';
const TPLUS2 = '4.3.3.4 - 4.4.4.1 -T+2 -2hp -cel -orgue +Banda / 16 / 14 / 12 / 10 / 8';

// ── 1. Ordre Daniels, cordes à la fin, avec les points ──
test('ordre Daniels : plan écrit cordes d\'abord (Red Bull) remis cordes à la fin', () => {
  const d = decodeEffectif(REDBULL);
  assert.deepEqual(d.cordes, { 'Violon I': 7, 'Violon II': 6, 'Alto': 5, 'Violoncelle': 4, 'Contrebasse': 3 });
  assert.deepEqual(d.bois, { 'Flûte': 2, Hautbois: 1, Clarinette: 2, Basson: 1 });
  assert.deepEqual(d.cuivres, { Cor: 3, Trompette: 2, Trombone: 2 });
  assert.equal(formatEffectifDaniels(REDBULL), '2.1.2.1 / 3.2.2.0 / T+1 / 1hp / 7.6.5.4.3');
  assert.equal(formatEffectifDaniels(d), '2.1.2.1 / 3.2.2.0 / T+1 / 1hp / 7.6.5.4.3');
});
test('1timb.1perc.1harpe collé = 1 timbalier, 1 percussionniste, 1 harpe', () => {
  const d = decodeEffectif(REDBULL);
  assert.equal(d.percussions.Timbales, 1);
  assert.equal(d.percussions.Percussion, 1);
  assert.equal(d.percussions.Harpe, 1);
  assert.deepEqual(d.effectifPercus, { timbaliers: 1, percussionnistes: 1 });
});
test('cordes d\'abord sans ligne nommée : 5 nombres décroissants en tête = cordes', () => {
  const d = decodeEffectif('7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1.1.1.0');
  assert.ok(d);
  assert.deepEqual(d.cordes, { 'Violon I': 7, 'Violon II': 6, 'Alto': 5, 'Violoncelle': 4, 'Contrebasse': 3 });
  assert.equal(d.bois['Flûte'], 2);
  assert.equal(d.cuivres['Cor'], 3);
});
test('ne pas confondre : 5 nombres croissants en tête ne sont pas des cordes', () => {
  const d = decodeEffectif('1.2.3.4.5 / 2.1.2.1 / 3.2.2.0 / 1.1.1.0');
  assert.ok(d === null || d.cordes['Violon I'] !== 1 || d.cordes['Contrebasse'] !== 5);
});
test('exemple de la consigne : LSO remis en ordre Daniels avec points', () => {
  assert.equal(formatEffectifDaniels(LSO), '2.2.2.0 / 0.4.0.0 / 2perc / 2pno / 1guitbasse / 10.8.6.6.0');
  assert.equal(formatEffectifDaniels('2220 / 0400'), '2.2.2.0 / 0.4.0.0');
});
test('T+2 : ligne remise en ordre, avec harpes et claviers', () => {
  assert.equal(formatEffectifDaniels(TPLUS2), '4.3.3.4 / 4.4.4.1 / T+2 / 2hp+cel+orgue / 16.14.12.10.8');
});
test('ligne remise en ordre : jamais de perte (relue, elle donne le même effectif), sinon la ligne écrite reste', () => {
  let changees = 0;
  for (const l of LIGNES_REELLES) {
    const d = decodeEffectif(l.ligne);
    if (!d) continue;
    const r = { effectif: l.ligne, effectifDetail: d, orchestre: null, percus: [] };
    appliquerOrdreDaniels(r);
    if (r.effectif === l.ligne) continue;
    changees++;
    const d2 = decodeEffectif(r.effectif);
    assert.ok(d2, l.id + ' : la ligne remise en ordre doit se relire');
    for (const g of ['bois', 'cuivres', 'percussions', 'cordes', 'autres']) {
      const f = (o) => JSON.stringify(Object.entries(o || {}).filter(([k, v]) => k !== 'total' && v > 0).sort());
      assert.equal(f(d2[g]), f(d[g]), l.id + ' ' + g);
    }
    assert.equal(r.effectifBrut, l.ligne);
  }
  assert.ok(changees >= 5, `au moins 5 lignes remises en ordre, ${changees}`);
});
test('appliquerOrdreDaniels : remet l\'effectif de la pièce en ordre et garde la ligne écrite', () => {
  const r = { effectif: REDBULL, effectifDetail: decodeEffectif(REDBULL), orchestre: null, percus: [] };
  appliquerOrdreDaniels(r);
  assert.equal(r.effectif, '2.1.2.1 / 3.2.2.0 / T+1 / 1hp / 7.6.5.4.3');
  assert.equal(r.effectifBrut, REDBULL);
  assert.deepEqual(r.effectifPercus, { timbaliers: 1, percussionnistes: 1 });
});
test('appliquerOrdreDaniels : une ligne qui ne peut pas être refaite sans perte reste telle qu\'écrite', () => {
  const brut = '104 2sopsax 0 / 0400 / 0T 7P (2 Marimba, 2 Xylo, Vibraphone) 0H 4Pno (two instruments with 4 hands on each) / 2.0.2.2.2';
  const d = decodeEffectif(brut);
  const r = { effectif: brut, effectifDetail: d, orchestre: null, percus: [] };
  appliquerOrdreDaniels(r);
  assert.ok(r.effectif === brut || decodeEffectif(r.effectif));
  assert.equal(r.effectifPercus.percussionnistes, 7);
});
test('formatEffectifDaniels depuis l\'orchestre de l\'app (listes de chaînes) + effectifPercus', () => {
  const orch = { bois: ['2 Flûtes', '2 Hautbois', '2 Clarinettes'], cuivres: ['4 Trompettes'], cordes: ['10 Violons I', '8 Violons II', '6 Altos', '6 Violoncelles'], autres: ['2 Harpes', 'Célesta'] };
  assert.equal(formatEffectifDaniels(orch, { effectifPercus: { timbaliers: 1, percussionnistes: 2 } }), '2.2.2.0 / 0.4.0.0 / T+2 / 2hp+cel / 10.8.6.6.0');
  assert.equal(formatEffectifDaniels({}), '');
  assert.equal(formatEffectifDaniels(null), '');
  assert.equal(formatEffectifDaniels('n\'importe quoi'), '');
});
test('les 21 lignes réelles du lot 2 restent justes', () => {
  assert.ok(LIGNES_REELLES.length >= 21);
  for (const l of LIGNES_REELLES) {
    const d = decodeEffectif(l.ligne);
    if (l.inv) { /* ligne dont le lot 2 attend un décodage ou un refus : couvert par lot2-effectifs-reels */ }
    assert.ok(d === null || typeof d === 'object', l.id);
  }
});

// ── 3. T+2 = 1 timbalier + 2 percussionnistes ──
test('effectifPercus : T+2 = { timbaliers: 1, percussionnistes: 2 }', () => {
  assert.deepEqual(decodeEffectif('4.3.3.4 - 4.4.4.1 -T+2 -2hp -cel -orgue +Banda 16.14.12.10.8').effectifPercus, { timbaliers: 1, percussionnistes: 2 });
  assert.deepEqual(decodeEffectif(TPLUS2).effectifPercus, { timbaliers: 1, percussionnistes: 2 });
});
test('effectifPercus : Daniels numérique 1.3.2.1 = 1 timbalier, 3 percussionnistes', () => {
  assert.deepEqual(decodeEffectif('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8').effectifPercus, { timbaliers: 1, percussionnistes: 3 });
});
test('effectifPercus : « 2 timb. » reste ambigu, rien n\'est deviné', () => {
  const d = decodeEffectif('2.2.2.2 - 4.2.3.0 - 2 timb. - 16.14.12.10.8');
  assert.equal(d, null, 'décodage refusé : nombre de timbaliers ou de timbales ?');
  const r = { effectif: '2.2.2.2 - 4.2.3.0 - 2 timb. - 16.14.12.10.8', effectifDetail: d };
  appliquerOrdreDaniels(r);
  assert.equal(r.effectifPercus, null);
  assert.equal(r.effectif, '2.2.2.2 - 4.2.3.0 - 2 timb. - 16.14.12.10.8', 'ligne écrite gardée');
});
test('effectifPercus : null quand l\'effectif ne dit rien des percussions', () => {
  assert.equal(decodeEffectif('2.2.2.2 / 4.3.3.1 / 16.14.12.10.8').effectifPercus, null);
});
test('effectifPercus : LSO « 0T 2P » = 0 timbalier, 2 percussionnistes', () => {
  assert.deepEqual(decodeEffectif(LSO).effectifPercus, { timbaliers: 0, percussionnistes: 2 });
});

// ── 4. LSO ──
test('LSO : 2220/0400 = 2.2.2.0 / 0.4.0.0', () => {
  const d = decodeEffectif('2220/0400');
  assert.deepEqual(d.bois, { 'Flûte': 2, Hautbois: 2, Clarinette: 2 });
  assert.deepEqual(d.cuivres, { Trompette: 4 });
  const d2 = decodeEffectif('2220 / 0400');
  assert.deepEqual(d2.bois, d.bois);
  assert.equal(decodeEffectif('2220/0400/0T 2P 0H 2Pno').effectifPercus.percussionnistes, 2);
});
test('LSO : « 2 x Vibraphones » = 2 vibraphones écrits', () => {
  const d = decodeEffectif(LSO);
  assert.deepEqual(d.instrumentsPercu, [{ nom: 'Vibraphone', qte: 2 }]);
  assert.deepEqual(P.lireInstrumentsPercuEcrits('(2 Marimba, 2 Xylo, Vibraphone)'), [{ nom: 'Marimba', qte: 2 }, { nom: 'Xylophone', qte: 2 }, { nom: 'Vibraphone', qte: 1 }]);
});

// ── 5. Noms baroques ──
const BAROQUES = [
  ['traverso', 'bois', 'Traverso'], ['Traversos', 'bois', 'Traverso'], ['hautbois baroque', 'bois', 'Hautbois baroque'], ['Basson baroque', 'bois', 'Basson baroque'],
  ['théorbe', 'continuo', 'Théorbe'], ['archiluth', 'continuo', 'Archiluth'], ['viole de gambe', 'cordes', 'Viole de gambe'], ['violes de gambe', 'cordes', 'Viole de gambe'],
  ['violone', 'cordes', 'Violone'], ['clavecin', 'continuo', 'Clavecin'], ['orgue positif', 'continuo', 'Orgue positif'], ['cornet à bouquin', 'cuivres', 'Cornet à bouquin'],
  ['cornets à bouquin', 'cuivres', 'Cornet à bouquin'], ['sacqueboute', 'cuivres', 'Sacqueboute'], ['cor naturel', 'cuivres', 'Cor naturel'], ['cors naturels', 'cuivres', 'Cor naturel'],
  ['trompette naturelle', 'cuivres', 'Trompette naturelle'], ['trompettes naturelles', 'cuivres', 'Trompette naturelle'],
];
for (const [txt, fam, nom] of BAROQUES) {
  test(`baroque : « ${txt} » → ${fam}`, () => {
    const c = classerInstrumentBaroque(txt);
    assert.ok(c, txt);
    assert.equal(c.famille, fam);
    assert.equal(c.nom, nom);
  });
}
test('baroque : un instrument moderne ou inconnu n\'est pas classé comme baroque', () => {
  assert.equal(classerInstrumentBaroque('hautbois'), null);
  assert.equal(classerInstrumentBaroque('trompette'), null);
  assert.equal(classerInstrumentBaroque('cor'), null);
  assert.equal(classerInstrumentBaroque('chaise'), null);
});
test('baroque : liste écrite du cartouche rangée par famille', () => {
  const o = lireOrchestreBaroque('5 dessus, 2 tailles, 1 viole, 1 violoncelle, 1 théorbe, 1 violone (Orgue & clavecin)');
  assert.deepEqual(o.cordes, ['5 Dessus de violon', '2 Tailles', '1 Viole', '1 Violoncelle', '1 Violone']);
  assert.deepEqual(o.continuo, ['1 Théorbe', 'Clavecin']);
  assert.equal(lireOrchestreBaroque('2 violons, 1 alto, 1 violoncelle'), null, 'liste moderne : rien à ranger');
});
test('baroque : la lecture locale d\'un fichier texte range les noms baroques', async () => {
  const file = { name: 'plan.txt', text: async () => 'Concert\nEffectif : 0-1-0-1/0-2-0-0/1-0-0-2 (Orgue & clavecin) ; 5 dessus, 2 tailles, 1 viole, 1 violoncelle, 1 théorbe, 1 violone\n' };
  const r = await P.extractFromTxt(file);
  assert.ok(r.orchestre.cordes.some((x) => /Dessus/.test(x)));
  assert.ok(r.orchestre.cordes.some((x) => /Violone/.test(x)));
  assert.ok(r.orchestre.continuo.some((x) => /Théorbe/.test(x)));
  assert.ok(r.orchestre.continuo.some((x) => /Clavecin/.test(x)));
});

// ── 7. Plan de détail percussion ──
test('détail percussion : « 4 timbales + siège + râteau » = 4 timbales, 1 siège de timbalier, 1 râteau', () => {
  const r = lireDetailPercussion('4 timbales + siège + râteau');
  assert.equal(r.detailPercussion, true);
  assert.equal(r.percus.length, 1);
  const p = r.percus[0];
  assert.equal(p.nom, 'Timbalier');
  assert.equal(p.items.filter((i) => /^Timbale \d$/.test(i.nom)).length, 4);
  assert.equal(p.items.filter((i) => i.nom === 'Siège de timbalier').length, 1);
  assert.equal(p.items.filter((i) => i.nom === 'Râteau').length, 1);
  assert.ok(!p.items.some((i) => /4 Timbales/i.test(i.nom)), 'jamais « 4 Timbales » en un seul item');
});
test('détail percussion : 5 postes sans orchestre, pôles propres et indicateur', async () => {
  const txt = ['Cymbales frappées', 'Tablette triangle', 'Tablette tambours de basque', 'Caisse claire (+ siège de caisse)', '4 timbales + siège + râteau', 'Pupitres', 'Chaises'].join('\n');
  const file = { name: 'detail.txt', text: async () => txt };
  const r = await P.extractFromTxt(file);
  assert.equal(r.detailPercussion, true);
  assert.equal(r.effectif, '');
  assert.equal(r.percus.length, 5);
  assert.ok(r.percus.every((p) => p.nom && p.items.length > 0 && p.items.every((i) => i.nom && i.cat)));
  const caisse = r.percus.find((p) => p.items.some((i) => /Caisse claire/.test(i.nom)));
  assert.ok(caisse.items.some((i) => i.nom === 'Siège de caisse'));
  assert.equal(r.percus.filter((p) => p.nom === 'Timbalier').length, 1);
});
test('détail percussion : un plan d\'orchestre n\'est jamais pris pour un plan de détail', async () => {
  const file = { name: 'orch.txt', text: async () => 'Effectif : 3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8\n' };
  const r = await P.extractFromTxt(file);
  assert.equal(r.detailPercussion, false);
  assert.equal(r.effectifPercus.timbaliers, 1);
  assert.equal(r.effectifPercus.percussionnistes, 3);
});
test('détail percussion : « Timbales : aucune » ne crée aucun poste', () => {
  const r = finaliserLecture({ effectif: '', effectifDetail: null, orchestre: null, percus: [] }, 'Timbales : aucune');
  assert.equal(r.percus.length, 0);
  assert.equal(r.detailPercussion, false);
});

// ── 6. Prompt et normalisation côté serveur ──
test('prompt : consignes sur le mobilier dessiné ou écrit', async () => {
  const c = await callExtract({ provider: { content: {} } });
  const p = promptOf(c);
  for (const re of [/PRATICABLES/, /sous quel/i, /PODIUM/, /PUPITRES/, /STANDS/, /chaise d'orchestre/, /chaise haute/, /chaise de contrebasse/, /chaise de timbalier/, /banquette/i, /Kolberg/, /R&S/, /tabouret/i, /ne suppose JAMAIS 4/i, /null si illisible/, /"écrit"/, /"dessiné"/, /details/, /detailPercussion/, /Archiluth/, /Sacqueboute/]) {
    assert.match(p, re);
  }
  assert.match(p, /tabouret.*BANQUETTE/is);
});
test('prompt : limite de 8 pages et 4,3 Mo intactes', async () => {
  const server = await imp('api/extract-ai.js');
  assert.equal(server.MAX_PAGES, 8);
  const ai = await imp('src/aiImport.js');
  assert.equal(ai.MAX_AI_BODY_BYTES, 4_300_000);
});
test('normalisation : praticables, podium, banquettes gardés ; illisible = null', async () => {
  const c = await callExtract({ provider: { content: {
    titre: 'X', detailPercussion: false,
    mobilierObserve: [
      { type: 'Praticable', qte: 3, details: 'sous le timbalier', source: 'dessiné' },
      { type: 'Praticable', qte: 'beaucoup', details: 'sous la harpe', source: 'dessiné' },
      { type: 'Podium du chef', qte: 1, source: 'dessiné' },
      { type: 'Banquette', qte: 3, details: 'piano, harpe', source: 'écrit' },
      { type: 'Chaise de timbalier', qte: null, source: 'écrit' },
      { type: 'Timbales', qte: 3, source: 'dessiné' },
      { type: 'Chaise', qte: -2 },
      { type: '', qte: 4 },
    ],
  } } });
  assert.equal(c.status, 200);
  const m = c.body.mobilierObserve;
  assert.equal(m.length, 7, 'l\'entrée sans type est écartée');
  assert.deepEqual(m[0], { type: 'Praticable', qte: 3, details: 'sous le timbalier', source: 'dessiné' });
  assert.equal(m[1].qte, null, 'quantité illisible : null, jamais un nombre inventé');
  assert.equal(m[2].type, 'Podium du chef');
  assert.equal(m[3].source, 'écrit');
  assert.equal(m[4].qte, null);
  assert.equal(m[5].qte, 3);
  assert.equal(m[6].qte, null, 'quantité négative refusée');
  assert.equal(c.body.detailPercussion, false);
});
test('normalisation : detailPercussion booléen seulement, sinon null', async () => {
  const a = await callExtract({ provider: { content: { detailPercussion: true, percus: [{ nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }] } } });
  assert.equal(a.body.detailPercussion, true);
  const b = await callExtract({ provider: { content: { detailPercussion: 'oui' } } });
  assert.equal(b.body.detailPercussion, null);
  const c = await callExtract({ provider: { content: {} } });
  assert.equal(c.body.detailPercussion, null);
});
