// LOT 6 : les images des plans rangées À PART sur le téléphone (magasin IndexedDB « images »).
// Le VRAI useConcerts (hooks et IndexedDB en mémoire, tests/support/lot3-*.mjs) ; pour la synchro, les VRAIES
// routes api/sync.js et api/plan-image.js sur le faux Supabase (tests/support/lot5-world.mjs).
// Aucun appel réseau réel. Lancer : node --test tests/lot6-images-locales.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, world, renderHook, unmountAll, EMAIL, sleep, owned, reset, freshStorage, waitFor, imp } from "./support/lot3-env.mjs";
import { MO, image, sha, ref, piece, pendingKey, setupWorld, seedLocal, idbConcert, posts, surTel } from "./support/lot5-world.mjs";

test.afterEach(() => unmountAll());

const BACKUP_KEY = `orkmap-concerts-backup:${EMAIL}`;
const idbList = () => Array.from(world.stores.concerts.values());
const hasInline = (value) => JSON.stringify(value).includes("data:image/");
const refsIn = (value) => Array.from(JSON.stringify(value).matchAll(/"orkimg:([0-9a-f]{64})"/g), (m) => m[1]);

// Hors ligne, sans aucun serveur : tout appel réseau est compté (et échoue).
function offlineWorld() {
  reset();
  navigator.onLine = false;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); throw new TypeError("Failed to fetch"); };
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  return { calls, restore: () => { console.warn = quiet.warn; console.error = quiet.error; } };
}

// INVARIANT « aucune image perdue » : chaque référence d'un concert rangé sur le téléphone a son image dans le
// magasin local (empreinte vérifiée), OU est une image du compte pas encore téléchargée (`accountHashes`).
function assertNoOrphanRef(accountHashes = new Set(), label = "") {
  for (const concert of idbList()) {
    for (const hash of refsIn(concert)) {
      const img = world.stores.images.get(hash);
      const local = typeof img === "string" && sha(img) === hash;
      assert.ok(local || accountHashes.has(hash), `${label} concert ${concert.id} : référence ${hash.slice(0, 8)} sans image`);
    }
  }
}

// Ce que le téléphone affiche pour chaque concert (références remplacées par l'image du magasin).
function shown(concert) {
  return concert.pieces.map((p) => ({ plans: surTel(p.plans), planDataUrl: surTel([p.planDataUrl])[0] }));
}

function ancienFormat() {
  const a = image(); const b = image(); const c = image(); const logo = image(5000);
  const list = [
    owned("c1", { titre: "Concert 1", pieces: [piece("p1", [a, b])] }),
    owned("c2", { titre: "Concert 2", logo, pieces: [piece("p2", [c, a]), piece("p3", [])] }),
  ];
  return { a, b, c, logo, list };
}

async function open(m) {
  const h = renderHook(m.useConcerts, [[], EMAIL]);
  await waitFor(() => h.result[2], 4000, "chargement");
  return h;
}

const migrated = () => idbList().length > 0 && !hasInline(idbList());

// ───────────── Migration ─────────────

test("migration : images rangées, relues, vérifiées, puis concerts réécrits avec références ; rien en réseau", async () => {
  const w = offlineWorld();
  try {
    const { a, b, c, logo, list } = ancienFormat();
    seedLocal(list);
    const avant = list.map(shown);
    const m = await freshStorage();
    const h = await open(m);
    await waitFor(migrated, 4000, "migration");
    assert.deepEqual(new Set(world.stores.images.keys()), new Set([a, b, c, logo].map(sha)), "4 images distinctes, chacune une fois");
    for (const [hash, img] of world.stores.images) assert.equal(sha(img), hash, "valeur = data URL, clé = son empreinte");
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [ref(a), ref(b)]);
    assert.equal(idbConcert("c1").pieces[0].planDataUrl, ref(b));
    assert.equal(idbConcert("c2").logo, ref(logo), "toute image du concert, pas seulement les plans");
    assert.deepEqual(idbList().map(shown), avant, "le téléphone affiche exactement les mêmes images");
    await waitFor(() => !hasInline(h.result[0]), 2000, "liste en mémoire allégée");
    assert.deepEqual(h.result[0].map(shown), avant);
    assertNoOrphanRef();
    assert.equal(w.calls.length, 0, "aucun appel réseau");
  } finally { w.restore(); }
});

test("migration : l'affichage n'attend pas le rangement des images", async () => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    seedLocal(list);
    let release;
    const held = new Promise((r) => { release = r; });
    world.hold = (op, store) => (op === "put" && store === "images" ? held : null);
    const m = await freshStorage();
    const h = await open(m);
    assert.equal(h.result[0].length, 2, "les concerts sont affichés");
    assert.equal(world.stores.images.size, 0, "alors qu'aucune image n'est encore rangée");
    assert.ok(hasInline(idbList()), "et que les concerts sont encore à l'ancien format");
    world.hold = null;
    release();
    await waitFor(migrated, 4000, "migration terminée ensuite");
    assertNoOrphanRef();
  } finally { w.restore(); }
});

test("migration : une écriture refusée (place) laisse CE concert tel quel ; reprise au lancement suivant", async () => {
  const w = offlineWorld();
  try {
    const { a, b, c, list } = ancienFormat();
    seedLocal(list);
    world.onOp = (op, store, key) => {
      if (op === "put" && store === "images" && key === sha(c)) {
        const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e;
      }
    };
    const m = await freshStorage();
    const h = await open(m);
    await waitFor(() => !hasInline(idbConcert("c1")), 4000, "c1 rangé");
    await sleep(200);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [ref(a), ref(b)]);
    assert.deepEqual(idbConcert("c2").pieces[0].plans, [c, a], "c2 garde ses images (tout ou rien par concert)");
    assert.ok(!world.stores.images.has(sha(c)));
    assert.deepEqual(h.result[0].find((x) => x.id === "c2").pieces[0].plans, [c, a]);
    assertNoOrphanRef();
    unmountAll();
    world.onOp = null;
    const m2 = await freshStorage();
    await open(m2);
    await waitFor(migrated, 4000, "reprise");
    assert.deepEqual(idbConcert("c2").pieces[0].plans, [ref(c), ref(a)]);
    assertNoOrphanRef();
  } finally { w.restore(); }
});

