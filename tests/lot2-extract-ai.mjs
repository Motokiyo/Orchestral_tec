// LOT 2, points 3, 4, 5, 8 côté serveur : api/extract-ai.js (vrai handler, fournisseur IA simulé).
// Aucun appel réseau : fetch est remplacé, les secrets sont factices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callExtract, promptOf, imageParts, extractAi, IMG } from './lot2-helpers.mjs';

const BON = { titre: 'T', compositeur: 'C', chef: 'Un Chef', percus: [{ nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }] };

// ───────── Pages (point 3) ─────────
test('12 pages envoyées : 8 analysées, 4 rejetées nommément, décompte renvoyé', async () => {
  const c = await callExtract({ images: Array(12).fill(IMG), provider: { content: BON } });
  assert.equal(c.status, 200);
  assert.equal(imageParts(c).length, 9, '8 pages + la légende');
  const pages = c.body.meta?.pages;
  assert.ok(pages, 'meta.pages présent');
  assert.equal(pages.received, 12);
  assert.equal(pages.analysed, 8);
  assert.deepEqual(pages.skipped.map((s) => s.page), [9, 10, 11, 12]);
  assert.ok(pages.skipped.every((s) => /8|limite/i.test(s.reason)), JSON.stringify(pages.skipped));
  assert.ok(c.body.warnings.some((w) => /8 pages sur 12/.test(w)), JSON.stringify(c.body.warnings));
});
test('format non pris en charge, donnée invalide et image trop lourde : rejetés avec une raison', async () => {
  const lourde = 'data:image/jpeg;base64,' + 'A'.repeat(12_000_004);
  const c = await callExtract({
    images: [IMG, 'data:image/gif;base64,AAAA', 42, 'data:image/png;base64,@@@@', lourde, 'data:image/webp;base64,AAAA'],
    provider: { content: BON },
  });
  assert.equal(c.status, 200);
  const p = c.body.meta.pages;
  assert.equal(p.received, 6);
  assert.equal(p.analysed, 2);
  assert.deepEqual(p.skipped.map((s) => s.page), [2, 3, 4, 5]);
  assert.match(p.skipped[0].reason, /format/i);
  assert.match(p.skipped[1].reason, /invalide|donn/i);
  assert.match(p.skipped[3].reason, /lourd|taille/i);
  assert.equal(imageParts(c).length, 3);
});
test('aucune page exploitable : 400 avec le détail des rejets', async () => {
  const c = await callExtract({ images: ['data:image/gif;base64,AAAA'], provider: { content: BON } });
  assert.equal(c.status, 400);
  assert.equal(c.fetchCalls, 0, 'le fournisseur n\'est pas appelé');
  assert.equal(c.body.meta.pages.analysed, 0);
  assert.equal(c.body.meta.pages.skipped.length, 1);
});
test('numérotation d\'origine des pages (pageNumbers) reprise dans les rejets', async () => {
  const c = await callExtract({ images: [IMG, 'data:image/gif;base64,AAAA', IMG], body: { pageNumbers: [1, 3, 4] }, provider: { content: BON } });
  assert.deepEqual(c.body.meta.pages.skipped.map((s) => s.page), [3]);
});

