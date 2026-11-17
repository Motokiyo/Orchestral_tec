// INSTANTANÉ D AUDIT du 17/11/2026 : reproduit les 57 défauts sur le code D ORIGINE (e6892c8). Après les lots 1 et 2, plusieurs fonctions ont changé de forme : ce script n est plus un test de non-régression, les tests vivants sont tests/lot*.mjs.
// Audit fonctionnel OrkMap : tests hors réseau, lecture seule du dépôt.
// Le code réel est chargé depuis le dépôt (import ou tranches vm), jamais copié.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = '/Users/alexandre/Territoire/Galaad-Motokiyo-Ferran/1 Projets/Orchestral-tec/';
const rd = (p) => fs.readFileSync(REPO + p, 'utf8');
const app = rd('src/App.jsx'), parser = rd('src/pdfParser.js'), store = rd('src/useStorage.js');
let pass = 0, fail = 0;
const T = (label, cond, detail = '') => { cond ? pass++ : fail++; console.log((cond ? 'CONFIRME ' : 'INFIRME  ') + label + (detail ? '  -> ' + detail : '')); };
const slice = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('tranche introuvable: ' + from); return src.slice(a, b); };

const U = await import(pathToFileURL(REPO + 'src/utils.js').href);
const { calculateMobilier, extractNumberFromItem, generatePieceText, generatePercusGlobalText } = U;
const hasCh = { hasChef: true };

console.log('\n=== A. calculateMobilier (src/utils.js, import réel) ===');
// A1 quantité inconnue -> 1
T('A1 quantité inconnue devient 1 (utils.js:46-50)', extractNumberFromItem('Flûte') === 1 && extractNumberFromItem('4Flûtes') === 1 && extractNumberFromItem('Violons I : 16') === 1);
// A2 pupitres vs LOOKUP_MOBILIER (harmonie 1 par musicien)
const sym = { bois: ['3 Flûtes', '3 Hautbois', '3 Clarinettes', '3 Bassons'], cuivres: ['4 Cors', '3 Trompettes', '3 Trombones', '1 Tuba'], cordes: ['16 Violons I', '14 Violons II', '12 Altos', '10 Violoncelles', '8 Contrebasses'], autres: ['2 Harpes', 'Piano'] };
const m = calculateMobilier(sym, [], hasCh);
const attenduPupitres = 12 + 11 + 8 + 7 + 6 + 5 + 4 /*cordes ceil*/ + 1 /*chef*/ + 2 /*harpes*/ + 1 /*piano*/;
T('A2 pupitres harmonie = 1 par ligne, pas 1 par musicien (utils.js:135-136)', m.general.pupitres === 35, `code=${m.general.pupitres} ; règle LOOKUP_MOBILIER harmonie 1:1 + solistes 1:1 donnerait ${attenduPupitres}`);
T('A2b écart chiffré', m.general.pupitres !== attenduPupitres, `ecart=${attenduPupitres - m.general.pupitres}`);
// A3 sièges des harpistes/pianiste : aucun
T('A3 harpes/piano/célesta (orchestre.autres) : 0 chaise, 0 banquette, 0 pupitre', m.general.chaisesNormales === 75 && !JSON.stringify(m).match(/banquette|tabouret/i), `chaisesNormales=${m.general.chaisesNormales}`);
// A4 double compte des chaises percu
const percus = [{ nom: 'Timbalier', items: [] }, { nom: 'Percu 1', items: [] }, { nom: 'Percu 2', items: [] }];
const m2 = calculateMobilier({ bois: [], cuivres: [], cordes: ['8 Contrebasses'], autres: [] }, percus, hasCh);
T('A4 chaises percu comptées deux fois : dans général.chaisesHautes ET dans stands.percus (utils.js:97-111 et :146)', m2.general.chaisesHautes === 8 + 1 + 3 && m2.stands.percus.reduce((s, x) => s + x.qty, 0) === 3, `chaisesHautes=${m2.general.chaisesHautes} (8 CB + 1 chef + 3 percus) ; stands.percus=${JSON.stringify(m2.stands.percus)}`);
// A5 chef : règle LOOKUP = chaise haute chef toujours 1
const m3 = calculateMobilier({ bois: [], cuivres: [], cordes: ['1 Violon I'], autres: [] }, [], { hasChef: false });
T('A5 sans chef : aucune chaise haute chef (LOOKUP_MOBILIER dit 1 toujours, en répétition)', m3.general.chaisesHautes === 0);
// A6 cordes "other" écrasement
const m4 = calculateMobilier({ bois: [], cuivres: [], cordes: ['5 Violes de gambe', '2 Théorbes'], autres: [] }, [], hasCh);
T('A6 cordes inconnues : affectation et non addition (utils.js:72) -> 5+2 devient 2', m4.general.chaisesNormales === 2, `chaisesNormales=${m4.general.chaisesNormales} (attendu 7)`);
// A7 "Violons 1" chiffres arabes, "1 Violon" seul
const m5 = calculateMobilier({ bois: [], cuivres: [], cordes: ['6 Violons 1', '4 Violons 2', '1 Violon'], autres: [] }, [], { hasChef: false });
T('A7 "Violons 1/2" ou "Violon" seul tombent dans other -> pupitres = nombre brut, pas ceil(n/2)', m5.general.pupitres === 1 /*last other overwrites*/, `pupitres=${m5.general.pupitres}, chaisesNormales=${m5.general.chaisesNormales} (musiciens réels 11)`);
// A8 stands : qty = effectif ou 1 par famille
T('A8 stands bois/cuivres : qty = nombre de musiciens, LOOKUP_MOBILIER dit 1 par famille', m.stands.bois[0].qty === 3 && m.stands.cuivres[0].qty === 4, `stands bois=${JSON.stringify(m.stands.bois.map(s => s.qty))}`);
// A9 chaisesSpeciales toujours vide
T('A9 chaisesSpeciales toujours [] au calcul', Array.isArray(m.general.chaisesSpeciales) && m.general.chaisesSpeciales.length === 0);
// A10 percus mal nommées
const m6 = calculateMobilier({ bois: [], cuivres: [], cordes: [], autres: [] }, [{ nom: 'Timbales' }, { nom: 'Timbalier 2' }, { nom: 'T' }], hasCh);
T('A10 le poste "T" ou "Timbales" non nommé "timbalier" reçoit une chaise haute standard', m6.stands.percus.find(s => s.type === 'Chaise timbalier')?.qty === 1 && m6.stands.percus.find(s => s.type === 'Chaises hautes')?.qty === 2, JSON.stringify(m6.stands.percus));
// A11 total musiciens
const txt = generatePieceText({ orchestre: sym, percus: [{ nom: 'Timbalier', items: [] }, { nom: 'Percu 1', items: [] }], effectif: '', titre: 'x' });
const total = /Nombre de musiciens : (\d+)/.exec(txt)[1];
T('A11 "Nombre de musiciens" exclut timbalier et percussionnistes', Number(total) === 86, `affiché=${total} ; réel=${12+11+60+3+2}`);
T('A11b valeur affichée != réelle', Number(total) !== 12+11+60+3+2);

