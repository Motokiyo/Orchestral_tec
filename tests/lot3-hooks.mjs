// LOT 3 : défauts de la relecture hostile qui touchent les données, rejoués sur le VRAI useConcerts
// (hooks React et IndexedDB remplacés par des équivalents en mémoire : tests/support/lot3-*.mjs).
// Lancer : node --test tests/lot3-hooks.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { world, renderHook, unmountAll, EMAIL, sleep, owned, concert, server, reset, freshStorage, waitFor } from "./support/lot3-env.mjs";

test.afterEach(() => unmountAll());

const titres = (list) => list.map((c) => `${c.id}:${c.titre}`).sort();
const idb = () => titres(Array.from(world.stores.concerts.values()));
const backup = () => titres(JSON.parse(localStorage.getItem(`orkmap-concerts-backup:${EMAIL}`) || "[]"));
const pendingKey = `orkmap-pending:${EMAIL}:concerts`;
const edit = (h, id, titre) => h.result[1]((list) => list.map((c) => (c.id === id ? { ...c, titre } : c)));

function seed(list) {
  for (const c of list) world.stores.concerts.set(c.id, structuredClone(c));
  localStorage.setItem(`orkmap-concerts-backup:${EMAIL}`, JSON.stringify(list));
  server.data.concerts = structuredClone(list);
}

// ───────────── C1 : modification faite pendant la réintégration du mode dégradé ─────────────

async function degradedScenario(actionDuringReintegration) {
  reset();
  seed([owned("a", { titre: "a v0" }), owned("b", { titre: "b v0" })]);
  const m = await freshStorage();
  world.delay = 450; // plus lent que le délai de lecture (400 ms avec le crochet de test) : mode dégradé
  const h = renderHook(m.useConcerts, [[], EMAIL]);
  await waitFor(() => m.readSyncStatus().degraded, 4000, "passage en mode dégradé");
  edit(h, "a", "a EDITE PENDANT DEGRADE");
  let fired = false;
  world.onPut = (store) => {
    if (store !== "concerts" || fired) return;
    fired = true; // première écriture de la réintégration : l'utilisateur agit à cet instant précis
    actionDuringReintegration(h);
  };
  await waitFor(() => fired, 8000, "début de l'écriture de réintégration");
  await waitFor(() => !m.readSyncStatus().degraded, 12000, "fin du mode dégradé");
  world.delay = 0;
  world.onPut = null;
  await waitFor(() => localStorage.getItem(pendingKey) === null && server.posts.length > 0, 8000, "envoi au compte");
  await sleep(200);
  return { h, m };
}

test("C1 : une modification faite pendant la réintégration du mode dégradé n'est pas perdue", async () => {
  const { h } = await degradedScenario((h) => edit(h, "b", "b EDITE PENDANT LA REINTEGRATION"));
  const attendu = ["a:a EDITE PENDANT DEGRADE", "b:b EDITE PENDANT LA REINTEGRATION"];
  assert.deepEqual(titres(h.result[0]), attendu, "écran");
  assert.deepEqual(idb(), attendu, "IndexedDB");
  assert.deepEqual(backup(), attendu, "copie de secours");
  assert.deepEqual(titres(server.data.concerts), attendu, "compte");
  assert.equal(localStorage.getItem(`orkmap-degraded-edits:${EMAIL}`), null, "marqueur effacé seulement une fois tout réintégré");
  h.unmount();
});

test("C1 : une suppression faite pendant la réintégration ne ressuscite pas", async () => {
  const { h } = await degradedScenario((h) => h.result[1]((list) => list.filter((c) => c.id !== "b")));
  const attendu = ["a:a EDITE PENDANT DEGRADE"];
  assert.deepEqual(titres(h.result[0]), attendu, "écran");
  assert.deepEqual(idb(), attendu, "IndexedDB");
  assert.deepEqual(titres(server.data.concerts), attendu, "compte");
  h.unmount();
});

// ───────────── C2 : « Recharger depuis le compte » pendant qu'on modifie ─────────────