// ───────── Déductions transformées en faits (point 4) ─────────
test('sansChef : jamais déduit d\'une absence', async () => {
  let c = await callExtract({ provider: { content: { titre: 'x', percus: [] } } });
  assert.equal(c.body.sansChef, null, 'le modèle ne parle pas du chef : inconnu');
  c = await callExtract({ provider: { content: { titre: 'x', chef: '', sansChef: false } } });
  assert.equal(c.body.sansChef, false, 'le modèle affirme qu\'il y a un chef');
  c = await callExtract({ provider: { content: { titre: 'x', sansChef: true } } });
  assert.equal(c.body.sansChef, true, 'le modèle affirme explicitement : sans chef');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'A. Dupont' } } });
  assert.equal(c.body.sansChef, false, 'un chef nommé est une observation');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'A. Dupont', sansChef: true } } });
  assert.equal(c.body.sansChef, null, 'contradiction : inconnu, pas de choix arbitraire');
  assert.ok(c.body.warnings.some((w) => /chef/i.test(w)));
  c = await callExtract({ provider: { content: { titre: 'x', sansChef: 'oui' } } });
  assert.equal(c.body.sansChef, null, 'mauvais type : inconnu');
});
test('le prompt n\'ordonne plus de déduire (chef, timbaliers, valeurs par défaut)', async () => {
  const c = await callExtract({ provider: { content: BON } });
  const p = promptOf(c);
  assert.doesNotMatch(p, /NE SUPPOSE JAMAIS un chef/i);
  assert.doesNotMatch(p, /pas de podium visible et pas de "Direction" écrite → sansChef=true/);
  assert.doesNotMatch(p, /2 timb[^\n]*→ 2 Timbaliers/i, '« 2 timbales » ne veut pas dire 2 timbaliers');
  assert.doesNotMatch(p, /Nombre de timbaliers = nombre de jeux de timbales/i);
  assert.match(p, /percusStatut/, 'le prompt demande l\'état de la lecture des percussions');
  assert.match(p, /mobilierObserve/, 'le prompt demande le mobilier observé');
  assert.match(p, /null/, 'le prompt autorise null pour l\'inconnu');
});

// ───────── Valeurs par défaut inventées (point 8) ─────────
test('pôle sans nom et objet sans catégorie : état inconnu explicite, plus « Percu » / « Accessoires »', async () => {
  const c = await callExtract({ provider: { content: { titre: 'x', chef: 'Un Chef', percus: [{ items: [{ nom: 'Triangle' }] }] } } });
  const pole = c.body.percus[0];
  assert.notEqual(pole.nom, 'Percu');
  assert.equal(pole.nom, extractAi.UNKNOWN_POLE_NAME);
  assert.notEqual(pole.items[0].cat, 'Accessoires');
  assert.equal(pole.items[0].cat, extractAi.UNKNOWN_CAT);
  assert.equal(pole.items[0].nom, 'Triangle');
  assert.ok(c.body.warnings.some((w) => /sans nom/i.test(w)), JSON.stringify(c.body.warnings));
});
test('une catégorie lue est conservée telle quelle', async () => {
  const c = await callExtract({ provider: { content: BON } });
  assert.equal(c.body.percus[0].items[0].cat, 'Timbales & Peaux');
});

// ───────── États de la liste de percussions (point 2, côté serveur) ─────────
test('percusStatut : lues / aucune / inconnu', async () => {
  let c = await callExtract({ provider: { content: BON } });
  assert.equal(c.body.meta.percusStatut, 'lues');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'C', percus: [], percusStatut: 'aucune' } } });
  assert.equal(c.body.meta.percusStatut, 'aucune', 'absence confirmée par le modèle');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'C', percus: [] } } });
  assert.equal(c.body.meta.percusStatut, 'inconnu', 'liste vide sans confirmation : vide ou illisible');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'C', percus: [], percusStatut: 'illisible' } } });
  assert.equal(c.body.meta.percusStatut, 'inconnu');
  c = await callExtract({ provider: { content: { titre: 'x', chef: 'C', percus: BON.percus, percusStatut: 'aucune' } } });
  assert.equal(c.body.meta.percusStatut, 'lues', 'contradiction : des postes lus l\'emportent');
  assert.ok(c.body.warnings.some((w) => /percussion/i.test(w)));
});

// ───────── Mobilier observé conservé à part (point 5) ─────────
test('mobilierObserve : conservé, nettoyé, séparé des percussions et de l\'orchestre', async () => {
  const mob = [
    { type: 'Chaise haute', qte: 3, details: 'rangée du fond', source: 'dessin' },
    { type: 'Pupitre', qte: null },
    { type: 'Banquette', qte: 'beaucoup' },
    { qte: 2 },
    'Tabouret',
    42,
  ];
  const c = await callExtract({ provider: { content: { ...BON, mobilierObserve: mob } } });
  assert.equal(c.status, 200);
  const m = c.body.mobilierObserve;
  assert.ok(Array.isArray(m));
  assert.deepEqual(m.map((x) => x.type), ['Chaise haute', 'Pupitre', 'Banquette', 'Tabouret']);
  assert.equal(m[0].qte, 3);
  assert.equal(m[0].source, 'dessin');
  assert.equal(m[1].qte, null);
  assert.equal(m[2].qte, null, 'quantité non numérique : inconnue');
  assert.equal(m[3].qte, null);
  assert.equal(c.body.percus.length, 1, 'le mobilier ne glisse pas dans les percussions');
  assert.ok(c.body.warnings.some((w) => /mobilier/i.test(w)), 'entrées écartées signalées');
});
test('mobilierObserve absent : tableau vide, pas de mobilier inventé', async () => {
  const c = await callExtract({ provider: { content: BON } });
  assert.deepEqual(c.body.mobilierObserve, []);
});

