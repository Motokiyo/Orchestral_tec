// LOT 2, points 1, 2, 3, 5, 8 côté application : lecture locale, adaptateur client, fusion IA/local,
// pages et taille d'envoi. Aucune API réelle : fetch est simulé.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { imp, impOrNull, rd } from './lot2-helpers.mjs';

const P = await imp('src/pdfParser.js');
const AI = await impOrNull('src/aiImport.js');
const need = () => assert.ok(AI, 'src/aiImport.js doit exister');
const fakeFile = (name, text) => ({ name, type: 'text/plain', text: async () => text });
const BIG = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n);
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

// ───────── Point 1 : « 4 Timbales » en dur ─────────
test('« Timbales : 2 instruments » ne produit plus de « 4 Timbales »', async () => {
  const r = await P.extractFromTxt(fakeFile('p.txt', 'Titre : Essai\nTimbales : 2 instruments'));
  const noms = r.percus.flatMap((p) => p.items.map((i) => i.nom));
  assert.ok(!noms.some((n) => /^4 Timbales$/i.test(n)), 'injection supprimée : ' + JSON.stringify(r.percus));
  assert.deepEqual(noms, ['2 instruments'], 'seul ce qui est écrit est repris');
});
test('« Timbales : aucune » ne crée aucun poste ni aucun instrument', async () => {
  for (const mot of ['aucune', 'Aucun', 'néant', 'sans']) {
    const r = await P.extractFromTxt(fakeFile('p.txt', `Titre : Essai\nTimbales : ${mot}`));
    const noms = r.percus.flatMap((p) => p.items.map((i) => i.nom));
    assert.deepEqual(noms, [], mot + ' : ' + JSON.stringify(r.percus));
    assert.ok(!r.percus.some((p) => /timbal/i.test(p.nom)), mot + ' : aucun poste Timbalier');
  }
});
test('« Timbales : » avec instruments listés : seulement ceux de la ligne', async () => {
  const r = await P.extractFromTxt(fakeFile('p.txt', 'Titre : Essai\nTimbales : 2 timbales, 1 triangle'));
  const noms = r.percus.flatMap((p) => p.items.map((i) => i.nom));
  assert.deepEqual(noms, ['2 timbales', '1 triangle']);
});
test('pdfParser.js : plus aucune injection codée en dur', () => {
  assert.doesNotMatch(rd('src/pdfParser.js'), /nom:\s*"4 Timbales"/);
});

// ───────── Point 8 : valeurs par défaut (côté lecture locale) ─────────
test('pdfParser.js : plus de sansChef déduit d\'une absence', () => {
  const src = rd('src/pdfParser.js');
  assert.doesNotMatch(src, /result\.sansChef = true/);
});
test('fichier TXT sans mention de chef : sansChef reste inconnu (jamais true)', async () => {
  const r = await P.extractFromTxt(fakeFile('p.txt', 'Titre : Essai\nEffectif : 7 violes de gambe'));
  assert.notEqual(r.sansChef, true);
});

