// LOT 5 : les images des plans sortent du JSON des concerts envoyé au compte.
// Le VRAI useConcerts (hooks et IndexedDB en mémoire, tests/support/lot3-*.mjs) parle aux VRAIES routes
// api/sync.js et api/plan-image.js, elles-mêmes branchées sur le faux Supabase en mémoire.
// Aucun appel réseau réel. Lancer : node --test tests/lot5-images.mjs
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, world, renderHook, unmountAll, EMAIL, sleep, owned, reset, freshStorage, waitFor, imp } from "./support/lot3-env.mjs";
import { installFakeSupabase } from "./support/fake-supabase.mjs";

const OTHER = "autre@test.invalid";
const MO = 1024 * 1024;
test.afterEach(() => unmountAll());

const image = (bytes = 60_000) => `data:image/jpeg;base64,${crypto.randomBytes(Math.floor((bytes * 3) / 4)).toString("base64")}`;
const sha = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const ref = (dataUrl) => `orkimg:${sha(dataUrl)}`;
const piece = (id, plans, extra = {}) => ({ id, titre: `P ${id}`, plans, planDataUrl: plans[plans.length - 1] || null, percus: [], ...extra });
const pendingKey = `orkmap-pending:${EMAIL}:concerts`;

function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function setEnv() {
  process.env.AUTH_SECRET = "secret-de-test-uniquement";
  process.env.ALLOWED_EMAILS = `${EMAIL},${OTHER}`;
  process.env.SUPABASE_URL = "https://x.fake.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-factice";
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
}

async function sessionCookie(email) {
  const auth = await imp("api/auth-utils.js");
  return auth.createSession(email).split(";")[0];
}

// Le téléphone (fetch relatif « /api/… ») parle aux vraies routes ; les routes parlent au faux Supabase.
async function setupWorld() {
  reset();
  setEnv();
  const fake = installFakeSupabase({ delay: false });
  const supa = globalThis.fetch;
  const sync = (await imp("api/sync.js")).default;
  const planImage = (await imp("api/plan-image.js")).default;
  const cookie = await sessionCookie(EMAIL);
  const log = [];
  const ctl = { offline: false, failImagePost: null };
  globalThis.fetch = async (url, init = {}) => {
    const s = String(url);
    if (!s.startsWith("/api/")) return supa(url, init);
    const u = new URL(s, "https://t.invalid");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push({ path: u.pathname, method, bytes: init.body ? Buffer.byteLength(init.body) : 0, body, hash: body?.hash || u.searchParams.get("hash") });
    if (ctl.offline) throw new TypeError("Failed to fetch");
    if (u.pathname === "/api/plan-image" && method === "POST" && ctl.failImagePost?.(body.hash)) {
      return new Response("{}", { status: 500 });
    }
    const res = mockRes();
    const handler = u.pathname === "/api/sync" ? sync : planImage;
    await handler({ method, body, query: Object.fromEntries(u.searchParams), headers: { cookie } }, res);
    return new Response(JSON.stringify(res.body ?? null), { status: res.statusCode });
  };
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  const restore = () => { fake.restore(); console.warn = quiet.warn; console.error = quiet.error; };
  const serverConcerts = () => fake.table("orkmap_user_data").find((r) => r.email === EMAIL && r.type === "concerts")?.data ?? null;
  const setServerConcerts = (data) => {
    const rows = fake.table("orkmap_user_data");
    const row = rows.find((r) => r.email === EMAIL && r.type === "concerts");
    if (row) row.data = structuredClone(data);
    else rows.push({ email: EMAIL, type: "concerts", data: structuredClone(data), updated_at: new Date().toISOString() });
  };
  const serverImages = () => fake.table("orkmap_plan_images").filter((r) => r.email === EMAIL);
  const putServerImage = (dataUrl, email = EMAIL) => fake.table("orkmap_plan_images").push({ email, hash: sha(dataUrl), data: dataUrl, bytes: dataUrl.length });
  return { fake, log, ctl, restore, serverConcerts, setServerConcerts, serverImages, putServerImage };
}