// ───────── Validation stricte des types (point 4) ─────────
test('percus de mauvais type : plus d\'erreur 500, liste vide + avertissement', async () => {
  const c = await callExtract({ provider: { content: { titre: 'x', percus: 'oops' } } });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.percus, []);
  assert.equal(c.body.meta.percusStatut, 'inconnu');
  assert.ok(c.body.warnings.some((w) => /percus/i.test(w)));
});
test('éléments inattendus dans percus / items : écartés avec avertissement, pas de 500', async () => {
  const c = await callExtract({ provider: { content: { titre: 'x', chef: 'C', percus: [null, 7, { nom: 'Percu 1', items: 'oops' }, { nom: 'Percu 2', items: [null, 'Cymbale', { nom: 12 }, { nom: 'Gong', cat: 'Grosses pièces' }] }] } } });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.percus.map((p) => p.nom), ['Percu 1', 'Percu 2']);
  assert.deepEqual(c.body.percus[0].items, []);
  assert.deepEqual(c.body.percus[1].items.map((i) => i.nom), ['Cymbale', 'Gong']);
  assert.ok(c.body.warnings.length > 0);
});
test('orchestre : listes non-tableaux et éléments non-textes sont écartés ; un orchestre non-objet devient null', async () => {
  let c = await callExtract({ provider: { content: { titre: 'x', orchestre: { bois: ['2 Flûtes', 9, null], continuo: ['Clavecin'], cordes: 'oops', cuivres: [] } } } });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.orchestre.bois, ['2 Flûtes']);
  assert.deepEqual(c.body.orchestre.cordes, []);
  assert.deepEqual(c.body.orchestre.continuo, ['Clavecin'], 'continuo conservé tel que lu');
  assert.ok(c.body.warnings.length >= 2);
  c = await callExtract({ provider: { content: { titre: 'x', orchestre: 'beaucoup' } } });
  assert.equal(c.status, 200);
  assert.equal(c.body.orchestre, null);
});
test('champs texte de mauvais type : vidés avec avertissement', async () => {
  const c = await callExtract({ provider: { content: { titre: { a: 1 }, compositeur: ['x'], duree: 12, salle: 'Salle', chef: 'C', effectif: null } } });
  assert.equal(c.status, 200);
  assert.equal(c.body.titre, '');
  assert.equal(c.body.compositeur, '');
  assert.equal(c.body.duree, '12');
  assert.equal(c.body.salle, 'Salle');
  assert.equal(c.body.effectif, '');
  assert.ok(c.body.warnings.some((w) => /titre/i.test(w)));
});
test('réponse qui n\'est pas un objet : refusée en 422, lisible', async () => {
  for (const content of ['[1,2]', 'null', '"texte"', '12']) {
    const c = await callExtract({ provider: { content } });
    assert.equal(c.status, 422, content);
    assert.ok(c.body.error && !/TypeError|undefined/.test(c.body.error), c.body.error);
    assert.equal(c.body.code, 'invalid_shape');
  }
});