test("C2 : une modification faite pendant l'écriture du rechargement n'est ni perdue ni renvoyée en arrière", async () => {
  reset();
  seed([owned("a", { titre: "a v0" }), owned("b", { titre: "b v0" })]);
  const m = await freshStorage();
  const h = renderHook(m.useConcerts, [[], EMAIL]);
  await waitFor(() => h.result[2], 4000, "chargement");
  await sleep(150);
  localStorage.removeItem(pendingKey);
  server.data.concerts = [owned("a", { titre: "a version SERVEUR" }), owned("b", { titre: "b v0" })];
  world.delay = 60;
  let fired = false;
  world.onPut = (store) => {
    if (store !== "concerts" || fired) return;
    fired = true; // première écriture du rechargement : modification de l'utilisateur
    edit(h, "b", "b EDITE PENDANT LE RECHARGEMENT");
  };
  const r = await h.result[3].reloadFromAccountSafe({ download: false });
  assert.ok(!r.refus, JSON.stringify(r));
  assert.ok(fired, "la modification a bien eu lieu pendant l'écriture");
  world.delay = 0;
  world.onPut = null;
  await waitFor(() => localStorage.getItem(pendingKey) === null && server.data.concerts.some((c) => c.titre === "b EDITE PENDANT LE RECHARGEMENT"), 8000, "envoi au compte");
  await sleep(200);
  const attendu = ["a:a version SERVEUR", "b:b EDITE PENDANT LE RECHARGEMENT"];
  assert.deepEqual(titres(h.result[0]), attendu, "écran");
  assert.deepEqual(idb(), attendu, "IndexedDB");
  assert.deepEqual(titres(server.data.concerts), attendu, "compte");
  h.unmount();
});

test("C2 : une suppression faite pendant le rechargement ne ressuscite pas", async () => {
  reset();
  seed([owned("a", { titre: "a v0" }), owned("b", { titre: "b v0" })]);
  const m = await freshStorage();
  const h = renderHook(m.useConcerts, [[], EMAIL]);
  await waitFor(() => h.result[2], 4000, "chargement");
  await sleep(150);
  localStorage.removeItem(pendingKey);
  world.delay = 60;
  let fired = false;
  world.onPut = (store) => {
    if (store !== "concerts" || fired) return;
    fired = true;
    h.result[1]((list) => list.filter((c) => c.id !== "b"));
  };
  const r = await h.result[3].reloadFromAccountSafe({ download: false });
  assert.ok(!r.refus, JSON.stringify(r));
  world.delay = 0;
  world.onPut = null;
  await sleep(600);
  assert.deepEqual(titres(h.result[0]), ["a:a v0"], "écran");
  assert.deepEqual(idb(), ["a:a v0"], "IndexedDB");
  h.unmount();
});

// ───────────── C9 : supprimer le DERNIER concert ─────────────

test("C9 : le dernier concert supprimé ne revient pas à la réouverture et n'est pas renvoyé au compte", async () => {
  reset();
  seed([owned("a", { titre: "a v0" })]);
  const m = await freshStorage();
  const h = renderHook(m.useConcerts, [[], EMAIL]);
  await waitFor(() => h.result[2], 4000, "chargement");
  await sleep(150);
  h.result[1](() => []);
  await waitFor(() => Array.isArray(server.data.concerts) && server.data.concerts.length === 0, 6000, "suppression envoyée");
  await sleep(150);
  h.unmount();
  const postsAvant = server.posts.length;
  const m2 = await freshStorage();
  const h2 = renderHook(m2.useConcerts, [[], EMAIL]);
  await waitFor(() => h2.result[2], 4000, "rechargement");
  await sleep(800);
  assert.deepEqual(titres(h2.result[0]), [], "écran après réouverture");
  assert.deepEqual(idb(), [], "IndexedDB");
  assert.deepEqual(server.data.concerts, [], "compte");
  assert.equal(server.posts.length, postsAvant, "rien n'est renvoyé au compte à la réouverture");
  h2.unmount();
});

test("C9 : une liste vide SANS suppression explicite n'efface pas la copie de secours", async () => {
  reset();
  const m = await freshStorage();
  const list = [owned("a"), owned("b")];
  m.writeConcertsBackup(EMAIL, list);
  assert.deepEqual(m.writeConcertsBackup(EMAIL, []).skipped, true, "liste vide sans removedIds : ignorée");
  assert.deepEqual(m.writeConcertsBackup(EMAIL, [], { removedIds: ["a"] }).skipped, true, "suppression d'un seul concert sur deux : ignorée");
  assert.equal(JSON.parse(localStorage.getItem(`orkmap-concerts-backup:${EMAIL}`)).length, 2);
  m.writeConcertsBackup(EMAIL, [], { removedIds: ["a", "b"] });
  assert.deepEqual(JSON.parse(localStorage.getItem(`orkmap-concerts-backup:${EMAIL}`)), [], "tous supprimés explicitement : copie vidée");
  assert.equal(JSON.parse(localStorage.getItem(`orkmap-concerts-backup-prev:${EMAIL}`)).length, 2, "la copie précédente est gardée à côté");
});

