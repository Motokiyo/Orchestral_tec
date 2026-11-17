// LOT 5 : les images des plans sortent du JSON des concerts envoyé au compte.
// Le VRAI useConcerts (hooks et IndexedDB en mémoire, tests/support/lot3-*.mjs) parle aux VRAIES routes
// api/sync.js et api/plan-image.js, elles-mêmes branchées sur le faux Supabase en mémoire.
// Aucun appel réseau réel. Lancer : node --test tests/lot5-images.mjs
import test, { mock } from "node:test";
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
// Ordre des clés tel que le rend un vrai Postgres jsonb (longueur, puis octets) : sert à vérifier
// que le téléphone ne compare pas du texte JSON brut.
function jsonbOrder(v) {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))) o[k] = jsonbOrder(v[k]);
    return o;
  }
  return v;
}

async function setupWorld({ jsonb = false } = {}) {
  reset();
  setEnv();
  const fake = installFakeSupabase({ delay: false });
  const supaInner = globalThis.fetch;
  const supa = jsonb ? async (url, init = {}) => {
    const r = await supaInner(url, init);
    if (String(url).includes("orkmap_user_data") && (!init.method || init.method === "GET")) {
      const rows = await r.json();
      return new Response(JSON.stringify(rows.map((row) => ({ ...row, data: jsonbOrder(row.data) }))), { status: 200 });
    }
    return r;
  } : supaInner;
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
// Envois réels (les demandes « lesquelles as-tu ? » { have } sont comptées à part).
const posts = (log, p) => log.filter((e) => e.path === p && e.method === "POST" && !e.body?.have);
const haves = (log) => log.filter((e) => e.path === "/api/plan-image" && e.method === "POST" && e.body?.have);
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
    const order = w.log.filter((e) => e.method === "POST").map((e) => (e.body?.have ? "have" : e.path));
    assert.deepEqual(order, ["have", "/api/plan-image", "/api/plan-image", "/api/plan-image", "/api/sync"], "le compte dit ce qu'il a, puis les images, puis les concerts");
    const sent = w.serverConcerts();
    assert.ok(noInlineImage(sent), "le JSON envoyé ne contient plus d'image");
    assert.deepEqual(sent.find((x) => x.id === "c1").pieces[0].plans, [ref(a), ref(b)]);
    assert.equal(w.serverImages().length, 3);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [a, b], "IndexedDB garde les data URL");
    assert.deepEqual(h.result[0].find((x) => x.id === "c1").pieces[0].plans, [a, b], "l'écran aussi");
  } finally { w.restore(); }
});

test("échec passager d'une image : concerts en attente, pastille, un seul essai par période, reprise après l'attente", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const b = image();
    w.ctl.failImagePost = (hash) => hash === sha(b);
    seedLocal([owned("c1", { pieces: [piece("p1", [a, b])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && m.readSyncStatus().imageRetry, 8000, "échec signalé");
    assert.equal(posts(w.log, "/api/sync").length, 0, "aucun envoi de concerts (pas de référence orpheline)");
    assert.ok(localStorage.getItem(pendingKey), "la modification reste en file");
    const { bannerInfo } = await imp("src/syncUi.js");
    assert.equal(bannerInfo(m.readSyncStatus()).text, "Sauvegarde en ligne en échec, nouvel essai plus tard");
    const before = posts(w.log, "/api/plan-image").length;
    for (let i = 0; i < 4; i += 1) { m.requestSyncRetry(); await sleep(80); }
    assert.equal(posts(w.log, "/api/plan-image").length, before, "pendant l'attente : ni b ni a ne repartent");
    w.ctl.failImagePost = null;
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      mock.timers.tick(61_000); // la première attente (1 min) est passée
      m.requestSyncRetry();
      await waitFor(() => w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "réessai");
    } finally { mock.timers.reset(); }
    assert.deepEqual(posts(w.log, "/api/plan-image").slice(before).map((e) => e.hash), [sha(b)], "a, déjà sur le compte, n'est pas renvoyée");
    assert.deepEqual(w.serverConcerts()[0].pieces[0].plans, [ref(a), ref(b)]);
    assert.equal(m.readSyncStatus().imageRetry, false);
  } finally { w.restore(); }
});

test("S2 : une image refusée par le serveur pour sa forme n'est jamais renvoyée en boucle", async () => {
  const w = await setupWorld();
  try {
    const bonne = image(60_000);
    const raw = image(3_000_000);
    const cassee = raw.slice(0, 1000) + "\r\n" + raw.slice(1000); // retour à la ligne dans le base64
    seedLocal([owned("c1", { pieces: [piece("p1", [bonne, cassee])] })]);
    localStorage.setItem(pendingKey, JSON.stringify({ rev: 1, removedIds: [] }));
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    for (let i = 0; i < 5; i += 1) { m.requestSyncRetry(); await sleep(60); }
    const imgs = posts(w.log, "/api/plan-image");
    assert.equal(imgs.length, 2, "une fois chacune : la cassée part en copie nettoyée (validée avant envoi)");
    const nettoyee = cassee.replace("\r\n", "");
    assert.deepEqual(w.serverConcerts()[0].pieces[0].plans, [ref(bonne), ref(nettoyee)]);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [bonne, cassee], "l'original reste intact sur le téléphone");
    assert.equal(posts(w.log, "/api/sync").length, 1);
  } finally { w.restore(); }
});