const seedLocal = (list) => { for (const c of list) world.stores.concerts.set(c.id, structuredClone(c)); };
const idbConcert = (id) => world.stores.concerts.get(id);
const posts = (log, p) => log.filter((e) => e.path === p && e.method === "POST");
const noInlineImage = (value) => !JSON.stringify(value).includes("data:image/");

// ───────────── Extraction des références ─────────────

test("extraction : plans[], planDataUrl et toute autre image deviennent orkimg:<sha256>, empreinte stable", async () => {
  const pi = await imp("src/planImages.js");
  const a = image();
  const b = image();
  const petite = "data:image/png;base64,iVBORw0KGgo=";
  const concerts = [owned("c1", { pieces: [piece("p1", [a, b], { autre: { vignette: b } })], logo: petite, note: "data:text/plain,bonjour" })];
  const out1 = await pi.externalizeImages(concerts);
  const out2 = await pi.externalizeImages(structuredClone(concerts));
  const p = out1.data[0].pieces[0];
  assert.deepEqual(p.plans, [ref(a), ref(b)]);
  assert.equal(p.planDataUrl, ref(b), "planDataUrl (même image que le dernier plan) : même référence");
  assert.equal(p.autre.vignette, ref(b), "image ailleurs dans le concert : trouvée aussi");
  assert.equal(out1.data[0].logo, petite, "une toute petite image reste dans le JSON");
  assert.equal(out1.data[0].note, "data:text/plain,bonjour", "un data URL qui n'est pas une image n'est pas touché");
  assert.equal(out1.images.size, 2, "une image présente deux fois n'est comptée qu'une fois");
  assert.equal(out1.images.get(sha(a)), a);
  assert.deepEqual(out2.data, out1.data, "empreinte stable d'un appel à l'autre");
  assert.equal(concerts[0].pieces[0].plans[0], a, "la liste d'origine (stockage local) n'est pas modifiée");
  assert.ok(pi.isImageRef(ref(a)) && !pi.isImageRef("orkimg:xyz") && !pi.isImageRef(a));
});

test("réhydratation : une référence connue redevient l'image, une inconnue reste telle quelle", async () => {
  const pi = await imp("src/planImages.js");
  const a = image();
  const inconnue = `orkimg:${"0".repeat(64)}`;
  const data = [owned("c1", { pieces: [piece("p1", [ref(a), inconnue])] })];
  const { data: out, missing, changed } = pi.rehydrateImages(data, new Map([[sha(a), a]]));
  assert.equal(changed, true);
  assert.deepEqual(out[0].pieces[0].plans, [a, inconnue]);
  assert.deepEqual(Array.from(missing), ["0".repeat(64)]);
  const nothing = pi.rehydrateImages(out, new Map());
  assert.equal(nothing.data, out, "rien à changer : même objet rendu");
});

// ───────────── Envoi : images d'abord, une par requête, puis les concerts ─────────────

test("envoi : chaque image part seule, puis les concerts allégés ; le stockage local garde les images", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const b = image(); const c = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a, b])] }), owned("c2", { pieces: [piece("p2", [c, a])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi complet");
    const imagePosts = posts(w.log, "/api/plan-image");
    assert.equal(imagePosts.length, 3, "3 images distinctes, 3 requêtes (a n'est envoyée qu'une fois)");
    for (const e of imagePosts) assert.equal(Object.keys(e.body).sort().join(","), "dataUrl,hash", "une seule image par requête");
    const order = w.log.filter((e) => e.method === "POST").map((e) => e.path);
    assert.deepEqual(order, ["/api/plan-image", "/api/plan-image", "/api/plan-image", "/api/sync"], "images d'abord, concerts ensuite");
    const sent = w.serverConcerts();
    assert.ok(noInlineImage(sent), "le JSON envoyé ne contient plus d'image");
    assert.deepEqual(sent.find((x) => x.id === "c1").pieces[0].plans, [ref(a), ref(b)]);
    assert.equal(w.serverImages().length, 3);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [a, b], "IndexedDB garde les data URL");
    assert.deepEqual(h.result[0].find((x) => x.id === "c1").pieces[0].plans, [a, b], "l'écran aussi");
  } finally { w.restore(); }
});