test("migration : une image relue différente (mémoire abîmée) n'est jamais référencée", async () => {
  const w = offlineWorld();
  try {
    const { a, list } = ancienFormat();
    seedLocal(list);
    // Le magasin rend une image tronquée pour a, à la relecture qui suit l'écriture : l'empreinte ne correspond pas.
    let written = false;
    world.onOp = (op, store, key) => {
      if (store !== "images" || key !== sha(a)) return;
      if (op === "put") written = true;
      if (op === "get" && written) world.stores.images.set(key, a.slice(0, 5000));
    };
    const m = await freshStorage();
    await open(m);
    await sleep(400);
    assert.ok(written, "l'écriture de a a bien eu lieu");
    assert.ok(!world.stores.images.has(sha(a)), "l'entrée mal relue est retirée du magasin");
    for (const concert of idbList()) {
      if (JSON.stringify(concert).includes(a.slice(30, 90))) continue; // garde son image a : bien
      assert.ok(!refsIn(concert).includes(sha(a)), `concert ${concert.id} : jamais de référence vers une image mal relue`);
    }
    assert.deepEqual(idbConcert("c1").pieces[0].plans[0], a, "c1 (qui contient a) reste à l'ancien format");
    assertNoOrphanRef();
    // Lancement suivant, mémoire saine : a est rangée et vérifiée, la migration se termine.
    unmountAll();
    world.onOp = null;
    const m2 = await freshStorage();
    await open(m2);
    await waitFor(migrated, 4000, "reprise");
    assert.equal(world.stores.images.get(sha(a)), a);
    assertNoOrphanRef();
  } finally { w.restore(); }
});

test("migration interrompue à CHAQUE opération (application fermée) : jamais d'état incohérent, reprise complète", async (t) => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    const avant = list.map(shown);
    // Passage témoin : nombre d'opérations IndexedDB d'une migration complète.
    seedLocal(list);
    let total = 0;
    world.onOp = () => { total += 1; };
    const m0 = await freshStorage();
    await open(m0);
    await waitFor(migrated, 4000, "migration témoin");
    await sleep(150);
    unmountAll();
    assert.ok(total > 10 && total < 400, `opérations comptées : ${total}`);
    t.diagnostic(`${total} points d'arrêt essayés`);

    for (let k = 1; k <= total; k += 1) {
      reset();
      navigator.onLine = false;
      globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
      seedLocal(structuredClone(list));
      let ops = 0;
      world.onOp = () => { ops += 1; if (ops === k) world.frozen = true; };
      const m = await freshStorage();
      renderHook(m.useConcerts, [[], EMAIL]);
      await waitFor(() => world.frozen || migrated(), 4000, `arrêt à l'opération ${k}`);
      await sleep(30);
      unmountAll();
      // État au moment de la « fermeture brutale » : cohérent, aucune image perdue.
      assertNoOrphanRef(new Set(), `arrêt ${k}/${total} :`);
      assert.deepEqual(idbList().sort((x, y) => x.id.localeCompare(y.id)).map(shown), avant, `arrêt ${k}/${total} : le téléphone afficherait les mêmes plans`);
      // Relance : l'ancienne instance est morte (IndexedDB gelée pour elle, localStorage figé à l'instant de l'arrêt).
      const lsAtKill = new Map(localStorage.map);
      const fresh = Object.create(Object.getPrototypeOf(localStorage));
      fresh.map = lsAtKill;
      globalThis.localStorage = fresh;
      world.frozen = false;
      world.onOp = null;
      const m2 = await freshStorage();
      const h2 = renderHook(m2.useConcerts, [[], EMAIL]);
      await waitFor(() => h2.result[2] && migrated(), 4000, `reprise après arrêt ${k}`);
      assertNoOrphanRef(new Set(), `reprise ${k} :`);
      assert.deepEqual(idbList().sort((x, y) => x.id.localeCompare(y.id)).map(shown), avant, `reprise ${k} : mêmes plans`);
      unmountAll();
    }
  } finally { w.restore(); }
});

test("migration idempotente : un second lancement ne réécrit ni image ni concert", async () => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    seedLocal(list);
    const m = await freshStorage();
    await open(m);
    await waitFor(migrated, 4000, "migration");
    await sleep(150);
    unmountAll();
    const before = structuredClone(idbList());
    const writes = [];
    world.onOp = (op, store, key) => { if (op === "put" || op === "delete") writes.push(`${op}:${store}:${key}`); };
    const m2 = await freshStorage();
    await open(m2);
    await sleep(300);
    assert.deepEqual(writes.filter((x) => !x.startsWith("put:photos")), [], "aucune écriture d'image ni de concert");
    assert.deepEqual(idbList(), before);
  } finally { w.restore(); }
});

