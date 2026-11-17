// LOT 1 : protection des données côté appareil (src/useStorage.js).
// Lancer : node --test tests/lot1-*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { importFresh, installBrowserStubs, fakeDb } from "./support/lot1-env.mjs";

const EMAIL = "owner@test.invalid";
const concert = (id, extra = {}) => ({ id, titre: `Concert ${id}`, pieces: [], ...extra });

async function load() {
  const storage = installBrowserStubs();
  const mod = await importFresh("src/useStorage.js");
  return { mod, storage };
}

// ───────────── C1 : rechargement non destructif ─────────────

test("C1 plan : refuse une réponse serveur vide ou invalide", async () => {
  const { mod } = await load();
  const local = [concert("a")];
  for (const serverData of [null, undefined, [], {}, "x", [{ titre: "sans id" }], [null], [concert("a"), { titre: "sans id" }]]) {
    const plan = mod.planSafeReload({ serverData, localConcerts: local, email: EMAIL });
    assert.equal(plan.refus, true, `devrait refuser ${JSON.stringify(serverData)}`);
    assert.ok(plan.raison);
  }
});

test("C1 plan : remplace les communs, garde les locaux absents du serveur, ajoute ceux du serveur", async () => {
  const { mod } = await load();
  const local = [concert("a", { titre: "local modifié" }), concert("b-hors-ligne")];
  const server = [concert("a", { titre: "version serveur" }), concert("c-serveur")];
  const snapshot = JSON.stringify(local);
  const plan = mod.planSafeReload({ serverData: server, localConcerts: local, email: EMAIL });
  assert.equal(plan.refus, false);
  const ids = plan.merged.map((c) => c.id);
  assert.deepEqual(ids.sort(), ["a", "b-hors-ligne", "c-serveur"]);
  assert.equal(plan.merged.find((c) => c.id === "a").titre, "version serveur");
  assert.equal(plan.merged.find((c) => c.id === "b-hors-ligne").titre, "Concert b-hors-ligne");
  assert.equal(plan["remplacés"], 1);
  assert.equal(plan["conservés"], 1);
  assert.equal(plan["ajoutés"], 1);
  assert.equal(JSON.stringify(local), snapshot, "la liste locale ne doit pas être modifiée en place");
});

function reloadDeps(over = {}) {
  const log = [];
  const deps = {
    email: EMAIL,
    isOffline: () => false,
    hasUnsavedEdits: () => false,
    hasPending: () => false,
    getLocal: () => [concert("a", { titre: "local" }), concert("hors-ligne")],
    fetchServer: async () => { log.push("fetch"); return [concert("a", { titre: "serveur" })]; },
    saveSafetyCopy: async (list) => { log.push("copie"); return { cle: "k", copies: list.length }; },
    download: async () => { log.push("telechargement"); return "sauvegarde.json"; },
    apply: async (...args) => { log.push(["apply", args]); },
    ...over,
  };
  return { deps, log };
}

test("C1 : un concert créé hors ligne survit à « Recharger depuis le compte »", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps();
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, undefined);
  const applied = log.find((x) => Array.isArray(x) && x[0] === "apply");
  assert.ok(applied, "apply doit être appelé");
  assert.equal(applied[1].length, 1, "apply reçoit uniquement la liste fusionnée : aucun removedIds");
  assert.deepEqual(applied[1][0].map((c) => c.id).sort(), ["a", "hors-ligne"]);
  assert.equal(r["remplacés"], 1);
  assert.equal(r["conservés"], 1);
});

test("C1 : copie locale AVANT tout remplacement, puis fichier proposé", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps();
  await mod.runSafeReload(deps);
  const order = log.map((x) => (Array.isArray(x) ? x[0] : x));
  assert.ok(order.indexOf("copie") >= 0 && order.indexOf("copie") < order.indexOf("apply"));
  assert.ok(order.indexOf("telechargement") < order.indexOf("apply"));
});