console.log('\n=== B. Daniels recalculé (App.jsx) ===');
const ctxB = { extractNumberFromItem, calculateMobilier, generatePercusGlobalText, console };
vm.createContext(ctxB);
vm.runInContext(slice(app, 'const DANIELS_BOIS', '// extractNumberFromItem is now imported') + slice(app, 'function matchSection(', 'export default function App') .replace('export default', ''), ctxB);
vm.runInContext(slice(app, '  function recalcDaniels(p)', '  // ── Orchestre mutations ──').replace(/^  /, '') , ctxB);
vm.runInContext(slice(app, '  const CORDES_PATTERNS', '  // ── Helper: recalculate Daniels').replace('const CORDES_PATTERNS','var CORDES_PATTERNS'), ctxB);
const mini = { effectif: '3.3.3.3 - 4.3.3.1 - 1.7.2.1 [Cel/Pno] - 16.14.12.10.8', sansChef: false, orchestre: sym, percus: [{ nom: 'Timbalier', items: [] }, ...Array.from({ length: 7 }, (_, i) => ({ nom: 'Percu ' + (i + 1), items: [] }))], mobilier: null };
const r = vm.runInContext('recalcDaniels', ctxB)(mini);
T('B1 recalcDaniels remplace la nomenclature lue sur le plan par une version recalculée (App.jsx:1472-1477)', r.effectif !== mini.effectif, `avant="${mini.effectif}"  après="${r.effectif}"`);
const noTimb = vm.runInContext('calculateDanielsNotation', ctxB)({ bois: [], cuivres: [], cordes: [], autres: ['1 Timbalier'] }, [{ nom: 'Percu 1', items: [] }]);
T('B2 un timbalier déclaré dans orchestre.autres est annulé (0) dès qu\'un pôle percu existe sans pôle timbalier (App.jsx:1137)', /0\.1\.0\.0/.test(noTimb), `notation="${noTimb}"`);
// B3 autocomplétion cordes
const ac = vm.runInContext('applyCordesAutoComplete', ctxB)(['8 Violons I', '6 Violons II', '4 Altos', '3 Violoncelles', '2 Contrebasses'], 8);
T('B3 renommer le V1 écrase les autres cordes saisies (offset fixe -2) (App.jsx:1455-1470)', ac.join('|') !== '8 Violons I|6 Violons II|4 Altos|3 Violoncelles|2 Contrebasses', ac.join(' | '));