test("taille : 20 Mo de concerts (19,8 Mo d'images) deviennent moins de 300 Ko ; copie de secours possible et sans image", async () => {
  const w = offlineWorld();
  try {
    const images = Array.from({ length: 10 }, () => image(0.99 * MO));
    const concerts = [];
    for (let i = 0; i < 40; i += 1) {
      const pieces = [piece(`p${i}`, i < 10 ? [images[i]] : [], { notes: "x".repeat(4000), percus: Array.from({ length: 6 }, (_, k) => ({ id: `r${i}-${k}`, nom: `Poste ${k}`, items: [] })) })];
      concerts.push(owned(`c${i}`, { pieces }));
    }
    const avant = Buffer.byteLength(JSON.stringify(concerts));
    assert.ok(avant > 19.9 * MO, `départ ${avant}`);
    seedLocal(concerts);
    // Comme sur le téléphone : la copie de secours de 20 Mo ne tient pas dans localStorage (~5 Mo).
    const ls = localStorage;
    const setItem = ls.setItem.bind(ls);
    ls.setItem = (k, v) => {
      if (String(v).length > 5 * MO) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      setItem(k, v);
    };
    const m = await freshStorage();
    await open(m);
    await waitFor(migrated, 15000, "migration");
    await waitFor(() => (localStorage.getItem(BACKUP_KEY) || "").length > 0 && !hasInline(JSON.parse(localStorage.getItem(BACKUP_KEY))), 4000, "copie de secours");
    const apres = Buffer.byteLength(JSON.stringify(idbList()));
    assert.ok(apres < 300 * 1024, `concerts sur le téléphone après rangement : ${apres} octets`);
    const backup = localStorage.getItem(BACKUP_KEY);
    assert.ok(backup.length < 300 * 1024, `copie de secours : ${backup.length} caractères`);
    assert.equal(JSON.parse(backup).length, 40, "la copie de secours contient tous les concerts");
    assert.ok(!backup.includes("data:image/"), "et aucune image");
    assert.equal(m.readSyncStatus().backupFailed, false, "plus d'alerte « copie de secours impossible »");
    assert.equal(world.stores.images.size, 10);
  } finally { w.restore(); }
});

test("nouveau plan importé dans l'app : image rangée avant l'écriture du concert, la liste en mémoire reste légère", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { pieces: [piece("p1", [])] })]);
    const m = await freshStorage();
    const h = await open(m);
    const plan = image();
    h.result[1]((list) => list.map((c) => ({ ...c, pieces: c.pieces.map((p) => ({ ...p, plans: [plan], planDataUrl: plan })) })));
    await waitFor(() => refsIn(idbConcert("c1")).length === 2, 4000, "concert écrit avec la référence");
    assert.equal(world.stores.images.get(sha(plan)), plan);
    assert.ok(!hasInline(idbList()), "jamais l'image dans le concert sur le téléphone");
    await waitFor(() => !hasInline(h.result[0]), 2000, "liste en mémoire allégée");
    assert.ok(!hasInline(JSON.parse(localStorage.getItem(BACKUP_KEY))), "copie de secours sans image");
    assertNoOrphanRef();
  } finally { w.restore(); }
});

// ───────────── Affichage par empreinte ─────────────

test("affichage : image lue dans le magasin hors ligne, cache mémoire, cadre si absente, data URL rendu tel quel", async () => {
  const w = offlineWorld();
  try {
    const { a, b, list } = ancienFormat();
    seedLocal(list);
    const m = await freshStorage();
    await open(m);
    await waitFor(migrated, 4000, "migration");
    let reads = 0;
    world.onOp = (op, store) => { if (op === "get" && store === "images") reads += 1; };
    assert.equal(await m.loadPlanImage(ref(a)), a);
    const first = reads;
    assert.equal(await m.loadPlanImage(ref(a)), a);
    assert.equal(reads, first, "deuxième affichage : cache mémoire, pas de lecture");
    assert.equal(await m.loadPlanImage(b), b, "plan tout juste importé (data URL) : rendu tel quel");
    const absente = ref(image());
    assert.equal(await m.loadPlanImage(absente), null, "hors ligne, image jamais téléchargée : cadre « Plan non disponible »");
    assert.equal(await m.loadPlanImage(`orkimg-local:${sha(a)}`), a, "« orkimg-local: » d'une image de ce téléphone : affichée");
    assert.deepEqual(await m.loadPlanImages([ref(a), absente, b]), [a, b], "lecture IA : les vraies images disponibles");
    assert.equal(w.calls.length, 0, "aucun appel réseau hors ligne");
  } finally { w.restore(); }
});

test("affichage : cache mémoire limité (nombre et taille)", async () => {
  const { createImageCache } = await imp("src/localImages.js");
  const cache = createImageCache({ maxEntries: 2, maxChars: 100 });
  cache.set("a", "x".repeat(10)); cache.set("b", "x".repeat(10));
  cache.get("a");
  cache.set("c", "x".repeat(10));
  assert.equal(cache.get("b"), undefined, "la moins récemment utilisée part");
  assert.ok(cache.get("a") && cache.get("c"));
  cache.set("d", "x".repeat(95));
  assert.equal(cache.size, 1, "taille plafonnée");
  assert.ok(cache.chars <= 100);
});

test("affichage : référence d'une copie réduite → l'original du téléphone (table copie → original)", async () => {
  const w = offlineWorld();
  try {
    const original = image(); const copie = image();
    world.stores.images.set(sha(original), original);
    world.stores.photos.set(`orkmap-image-registry:${EMAIL}`, { variants: { [sha(original)]: sha(copie) }, rejected: {}, retry: {} });
    seedLocal([owned("c1", { pieces: [piece("p1", [ref(copie)])] })]);
    const m = await freshStorage();
    await open(m);
    assert.equal(await m.loadPlanImage(ref(copie)), original);
    const snap = await m.buildLocalSnapshot(null, { email: EMAIL });
    assert.deepEqual(snap.concerts[0].pieces[0].plans, [original], "export : l'original");
  } finally { w.restore(); }
});