// ───────── Adaptateur client extractWithGemini (points 4, 5, 8) ─────────
test('adaptateur : mobilier observé conservé à part, sansChef null conservé, pas de « Percu »/« Accessoires »', async () => {
  need();
  globalThis.fetch = async () => okResponse({
    titre: 'T', chef: '', sansChef: null, effectif: '', orchestre: { bois: [], cuivres: [], cordes: [], autres: [] },
    percus: [{ items: [{ nom: 'Triangle' }] }, { nom: 'Percu 2', items: [{ cat: 'Claviers', nom: 'Vibraphone' }] }],
    mobilierObserve: [{ type: 'Chaise haute', qte: 3 }],
    warnings: ['avertissement serveur'],
    meta: { pages: { received: 1, analysed: 1, skipped: [] }, percusStatut: 'lues' },
  });
  const r = await P.extractWithGemini([BIG(100)], 'concert');
  assert.equal(r.sansChef, null);
  assert.deepEqual(r.mobilierObserve, [{ type: 'Chaise haute', qte: 3 }]);
  assert.equal(r.percus[0].nom, AI.UNKNOWN_POLE_NAME);
  assert.equal(r.percus[0].items[0].cat, AI.UNKNOWN_CAT);
  assert.equal(r.percus[1].items[0].cat, 'Claviers');
  assert.equal(r.mobilier, undefined, 'le mobilier observé n\'est pas mélangé au mobilier calculé');
  assert.deepEqual(r.aiMeta.warnings, ['avertissement serveur']);
  assert.equal(r.aiMeta.percusStatut, 'lues');
});
test('adaptateur : anciennes réponses sans meta/warnings (serveur plus ancien) toujours lisibles', async () => {
  need();
  globalThis.fetch = async () => okResponse({ titre: 'T', percus: [{ nom: 'P', items: [{ cat: 'Claviers', nom: 'Marimba' }] }], sansChef: true });
  const r = await P.extractWithGemini([BIG(100)], 'concert');
  assert.equal(r.sansChef, true);
  assert.equal(r.percus.length, 1);
  assert.deepEqual(r.mobilierObserve, []);
  assert.deepEqual(r.aiMeta.warnings, []);
  assert.equal(r.aiMeta.percusStatut, 'inconnu');
});
test('envoi : pages numérotées d\'origine, mode, et décompte', async () => {
  need();
  let sent;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return okResponse({ titre: 'T', percus: [] }); };
  const r = await P.extractWithGemini([BIG(100), BIG(100)], 'concert', { pageNumbers: [1, 3], totalPages: 3, failedPages: [2] });
  assert.equal(sent.mode, 'concert');
  assert.equal(sent.images.length, 2);
  assert.deepEqual(sent.pageNumbers, [1, 3]);
  assert.equal(r.aiMeta.pages.total, 3);
  assert.equal(r.aiMeta.pages.analysed, 2);
  assert.deepEqual(r.aiMeta.pages.skipped.map((s) => s.page), [2]);
});