test("échec d'une image : les concerts ne partent pas ; au réessai, seules les images manquantes partent", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const b = image();
    w.ctl.failImagePost = (hash) => hash === sha(b);
    seedLocal([owned("c1", { pieces: [piece("p1", [a, b])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && posts(w.log, "/api/plan-image").length >= 2, 8000, "tentative d'envoi");
    await sleep(150);
    assert.equal(posts(w.log, "/api/sync").length, 0, "aucun envoi de concerts (pas de référence orpheline)");
    assert.equal(w.serverConcerts(), null);
    assert.ok(localStorage.getItem(pendingKey), "la modification reste en file");
    w.ctl.failImagePost = null;
    const before = posts(w.log, "/api/plan-image").length;
    m.requestSyncRetry();
    await waitFor(() => w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "réessai");
    const retried = posts(w.log, "/api/plan-image").slice(before).map((e) => e.hash);
    assert.deepEqual(retried, [sha(b)], "a, déjà acceptée, n'est pas renvoyée");
    assert.deepEqual(w.serverConcerts()[0].pieces[0].plans, [ref(a), ref(b)]);
  } finally { w.restore(); }
});

test("image déjà envoyée : une modification ne renvoie que les concerts", async () => {
  const w = await setupWorld();
  try {
    const a = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "premier envoi");
    const imagesBefore = posts(w.log, "/api/plan-image").length;
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "modifié" })));
    await waitFor(() => w.serverConcerts()[0].titre === "modifié" && localStorage.getItem(pendingKey) === null, 8000, "second envoi");
    assert.equal(posts(w.log, "/api/plan-image").length, imagesBefore, "aucune image renvoyée");
  } finally { w.restore(); }
});

test("réouverture : le compte a déjà les références, rien n'est renvoyé", async () => {
  const w = await setupWorld();
  try {
    const a = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a])] })]);
    w.setServerConcerts([owned("c1", { pieces: [piece("p1", [ref(a)])] })]);
    w.putServerImage(a);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2], 4000, "chargement");
    await sleep(300);
    assert.equal(w.log.filter((e) => e.method === "POST").length, 0, "ni image ni concerts renvoyés");
    assert.equal(localStorage.getItem(pendingKey), null);
    assert.deepEqual(h.result[0][0].pieces[0].plans, [a]);
  } finally { w.restore(); }
});

// ───────────── Réception ─────────────

test("réception : référence réhydratée depuis le téléphone, sinon téléchargée, puis rangée dans IndexedDB", async () => {
  const w = await setupWorld();
  try {
    const local = image(); const distante = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [local])] })]);
    w.setServerConcerts([
      owned("c1", { pieces: [piece("p1", [ref(local)])] }),
      owned("c2", { pieces: [piece("p2", [ref(local), ref(distante)])] }),
    ]);
    w.putServerImage(local);
    w.putServerImage(distante);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && h.result[0].find((c) => c.id === "c2")?.pieces[0].plans[1] === distante, 8000, "téléchargement");
    const gets = w.log.filter((e) => e.path === "/api/plan-image" && e.method === "GET").map((e) => e.hash);
    assert.deepEqual(gets, [sha(distante)], "seule l'image absente du téléphone est téléchargée");
    await waitFor(() => idbConcert("c2")?.pieces[0].plans[1] === distante, 4000, "IndexedDB");
    assert.deepEqual(idbConcert("c2").pieces[0].plans, [local, distante]);
  } finally { w.restore(); }
});