test("garde-fou : l'écran passe par PlanImage, la lecture IA par loadPlanImages (plus de <img src={planUrl}>)", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
  assert.match(app, /<PlanImage\s/);
  assert.ok(!/src=\{planUrl\}/.test(app), "aucun affichage direct d'une valeur de plans[]");
  assert.match(app, /await loadPlanImages\(targetPiece\.plans\)/);
  assert.ok(!/isAnyImageRef/.test(app), "plus de tri « référence / image » à la main dans App.jsx");
});

// ───────────── Export et import ─────────────

test("export « toutes mes données » : fichier autonome avec les vraies images (identique à l'ancien format)", async () => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    const absente = image();
    list.push(owned("c3", { pieces: [piece("p9", [ref(absente)])] })); // plan du compte jamais téléchargé
    seedLocal(list);
    const m = await freshStorage();
    await open(m);
    await waitFor(() => !hasInline(idbList()), 4000, "migration");
    const files = [];
    const info = await m.exportLocalDataToFile({ email: EMAIL, download: (name, text) => files.push(text) });
    const snap = JSON.parse(files[0]);
    const byId = (arr) => Object.fromEntries(arr.map((c) => [c.id, c]));
    assert.deepEqual(byId(snap.concerts), byId(list), "les concerts exportés sont ceux d'avant le rangement, images comprises");
    assert.equal(snap.plansNonInclus, 1);
    assert.equal(info.plansNonInclus, 1);
    const { exportReportText } = await imp("src/syncUi.js");
    assert.match(exportReportText(info), /1 plan n'est pas sur ce téléphone/);
    assert.ok(!files[0].includes(`orkimg:${sha(list[0].pieces[0].plans[0])}`), "aucune référence pour une image présente");
  } finally { w.restore(); }
});

test("import d'une ancienne sauvegarde (images dans les concerts) : réimportable, images rangées, réexport identique", async () => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    // Fichier exporté AVANT le lot 6 : format actuel, images dans les concerts.
    const oldFile = JSON.stringify({ kind: "orkmap-local-export", version: 1, dbVersion: 4, concerts: list, photos: [], omrScores: [] });
    const m = await freshStorage();
    const h = await open(m);
    const imported = JSON.parse(oldFile).concerts;
    h.result[1]((prev) => [...prev, ...imported]);
    await waitFor(() => idbList().length === 2 && !hasInline(idbList()), 4000, "import rangé");
    assert.deepEqual(idbList().map(shown), list.map(shown), "les plans importés s'affichent");
    assertNoOrphanRef();
    const files = [];
    await m.exportLocalDataToFile({ email: EMAIL, download: (name, text) => files.push(text) });
    const again = JSON.parse(files[0]).concerts.sort((x, y) => x.id.localeCompare(y.id));
    assert.deepEqual(again, list, "réexport : le même fichier de concerts qu'à l'origine");
  } finally { w.restore(); }
});

// ───────────── Synchro (lot 5) avec le magasin local ─────────────

test("envoi depuis le magasin : les images partent lues dans le magasin local, puis les concerts ; le téléphone garde les références", async () => {
  const w = await setupWorld();
  try {
    const { a, b, c, logo, list } = ancienFormat();
    seedLocal(list);
    navigator.onLine = false;
    const m = await freshStorage();
    await open(m);
    await waitFor(migrated, 4000, "migration hors ligne");
    assert.equal(w.log.length, 0);
    localStorage.setItem(pendingKey, JSON.stringify({ rev: 1, removedIds: [] }));
    navigator.onLine = true;
    m.requestSyncRetry();
    await waitFor(() => w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    const sent = posts(w.log, "/api/plan-image");
    assert.deepEqual(new Set(sent.map((e) => e.hash)), new Set([a, b, c, logo].map(sha)));
    for (const e of sent) assert.equal(sha(e.body.dataUrl), e.hash, "la vraie image, lue dans le magasin");
    const order = w.log.filter((e) => e.method === "POST").map((e) => (e.body?.have ? "have" : e.path));
    assert.equal(order[0], "have");
    assert.equal(order[order.length - 1], "/api/sync", "images d'abord, concerts ensuite");
    assert.ok(!hasInline(w.serverConcerts()));
    assert.deepEqual(w.serverConcerts().find((x) => x.id === "c1").pieces[0].plans, [ref(a), ref(b)]);
    assert.ok(!hasInline(idbList()), "le téléphone garde les références");
  } finally { w.restore(); }
});

test("envoi depuis le magasin : image déjà sur le compte → jamais relue ; refus définitif → dernier recours inchangé", async () => {
  const pi = await imp("src/planImages.js");
  const a = image(); const b = image(); const c = image();
  const store = new Map([[sha(a), a], [sha(b), b], [sha(c), c]]);
  const reads = [];
  const local = { has: (h) => store.has(h), get: async (h) => { reads.push(h); return store.get(h) ?? null; } };
  const absente = ref(image());
  const data = [{ id: "c1", pieces: [{ id: "p1", plans: [ref(a), ref(b), `orkimg-local:${sha(c)}`, absente] }] }];
  const uploaded = [];
  const out = await pi.prepareConcertsUpload(EMAIL, data, {
    maxBytes: 4 * MO, local,
    check: async () => new Set([sha(a)]),
    upload: async (hash, dataUrl) => {
      uploaded.push(hash);
      if (hash === sha(c)) { const e = new Error("refus"); e.status = 400; throw e; }
      assert.equal(sha(dataUrl), hash);
    },
  });
  assert.ok(!reads.includes(sha(a)), "a est sur le compte : jamais lue dans le magasin");
  assert.deepEqual(uploaded, [sha(b), sha(c)]);
  assert.equal(out[0].pieces[0].plans[0], ref(a));
  assert.equal(out[0].pieces[0].plans[1], ref(b));
  assert.equal(out[0].pieces[0].plans[2], c, "refusée : dans le JSON puisque ça tient (comme au lot 5)");
  assert.equal(out[0].pieces[0].plans[3], absente, "image du compte pas sur ce téléphone : référence telle quelle");
  // Forme sortante calculée sans réseau : la même que celle envoyée.
  const registry = pi.createImageRegistry({ rejected: { [sha(c)]: 1 } });
  assert.deepEqual(await pi.outgoingForm(data, registry, { maxBytes: 4 * MO, local }), out);
});

test("envoi depuis le magasin : image locale trop lourde → copie réduite sous SON empreinte, l'original reste", async () => {
  const pi = await imp("src/planImages.js");
  const grosse = image(4.2 * MO);
  const petite = image(1 * MO);
  pi.setImageShrinker(async () => petite);
  try {
    const local = { has: (h) => h === sha(grosse), get: async () => grosse };
    const registry = pi.createImageRegistry();
    const uploaded = [];
    const out = await pi.prepareConcertsUpload(EMAIL, [{ id: "c1", pieces: [{ id: "p1", plans: [ref(grosse)] }] }], {
      maxBytes: 4 * MO, local, registry, check: async () => new Set(), upload: async (hash, dataUrl) => { uploaded.push([hash, dataUrl.length]); },
    });
    assert.deepEqual(uploaded, [[sha(petite), petite.length]]);
    assert.deepEqual(out[0].pieces[0].plans, [ref(petite)]);
    assert.equal(registry.variantOf(sha(grosse)), sha(petite));
  } finally { pi.setImageShrinker(null); }
});

test("téléchargement vers le magasin (second appareil) : puis hors ligne, rechargement, les plans s'affichent", async () => {
  const w = await setupWorld();
  try {
    const x = image(); const y = image();
    w.setServerConcerts([owned("c1", { pieces: [piece("p1", [ref(x), ref(y)])] })]);
    w.putServerImage(x);
    w.putServerImage(y);
    const m = await freshStorage();
    await open(m);
    await waitFor(() => world.stores.images.has(sha(x)) && world.stores.images.has(sha(y)), 4000, "téléchargement");
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [ref(x), ref(y)], "le concert garde ses références (pas de réécriture lourde)");
    assertNoOrphanRef();
    unmountAll();
    // Salle sans réseau : nouveau lancement.
    navigator.onLine = false;
    w.ctl.offline = true;
    const before = w.log.length;
    const m2 = await freshStorage();
    const h2 = await open(m2);
    assert.deepEqual(await m2.loadPlanImages(h2.result[0][0].pieces[0].plans), [x, y]);
    assert.equal(w.log.length, before, "aucun appel réseau");
  } finally { w.restore(); }
});