// ───────── Point 3 : pages et taille avant envoi ─────────
test('planAiPages : 10 pages, 8 gardées, 2 rejetées avec raison, résumé « 8 pages sur 10 analysées »', () => {
  need();
  const plan = AI.planAiPages(Array(10).fill(BIG(1000)));
  assert.equal(plan.images.length, 8);
  assert.equal(plan.total, 10);
  assert.deepEqual(plan.skipped.map((s) => s.page), [9, 10]);
  assert.match(plan.skipped[0].reason, /8/);
  assert.equal(AI.pagesSummary(10, 8), '8 pages sur 10 analysées');
  assert.equal(AI.pagesSummary(1, 1), '1 page sur 1 analysée');
  assert.equal(AI.pagesSummary(3, 3), '3 pages sur 3 analysées');
});
test('planAiPages : la taille cumulée reste sous la limite Vercel de 4,5 Mo, sans compression', () => {
  need();
  assert.ok(AI.MAX_AI_BODY_BYTES < 4.5 * 1024 * 1024);
  const pages = [BIG(2_000_000), BIG(2_000_000), BIG(2_000_000)];
  const plan = AI.planAiPages(pages);
  assert.equal(plan.images.length, 2);
  assert.deepEqual(plan.skipped.map((s) => s.page), [3]);
  assert.match(plan.skipped[0].reason, /taille|lourd/i);
  assert.ok(plan.bytes < AI.MAX_AI_BODY_BYTES);
  assert.deepEqual(plan.images, pages.slice(0, 2), 'les images sont envoyées telles quelles, jamais recompressées');
});
test('planAiPages : une page trop lourde est sautée mais une plus petite derrière peut passer', () => {
  need();
  const plan = AI.planAiPages([BIG(1000), BIG(5_000_000), BIG(1000)]);
  assert.deepEqual(plan.pageNumbers, [1, 3]);
  assert.deepEqual(plan.skipped.map((s) => s.page), [2]);
});
test('planAiPages : formats non reconnus rejetés explicitement (HEIC, GIF, texte)', () => {
  need();
  const plan = AI.planAiPages(['data:image/heic;base64,AAAA', 'data:image/gif;base64,AAAA', 'pas une image', BIG(100)]);
  assert.deepEqual(plan.skipped.map((s) => s.page), [1, 2, 3]);
  assert.ok(plan.skipped.every((s) => /format|image/i.test(s.reason)));
  assert.equal(plan.images.length, 1);
});
test('planAiPages : pages non rendues (échec de rendu) comptées dans le total', () => {
  need();
  const plan = AI.planAiPages([BIG(100), BIG(100)], { pageNumbers: [1, 3], totalPages: 3, failedPages: [2] });
  assert.equal(plan.total, 3);
  assert.deepEqual(plan.skipped.map((s) => s.page), [2]);
  assert.match(plan.skipped[0].reason, /rendu|lire|illisible/i);
});
test('extractWithGemini : page unique trop lourde => aucun envoi, message clair', async () => {
  need();
  let called = 0;
  globalThis.fetch = async () => { called++; return okResponse({}); };
  await assert.rejects(
    () => P.extractWithGemini([BIG(6_000_000)], 'concert'),
    (e) => {
      assert.ok(e instanceof AI.AiExtractionError);
      assert.equal(e.kind, 'too_large');
      assert.match(e.message, /Mo/);
      assert.match(e.message, /compress|illisible/i, 'dit pourquoi on ne compresse pas');
      return true;
    },
  );
  assert.equal(called, 0, 'aucun envoi avant le contrôle de taille');
});
test('extractWithGemini : le corps envoyé est toujours sous 4,5 Mo', async () => {
  need();
  let size = 0;
  globalThis.fetch = async (url, init) => { size = init.body.length; return okResponse({ titre: 'T', percus: [] }); };
  const r = await P.extractWithGemini([BIG(2_000_000), BIG(2_000_000), BIG(2_000_000), BIG(1000)], 'concert');
  assert.ok(size < 4.5 * 1024 * 1024, 'taille ' + size);
  assert.equal(r.aiMeta.pages.total, 4);
  assert.ok(r.aiMeta.pages.skipped.length >= 1);
});
test('extractWithGemini : 413 non-JSON de la plateforme => erreur typée lisible', async () => {
  need();
  globalThis.fetch = async () => ({ ok: false, status: 413, json: async () => { throw new SyntaxError('Unexpected token R'); }, text: async () => 'Request Entity Too Large' });
  await assert.rejects(() => P.extractWithGemini([BIG(100)], 'concert'), (e) => {
    assert.equal(e.kind, 'payload_too_large');
    assert.match(e.message, /volumineux|lourd|4,5 Mo/i);
    return true;
  });
});
test('extractWithGemini : réseau coupé, délai dépassé, réponse non-objet => erreurs typées', async () => {
  need();
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => P.extractWithGemini([BIG(100)], 'concert'), (e) => e.kind === 'network');
  globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; reject(e); }));
  await assert.rejects(() => P.extractWithGemini([BIG(100)], 'concert', { timeoutMs: 40 }), (e) => e.kind === 'timeout');
  globalThis.fetch = async () => okResponse('une chaîne');
  await assert.rejects(() => P.extractWithGemini([BIG(100)], 'concert'), (e) => e.kind === 'invalid');
});
test('extractWithGemini : erreur du serveur (422/502) remonte avec son message et ses avertissements', async () => {
  need();
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'Réponse IA tronquée', code: 'truncated', warnings: ['coupée à 16384 jetons'] }), text: async () => '' });
  await assert.rejects(() => P.extractWithGemini([BIG(100)], 'concert'), (e) => {
    assert.equal(e.kind, 'truncated');
    assert.match(e.message, /tronqu/i);
    assert.deepEqual(e.warnings, ['coupée à 16384 jetons']);
    return true;
  });
});

// ───────── Point 2 : trois états, pas de retour silencieux au local ─────────
const LOCAL = () => ({
  titre: 'Local', compositeur: 'Moi', effectif: '', effectifDetail: null,
  orchestre: { bois: ['9 Flûtes'], cuivres: [], cordes: [], autres: [] },
  percus: [{ nom: 'Percu local erroné', items: [{ cat: 'Accessoires', nom: 'Triangle' }] }],
  planDataUrls: ['x'], planDataUrl: 'x', sansChef: undefined,
});
const aiResult = (over = {}) => ({
  titre: 'IA', compositeur: '', duree: '', salle: '', chef: '', date: '', sansChef: null, effectif: '', effectifDetail: null,
  orchestre: { bois: ['1 Flûte'], cuivres: [], cordes: [], autres: [] }, percus: [], mobilierObserve: [],
  aiMeta: { warnings: [], percusStatut: 'inconnu', pages: { total: 1, analysed: 1, skipped: [] } }, ...over,
});