test("réception hors ligne / image introuvable : la référence est gardée, rien ne casse", async () => {
  const w = await setupWorld();
  try {
    const absente = image();
    w.setServerConcerts([owned("c2", { pieces: [piece("p2", [ref(absente)])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && h.result[0].length === 1, 4000, "chargement");
    await sleep(300);
    assert.deepEqual(h.result[0][0].pieces[0].plans, [ref(absente)], "référence gardée (404 sur le compte)");
    assert.deepEqual(idbConcert("c2").pieces[0].plans, [ref(absente)]);
    // Le téléphone renvoie la référence telle quelle (le compte la connaît), sans tenter d'envoyer l'image.
    assert.equal(posts(w.log, "/api/plan-image").length, 0);
  } finally { w.restore(); }
});

test("téléchargement plus tard : hors ligne d'abord, l'image arrive au retour du réseau", async () => {
  const w = await setupWorld();
  try {
    const distante = image();
    w.setServerConcerts([owned("c2", { pieces: [piece("p2", [ref(distante)])] })]);
    w.putServerImage(distante);
    const m = await freshStorage();
    w.ctl.offline = true;
    // Le chargement initial lit le compte ; on coupe juste après pour le téléchargement.
    let first = true;
    const routed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (first && String(url).startsWith("/api/sync")) { first = false; w.ctl.offline = false; const r = await routed(url, init); w.ctl.offline = true; return r; }
      return routed(url, init);
    };
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && h.result[0].length === 1, 4000, "chargement");
    await sleep(200);
    assert.deepEqual(h.result[0][0].pieces[0].plans, [ref(distante)], "hors ligne : cadre « Plan non disponible »");
    w.ctl.offline = false;
    m.requestSyncRetry();
    await waitFor(() => h.result[0][0].pieces[0].plans[0] === distante, 4000, "téléchargement au retour du réseau");
  } finally { w.restore(); }
});

test("fusion : une référence du compte n'écrase jamais l'image locale du même concert", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const inconnue = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a])] })]);
    w.setServerConcerts([owned("c1", { pieces: [piece("p1", [ref(inconnue)])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2], 4000, "chargement");
    await sleep(300);
    assert.deepEqual(h.result[0][0].pieces[0].plans, [a], "écran : l'image locale reste");
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [a], "IndexedDB : l'image locale reste");
  } finally { w.restore(); }
});

test("« Recharger depuis le compte » : les références redeviennent les images du téléphone", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const b = image();
    seedLocal([owned("c1", { titre: "local", pieces: [piece("p1", [a, b])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    w.setServerConcerts([owned("c1", { titre: "version du compte", pieces: [piece("p1", [ref(b), ref(a)])] })]);
    const r = await h.result[3].reloadFromAccountSafe({ download: false });
    assert.ok(!r.refus, JSON.stringify(r));
    assert.equal(h.result[0][0].titre, "version du compte");
    assert.deepEqual(h.result[0][0].pieces[0].plans, [b, a]);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [b, a]);
  } finally { w.restore(); }
});

test("409 : la fusion avec le compte garde les images locales puis renvoie sans image", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const z = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    // Un autre appareil a ajouté c9 (avec une image) : notre prochain envoi reçoit un 409, fusionne, renvoie.
    w.putServerImage(z);
    w.setServerConcerts([...w.serverConcerts(), owned("c9", { pieces: [piece("p9", [ref(z)])] })]);
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "modifié" })));
    await waitFor(() => w.serverConcerts().some((c) => c.titre === "modifié") && localStorage.getItem(pendingKey) === null, 8000, "fusion et renvoi");
    assert.deepEqual(w.serverConcerts().map((c) => c.id).sort(), ["c1", "c9"]);
    assert.ok(noInlineImage(w.serverConcerts()));
    assert.deepEqual(h.result[0].find((c) => c.id === "c1").pieces[0].plans, [a]);
    await waitFor(() => h.result[0].find((c) => c.id === "c9")?.pieces[0].plans[0] === z, 4000, "image de c9 téléchargée");
  } finally { w.restore(); }
});