test("second appareil hors ligne : plans du compte jamais téléchargés → cadre, rien ne casse ; au retour du réseau ils arrivent", async () => {
  const w = await setupWorld();
  try {
    const x = image();
    w.setServerConcerts([owned("c1", { pieces: [piece("p1", [ref(x)])] })]);
    w.putServerImage(x);
    // La liste arrive du compte, puis le réseau tombe avant le téléchargement des images.
    const routed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const r = await routed(url, init);
      if (String(url).startsWith("/api/sync")) { navigator.onLine = false; w.ctl.offline = true; }
      return r;
    };
    const m = await freshStorage();
    const h = await open(m);
    await sleep(200);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [ref(x)]);
    assertNoOrphanRef(new Set([sha(x)]), "référence d'une image du compte :");
    assert.equal(await m.loadPlanImage(ref(x)), null, "cadre « Plan non disponible hors ligne »");
    unmountAll();
    const m2 = await freshStorage();
    const h2 = await open(m2);
    assert.equal(h2.result[0].length, 1, "relancé hors ligne : le concert s'ouvre");
    assert.equal(await m2.loadPlanImage(ref(x)), null);
    navigator.onLine = true;
    w.ctl.offline = false;
    assert.equal(await m2.loadPlanImage(ref(x)), x, "au retour du réseau, l'image arrive à l'affichage");
    assert.equal(world.stores.images.get(sha(x)), x, "et elle est rangée sur le téléphone");
    void h;
  } finally { w.restore(); }
});

test("mode mémoire lente (dégradé) : aucune migration tant qu'IndexedDB n'a pas été relu", async () => {
  const w = offlineWorld();
  try {
    const { list } = ancienFormat();
    seedLocal(list);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
    world.delay = 600; // au-delà du délai de lecture (400 ms dans les tests) : mode dégradé
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && m.readSyncStatus().degraded, 4000, "mode dégradé");
    assert.equal(world.stores.images.size, 0, "rien n'est rangé en mode dégradé");
    world.delay = 0;
    await waitFor(() => !m.readSyncStatus().degraded, 8000, "relecture réussie");
    await waitFor(migrated, 4000, "migration après la relecture");
    assertNoOrphanRef();
  } finally { w.restore(); }
});

// ───────────── Relecture hostile du lot 6 ─────────────