test("C1 : refuse sans rien toucher s'il y a des modifications en attente d'envoi", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps({ hasPending: () => true });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, true);
  assert.deepEqual(log, [], "ni réseau, ni copie, ni remplacement");
});

test("C1 : refuse si une sauvegarde locale est en cours (délai de 500 ms)", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps({ hasUnsavedEdits: () => true });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, true);
  assert.deepEqual(log, []);
});

test("C1 : refuse si une modification apparaît pendant le téléchargement serveur", async () => {
  const { mod } = await load();
  let pending = false;
  const { deps, log } = reloadDeps({
    hasPending: () => pending,
    fetchServer: async () => { pending = true; return [concert("a")]; },
  });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, true);
  assert.ok(!log.some((x) => Array.isArray(x) && x[0] === "apply"));
});

test("C1 : refuse si le serveur répond vide (ne vide jamais le local)", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps({ fetchServer: async () => [] });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, true);
  assert.ok(!log.some((x) => Array.isArray(x) && x[0] === "apply"));
});

test("C1 : refuse si la copie de secours est impossible", async () => {
  const { mod } = await load();
  const { deps, log } = reloadDeps({ saveSafetyCopy: async () => { throw new Error("quota"); } });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, true);
  assert.ok(!log.some((x) => Array.isArray(x) && x[0] === "apply"));
});

test("C1 : un échec du fichier téléchargé ne bloque pas (la copie locale suffit)", async () => {
  const { mod } = await load();
  const { deps } = reloadDeps({ download: async () => { throw new Error("pas de DOM"); } });
  const r = await mod.runSafeReload(deps);
  assert.equal(r.refus, undefined);
});

test("C1 : refuse hors ligne et si le serveur est injoignable", async () => {
  const { mod } = await load();
  assert.equal((await mod.runSafeReload(reloadDeps({ isOffline: () => true }).deps)).refus, true);
  const r = await mod.runSafeReload(reloadDeps({ fetchServer: async () => { throw new Error("500"); } }).deps);
  assert.equal(r.refus, true);
});

test("C1 copie de secours : clés horodatées uniques, jamais écrasées", async () => {
  const { mod, storage } = await load();
  const db = fakeDb();
  const list = [concert("a"), concert("b")];
  const r1 = await mod.saveSafetyCopy(EMAIL, list, { db });
  const r2 = await mod.saveSafetyCopy(EMAIL, [concert("z")], { db });
  assert.notEqual(r1.cle, r2.cle);
  const keys = Array.from(db.stores.photos.keys()).filter((k) => String(k).startsWith("orkmap-safety-copy:"));
  assert.equal(keys.length, 2);
  assert.equal(db.stores.photos.get(r1.cle).concerts.length, 2);
  assert.ok(!Array.from(storage.map.keys()).some((k) => k.startsWith("orkmap-safety-copy:")), "localStorage est épargné (quota) quand IndexedDB a répondu");
});

test("C1 copie de secours : repli sur localStorage si IndexedDB refuse", async () => {
  const { mod, storage } = await load();
  const db = fakeDb();
  db.put = async () => { throw new Error("idb plein"); };
  const r = await mod.saveSafetyCopy(EMAIL, [concert("a")], { db });
  assert.equal(r.idb, false);
  assert.equal(r.ls, true);
  assert.ok(Array.from(storage.map.keys()).some((k) => k.startsWith("orkmap-safety-copy:")));
});

test("C1 copie de secours : échoue franchement si ni IndexedDB ni localStorage n'acceptent", async () => {
  const { mod, storage } = await load();
  storage.failWrites = true;
  const db = fakeDb();
  db.put = async () => { throw new Error("idb plein"); };
  await assert.rejects(() => mod.saveSafetyCopy(EMAIL, [concert("a")], { db }));
});

// ───────────── I1 : copie de secours localStorage et mode dégradé ─────────────