test('IA lit des percussions : elles remplacent le local, aucun bandeau', () => {
  need();
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ percus: [{ nom: 'Timbalier', items: [{ cat: 'Timbales & Peaux', nom: 'Timbale 1' }] }], aiMeta: { warnings: [], percusStatut: 'lues', pages: { total: 1, analysed: 1, skipped: [] } } }), { decodeEffectif: () => null });
  assert.deepEqual(out.percus.map((p) => p.nom), ['Timbalier']);
  assert.equal(out.aiStatus.percusState, 'lues');
  assert.equal(AI.aiBannerInfo(out), null);
});
test('absence confirmée : liste vide gardée vide, état « absence_confirmee », pas de bandeau', () => {
  need();
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ aiMeta: { warnings: [], percusStatut: 'aucune', pages: { total: 1, analysed: 1, skipped: [] } } }), { decodeEffectif: () => null });
  assert.deepEqual(out.percus, []);
  assert.equal(out.aiStatus.percusState, 'absence_confirmee');
  assert.equal(AI.aiBannerInfo({ aiStatus: out.aiStatus }), null);
});
test('réponse vide ou illisible : liste vide (le local n\'est PAS restauré) + bandeau à vérifier', () => {
  need();
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult(), { decodeEffectif: () => null });
  assert.deepEqual(out.percus, [], 'le triangle local erroné ne revient pas');
  assert.equal(out.aiStatus.percusState, 'vide_ou_illisible');
  assert.equal(out.aiStatus.localPercusIgnored, 1);
  const b = AI.aiBannerInfo({ aiStatus: out.aiStatus });
  assert.ok(b, 'bandeau affiché');
  assert.match(b.lines.join(' '), /vide|illisible/i);
});
test('échec technique : percussions locales non restaurées, bandeau « Lecture IA échouée, données à vérifier »', () => {
  need();
  const out = AI.failedAiLocal(LOCAL(), new AI.AiExtractionError('Délai dépassé', { kind: 'timeout' }));
  assert.deepEqual(out.percus, []);
  assert.equal(out.titre, 'Local', 'les champs texte lus localement restent');
  assert.equal(out.orchestre.bois[0], '9 Flûtes');
  assert.equal(out.aiStatus.state, 'failed');
  assert.equal(out.aiStatus.dismissed, false);
  const b = AI.aiBannerInfo({ aiStatus: out.aiStatus });
  assert.equal(b.title, 'Lecture IA échouée, données à vérifier');
  assert.match(b.lines.join(' '), /Délai dépassé/);
});
test('échec avec une erreur quelconque (pas AiExtractionError) : même traitement', () => {
  need();
  const out = AI.failedAiLocal(LOCAL(), new Error('boom'));
  assert.equal(out.aiStatus.state, 'failed');
  assert.match(AI.aiBannerInfo({ aiStatus: out.aiStatus }).lines.join(' '), /boom/);
  const out2 = AI.failedAiLocal(LOCAL(), undefined);
  assert.equal(out2.aiStatus.state, 'failed');
});
test('bandeau conservé tant que non fermé ; fermer le masque ; un nouvel état le rouvre', () => {
  need();
  let st = AI.failedAiLocal(LOCAL(), new Error('x')).aiStatus;
  assert.ok(AI.aiBannerInfo({ aiStatus: st }));
  assert.ok(AI.aiBannerInfo({ aiStatus: JSON.parse(JSON.stringify(st)) }), 'survit à une sauvegarde/relecture JSON');
  const closed = AI.dismissAiStatus(st);
  assert.equal(closed.dismissed, true);
  assert.equal(AI.aiBannerInfo({ aiStatus: closed }), null);
  assert.equal(closed.state, 'failed', 'l\'état reste consigné');
});
test('pages rejetées : « 8 pages sur 10 analysées » visible dans le bandeau', () => {
  need();
  const meta = { warnings: [], percusStatut: 'lues', pages: { total: 10, analysed: 8, skipped: [{ page: 9, reason: 'au-delà de 8 pages' }, { page: 10, reason: 'au-delà de 8 pages' }] } };
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ percus: [{ nom: 'T', items: [] }], aiMeta: meta }), { decodeEffectif: () => null });
  const b = AI.aiBannerInfo({ aiStatus: out.aiStatus });
  assert.ok(b);
  assert.match(b.lines.join('\n'), /8 pages sur 10 analysées/);
  assert.match(b.lines.join('\n'), /page 9/);
});
test('avertissements de la lecture IA affichés dans le bandeau', () => {
  need();
  const meta = { warnings: ['Champ titre de type inattendu ignoré'], percusStatut: 'lues', pages: { total: 1, analysed: 1, skipped: [] } };
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ percus: [{ nom: 'T', items: [] }], aiMeta: meta }), { decodeEffectif: () => null });
  assert.match(AI.aiBannerInfo({ aiStatus: out.aiStatus }).lines.join('\n'), /titre de type inattendu/);
});
test('orchestre non lu par l\'IA : lecture locale gardée et signalée', () => {
  need();
  const out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ orchestre: null }), { decodeEffectif: () => null });
  assert.equal(out.orchestre.bois[0], '9 Flûtes');
  assert.match(AI.aiBannerInfo({ aiStatus: out.aiStatus }).lines.join(' '), /effectif|orchestre/i);
});
test('sansChef et mobilier observé repris de l\'IA, jamais inventés', () => {
  need();
  let out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ sansChef: false, mobilierObserve: [{ type: 'Pupitre', qte: 2 }] }), { decodeEffectif: () => null });
  assert.equal(out.sansChef, false);
  assert.deepEqual(out.mobilierObserve, [{ type: 'Pupitre', qte: 2 }]);
  out = AI.mergeAiIntoLocal(LOCAL(), aiResult({ sansChef: null }), { decodeEffectif: () => null });
  assert.equal(out.sansChef, null);
});
test('hors ligne : lecture locale conservée (décision du 23/09), mais marquée et visible', () => {
  need();
  const out = AI.offlineAiLocal(LOCAL());
  assert.equal(out.percus.length, 1);
  assert.equal(out.aiStatus.state, 'skipped');
  assert.match(AI.aiBannerInfo({ aiStatus: out.aiStatus }).title, /hors ligne|non faite/i);
});