// B1 : deux enregistrements qui se chevauchent (l'un retenu par le rangement d'une image) : l'ordre
// d'écriture suit l'ordre des modifications. `order` : "apres-liberation" (T3 après la fin de la
// migration retenue, script course-save.mjs de la relecture) ou "avant-liberation" (T3 pendant).
async function courseSave({ online, order }) {
  const w = online ? await setupWorld() : offlineWorld();
  try {
    const a = image();
    world.stores.concerts.set("c1", owned("c1", { titre: "ORIGINE", pieces: [piece("p1", [a])] }));
    const held = [];
    world.hold = (op, store) => (op === "put" && store === "images" ? new Promise((r) => held.push(r)) : null);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => held.length === 1, 4000, "migration retenue");
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "T0" })));
    await waitFor(() => world.stores.concerts.get("c1").titre === "T0", 2000, "S2 : T0 écrit tout de suite malgré la migration retenue");
    if (order === "avant-liberation") {
      h.result[1]((list) => list.map((c) => ({ ...c, titre: "T3" })));
      await waitFor(() => world.stores.concerts.get("c1").titre === "T3", 2000, "T3 écrit");
      world.hold = null;
      for (const r of held) r();
    } else {
      world.hold = null;
      for (const r of held) r();
      await waitFor(() => !hasInline(world.stores.concerts.get("c1")), 3000, "migration écrite");
      assert.equal(world.stores.concerts.get("c1").titre, "T0");
      await waitFor(() => h.result[2], 4000, "chargé");
      h.result[1]((list) => list.map((c) => ({ ...c, titre: "T3" })));
    }
    const done = () => world.stores.concerts.get("c1").titre === "T3" && !hasInline(world.stores.concerts.get("c1"))
      && (!online || (w.serverConcerts()?.[0]?.titre === "T3" && localStorage.getItem(pendingKey) === null));
    await waitFor(done, 6000, "T3 écrit (et envoyé)");
    await sleep(400); // une écriture en retard aurait le temps de passer
    const backup = JSON.parse(localStorage.getItem(BACKUP_KEY));
    assert.equal(world.stores.concerts.get("c1").titre, "T3", "IndexedDB");
    assert.equal(h.result[0][0].titre, "T3", "écran");
    assert.equal(backup[0].titre, "T3", "copie de secours");
    if (online) assert.equal(w.serverConcerts()[0].titre, "T3", "compte");
    assert.deepEqual(surTel(world.stores.concerts.get("c1").pieces[0].plans), [a]);
    assertNoOrphanRef();
    unmountAll();
    const m2 = await freshStorage();
    const h2 = await open(m2);
    await sleep(online ? 600 : 200);
    assert.equal(h2.result[0][0].titre, "T3", "réouverture");
    assert.equal(world.stores.concerts.get("c1").titre, "T3");
    if (online) assert.equal(w.serverConcerts()[0].titre, "T3");
  } finally { w.restore(); }
}

for (const online of [false, true]) {
  for (const order of ["apres-liberation", "avant-liberation"]) {
    test(`B1 : deux enregistrements qui se chevauchent (${online ? "en ligne" : "hors ligne"}, T3 ${order === "avant-liberation" ? "pendant" : "après"} la migration retenue) : la dernière modification partout`, async () => {
      await courseSave({ online, order });
    });
  }
}

test("B1 : un enregistrement s'exécute avec la liste la plus récente et réunit les suppressions demandées entre-temps", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "un" }), owned("c2", { titre: "deux" }), owned("c3", { titre: "trois" })]);
    const m = await freshStorage();
    const h = await open(m);
    let release;
    const held = new Promise((r) => { release = r; });
    world.hold = (op, store) => (op === "put" && store === "concerts" ? held : null);
    h.result[1]((list) => list.filter((c) => c.id !== "c2").map((c) => (c.id === "c1" ? { ...c, titre: "un modifié" } : c)));
    await sleep(150); // premier enregistrement retenu en pleine écriture
    h.result[1]((list) => list.filter((c) => c.id !== "c3"));
    await sleep(150);
    world.hold = null;
    release();
    await waitFor(() => !world.stores.concerts.has("c2") && !world.stores.concerts.has("c3") && world.stores.concerts.get("c1")?.titre === "un modifié", 3000, "état final");
    await sleep(200);
    assert.deepEqual(Array.from(world.stores.concerts.keys()), ["c1"]);
    assert.deepEqual(JSON.parse(localStorage.getItem(BACKUP_KEY)).map((c) => c.id), ["c1"]);
  } finally { w.restore(); }
});

test("S2 : nouveau plan puis fermeture par Android pendant le rangement : la modification n'est jamais perdue", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "avant", pieces: [piece("p1", [])] })]);
    const m = await freshStorage();
    const h = await open(m);
    const plan = image();
    world.hold = (op, store) => (op === "put" && store === "images" ? new Promise(() => {}) : null); // rangement jamais fini
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "après", pieces: c.pieces.map((p) => ({ ...p, plans: [plan], planDataUrl: plan })) })));
    await waitFor(() => world.stores.concerts.get("c1").titre === "après", 2000, "écrit avant le rangement de l'image");
    assert.deepEqual(world.stores.concerts.get("c1").pieces[0].plans, [plan], "écrit avec son image (pas encore rangée)");
    assert.equal(JSON.parse(localStorage.getItem(BACKUP_KEY))[0].titre, "après", "copie de secours écrite aussi");
    // Android tue l'application ici.
    world.frozen = true;
    unmountAll();
    const ls = new Map(localStorage.map);
    const fresh = Object.create(Object.getPrototypeOf(localStorage)); fresh.map = ls; globalThis.localStorage = fresh;
    world.frozen = false; world.hold = null;
    const m2 = await freshStorage();
    const h2 = await open(m2);
    assert.equal(h2.result[0][0].titre, "après");
    await waitFor(migrated, 4000, "rangement repris");
    assert.deepEqual(surTel(world.stores.concerts.get("c1").pieces[0].plans), [plan]);
    assertNoOrphanRef();
  } finally { w.restore(); }
});