test("I1 : un échec de quota est signalé dans l'état exposé, pas seulement en console", async () => {
  const { mod, storage } = await load();
  assert.equal(mod.readSyncStatus().backupFailed, false);
  storage.failWrites = true;
  const r = mod.writeConcertsBackup(EMAIL, [concert("a")]);
  assert.equal(r.ok, false);
  assert.equal(mod.readSyncStatus().backupFailed, true);
  storage.failWrites = false;
  assert.equal(mod.writeConcertsBackup(EMAIL, [concert("a")]).ok, true);
  assert.equal(mod.readSyncStatus().backupFailed, false);
});

test("I1 : un échec d'écriture de la marque « en attente » est aussi signalé", async () => {
  const { mod, storage } = await load();
  storage.failWrites = true;
  mod.markPending(EMAIL, "concerts");
  assert.equal(mod.readSyncStatus().backupFailed, true);
});

test("I1 : la copie n'est plus écrasée en silence par une liste plus courte", async () => {
  const { mod, storage } = await load();
  mod.writeConcertsBackup(EMAIL, [concert("a"), concert("b"), concert("c")]);
  mod.writeConcertsBackup(EMAIL, [concert("a")]); // b et c disparaissent sans suppression explicite
  const prevKey = Array.from(storage.map.keys()).find((k) => k.startsWith("orkmap-concerts-backup-prev:"));
  assert.ok(prevKey, "la génération précédente doit être conservée");
  assert.equal(JSON.parse(storage.getItem(prevKey)).length, 3);
});

test("I1 : une suppression explicite ne déclenche pas la conservation de l'ancienne copie", async () => {
  const { mod, storage } = await load();
  mod.writeConcertsBackup(EMAIL, [concert("a"), concert("b")]);
  mod.writeConcertsBackup(EMAIL, [concert("a")], { removedIds: ["b"] });
  assert.ok(!Array.from(storage.map.keys()).some((k) => k.startsWith("orkmap-concerts-backup-prev:")));
});

test("I1 : IndexedDB qui échoue ou dépasse le délai → mode dégradé, jamais de semis du serveur", async () => {
  const { mod, storage } = await load();
  mod.writeConcertsBackup(EMAIL, [concert("vieux")]);
  const r = await mod.loadLocalWithFallback({
    email: EMAIL,
    read: () => new Promise(() => {}), // ne répond jamais
    timeoutMs: 20,
  });
  assert.equal(r.degraded, true);
  assert.equal(r.canSeed, false, "la copie de secours ne doit jamais servir à écraser le serveur");
  assert.deepEqual(r.localData.map((c) => c.id), ["vieux"]);
});

test("I1 : lecture normale → pas de mode dégradé", async () => {
  const { mod } = await load();
  const r = await mod.loadLocalWithFallback({
    email: EMAIL,
    read: async () => ({ localData: [concert("a")], canSeed: true }),
    timeoutMs: 50,
  });
  assert.equal(r.degraded, false);
  assert.equal(r.canSeed, true);
});