// ───────── enrichWithAi réel (tranche d'App.jsx exécutée) ─────────
function loadEnrich(extra = {}) {
  need();
  const app = rd('src/App.jsx');
  const a = app.indexOf('  async function enrichWithAi(');
  const b = app.indexOf('  function extractNum(', a);
  assert.ok(a > 0 && b > a, 'enrichWithAi introuvable');
  const alerts = [];
  const calls = [];
  const ctx = {
    console, alerts, calls, isOffline: () => false, alert: (m) => alerts.push(m),
    decodeEffectif: () => null,
    extractWithGemini: async (...args) => { calls.push(args); return aiResult(); },
    mergeAiIntoLocal: AI.mergeAiIntoLocal, failedAiLocal: AI.failedAiLocal, offlineAiLocal: AI.offlineAiLocal,
    ...extra,
  };
  vm.createContext(ctx);
  vm.runInContext(app.slice(a, b), ctx);
  return ctx;
}
test('enrichWithAi : réponse IA vide => plus de percussions locales ressuscitées', async () => {
  const ctx = loadEnrich();
  const out = await ctx.enrichWithAi(LOCAL());
  assert.deepEqual(out.percus, []);
  assert.equal(out.aiStatus.percusState, 'vide_ou_illisible');
});
test('enrichWithAi : échec de l\'IA => état « failed », pas de retour silencieux au local', async () => {
  const ctx = loadEnrich({ extractWithGemini: async () => { throw new Error('boom'); } });
  const out = await ctx.enrichWithAi(LOCAL());
  assert.deepEqual(out.percus, []);
  assert.equal(out.aiStatus.state, 'failed');
  assert.match(out.aiStatus.message, /boom/);
});
test('enrichWithAi : IA correcte => ses percussions', async () => {
  const ctx = loadEnrich({ extractWithGemini: async () => aiResult({ percus: [{ nom: 'Percu 1', items: [{ cat: 'Claviers', nom: 'Marimba' }] }], aiMeta: { warnings: [], percusStatut: 'lues', pages: { total: 1, analysed: 1, skipped: [] } } }) });
  const out = await ctx.enrichWithAi(LOCAL());
  assert.deepEqual(out.percus.map((p) => p.nom), ['Percu 1']);
});
test('enrichWithAi : transmet numéros de pages, total et pages non rendues', async () => {
  const ctx = loadEnrich();
  await ctx.enrichWithAi({ ...LOCAL(), planDataUrls: ['a', 'b'], planPageNumbers: [1, 3], pageCount: 3, pagesFailed: [2] });
  const opts = ctx.calls[0][2];
  assert.deepEqual(JSON.parse(JSON.stringify(opts)), { pageNumbers: [1, 3], totalPages: 3, failedPages: [2] });
});
test('enrichWithAi : hors ligne => alerte, lecture locale, état « skipped »', async () => {
  const ctx = loadEnrich({ isOffline: () => true });
  const out = await ctx.enrichWithAi(LOCAL());
  assert.equal(ctx.alerts.length, 1);
  assert.equal(out.aiStatus.state, 'skipped');
});
test('enrichWithAi : liste texte sans image => lecture locale inchangée, aucun état IA', async () => {
  const ctx = loadEnrich();
  const local = { ...LOCAL(), planDataUrls: [], planDataUrl: null };
  const out = await ctx.enrichWithAi(local);
  assert.equal(out, local);
  assert.equal(out.aiStatus, undefined);
});