// ───────────── Le cas du régisseur : 20 Mo dont 19,8 Mo d'images ─────────────

test("20 Mo de concerts dont 19,8 Mo d'images : envoi des concerts < 300 Ko, chaque requête < 4 Mo", async () => {
  const w = await setupWorld();
  try {
    // Comme dans l'app, chaque image figure deux fois dans le JSON (plans[] et planDataUrl) :
    // 10 images distinctes de 0,99 Mo = 19,8 Mo d'images dans le JSON.
    const images = Array.from({ length: 10 }, () => image(0.99 * MO));
    const concerts = [];
    for (let i = 0; i < 40; i += 1) {
      const pieces = [piece(`p${i}`, i < 10 ? [images[i]] : [], { notes: "x".repeat(4000), percus: Array.from({ length: 6 }, (_, k) => ({ id: `r${i}-${k}`, nom: `Poste ${k}`, items: [] })) })];
      concerts.push(owned(`c${i}`, { pieces }));
    }
    const total = Buffer.byteLength(JSON.stringify(concerts));
    assert.ok(total > 19.9 * MO && total < 21 * MO, `taille de départ ${total}`);
    seedLocal(concerts);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 20000, "envoi complet");
    const syncPost = posts(w.log, "/api/sync");
    assert.equal(syncPost.length, 1);
    assert.ok(syncPost[0].bytes < 300 * 1024, `concerts envoyés : ${syncPost[0].bytes} octets`);
    assert.equal(posts(w.log, "/api/plan-image").length, 10);
    for (const e of w.log) assert.ok(e.bytes < 4 * MO, `requête ${e.path} de ${e.bytes} octets`);
    assert.equal(m.readSyncStatus().oversize.length, 0, "plus de bandeau « trop lourd »");
  } finally { w.restore(); }
});