test("I1 : nouvelle tentative patiente (plus de 4 s) au lieu d'abandonner", async () => {
  const { mod } = await load();
  assert.ok(mod.LOCAL_RETRY_TIMEOUTS_MS[0] >= 15000, "premier délai de relecture >= 15 s");
  let n = 0;
  const waits = [];
  const res = await mod.retryLocalRead({
    read: () => (++n < 3 ? new Promise(() => {}) : Promise.resolve({ localData: [concert("a")], canSeed: true })),
    isCurrent: () => true,
    timeouts: [10, 10, 10],
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(n, 3);
  assert.deepEqual(res.localData.map((c) => c.id), ["a"]);
  assert.equal(waits.length, 2);
});

test("I1 : la relecture s'arrête si le compte a changé", async () => {
  const { mod } = await load();
  let current = true;
  const res = await mod.retryLocalRead({
    read: () => new Promise(() => {}),
    isCurrent: () => current,
    timeouts: [5, 5],
    sleep: async () => { current = false; },
  });
  assert.equal(res, null);
});

test("I1 réconciliation après mode dégradé : seul ce qui a été modifié pendant le mode dégradé écrase IndexedDB", async () => {
  const { mod } = await load();
  const base = [concert("a", { titre: "copie périmée" }), concert("b", { titre: "copie périmée" })];
  const baseSig = mod.signaturesOf(base);
  const current = [concert("a", { titre: "copie périmée" }), concert("b", { titre: "éditée pendant le mode dégradé" }), concert("n", { titre: "créée pendant le mode dégradé" })];
  const idb = [concert("a", { titre: "VRAIE version IndexedDB" }), concert("b", { titre: "VRAIE b" }), concert("seulement-idb")];
  const editedIds = mod.changedIds(baseSig, current);
  assert.deepEqual(editedIds.sort(), ["b", "n"]);
  const out = mod.reconcileAfterDegraded({ editedIds, current, idb, removedIds: [] });
  const byId = Object.fromEntries(out.map((c) => [c.id, c.titre]));
  assert.equal(byId.a, "VRAIE version IndexedDB", "non modifié pendant le dégradé : IndexedDB gagne");
  assert.equal(byId.b, "éditée pendant le mode dégradé", "modifié pendant le dégradé : la modification gagne");
  assert.equal(byId.n, "créée pendant le mode dégradé");
  assert.equal(byId["seulement-idb"], "Concert seulement-idb", "rien de ce qui est dans IndexedDB ne disparaît");
});

test("I1 réconciliation : les suppressions explicites sont appliquées, rien d'autre ne disparaît", async () => {
  const { mod } = await load();
  const base = [concert("a"), concert("b")];
  const out = mod.reconcileAfterDegraded({ editedIds: [], current: [concert("a")], idb: [concert("a"), concert("b"), concert("c")], removedIds: ["b"] });
  assert.deepEqual(out.map((c) => c.id).sort(), ["a", "c"]);
});

test("I1 : les modifications faites en mode dégradé survivent à une fermeture (marqueur persistant)", async () => {
  const { mod, storage } = await load();
  assert.equal(mod.readDegradedMarker(EMAIL), null);
  mod.writeDegradedMarker(EMAIL, { editedIds: ["b"], removedIds: ["x"] });
  const marker = mod.readDegradedMarker(EMAIL);
  assert.deepEqual(marker.editedIds, ["b"]);
  assert.deepEqual(marker.removedIds, ["x"]);
  mod.clearDegradedMarker(EMAIL);
  assert.equal(mod.readDegradedMarker(EMAIL), null);
  assert.ok(storage);
});

// ───────────── C2 : limite de 4,5 Mo côté Vercel ─────────────

function fetchRecorder(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    return handler(String(url), opts, calls.length);
  };
  return calls;
}
const ok = (status = 200, body = { ok: true }) => new Response(JSON.stringify(body), { status });
const bigConcert = (id, mb) => concert(id, { plan: "x".repeat(Math.floor(mb * 1024 * 1024)) });

test("C2 : mesure en octets (les accents comptent double)", async () => {
  const { mod } = await load();
  assert.equal(mod.measureBytes("abc"), 3);
  assert.equal(mod.measureBytes("é"), 2);
  assert.equal(mod.measureBytes("€"), 3);
});

test("C2 : au-delà de 4 Mo, rien n'est envoyé, l'état « trop volumineux » est exposé, la marque reste", async () => {
  const { mod } = await load();
  const calls = fetchRecorder(() => ok());
  mod.markPending(EMAIL, "concerts");
  let payloadCalls = 0;
  const args = { email: EMAIL, type: "concerts", getPayload: () => { payloadCalls += 1; return [bigConcert("g", 4.6)]; }, absorbRemote: async () => {} };
  await mod.pushPending(args);
  assert.equal(calls.length, 0, "aucun envoi réseau");
  const status = mod.readSyncStatus();
  assert.equal(status.oversize.length, 1);
  assert.equal(status.oversize[0].type, "concerts");
  assert.ok(status.oversize[0].bytes > mod.MAX_PAYLOAD_BYTES);
  assert.ok(mod.readPending(EMAIL, "concerts"), "la donnée reste marquée en attente (rien n'est perdu)");
  // La relance automatique de 60 s ne recalcule pas tant que rien n'a changé.
  await mod.pushPending(args);
  assert.equal(payloadCalls, 1);
  assert.equal(calls.length, 0);
});

test("C2 : dès que la taille redescend (nouvelle modification), l'envoi reprend et l'état disparaît", async () => {
  const { mod } = await load();
  const calls = fetchRecorder(() => ok());
  mod.markPending(EMAIL, "concerts");
  let big = true;
  const args = { email: EMAIL, type: "concerts", getPayload: () => [big ? bigConcert("g", 4.6) : concert("g")], absorbRemote: async () => {} };
  await mod.pushPending(args);
  big = false;
  mod.markPending(EMAIL, "concerts"); // une modification : la marque change de révision
  await mod.pushPending(args);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(mod.readSyncStatus().oversize.length, 0);
  assert.equal(mod.readPending(EMAIL, "concerts"), null);
});

test("C2 non-régression : un envoi normal passe et solde la marque", async () => {
  const { mod } = await load();
  const calls = fetchRecorder(() => ok());
  mod.markPending(EMAIL, "concerts", ["x"]);
  await mod.pushPending({ email: EMAIL, type: "concerts", getPayload: () => [concert("a")], absorbRemote: async () => {} });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body).removedIds, ["x"]);
  assert.equal(mod.readPending(EMAIL, "concerts"), null);
});