test("refus définitif (400) : l'image n'est plus renvoyée, les concerts partent quand même", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const b = image();
    const routed = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === "/api/plan-image" && init.body && JSON.parse(init.body).hash === sha(b)) {
        w.log.push({ path: "/api/plan-image", method: "POST", body: { hash: sha(b), dataUrl: "x" }, hash: sha(b), bytes: init.body.length });
        return new Response(JSON.stringify({ error: "x" }), { status: 400 });
      }
      return routed(url, init);
    };
    seedLocal([owned("c1", { pieces: [piece("p1", [a, b])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "modifié" })));
    await waitFor(() => w.serverConcerts()[0].titre === "modifié", 8000, "second envoi");
    assert.equal(posts(w.log, "/api/plan-image").filter((e) => e.hash === sha(b)).length, 1, "un seul essai pour b");
    const plans = w.serverConcerts()[0].pieces[0].plans;
    assert.equal(plans[0], ref(a));
    assert.equal(plans[1], b, "dernier recours : l'image reste dans le JSON, puisque ça tient");
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
    // Le chargement initial lit le compte ; le téléphone passe hors ligne juste après.
    let first = true;
    const routed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const r = await routed(url, init);
      if (first && String(url).startsWith("/api/sync")) { first = false; navigator.onLine = false; }
      return r;
    };
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && h.result[0].length === 1, 4000, "chargement");
    await sleep(200);
    assert.deepEqual(h.result[0][0].pieces[0].plans, [ref(distante)], "hors ligne : cadre « Plan non disponible »");
    assert.equal(w.log.filter((e) => e.method === "GET" && e.path === "/api/plan-image").length, 0, "rien tenté hors ligne");
    navigator.onLine = true;
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