// ───────── Réponse tronquée (point 4) ─────────
test('JSON tronqué dans un tableau imbriqué : refusé, avertissement, pas réparé', async () => {
  const c = await callExtract({ provider: { content: '{"titre":"T","percus":[{"nom":"Timbalier","items":[{"cat":"Timbales & Peaux","nom":"Timbale 1"},{"cat":"Claviers","nom":"Vib' } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'truncated');
  assert.match(c.body.error, /tronqu/i);
  assert.ok(Array.isArray(c.body.warnings) && c.body.warnings.length > 0);
  assert.equal(c.body.titre, undefined, 'aucune donnée partielle renvoyée');
});
test('JSON tronqué en fin d\'objet : refusé aussi (ancien comportement : « réparé » en 200)', async () => {
  const c = await callExtract({ provider: { content: '{"titre":"T","chef":"X","percus":[],"compositeur":"Mah' } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'truncated');
});
test('finish_reason = length : refusé même si le JSON est valide', async () => {
  const c = await callExtract({ provider: { content: BON, finish_reason: 'length' } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'truncated');
});
test('contenu vide ou illisible (pas du JSON) : refus lisible, pas de 500 générique', async () => {
  let c = await callExtract({ provider: { content: '' } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'empty');
  c = await callExtract({ provider: { content: 'Voici votre plan : désolé je ne peux pas' } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'unreadable');
});
test('JSON dans des balises ``` : toujours accepté (ce n\'est pas une réparation du contenu)', async () => {
  const c = await callExtract({ provider: { content: '```json\n' + JSON.stringify(BON) + '\n```' } });
  assert.equal(c.status, 200);
  assert.equal(c.body.titre, 'T');
});

// ───────── Fournisseur en erreur, délai maximal (point 4) ─────────
test('429 du fournisseur : relayé avec un message clair, sans détail du fournisseur', async () => {
  const c = await callExtract({ provider: { status: 429 } });
  assert.equal(c.status, 429);
  assert.equal(c.body.code, 'rate_limited');
  assert.doesNotMatch(JSON.stringify(c.body), /SECRET-DETAIL-42/);
});
test('500 du fournisseur : 502, message clair, détail du fournisseur non relayé', async () => {
  const c = await callExtract({ provider: { status: 500 } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'provider_error');
  assert.doesNotMatch(JSON.stringify(c.body), /SECRET-DETAIL-42/);
});
test('fournisseur injoignable : 502 lisible', async () => {
  const c = await callExtract({ provider: { throwError: new TypeError('fetch failed') } });
  assert.equal(c.status, 502);
  assert.equal(c.body.code, 'unreachable');
});
test('délai maximal : AbortController, 504 avant le maxDuration de 60 s', async () => {
  process.env.EXTRACT_AI_TIMEOUT_MS = '60';
  try {
    const t0 = Date.now();
    const c = await callExtract({ provider: { hang: true } });
    assert.equal(c.status, 504);
    assert.equal(c.body.code, 'timeout');
    assert.ok(Date.now() - t0 < 5000);
  } finally { delete process.env.EXTRACT_AI_TIMEOUT_MS; }
  assert.ok(extractAi.DEFAULT_TIMEOUT_MS < extractAi.config.maxDuration * 1000, 'délai par défaut inférieur au maxDuration');
});

// ───────── Compatibilité du format existant ─────────
test('enveloppe additive : tous les champs historiques gardent nom et type', async () => {
  const c = await callExtract({ provider: { content: { titre: 'T', compositeur: 'C', duree: '10', salle: 'S', chef: 'X', date: 'D', effectif: '2.2.2.2', orchestre: { bois: ['2 Flûtes'], cuivres: [], cordes: [], autres: [] }, percus: BON.percus } } });
  assert.equal(c.status, 200);
  for (const k of ['titre', 'compositeur', 'duree', 'salle', 'chef', 'date', 'effectif']) assert.equal(typeof c.body[k], 'string', k);
  assert.equal(typeof c.body.sansChef === 'boolean' || c.body.sansChef === null, true);
  assert.deepEqual(c.body.orchestre, { bois: ['2 Flûtes'], cuivres: [], cordes: [], autres: [] });
  assert.deepEqual(c.body.percus, [{ nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }]);
  assert.ok(Array.isArray(c.body.warnings));
  assert.ok(c.body.meta && c.body.meta.pages);
});
test('garde-fous existants intacts : méthode, session, mode', async () => {
  const noSession = await callExtract({ noSession: true });
  assert.equal(noSession.status, 401);
  const badMode = await callExtract({ body: { mode: 'autre' } });
  assert.equal(badMode.status, 400);
});