console.log('\n=== C. Décodeur Daniels (pdfParser.js) ===');
const ctxC = { console };
vm.createContext(ctxC);
vm.runInContext(slice(parser, '// French pluralization', '// IMAGE EXTRACTION').replace(/export /g, ''), ctxC);
const dec = (s) => vm.runInContext('decodeEffectif', ctxC)(s);
const orc = (d) => vm.runInContext('orchestreFromEffectif', ctxC)(d);
let d = dec('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8');
T('C1 symphonique : timbales 1, percus 3, harpes 2, claviers 1, cordes 16/14/12/10/8', d && d.percussions.Timbales === 1 && d.percussions.Percussion === 3 && d.percussions.Harpe === 2 && d.percussions.Clavier === 1 && d.cordes.Contrebasse === 8);
const o = orc(d);
T('C2 orchestreFromEffectif ne conserve ni timbaliers ni percussionnistes (pôles à créer ailleurs)', !JSON.stringify(o).match(/timbal|percuss/i), JSON.stringify(o.autres));
d = dec('2.2.2.2/4.2.3.1/1.3.2.1 [Cel/Pno]/16.14.12.10.8');
d = dec('0-1-0-1 / 0-2-0-0 / 1-0-0-2');
d = dec('3.3.3.3 - 4.3.3.1 - 2 timb. 7 percs - 2 harpes - cél/orgue');
T('C5 cartouche "Die Frau" en clair (mots) : non décodé (null)', d === null);
d = dec('2(pic).2(eh).2(bcl).2(cbn) - 4.2.3.1 - 1.2 - 8.6.4.4.2');
T('C6 doublures (pic)(eh) : notation de forme parenthèse', !!d, d ? JSON.stringify(d.bois) : 'null');
d = dec('2.2.2.2 - 2.2.0.0 - 1 - 6.4.3.3.2');
T('C7 groupe percussions à 1 chiffre', !!d, d ? JSON.stringify(d.percussions) : 'null');

d = dec('2.2.2.2 / 4.2.3.1 / 1.3.2.1 [Cel/Pno] / 16.14.12.10.8');
T('C3b exemple du prompt (Mahler) "… / 1.3.2.1 [Cel/Pno] / 16.14.12.10.8" : le "/" dans les crochets casse le découpage, cordes perdues', d && (!d.cordes || Object.keys(d.cordes).length === 0), d ? 'cordes=' + JSON.stringify(d.cordes) + ' perc=' + JSON.stringify(d.percussions) : 'null');
d = dec('1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1');
T('C8 exemple du commentaire du code "1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1" : cordes mal décodées (pdfParser.js:1255-1262)', d && !(d.cordes && d.cordes['Contrebasse'] === 1), d ? 'cordes=' + JSON.stringify(d.cordes) + ' perc=' + JSON.stringify(d.percussions) : 'null');
d = dec('3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8');
T('C9 contrôle : notation à points et tirets simple correcte (cordes 5 pupitres)', d && Object.keys(d.cordes).length === 5);
d = dec('3.3.3.3/4.3.3.1 - 14.12.10.8.6');
T('C10 exemple "mixte" du commentaire : 3 groupes sans percussions -> les cordes sont lues comme percussions', d && d.cordes === null, d ? 'perc=' + JSON.stringify(d.percussions) : 'null');
d = dec('0-1-0-1 / 0-2-0-0 / 1-0-0-2');
T('C4b baroque "0-1-0-1 / 0-2-0-0 / 1-0-0-2" (Ex1 du prompt) : découpage en 4 groupes erroné ("1" puis "0-0-2")', d && d.percussions && d.percussions.Timbales === 1 && !d.percussions.Clavier, JSON.stringify(d && {perc: d.percussions, cordes: d.cordes}));