test("plan déjà stocké de plus de 4 Mo : une copie réduite part sous SON empreinte, l'original reste, rien ne bloque", async () => {
  const w = await setupWorld();
  const pi = await imp("src/planImages.js");
  const petites = new Map();
  pi.setImageShrinker(async (dataUrl) => {
    if (!petites.has(dataUrl)) petites.set(dataUrl, image(1.5 * MO));
    return petites.get(dataUrl);
  });
  try {
    const grosse = image(4.2 * MO);
    seedLocal([owned("c1", { pieces: [piece("p1", [grosse])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    const copie = petites.get(grosse);
    assert.deepEqual(posts(w.log, "/api/plan-image").map((e) => e.hash), [sha(copie)]);
    assert.deepEqual(w.serverConcerts()[0].pieces[0].plans, [ref(copie)]);
    for (const e of w.log) assert.ok(e.bytes < 4 * MO);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [grosse], "l'original reste intact");
    assert.equal(m.readSyncStatus().oversize.length, 0);
    // Réouverture : la copie du compte retrouve l'ORIGINAL (table copie → original), sans téléchargement ni renvoi.
    unmountAll();
    const m2 = await freshStorage();
    const before = w.log.length;
    const h2 = renderHook(m2.useConcerts, [[], EMAIL]);
    await waitFor(() => h2.result[2], 4000, "réouverture");
    await sleep(300);
    const after = w.log.slice(before);
    assert.equal(after.filter((e) => e.method === "GET" && e.path === "/api/plan-image").length, 0, "pas de téléchargement de la copie");
    assert.equal(after.filter((e) => e.method === "POST").length, 0, "rien renvoyé");
    assert.deepEqual(h2.result[0][0].pieces[0].plans, [grosse]);
    // Un autre téléphone qui reçoit la référence de la copie la retrouve par la même table : ici le
    // même compte reçoit c2 (venu d'ailleurs) qui cite la copie ; le téléphone y met l'original.
    const rec = await m2.resolveImagesFromDevice([owned("c2", { pieces: [piece("p2", [ref(copie)])] })], h2.result[0], EMAIL);
    assert.deepEqual(rec[0].pieces[0].plans, [grosse]);
  } finally { pi.setImageShrinker(null); w.restore(); }
});

test("plan illisible et trop lourd : concerts envoyés quand même, référence « non envoyée » et pastille", async () => {
  const w = await setupWorld();
  try {
    const grosse = image(4.2 * MO); // Node n'a pas de canvas : réduction impossible, dernier recours
    const a = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a, grosse])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    assert.deepEqual(w.serverConcerts()[0].pieces[0].plans, [ref(a), `orkimg-local:${sha(grosse)}`]);
    assert.deepEqual(posts(w.log, "/api/plan-image").map((e) => e.hash), [sha(a)], "la grosse n'est jamais tentée");
    assert.equal(m.readSyncStatus().unsentPlans, 1);
    const { bannerInfo, noteStockage } = await imp("src/syncUi.js");
    assert.equal(bannerInfo(m.readSyncStatus()), null, "pas de pastille permanente");
    assert.match(noteStockage(m.readSyncStatus()), /1 plan reste sur ce téléphone/);
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [a, grosse], "l'image reste sur le téléphone");
    // Réouverture : rien n'est renvoyé, rien n'est téléchargé, l'image locale reste affichée.
    unmountAll();
    const before = w.log.length;
    const m2 = await freshStorage();
    const h2 = renderHook(m2.useConcerts, [[], EMAIL]);
    await waitFor(() => h2.result[2], 4000, "réouverture");
    await sleep(300);
    assert.equal(w.log.slice(before).filter((e) => e.method === "POST" || (e.method === "GET" && e.path === "/api/plan-image")).length, 0);
    assert.deepEqual(h2.result[0][0].pieces[0].plans, [a, grosse]);
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
    const cassee = `data:image/jpeg;base64,${"A".repeat(3000)}\r\n${"B".repeat(3000)}`;
    assert.equal((await routeCall(handler, { body: { hash: sha(cassee), dataUrl: cassee } })).statusCode, 400, "base64 mal formé");
    const pasDataUrl = `https://exemple.invalid/${"x".repeat(3000)}`;
    assert.equal((await routeCall(handler, { body: { hash: sha(pasDataUrl), dataUrl: pasDataUrl } })).statusCode, 400, "pas un data URL");
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
    // « Lesquelles as-tu ? » : seulement les images du compte connecté.
    const z = image();
    const known = await routeCall(handler, { body: { have: [sha(a), sha(z)] } });
    assert.equal(known.statusCode, 200);
    assert.deepEqual(known.body.known, [sha(a)]);
    fake.table("orkmap_plan_images").splice(0, fake.table("orkmap_plan_images").length, ...fake.table("orkmap_plan_images").filter((r) => r.email === OTHER));
    assert.deepEqual((await routeCall(handler, { body: { have: [sha(a)] } })).body.known, [], "celle d'un autre compte ne compte pas");
    assert.equal((await routeCall(handler, { body: { have: [sha(a)] }, email: null })).statusCode, 401);
    assert.equal((await routeCall(handler, { body: { have: ["pas-une-empreinte"] } })).statusCode, 400);
    assert.equal((await routeCall(handler, { body: { have: Array.from({ length: 201 }, (_, i) => sha(String(i))) } })).statusCode, 400, "limite de taille");
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
  // 17/11/2026 : photos gardées sur le téléphone = AUCUNE pastille (elle gênait l'usage), info sous l'export.
  assert.equal(bannerInfo({ ...ok, oversize: [{ type: "photos", bytes: 12 * MO }] }), null, "aucune pastille pour les photos");
  assert.equal(bannerInfo({ ...ok, backupFailed: true }), null, "aucune pastille pour la copie de secours");
  assert.equal(bannerInfo({ ...ok, unsentPlans: 2 }), null, "aucune pastille pour les plans non sauvegardés");
  const { noteStockage } = await imp("src/syncUi.js");
  assert.match(noteStockage({ oversize: [{ type: "photos", bytes: 12 * MO }] }), /photos \(12,0 Mo\) restent sur ce téléphone/);
  assert.match(noteStockage({ unsentPlans: 2 }), /2 plans restent sur ce téléphone/);
  assert.equal(noteStockage({ oversize: [] }), "");
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
  assert.equal(bannerInfo(status), null, "photos gardées sur le téléphone : aucune pastille");
});

// ───────────── Relecture hostile (scripts S1 à S4, points 5, 6, 7) ─────────────

test("S1 : le compte (jsonb) réordonne les clés ; trois ouvertures sans modification ne renvoient rien", async () => {
  for (const jsonb of [false, true]) {
    const w = await setupWorld({ jsonb });
    try {
      const a = image();
      const c = owned("c1", { titre: "Concert", date: "2026-12-01", pieces: [piece("p1", [a], { couleur: "rouge" })] });
      seedLocal([c]);
      w.setServerConcerts([{ ...c, pieces: [piece("p1", [ref(a)], { couleur: "rouge" })] }]);
      w.putServerImage(a);
      for (let launch = 1; launch <= 3; launch += 1) {
        const m = await freshStorage();
        const h = renderHook(m.useConcerts, [[], EMAIL]);
        await waitFor(() => h.result[2], 4000, "ouverture");
        await sleep(200);
        unmountAll();
      }
      assert.equal(posts(w.log, "/api/sync").length, 0, `jsonb=${jsonb} : aucun renvoi`);
      assert.equal(w.fake.table("orkmap_sync_history").length, 0, `jsonb=${jsonb} : aucune ligne d'historique`);
      assert.equal(localStorage.getItem(pendingKey), null);
    } finally { w.restore(); }
  }
});

test("S1 : forme canonique (clés triées à tous les niveaux)", async () => {
  reset();
  const m = await freshStorage();
  assert.ok(m.sameData({ b: 1, a: [{ y: 2, x: 1 }] }, { a: [{ x: 1, y: 2 }], b: 1 }));
  assert.ok(!m.sameData({ a: [1, 2] }, { a: [2, 1] }), "l'ordre des listes compte toujours");
});

test("S3 : liste locale perdue (stockage plein ou neuf) : le compte dit ce qu'il a, rien n'est renvoyé", async () => {
  const pi = await imp("src/planImages.js");
  const onServer = new Set();
  const imgs = Array.from({ length: 6 }, () => image(400_000));
  const data = [{ id: "c1", pieces: [{ id: "p1", plans: imgs }] }];
  const counts = [];
  for (let launch = 1; launch <= 2; launch += 1) {
    let sent = 0;
    await pi.prepareConcertsUpload(EMAIL, data, {
      maxBytes: 4 * MO,
      registry: pi.createImageRegistry(), // nouveau lancement, rien de mémorisé sur le téléphone
      check: async (hashes) => new Set(Array.from(hashes).filter((h) => onServer.has(h))),
      upload: async (hash) => { sent += 1; onServer.add(hash); },
    });
    counts.push(sent);
  }
  assert.deepEqual(counts, [6, 0]);
});

test("S4 : table des images vidée côté compte : les images repartent avant les concerts", async () => {
  const w = await setupWorld();
  try {
    const a = image();
    seedLocal([owned("c1", { pieces: [piece("p1", [a])] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "premier envoi");
    w.fake.table("orkmap_plan_images").length = 0; // base remise à zéro
    h.result[1]((list) => list.map((c) => ({ ...c, titre: "modifié" })));
    await waitFor(() => w.serverConcerts()[0].titre === "modifié" && localStorage.getItem(pendingKey) === null, 8000, "second envoi");
    assert.equal(posts(w.log, "/api/plan-image").filter((e) => e.hash === sha(a)).length, 2, "renvoyée parce que le compte ne l'a plus");
    assert.equal(w.serverImages().length, 1, "plus de référence orpheline");
  } finally { w.restore(); }
});

test("point 6 : reconnaissance des images (paramètres, octet-stream, tout data: dans les plans)", async () => {
  const pi = await imp("src/planImages.js");
  const jpegB64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(6000)]).toString("base64");
  const avecNom = `data:image/jpeg;name=plan.jpg;base64,${jpegB64}`;
  const octet = `data:application/octet-stream;base64,${jpegB64}`;
  const heic = `data:application/octet-stream;base64,${Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), crypto.randomBytes(6000)]).toString("base64")}`;
  const pdfDansPlans = `data:application/pdf;base64,${crypto.randomBytes(6000).toString("base64")}`;
  const binaireHorsPlans = `data:application/octet-stream;base64,${Buffer.concat([Buffer.from("PK"), crypto.randomBytes(6000)]).toString("base64")}`;
  assert.ok(pi.isExternalImage(avecNom));
  assert.ok(pi.isExternalImage(octet), "octet-stream avec signature JPEG");
  assert.ok(pi.isExternalImage(heic), "octet-stream avec signature HEIC");
  assert.ok(!pi.isExternalImage(binaireHorsPlans), "binaire qui n'est pas une image, hors des plans : pas touché");
  assert.ok(!pi.isExternalImage(pdfDansPlans), "hors des plans, un PDF n'est pas une image");
  assert.ok(pi.isExternalImage(pdfDansPlans, true), "dans les plans, tout data: de plus de 2 Ko");
  const data = [{ id: "c1", logo: octet, fichier: binaireHorsPlans, pieces: [{ id: "p1", plans: [avecNom, pdfDansPlans], planDataUrl: pdfDansPlans }] }];
  const { data: out } = await pi.externalizeImages(data);
  assert.deepEqual(out[0].pieces[0].plans, [ref(avecNom), ref(pdfDansPlans)]);
  assert.equal(out[0].pieces[0].planDataUrl, ref(pdfDansPlans));
  assert.equal(out[0].logo, ref(octet));
  assert.equal(out[0].fichier, binaireHorsPlans);
  assert.ok(pi.isValidImageDataUrl(avecNom) && pi.isValidImageDataUrl(pdfDansPlans));
  assert.ok(!pi.isValidImageDataUrl(avecNom.slice(0, 500) + "\n" + avecNom.slice(500)));
});

test("point 1a : à l'import, le plan est réduit si besoin (original gardé si la réduction échoue)", async () => {
  const pi = await imp("src/planImages.js");
  const grosse = image(5 * MO);
  const petite = image(1 * MO);
  const vus = [];
  pi.setImageShrinker(async (dataUrl, opts) => { vus.push(opts); return petite; });
  try {
    assert.equal(await pi.shrinkPlanForStorage(grosse), petite);
    assert.deepEqual([vus[0].maxSide, vus[0].quality, vus[0].keepIfFits], [2400, 0.85, true]);
    assert.ok(vus[0].maxBytes <= 3 * MO, "largement sous la limite d'envoi");
    pi.setImageShrinker(async () => null);
    assert.equal(await pi.shrinkPlanForStorage(grosse), grosse, "illisible : on garde l'original");
  } finally { pi.setImageShrinker(null); }
});

test("point 5 : un téléchargement en échec ne bloque pas les suivants ; il attend avant un nouvel essai", async () => {
  reset();
  const m = await freshStorage();
  const imgs = [image(), image(), image()];
  const calls = [];
  let failFirst = true;
  globalThis.fetch = async (url) => {
    const hash = new URL(String(url), "https://t.invalid").searchParams.get("hash");
    calls.push(hash);
    if (hash === sha(imgs[0]) && failFirst) return new Response("{}", { status: 500 });
    const dataUrl = imgs.find((d) => sha(d) === hash);
    return new Response(JSON.stringify({ hash, dataUrl }), { status: 200 });
  };
  const quiet = console.warn;
  console.warn = () => {};
  try {
    let t = 1_000_000;
    const found = await m.downloadMissingImages(imgs.map(sha), { email: EMAIL, now: () => t });
    assert.deepEqual(Array.from(found.keys()), [sha(imgs[1]), sha(imgs[2])], "les suivantes arrivent");
    failFirst = false;
    calls.length = 0;
    await m.downloadMissingImages([sha(imgs[0])], { email: EMAIL, now: () => t + 30_000 });
    assert.equal(calls.length, 0, "pas de nouvel essai avant 1 min");
    const later = await m.downloadMissingImages([sha(imgs[0])], { email: EMAIL, now: () => t + 61_000 });
    assert.equal(later.get(sha(imgs[0])), imgs[0]);
  } finally { console.warn = quiet; }
});

test("point 7 : mode mémoire lente, la copie de secours avec référence ne remplace pas l'image d'IndexedDB", async () => {
  const w = await setupWorld();
  try {
    const a = image();
    seedLocal([owned("c1", { titre: "avant", pieces: [piece("p1", [a])] })]);
    // Fermé pendant un mode dégradé : la copie de secours porte la modification, mais une référence.
    localStorage.setItem(`orkmap-concerts-backup:${EMAIL}`, JSON.stringify([owned("c1", { titre: "modifié en mode lent", pieces: [piece("p1", [ref(a)])] })]));
    localStorage.setItem(`orkmap-degraded-edits:${EMAIL}`, JSON.stringify({ editedIds: ["c1"], removedIds: [] }));
    w.ctl.offline = true;
    navigator.onLine = false;
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2], 4000, "chargement");
    await sleep(150);
    assert.equal(h.result[0][0].titre, "modifié en mode lent", "la modification est réintégrée");
    assert.deepEqual(h.result[0][0].pieces[0].plans, [a], "l'image d'IndexedDB est gardée");
    assert.deepEqual(idbConcert("c1").pieces[0].plans, [a]);
  } finally { w.restore(); }
});

test("point 7 : « Recharger depuis le compte » avec un plan non téléchargeable garde la version du téléphone et le dit", async () => {
  const w = await setupWorld();
  try {
    const a = image(); const absente = image();
    seedLocal([owned("c1", { titre: "local", pieces: [piece("p1", [a])] }), owned("c2", { titre: "local 2", pieces: [] })]);
    const m = await freshStorage();
    const h = renderHook(m.useConcerts, [[], EMAIL]);
    await waitFor(() => h.result[2] && w.serverConcerts() && localStorage.getItem(pendingKey) === null, 8000, "envoi");
    w.setServerConcerts([
      owned("c1", { titre: "compte", pieces: [piece("p1", [ref(absente)])] }),
      owned("c2", { titre: "compte 2", pieces: [] }),
    ]);
    const r = await h.result[3].reloadFromAccountSafe({ download: false });
    assert.ok(!r.refus, JSON.stringify(r));
    assert.equal(r.plansManquants, 1);
    const c1 = h.result[0].find((c) => c.id === "c1");
    assert.equal(c1.titre, "local");
    assert.deepEqual(c1.pieces[0].plans, [a], "jamais une référence à la place de l'image du téléphone");
    assert.equal(h.result[0].find((c) => c.id === "c2").titre, "compte 2", "les autres sont rechargés");
    const { reloadReportText } = await imp("src/syncUi.js");
    assert.match(reloadReportText(r), /1 gardé en version du téléphone \(plans du compte non téléchargés/);
  } finally { w.restore(); }
});