test("S3 : une modification après la migration ne relit ni ne réécrit aucune image ; une seule migration au premier lancement", async () => {
  const w = offlineWorld();
  try {
    const { a, b, c, logo, list } = ancienFormat();
    seedLocal(list);
    const imageOps = [];
    world.onOp = (op, store, key) => { if (store === "images") imageOps.push(`${op}:${key ?? ""}`); };
    const m = await freshStorage();
    const h = await open(m);
    m.requestSyncRetry(); m.requestSyncRetry(); // autres déclencheurs pendant la migration
    await waitFor(migrated, 4000, "migration");
    await sleep(200);
    const puts = imageOps.filter((x) => x.startsWith("put:"));
    assert.equal(puts.length, 4, `une écriture par image, pas de migrations parallèles (${puts.length})`);
    assert.deepEqual(new Set(puts.map((x) => x.slice(4))), new Set([a, b, c, logo].map(sha)));
    imageOps.length = 0;
    for (let i = 0; i < 3; i += 1) {
      h.result[1]((l) => l.map((x) => ({ ...x, titre: `modif ${i}` })));
      await waitFor(() => world.stores.concerts.get("c1").titre === `modif ${i}`, 2000, "écrit");
    }
    assert.deepEqual(imageOps, [], "aucune lecture ni écriture d'image pour une modification de texte");
    // Nouveau plan sur un concert : seule SA nouvelle image est écrite et vérifiée.
    const neuf = image();
    h.result[1]((l) => l.map((x) => (x.id === "c1" ? { ...x, pieces: x.pieces.map((p) => ({ ...p, plans: [...p.plans, neuf] })) } : x)));
    await waitFor(() => refsIn(world.stores.concerts.get("c1")).includes(sha(neuf)) && migrated(), 3000, "nouveau plan rangé");
    assert.deepEqual(imageOps.filter((x) => x.startsWith("put:")), [`put:${sha(neuf)}`]);
  } finally { w.restore(); }
});

test("S3 : image refusée (place) : nouvel essai seulement après l'attente, pas à chaque enregistrement", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { pieces: [piece("p1", [])] })]);
    let tries = 0;
    let full = true;
    const plan = image();
    world.onOp = (op, store, key) => {
      if (op === "put" && store === "images" && key === sha(plan)) {
        tries += 1;
        if (full) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      }
    };
    const m = await freshStorage();
    const h = await open(m);
    h.result[1]((l) => l.map((x) => ({ ...x, pieces: x.pieces.map((p) => ({ ...p, plans: [plan] })) })));
    await waitFor(() => tries === 1, 2000, "premier essai");
    for (let i = 0; i < 4; i += 1) {
      h.result[1]((l) => l.map((x) => ({ ...x, titre: `t${i}` })));
      await waitFor(() => world.stores.concerts.get("c1").titre === `t${i}`, 2000, "écrit");
    }
    assert.equal(tries, 1, "pas de nouvel essai pendant l'attente (1 min)");
    assert.deepEqual(world.stores.concerts.get("c1").pieces[0].plans, [plan], "le plan reste dans le concert : rien n'est perdu");
    assertNoOrphanRef();
    // Après l'attente : nouvel essai, réussi.
    full = false;
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      h.result[1]((l) => l.map((x) => ({ ...x, titre: "plus tard" })));
      await waitFor(() => world.stores.concerts.get("c1").titre === "plus tard" && migrated(), 3000, "rangé après l'attente");
    } finally { Date.now = realNow; }
    assert.equal(tries, 2);
  } finally { w.restore(); }
});

test("S1 : une seule connexion IndexedDB ; « blocked » → message clair ; « blocking » → écrit ce qui attend, ferme, recharge ; « terminated » → rouverte", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "avant" })]);
    const m = await freshStorage();
    const h = await open(m);
    h.result[1]((l) => l.map((x) => ({ ...x, titre: "x" })));
    await waitFor(() => world.stores.concerts.get("c1").titre === "x", 2000, "écrit");
    assert.equal(world.opens, 1, `une seule ouverture pour toute la session (${world.opens})`);
    const options = world.openOptions;
    assert.equal(typeof options.blocked, "function");
    options.blocked();
    const { bannerInfo } = await imp("src/syncUi.js");
    assert.equal(m.readSyncStatus().upgradeBlocked, true);
    assert.match(bannerInfo(m.readSyncStatus()).text, /Ferme les autres fenêtres OrkMap pour terminer la mise à jour/);
    // Modification en attente (enregistrement différé pas encore parti), puis une autre fenêtre veut monter la base.
    let reloaded = 0;
    m.setPageReloader(() => { reloaded += 1; });
    h.result[1]((l) => l.map((x) => ({ ...x, titre: "juste avant la mise à jour" })));
    options.blocking();
    await waitFor(() => reloaded === 1, 3000, "page rechargée");
    assert.equal(world.stores.concerts.get("c1").titre, "juste avant la mise à jour", "ce qui attendait est écrit avant la fermeture");
    assert.equal(world.closes, 1, "connexion fermée pour laisser monter la nouvelle version");
    // Connexion coupée par le navigateur : la suivante est rouverte.
    const before = world.opens;
    world.openOptions.terminated?.();
    await m.loadPlanImage(ref(image()), { download: false });
    assert.ok(world.opens > before, "rouverte après « terminated » ou « blocking »");
    m.setPageReloader(null);
  } finally { w.restore(); }
});

test("S1 : « Chargement du plan… » jamais sans fin : délai, puis null (cadre avec message)", async () => {
  const w = offlineWorld();
  try {
    const a = image();
    world.stores.images.set(sha(a), a);
    seedLocal([owned("c1", { pieces: [piece("p1", [ref(a)])] })]);
    const m = await freshStorage();
    await open(m);
    world.hold = (op, store) => (op === "get" && store === "images" ? new Promise(() => {}) : null);
    const t0 = Date.now();
    assert.equal(await m.loadPlanImage(ref(a), { timeoutMs: 150 }), null);
    assert.ok(Date.now() - t0 < 1000);
    world.hold = null;
  } finally { w.restore(); }
});