console.log('\n=== D. Chaîne d\'import : enrichWithAi / handleAddPlan (App.jsx) ===');
const ctxD = { console, alert() {}, isOffline: () => false, decodeEffectif: () => null, extractWithGemini: async () => ({ percus: [], orchestre: null, sansChef: false }) };
vm.createContext(ctxD);
vm.runInContext(slice(app, '  async function enrichWithAi(', '  function extractNum('), ctxD);
const out = await ctxD.enrichWithAi({ planDataUrls: ['x'], percus: [{ nom: 'Percu local erroné', items: [{ nom: 'Triangle' }] }], orchestre: { bois: ['9 Flûtes'], cuivres: [], cordes: [], autres: [] } });
T('D1 IA = [] (abstention) remplacée par la liste locale (App.jsx:2007-2008)', out.percus.length === 1 && out.orchestre.bois[0] === '9 Flûtes');
ctxD.extractWithGemini = async () => { throw new Error('boom'); };
const out2 = await ctxD.enrichWithAi({ planDataUrls: ['x'], percus: [{ nom: 'L', items: [] }] });
T('D2 échec de l\'IA : retour silencieux au local, aucune alerte (App.jsx:2010-2012)', out2.percus.length === 1);
T('D3 handleAddPlan(PDF) ne garde que la page 1 (App.jsx:1923-1925)', /isPdf\)\s*\{\s*const data = await extractFromPdf\(file\);\s*planDataUrl = data\.planDataUrl;/.test(app));
T('D4 import : mobilier calculé seulement si data.orchestre (App.jsx:1888)', /mobilier: data\.orchestre \? calculateMobilier/.test(app));
const rx = /handleAiExtract[\s\S]*?setMergeData/.exec(app)[0];
T('D5 handleAiExtract ne recalcule ni Daniels ni mobilier après remplissage', !/recalcDaniels|calculateMobilier|effectifDetail/.test(rx));
T('D6 handleAiExtract ne renseigne jamais sansChef', !/sansChef/.test(rx));
const chefLines = app.split('\n').filter(l => /sansChef/.test(l)).map(l => l.trim());
T('D7 aucune commande d\'interface ne fixe sansChef : lignes concernées = calculs et import IA seulement', chefLines.every(l => /calculateMobilier|aiData|localData|\/\/|const \{|hasChef/.test(l)) && !chefLines.some(l => /onChange|onClick|setSansChef/.test(l)), chefLines.length + ' lignes');
T('D8 boutons "Garder" et "Ignorer" désactivés (App.jsx:2302, 2359)', /<button style=\{btnChoice\} disabled>Garder<\/button>/.test(app) && /<button style=\{btnChoice\} disabled>Ignorer<\/button>/.test(app));
const tb = parser.indexOf('nom: "4 Timbales"');
T('D9 "4 Timbales" codé en dur (pdfParser.js:1820)', tb > 0, 'ligne ' + parser.slice(0, tb).split('\n').length);

console.log('\n=== E. Passerelle /api/extract-ai (handler réel, fetch simulé) ===');
process.env.AUTH_SECRET = 'test-only-secret'; process.env.ALLOWED_EMAILS = 'test@example.invalid'; process.env.DEEPSEEK_API_KEY = 'dummy-not-a-key';
const auth = await import(pathToFileURL(REPO + 'api/auth-utils.js').href);
const ck = auth.createSession('test@example.invalid').split(';')[0];
const handler = (await import(pathToFileURL(REPO + 'api/extract-ai.js').href)).default;
async function call(images, modelText, extra = {}) {
  let sent = null;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof modelText === 'string' ? modelText : JSON.stringify(modelText) } }] }), text: async () => '' }; };
  let status = 0, body = null;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await handler({ method: 'POST', headers: { cookie: ck }, body: { images, mode: 'concert' } }, res);
  return { status, body, sent };
}
const img = 'data:image/jpeg;base64,AAAA';
let c = await call(Array(12).fill(img), { titre: 'x', percus: [] });
T('E1 12 pages envoyées : 8 transmises + légende, 4 pages perdues sans avertissement (extract-ai.js:41)', c.sent.messages[0].content.filter(p => p.type === 'image_url').length === 9 && c.body.meta === undefined);
T('E2 sansChef=true quand le modèle ne parle pas du chef (extract-ai.js:185)', c.body.sansChef === true);
c = await call([img], { titre: 'x', chef: 'Un Chef', percus: [{ items: [{ nom: 'Triangle' }] }] });
T('E3 pôle sans nom -> "Percu", objet sans catégorie -> "Accessoires" (valeurs par défaut présentées comme lues)', c.body.percus[0].nom === 'Percu' && c.body.percus[0].items[0].cat === 'Accessoires' && c.body.sansChef === false);
c = await call([img], '{"titre":"T","percus":[{"nom":"Timbalier","items":[{"cat":"Timbales & Peaux","nom":"Timbale 1"},{"cat":"Claviers","nom":"Vib');
T('E4a JSON tronqué dans un tableau imbriqué : la "réparation" ferme ] puis } dans le mauvais ordre -> échec 500 (extract-ai.js:158-173)', c.status === 500, 'status=' + c.status);
c = await call([img], '{"titre":"T","chef":"X","percus":[{"nom":"Timbalier","items":[{"cat":"Timbales & Peaux","nom":"Timbale 1"}]},{"nom":"Percu 1","items":[]}],"compositeur":"Mah');
T('E4b JSON tronqué en queue d\'objet : réparé et renvoyé en 200 sans indicateur ni drapeau "tronqué"', c.status === 200 && c.body.meta === undefined && c.body.compositeur === 'Mah', 'status=' + c.status + ' compositeur=' + (c.body && c.body.compositeur));
c = await call([img], { titre: 'x', percus: 'oops' });
T('E5 percus de type inattendu : erreur 500 (pas de validation)', c.status === 500, 'status=' + c.status);
c = await call([img], { titre: 'x', orchestre: { bois: ['2 Flûtes'], continuo: ['Clavecin'], cordes: 'oops' } });
T('E6 orchestre transmis tel quel : "continuo" produit par le prompt mais jamais lu par l\'UI ; cordes non-liste accepté', c.status === 200 && c.body.orchestre.continuo && typeof c.body.orchestre.cordes === 'string' && !/continuo/.test(app));
T('E7 schéma de sortie sans quantité, position, confiance, source, mobilier (items = {cat, nom})', !/qte|quantite|position|confiance/.test(slice(rd('api/extract-ai.js'), 'percus: (parsed.percus', '  } catch (err)')));