// ───────── Pages (handleAddPlan) et branchement dans App.jsx ─────────
test('handleAddPlan : un PDF ajoute toutes ses pages, plus seulement la première', () => {
  const app = rd('src/App.jsx');
  const a = app.indexOf('  async function handleAddPlan(');
  const b = app.indexOf('  async function enrichWithAi(', a);
  const body = app.slice(a, b);
  assert.doesNotMatch(body, /planDataUrl = data\.planDataUrl;/, 'ancienne affectation de la seule page 1');
  assert.match(body, /planDataUrls/);
  assert.match(body, /pageCount|pagesFailed/, 'les pages non rendues sont signalées');
});
test('import : la pièce créée garde l\'état IA, le mobilier observé et un sansChef à trois états', () => {
  const app = rd('src/App.jsx');
  const a = app.indexOf('  async function handlePdfImportNew(');
  const b = app.indexOf('  async function handleAddPlan(', a);
  const body = app.slice(a, b);
  assert.match(body, /aiStatus:\s*data\.aiStatus/);
  assert.match(body, /mobilierObserve:/);
  assert.match(body, /sansChef:/);
});
test('bandeau : défini via styles.js, bouton de fermeture d\'au moins 44 px', () => {
  const app = rd('src/App.jsx');
  const styles = rd('src/styles.js');
  assert.match(app, /aiBannerInfo\(piece\)/);
  assert.match(app, /dismissAiBanner/);
  assert.match(styles, /aiBanner/);
  assert.match(styles, /aiBannerClose[\s\S]{0,200}minWidth: 44[\s\S]{0,60}minHeight: 44|aiBannerClose[\s\S]{0,200}minHeight: 44[\s\S]{0,60}minWidth: 44/);
});
test('les deux constantes « inconnu » du serveur et du client sont identiques', async () => {
  need();
  const server = await imp('api/extract-ai.js');
  assert.equal(server.UNKNOWN_POLE_NAME, AI.UNKNOWN_POLE_NAME);
  assert.equal(server.UNKNOWN_CAT, AI.UNKNOWN_CAT);
  assert.equal(server.MAX_PAGES, AI.MAX_AI_PAGES);
});