test("C2 non-régression : un 409 absorbe le serveur puis renvoie (rien n'est supprimé)", async () => {
  const { mod } = await load();
  const calls = fetchRecorder((url, opts, n) => {
    if (n === 1) return ok(409, { error: "x" });
    if (opts.method === "POST") return ok();
    return ok(200, { data: [concert("serveur")] });
  });
  mod.markPending(EMAIL, "concerts");
  let list = [concert("local")];
  await mod.pushPending({
    email: EMAIL, type: "concerts",
    getPayload: () => list,
    absorbRemote: async (remote) => { list = [...list, ...remote]; },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].body).data.map((c) => c.id), ["local", "serveur"]);
  assert.equal(mod.readPending(EMAIL, "concerts"), null);
});

// ───────────── Export local sans envoi ─────────────

test("Export : fichier complet (concerts + photos + scores), sans doublon, sans réseau", async () => {
  const { mod } = await load();
  const db = fakeDb({
    concerts: { a: concert("a"), b: concert("b") },
    photos: { [`all-photos:${EMAIL}`]: { p1: [{ id: "ph1", dataUrl: "data:image/jpeg;base64,AAA" }] } },
    "omr-scores": { s1: { id: "s1", titre: "Score" } },
  });
  const snap = await mod.buildLocalSnapshot(db);
  assert.equal(snap.concerts.length, 2);
  assert.equal(snap.photos.length, 1);
  assert.equal(snap.photos[0].key, `all-photos:${EMAIL}`);
  assert.equal(snap.omrScores.length, 1);
  assert.equal(snap.stores, undefined, "pas de doublon de données (contrairement au dump de récupération)");
  assert.deepEqual(snap.counts, { concerts: 2, photos: 1, omrScores: 1 });
  assert.ok(snap.exportedAt);
});

test("Export : le téléchargement ne contacte jamais le réseau", async () => {
  const { mod } = await load();
  const calls = fetchRecorder(() => { throw new Error("réseau interdit"); });
  const db = fakeDb({ concerts: { a: concert("a") } });
  const downloaded = [];
  const info = await mod.exportLocalDataToFile({ db, download: (name, text) => downloaded.push({ name, text }) });
  assert.equal(calls.length, 0);
  assert.equal(downloaded.length, 1);
  assert.match(downloaded[0].name, /^orkmap-sauvegarde-locale-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  assert.equal(JSON.parse(downloaded[0].text).concerts[0].id, "a");
  assert.equal(info.counts.concerts, 1);
});

test("Export : l'export de récupération existant est conservé", async () => {
  const { mod } = await load();
  assert.equal(typeof mod.exportLocalDataForRecovery, "function");
});