console.log('\n=== F. Synchro multi-appareils (useStorage.js) ===');
const ctxF = { console };
vm.createContext(ctxF);
vm.runInContext(slice(store, 'function normalizeEmail', 'function photosKey').replace('const ALEX_EMAIL', 'var ALEX_EMAIL') , ctxF);
vm.runInContext('var ALEX_EMAIL="test@example.invalid";' + slice(store, 'function mergeConcerts', 'function remoteConcertPayload') + slice(store, 'function mergePhotoGroups', 'function withTimeout'), ctxF);
const remote = [{ id: 'c1', titre: 'Concert', pieces: [{ id: 'a' }, { id: 'b', titre: 'ajoutée sur le téléphone' }], archived: true }];
const local = [{ id: 'c1', titre: 'Concert', pieces: [{ id: 'a' }] }];
const mg = ctxF.mergeConcerts(local, remote, 'test@example.invalid')[0];
T('F1 fusion au niveau du concert : une pièce ajoutée ailleurs disparaît si le local est en retard (useStorage.js:74-85)', mg.pieces.length === 1);
T('F1b mais un champ présent seulement côté serveur (archived) survit : fusion incohérente selon les champs', mg.archived === true);
const ph = ctxF.mergePhotoGroups({ p1: [{ id: '1' }] }, { p1: [{ id: '1' }, { id: '2' }] });
T('F2 photos : union sans suppression -> une photo supprimée localement revient du serveur', ph.p1.length === 2);
T('F3 supprimer un concert/pièce ne purge pas ses photos (setPhotos appelé seulement par addPhoto/deletePhoto)', (app.match(/setPhotos\(/g) || []).length === 2);
T('F4 aucun champ de version de schéma dans les concerts (grep schemaVersion/version dans App/useStorage)', !/schemaVersion|dataVersion/.test(app + store));

console.log('\n=== G. Base R&S / Kolberg (docs/) ===');
const csv = (f) => { const L = rd('docs/' + f).trim().split('\n'); const h = L[0].split(','); return L.slice(1).map(l => { const cells = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; } cells.push(cur); return Object.fromEntries(h.map((k, i) => [k, cells[i]])); }); };
const rsAll = csv('RS_CATALOGUE_COMPLET.csv');
const smap = rsAll.filter(x => x.Reference.startsWith('SMAP-')).length;
T('G1 refs R&S fictives "SMAP-" (sitemap seul, pas de vraie référence)', smap > 0, `${smap}/${rsAll.length}`);
const ko = csv('KOLBERG_CATALOGUE_REFERENCE.csv');
const cnt = {}; ko.forEach(r => cnt[r.Reference] = (cnt[r.Reference] || 0) + 1);
T('G2 références Kolberg non uniques (deux produits pour 134-1, 136-1, 1325K, 2110KS)', Object.values(cnt).some(v => v > 1), Object.entries(cnt).filter(([, v]) => v > 1).map(([k]) => k).join(','));
T('G3 aucun code ne lit docs/*.csv ni LOOKUP_*.json', !/LOOKUP_|RS_CATALOGUE|KOLBERG_CAT|RS_KOLBERG/.test(app + parser + rd('src/utils.js') + store + rd('api/extract-ai.js') + rd('vite.config.js')));
const sie = rsAll.filter(x => x.Reference.startsWith('SIE '));
T('G4 chaises R&S exploitables par type (SIE, sous-catégorie)', sie.length >= 30, `${sie.length} SIE ; sous-catégories=${[...new Set(sie.map(x => x.Sous_Categorie))].join('/')}`);
const rsNames = rsAll.filter(x => /^(Chaises)/.test(x.Categorie)).map(x => x.Categorie + '/' + x.Sous_Categorie);
T('G5 deux taxonomies parallèles pour les mêmes chaises (Chaises vs Chaises-Musiciens)', new Set(rsNames).size > 8, [...new Set(rsNames)].length + ' couples');