test("export sans adresse : la table copie → original du compte des concerts est utilisée", async () => {
  const w = offlineWorld();
  try {
    const original = image(); const copie = image();
    world.stores.images.set(sha(original), original);
    world.stores.photos.set(`orkmap-image-registry:${EMAIL}`, { variants: { [sha(original)]: sha(copie) }, rejected: {}, retry: {} });
    seedLocal([owned("c1", { pieces: [piece("p1", [ref(copie)])] })]);
    const m = await freshStorage();
    const snap = await m.buildLocalSnapshot(null, {});
    assert.deepEqual(snap.concerts[0].pieces[0].plans, [original]);
    assert.equal(snap.plansNonInclus, 0);
  } finally { w.restore(); }
});

// ───────────── Seconde relecture du lot 6 ─────────────

const backupTitle = () => JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]").find((c) => c.id === "c1")?.titre;

test("A1 : une écriture IndexedDB figée ne fige pas la file : copie de secours et « en attente » tout de suite, la suite reprend la liste la plus récente (relecture6b/file-bloquee.mjs)", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "ORIGINE", pieces: [] })]);
    const m = await freshStorage();
    const h = await open(m);
    await sleep(100);
    let stuck = false;
    world.hold = (op, store) => { if (op === "put" && store === "concerts" && !stuck) { stuck = true; return new Promise(() => {}); } return null; };
    h.result[1]((l) => l.map((c) => ({ ...c, titre: "E1" })));
    await sleep(300);
    assert.equal(world.stores.concerts.get("c1").titre, "ORIGINE", "écriture figée");
    assert.equal(backupTitle(), "E1", "copie de secours écrite tout de suite");
    assert.ok(localStorage.getItem(pendingKey) !== null, "marque « en attente » posée tout de suite");
    world.hold = null;
    h.result[1]((l) => l.map((c) => ({ ...c, titre: "E2" })));
    await sleep(300);
    h.result[1]((l) => l.map((c) => ({ ...c, titre: "E3" })));
    assert.equal(backupTitle(), "E3");
    await waitFor(() => world.stores.concerts.get("c1").titre === "E3", 4000, "la file reprend après le délai de l'écriture figée");
    await waitFor(() => !m.readSyncStatus().degraded, 2000, "alerte « mémoire lente » levée une fois l'écriture faite");
    assert.ok(localStorage.getItem(pendingKey) !== null, "toujours en attente d'envoi (hors ligne)");
    assert.equal(h.result[0][0].titre, "E3");
    unmountAll();
    const m2 = await freshStorage();
    const h2 = await open(m2);
    await sleep(200);
    assert.equal(h2.result[0][0].titre, "E3", "réouverture");
  } finally { w.restore(); }
});

test("A1 : IndexedDB figée puis application tuée avant le nouvel essai : la réouverture montre la dernière modification", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "ORIGINE", pieces: [] }), owned("c2", { titre: "deux", pieces: [] })]);
    const m = await freshStorage();
    const h = await open(m);
    world.hold = (op, store) => (op === "put" && store === "concerts" ? new Promise(() => {}) : null);
    h.result[1]((l) => l.filter((c) => c.id !== "c2").map((c) => ({ ...c, titre: "E1" })));
    await waitFor(() => m.readSyncStatus().degraded, 4000, "écriture abandonnée après son délai, alerte affichée");
    // Android tue l'application ; IndexedDB refonctionne au relancement.
    world.frozen = true;
    unmountAll();
    const ls = new Map(localStorage.map);
    const fresh = Object.create(Object.getPrototypeOf(localStorage)); fresh.map = ls; globalThis.localStorage = fresh;
    world.frozen = false; world.hold = null;
    const m2 = await freshStorage();
    const h2 = await open(m2);
    await sleep(200);
    assert.deepEqual(h2.result[0].map((c) => `${c.id}:${c.titre}`), ["c1:E1"], "modification et suppression gardées");
    await waitFor(() => world.stores.concerts.get("c1")?.titre === "E1" && !world.stores.concerts.has("c2"), 3000, "réécrites dans IndexedDB");
  } finally { w.restore(); }
});

test("A2 : « blocking » pendant une écriture lente : la file se vide et la copie de secours est à jour avant le rechargement (relecture6b/blocking-file-lente.mjs)", async () => {
  const w = offlineWorld();
  try {
    seedLocal([owned("c1", { titre: "ORIGINE", pieces: [] })]);
    const m = await freshStorage();
    let reloads = 0; let atReload = null;
    m.setPageReloader(() => { reloads += 1; atReload = { idb: world.stores.concerts.get("c1").titre, copie: backupTitle() }; });
    const h = await open(m);
    await sleep(100);
    let first = true;
    world.hold = (op, store) => { if (op === "put" && store === "concerts" && first) { first = false; return sleep(1000); } return null; };
    h.result[1]((l) => l.map((c) => ({ ...c, titre: "E1" })));
    await sleep(120);
    h.result[1]((l) => l.map((c) => ({ ...c, titre: "E2" }))); // enregistrement différé
    world.openOptions.blocking();
    await waitFor(() => reloads === 1, 5000, "rechargement");
    assert.deepEqual(atReload, { idb: "E2", copie: "E2" });
    m.setPageReloader(null);
  } finally { w.restore(); }
});

test("upgradeBlocked : le message disparaît aussi quand l'ouverture échoue après le blocage", async () => {
  reset();
  const m = await freshStorage();
  // Ouverture qui annonce un blocage puis échoue (world.failOpen : le faux openDB lève une erreur).
  await m.loadPlanImage(ref(image()), { download: false }); // ouvre la base (stub)
  world.openOptions.blocked();
  assert.equal(m.readSyncStatus().upgradeBlocked, true);
  world.openOptions.terminated(); // connexion perdue : la prochaine ouverture repart de zéro
  world.failOpen = true;
  await m.loadPlanImage(ref(image()), { download: false });
  world.failOpen = false;
  assert.equal(m.readSyncStatus().upgradeBlocked, false);
});