// ───────────── C6 : copies de sécurité et export ─────────────

const bigPlan = "data:image/jpeg;base64," + "A".repeat(20000);
const bigList = Array.from({ length: 3 }, (_, i) => ({ id: "c" + i, plans: [bigPlan] }));

test("C6 : on garde les 3 copies de sécurité les plus récentes PAR COMPTE", async () => {
  reset();
  const m = await freshStorage();
  world.stores.photos.set("orkmap-safety-copy:autre@y:2020-01-01T00:00:00.000Z:1", { kind: "orkmap-safety-copy", concerts: [] });
  const cles = [];
  for (let i = 0; i < 6; i += 1) {
    cles.push((await m.saveSafetyCopy(EMAIL, bigList)).cle);
    await sleep(3);
  }
  const miennes = Array.from(world.stores.photos.keys()).filter((k) => k.startsWith(`orkmap-safety-copy:${EMAIL}:`));
  assert.deepEqual(miennes.sort(), cles.slice(-3).sort(), "les 3 dernières seulement");
  assert.ok(world.stores.photos.has("orkmap-safety-copy:autre@y:2020-01-01T00:00:00.000Z:1"), "la copie d'un autre compte n'est pas touchée");
});

test("C6 : la purge compte aussi les copies de repli localStorage", async () => {
  reset();
  const m = await freshStorage();
  for (let i = 1; i <= 5; i += 1) localStorage.setItem(`orkmap-safety-copy:${EMAIL}:2026-11-17T10:00:0${i}.000Z:${i}`, "{}");
  localStorage.setItem("orkmap-concerts-backup:" + EMAIL, "[]");
  const removed = await m.pruneSafetyCopies(EMAIL);
  assert.equal(removed, 2);
  const left = Array.from(localStorage.map.keys()).filter((k) => k.startsWith("orkmap-safety-copy:")).sort();
  assert.deepEqual(left.map((k) => k.slice(-1)), ["3", "4", "5"]);
  assert.ok(localStorage.getItem("orkmap-concerts-backup:" + EMAIL) !== null, "la copie courante n'est pas une copie de sécurité");
});

test("C6 : l'export ne contient ni les copies de sécurité ni les données des autres comptes", async () => {
  reset();
  const m = await freshStorage();
  world.stores.concerts.set("mien", owned("mien"));
  world.stores.concerts.set("autre", { ...concert("autre"), ownerEmail: "autre@y" });
  world.stores.photos.set(`all-photos:${EMAIL}`, { p: [{ id: "ph1" }, { id: "ph2" }] });
  world.stores.photos.set("all-photos:autre@y", { q: [{ id: "ph3" }] });
  world.stores["omr-scores"].set("s1", { id: "s1", ownerEmail: EMAIL });
  world.stores["omr-scores"].set("s2", { id: "s2", ownerEmail: "autre@y" });
  for (let i = 0; i < 3; i += 1) await m.saveSafetyCopy(EMAIL, bigList);
  const snap = await m.buildLocalSnapshot(undefined, { email: EMAIL });
  assert.deepEqual(snap.concerts.map((c) => c.id), ["mien"]);
  assert.deepEqual(snap.photos.map((p) => p.key), [`all-photos:${EMAIL}`]);
  assert.deepEqual(snap.omrScores.map((s) => s.id), ["s1"]);
  assert.deepEqual(snap.counts, { concerts: 1, photos: 2, omrScores: 1 }, "les photos comptées sont de vraies photos");
  assert.ok(JSON.stringify(snap).length < 5000, "aucune copie de 60 Ko dans le fichier");
  // sans compte précisé : tout reste exporté, sauf les copies de sécurité
  const all = await m.buildLocalSnapshot();
  assert.equal(all.photos.length, 2);
  assert.ok(!all.photos.some((p) => String(p.key).startsWith("orkmap-safety-copy:")));
});