console.log('\n=== H. Tessitures (docs) ===');
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = (s) => { const m = /^([A-G])(#|b)?(\d)$/.exec(s.trim()); if (!m) return null; return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
const rows = [];
for (const [file] of [['TESSITURE_PERCUSSION.md']]) for (const l of rd('docs/' + file).split('\n')) { const c = l.split('|').map(s => s.trim()); const m = /^(\d(?:[.,]\d)?|\d[⅓½]|[0-9]+⅓|[0-9]+½)\s*oct/.exec(c[2] || ''); const rg = /^([A-G][#b]?\d)\s*[–-]\s*([A-G][#b]?\d)/.exec(c[3] || ''); if (rg && c[1] && /oct|Concert|Opera|pédale|valise/i.test(c[1] + c[2])) rows.push({ nom: c[1] + ' ' + c[2], lo: midi(rg[1]), hi: midi(rg[2]), lab: c[2] }); }
const refSrc = rd('docs/EXTRACTION_IA_REFERENCE.md');
const glock1 = /Glockenspiel pédale\*\* \| 3 oct \| (\S+) – (\S+)/.exec(refSrc);
const glock2 = /Glockenspiel pédale Concert\*\* \| 3 oct \| (\S+) – (\S+)/.exec(rd('docs/TESSITURE_PERCUSSION.md'));
T('H1 glockenspiel pédale 3 oct : deux plages différentes dans les deux documents', glock1 && glock2 && (glock1[1] + glock1[2]) !== (glock2[1] + glock2[2]), `EXTRACTION_IA_REFERENCE=${glock1 && glock1[1] + '-' + glock1[2]}  TESSITURE_PERCUSSION=${glock2 && glock2[1] + '-' + glock2[2]}`);
const tim = rd('docs/TESSITURE_PERCUSSION.md');
const t28 = /\| 28" \| (\S+ – \S+)/.exec(tim)[1], t29 = /\| 29" \| (\S+ – \S+)/.exec(tim)[1];
T('H2 timbales 28" et 29" : même plage (à confirmer au poster Kolberg)', t28 === t29, t28);
const lab = (r) => { const n = parseFloat(r.lab.replace(',', '.')) || 0; const frac = /⅓/.test(r.lab) ? 1 / 3 : /½/.test(r.lab) ? .5 : 0; return n + frac; };
const bad = rows.filter(r => r.lo != null && r.hi != null && Math.abs((r.hi - r.lo) / 12 - lab(r)) > 0.35).map(r => `${r.nom.trim()} : étiquette ${lab(r)} oct, plage ${((r.hi - r.lo) / 12).toFixed(2)} oct`);
T('H3 étiquettes d\'octaves cohérentes avec les plages (tolérance 0,35)', bad.length === 0, bad.join(' ; ') || `${rows.length} lignes contrôlées`);
T('H4 aucune tessiture utilisée par le code (phase 4 non commencée)', !/tessitur/i.test(app + parser + rd('src/utils.js')));

console.log(`\nRésultat: ${pass} confirmés, ${fail} infirmés`);