test("une image seule de plus de 4 Mo : rien ne part, bandeau « un plan est trop lourd »", async () => {
  const w = await setupWorld();
  try {
    seedLocal([owned("c1", { pieces: [piece("p1", [image(4.2 * MO)])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && m.readSyncStatus().oversize.length === 1, 8000, "état trop lourd");
    assert.equal(w.log.filter((e) => e.method === "POST").length, 0);
    assert.equal(m.readSyncStatus().oversize[0].what, "plan");
    const { bannerInfo } = await imp("src/syncUi.js");
    assert.match(bannerInfo(m.readSyncStatus()).text, /^Un plan est trop lourd/);
    assert.ok(localStorage.getItem(pendingKey), "la modification reste en file");
  } finally { w.restore(); }
});

// ───────────── Route /api/plan-image ─────────────

async function routeCall(handler, { method = "POST", body, query = {}, email = EMAIL } = {}) {
  const res = mockRes();
  const cookie = email ? await sessionCookie(email) : "";
  await handler({ method, body, query, headers: { cookie } }, res);
  return res;
}

test("route plan-image : session obligatoire, empreinte vérifiée, taille, idempotence, cloisonnement", async () => {
  setEnv();
  const fake = installFakeSupabase({ delay: false });
  const quiet = console.error;
  console.error = () => {};
  try {
    const handler = (await imp("api/plan-image.js")).default;
    const a = image();
    assert.equal((await routeCall(handler, { body: { hash: sha(a), dataUrl: a }, email: null })).statusCode, 401, "sans session");
    assert.equal((await routeCall(handler, { method: "GET", query: { hash: sha(a) }, email: null })).statusCode, 401);
    assert.equal(fake.calls.length, 0, "aucune lecture ni écriture sans session");
    assert.equal((await routeCall(handler, { body: { hash: "abc", dataUrl: a } })).statusCode, 400, "empreinte mal formée");
    assert.equal((await routeCall(handler, { body: { hash: sha(image()), dataUrl: a } })).statusCode, 400, "empreinte d'une autre image");
    const texte = `data:text/html;base64,${Buffer.from("x".repeat(5000)).toString("base64")}`;
    assert.equal((await routeCall(handler, { body: { hash: sha(texte), dataUrl: texte } })).statusCode, 400, "pas une image");
    const heic = image().replace("image/jpeg", "image/heic");
    assert.equal((await routeCall(handler, { body: { hash: sha(heic), dataUrl: heic } })).statusCode, 200, "HEIC d'iPhone accepté (même règle que le téléphone)");
    fake.table("orkmap_plan_images").length = 0;
    const lourde = image(4.1 * MO);
    assert.equal((await routeCall(handler, { body: { hash: sha(lourde), dataUrl: lourde } })).statusCode, 413, "plus de 4 Mo");
    assert.equal(fake.table("orkmap_plan_images").length, 0);
    const r1 = await routeCall(handler, { body: { hash: sha(a), dataUrl: a } });
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.body.already, false);
    const r2 = await routeCall(handler, { body: { hash: sha(a), dataUrl: a } });
    assert.equal(r2.statusCode, 200, "déjà là = ok");
    assert.equal(r2.body.already, true);
    assert.equal(fake.table("orkmap_plan_images").length, 1, "une seule ligne");
    const row = fake.table("orkmap_plan_images")[0];
    assert.equal(row.email, EMAIL);
    assert.equal(row.bytes, a.length);
    const g = await routeCall(handler, { method: "GET", query: { hash: sha(a) } });
    assert.equal(g.statusCode, 200);
    assert.equal(g.body.dataUrl, a);
    const other = await routeCall(handler, { method: "GET", query: { hash: sha(a) }, email: OTHER });
    assert.equal(other.statusCode, 404, "un autre compte ne voit pas l'image");
    // Le même contenu envoyé par un autre compte est rangé à part (clé email + empreinte).
    assert.equal((await routeCall(handler, { body: { hash: sha(a), dataUrl: a }, email: OTHER })).body.already, false);
    assert.equal(fake.table("orkmap_plan_images").length, 2);
    assert.equal((await routeCall(handler, { method: "PUT", body: {} })).statusCode, 405);
  } finally { fake.restore(); console.error = quiet; }
});

// ───────────── /api/sync : anciens téléphones et règle 409 ─────────────

test("sync : un ancien téléphone qui envoie encore des images dans les concerts est accepté ; 409 inchangé", async () => {
  setEnv();
  const fake = installFakeSupabase({ delay: false });
  const quiet = { warn: console.warn, error: console.error };
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(" "));
  console.error = () => {};
  try {
    const mod = await imp("api/sync.js");
    const a = image(500_000);
    const r = await routeCall(mod.default, { body: { type: "concerts", data: [owned("c1", { pieces: [piece("p1", [a])] })], removedIds: [] } });
    assert.equal(r.statusCode, 200);
    assert.ok(warnings.some((w) => /inline image/.test(w)), "noté dans le journal");
    assert.deepEqual(mod.countInlineImages([{ x: a, y: [a], z: "data:image/png;base64,AAAA" }]).count, 2);
    const refused = await routeCall(mod.default, { body: { type: "concerts", data: [owned("c2")], removedIds: [] } });
    assert.equal(refused.statusCode, 409, "c1 manquant sans suppression explicite : refusé comme avant");
    const removed = await routeCall(mod.default, { body: { type: "concerts", data: [owned("c2")], removedIds: ["c1"] } });
    assert.equal(removed.statusCode, 200, "suppression explicite : acceptée comme avant");
  } finally { fake.restore(); console.warn = quiet.warn; console.error = quiet.error; }
});

// ───────────── Migration 007 ─────────────

test("migration 007 : table des images de plans, additive, RLS sans politique, anon/authenticated révoqués", () => {
  const dir = path.join(ROOT, "supabase/migrations");
  const file = fs.readdirSync(dir).find((n) => n.startsWith("007"));
  assert.ok(file, "007_*.sql introuvable");
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  assert.match(code, /create table if not exists public\.orkmap_plan_images/i);
  for (const col of ["email text", "hash text", "data text", "bytes int", "created_at timestamptz"]) assert.match(code, new RegExp(col, "i"), col);
  assert.match(code, /default now\(\)/i);
  assert.match(code, /primary key \(email, hash\)/i);
  assert.match(code, /alter table public\.orkmap_plan_images enable row level security/i);
  assert.match(code, /revoke all on table public\.orkmap_plan_images from anon, authenticated/i);
  assert.doesNotMatch(code, /create policy/i);
  assert.doesNotMatch(code, /\b(drop|truncate|delete\s+from|alter\s+table\s+\S+\s+drop)\b/i);
  assert.doesNotMatch(code, /orkmap_user_data|orkmap_sync_history/i, "ne touche à aucune table existante");
});

// ───────────── Bandeau par type ─────────────

test("bandeau : concerts, plan, partitions nommés ; photos = avis discret qui ne cache rien", async () => {
  const { bannerInfo } = await imp("src/syncUi.js");
  const ok = { online: true, pending: 0, sessionExpired: false, oversize: [], backupFailed: false, degraded: false };
  const c = bannerInfo({ ...ok, oversize: [{ type: "concerts", bytes: 20.4 * MO }] });
  assert.equal(c.kind, "oversize");
  assert.equal(c.card, true);
  assert.match(c.text, /^Tes concerts sont trop lourds .*\(20,4 Mo\)/);
  assert.match(bannerInfo({ ...ok, oversize: [{ type: "concerts", bytes: 4.3 * MO, what: "plan" }] }).text, /^Un plan est trop lourd .*\(4,3 Mo\)/);
  assert.match(bannerInfo({ ...ok, oversize: [{ type: "omr-scores", bytes: 5 * MO }] }).text, /^Tes partitions/);
  const p = bannerInfo({ ...ok, oversize: [{ type: "photos", bytes: 12 * MO }] });
  assert.equal(p.kind, "oversizePhotos");
  assert.equal(p.card, false, "pas d'encart");
  assert.equal(p.tone, "neutral", "pas de rouge");
  assert.match(p.text, /Photos .*12,0 Mo/);
  assert.equal(bannerInfo({ ...ok, online: false, oversize: [{ type: "photos", bytes: 12 * MO }] }).kind, "offline", "le réseau passe avant");
  assert.equal(bannerInfo({ ...ok, pending: 1, oversize: [{ type: "photos", bytes: 12 * MO }] }).kind, "pending");
  assert.equal(bannerInfo({ ...ok, degraded: true, oversize: [{ type: "photos", bytes: 12 * MO }] }).kind, "degraded");
  const both = bannerInfo({ ...ok, oversize: [{ type: "photos", bytes: 30 * MO }, { type: "concerts", bytes: 5 * MO }] });
  assert.equal(both.kind, "oversize");
  assert.match(both.text, /^Tes concerts .*\(5,0 Mo\)/, "la taille des photos ne se mélange pas aux concerts");
});

test("bandeau : des photos trop lourdes ne laissent pas « Envoi des modifications… » affiché pour toujours", async () => {
  reset();
  const m = await freshStorage();
  globalThis.fetch = async () => { throw new Error("aucun envoi attendu"); };
  m.markPending(EMAIL, "photos");
  assert.equal(m.readSyncStatus().pending, 1);
  await m.pushPending({ email: EMAIL, type: "photos", getPayload: () => ({ p1: [{ id: "x", dataUrl: "a".repeat(4.5 * MO) }] }) });
  const status = m.readSyncStatus();
  assert.equal(status.oversize[0].type, "photos");
  assert.equal(status.pending, 0, "rien n'est en cours d'envoi");
  assert.ok(m.readPending(EMAIL, "photos"), "la marque reste (rien n'est perdu)");
  const { bannerInfo } = await imp("src/syncUi.js");
  assert.equal(bannerInfo(status).kind, "oversizePhotos");
});
