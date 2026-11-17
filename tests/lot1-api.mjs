// LOT 1 : failles d'accès (api/*.js). Aucun réseau : faux Supabase en mémoire.
import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importFresh, mockRes } from "./support/lot1-env.mjs";
import { installFakeSupabase } from "./support/fake-supabase.mjs";

const ALEX = "alex@test.invalid";
const OTHER = "autre@test.invalid";
const THIRD = "troisieme@test.invalid";

let fake;
let originalLog;
beforeEach(() => {
  process.env.AUTH_SECRET = "secret-de-test-uniquement";
  process.env.ALLOWED_EMAILS = `${ALEX},${OTHER},${THIRD}`;
  process.env.SUPABASE_URL = "https://x.fake.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-factice";
  process.env.AUTH_DEV_CODES = "true";
  delete process.env.RESEND_API_KEY;
  delete process.env.GMAIL_CLIENT_ID;
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
  fake = installFakeSupabase();
  originalLog = console.log;
  console.log = () => {};
});
afterEach(() => {
  fake.restore();
  console.log = originalLog;
  mock.timers.reset();
});

const cookieOf = (res) => {
  const raw = res.headers["Set-Cookie"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(Boolean).map((c) => c.split(";")[0]).join("; ");
};
const reqOf = ({ body = {}, cookie = "", headers = {}, method = "POST", query = {} } = {}) => ({
  method, body, query, headers: { cookie, ...headers },
});

async function login(email = ALEX) {
  const auth = await importFresh("api/auth-utils.js");
  return auth.createSession(email).split(";")[0];
}

// ───────────── C4 : /api/recovery-dump ─────────────

const dumpBody = (over = {}) => ({ email: ALEX, dumpType: "summary", recordKey: "k1", payload: { a: 1 }, meta: {}, ...over });

test("C4 : sans session, refus 401 et aucune écriture", async () => {
  const handler = (await importFresh("api/recovery-dump.js")).default;
  const res = mockRes();
  await handler(reqOf({ body: dumpBody(), headers: { origin: "https://orkmap.eiffelai.io" } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(fake.calls.length, 0);
});

test("C4 : session valide mais e-mail du corps différent → 403", async () => {
  const handler = (await importFresh("api/recovery-dump.js")).default;
  const res = mockRes();
  await handler(reqOf({ body: dumpBody({ email: OTHER }), cookie: await login(ALEX), headers: { origin: "https://orkmap.eiffelai.io" } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(fake.calls.length, 0);
});

test("C4 : session valide et e-mail identique → écrit, avec l'origine de l'en-tête", async () => {
  const handler = (await importFresh("api/recovery-dump.js")).default;
  const res = mockRes();
  await handler(reqOf({ body: dumpBody(), cookie: await login(ALEX), headers: { origin: "https://orkmap.eiffelai.io" } }), res);
  assert.equal(res.statusCode, 200);
  const row = fake.table("orkmap_recovery_dumps")[0];
  assert.equal(row.email, ALEX);
  assert.equal(row.source_origin, "https://orkmap.eiffelai.io");
});

test("C4 : l'origine ne vient jamais du corps de la requête", async () => {
  const handler = (await importFresh("api/recovery-dump.js")).default;
  const cookie = await login(ALEX);
  // En-tête absent + origine du corps hostile : elle est ignorée, jamais enregistrée.
  const res = mockRes();
  await handler(reqOf({ body: dumpBody({ sourceOrigin: "https://evil.example" }), cookie }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(fake.table("orkmap_recovery_dumps")[0].source_origin, null);
  // En-tête hostile : refus.
  const res2 = mockRes();
  await handler(reqOf({ body: dumpBody(), cookie, headers: { origin: "https://evil.example" } }), res2);
  assert.equal(res2.statusCode, 403);
  // En-tête absent + origine du corps autorisée : elle ne « légitime » pas non plus la requête.
  const res3 = mockRes();
  await handler(reqOf({ body: dumpBody({ sourceOrigin: "https://orkmap.eiffelai.io" }), cookie }), res3);
  assert.equal(fake.table("orkmap_recovery_dumps").at(-1).source_origin, null);
});

// ───────────── C3 : code de connexion ─────────────

async function requestCode(email = ALEX) {
  const handler = (await importFresh("api/request-code.js")).default;
  return handler;
}

test("C3 : le code et ses tentatives vivent côté serveur, pas dans le cookie", async () => {
  const handler = await requestCode();
  const res = mockRes();
  await handler(reqOf({ body: { email: ALEX } }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.devCode, /^\d{6}$/);
  const rows = fake.table("orkmap_login_challenges");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts, 0);
  assert.ok(rows[0].code_hash && !rows[0].code_hash.includes(res.body.devCode));
  const cookie = decodeURIComponent(cookieOf(res));
  assert.ok(!cookie.includes("attempts"), "plus de compteur dans le cookie");
  const body = JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[0], "base64url").toString());
  assert.equal(body.codeHash, undefined);
});

test("C3 : le bon code ouvre une session UNE seule fois", async () => {
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const r1 = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r1);
  const cookie = cookieOf(r1);
  const code = r1.body.devCode;
  const v1 = mockRes();
  await verify(reqOf({ body: { email: ALEX, code }, cookie }), v1);
  assert.equal(v1.statusCode, 200);
  assert.ok(String(v1.headers["Set-Cookie"]).includes("orkmap_session="));
  // Rejeu du même couple cookie + code : refusé.
  const v2 = mockRes();
  await verify(reqOf({ body: { email: ALEX, code }, cookie }), v2);
  assert.equal(v2.statusCode, 401);
});

test("C3 : 5 mauvais codes brûlent le défi, même si le client rejoue l'ancien cookie", async () => {
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const r = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r);
  const cookie = cookieOf(r); // l'attaquant ignore les nouveaux cookies et rejoue celui-ci
  const code = r.body.devCode;
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i += 1) {
    const v = mockRes();
    await verify(reqOf({ body: { email: ALEX, code: wrong }, cookie }), v);
    assert.equal(v.statusCode, 401);
  }
  const final = mockRes();
  await verify(reqOf({ body: { email: ALEX, code }, cookie }), final);
  assert.equal(final.statusCode, 401, "le bon code ne passe plus après 5 échecs");
  assert.equal(fake.table("orkmap_login_challenges")[0].attempts, 5);
});

test("C3 : un code expiré est refusé", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const r = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r);
  mock.timers.tick(11 * 60 * 1000);
  const v = mockRes();
  await verify(reqOf({ body: { email: ALEX, code: r.body.devCode }, cookie: cookieOf(r) }), v);
  assert.equal(v.statusCode, 401);
});

test("C3 : un nouveau code demandé depuis le MÊME navigateur invalide l'ancien de ce navigateur", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const r1 = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r1);
  mock.timers.tick(61 * 1000);
  const r2 = mockRes();
  await request(reqOf({ body: { email: ALEX }, cookie: cookieOf(r1) }), r2);
  assert.equal(r2.statusCode, 200);
  const v = mockRes();
  await verify(reqOf({ body: { email: ALEX, code: r1.body.devCode }, cookie: cookieOf(r1) }), v);
  assert.equal(v.statusCode, 401);
  const v2 = mockRes();
  await verify(reqOf({ body: { email: ALEX, code: r2.body.devCode }, cookie: cookieOf(r2) }), v2);
  assert.equal(v2.statusCode, 200);
});

test("C3 : un tiers qui demande un code pour la même adresse ne brûle PAS le défi d'un autre navigateur", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const victim = mockRes();
  await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": "198.51.100.1" } }), victim);
  mock.timers.tick(61 * 1000);
  const attacker = mockRes();
  await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": "203.0.113.9" } }), attacker);
  assert.equal(attacker.statusCode, 200);
  const v = mockRes();
  await verify(reqOf({ body: { email: ALEX, code: victim.body.devCode }, cookie: cookieOf(victim) }), v);
  assert.equal(v.statusCode, 200, "le code de la victime reste valable");
});

test("C3 : même quand la limite horaire est épuisée par un tiers, le code déjà envoyé reste vérifiable", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const victim = mockRes();
  await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": "198.51.100.1" } }), victim);
  for (let i = 0; i < 4; i += 1) {
    mock.timers.tick(61 * 1000);
    const a = mockRes();
    await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": `203.0.113.${10 + i}` } }), a);
    assert.equal(a.statusCode, 200);
  }
  mock.timers.tick(61 * 1000);
  const blocked = mockRes();
  await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": "198.51.100.1" } }), blocked);
  assert.equal(blocked.statusCode, 429, "la limite horaire est bien atteinte");
  const v = mockRes();
  await verify(reqOf({ body: { email: ALEX, code: victim.body.devCode }, cookie: cookieOf(victim) }), v);
  assert.equal(v.statusCode, 200, "le défi encore valable reste vérifiable");
});

test("C3 : deux demandes SIMULTANÉES pour la même adresse : une seule passe (limite atomique)", async () => {
  const request = await requestCode();
  const out = await Promise.all([1, 2, 3, 4].map(async () => {
    const r = mockRes();
    await request(reqOf({ body: { email: ALEX } }), r);
    return r.statusCode;
  }));
  assert.deepEqual(out.slice().sort(), [200, 429, 429, 429]);
  assert.equal(fake.table("orkmap_login_challenges").length, 1);
});

test("C3 : limite par IP (première adresse de x-forwarded-for), en plus de la limite par adresse", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const ask = async (email, ip) => { const r = mockRes(); await request(reqOf({ body: { email }, headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }), r); return r; };
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await ask(ALEX, "203.0.113.50")).statusCode, 200);
    assert.equal((await ask(OTHER, "203.0.113.50")).statusCode, 200);
    mock.timers.tick(61 * 1000);
  }
  const blocked = await ask(THIRD, "203.0.113.50");
  assert.equal(blocked.statusCode, 429, "11e demande de la même IP, même pour une autre adresse");
  assert.ok(Number(blocked.headers["Retry-After"]) > 0);
  assert.equal((await ask(THIRD, "203.0.113.99")).statusCode, 200, "une autre IP n'est pas touchée");
  assert.equal(fake.table("orkmap_login_challenges").find((r) => r.email === ALEX).ip, "203.0.113.50", "première adresse seulement");
});

test("C3 : en-tête x-forwarded-for absent ou invalide → pas de limite par IP, jamais d'erreur", async () => {
  const request = await requestCode();
  const r = mockRes();
  await request(reqOf({ body: { email: ALEX }, headers: { "x-forwarded-for": "<script>alert(1)</script>" } }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(fake.table("orkmap_login_challenges")[0].ip, null);
});

test("C3 : limite de débit, 1 par minute puis 5 par heure et par adresse", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-17T10:00:00Z") });
  const request = await requestCode();
  const ask = async (email = ALEX) => { const r = mockRes(); await request(reqOf({ body: { email } }), r); return r; };
  assert.equal((await ask()).statusCode, 200);
  const tooFast = await ask();
  assert.equal(tooFast.statusCode, 429, "2e demande dans la minute");
  assert.ok(Number(tooFast.headers["Retry-After"]) > 0);
  assert.equal((await ask(OTHER)).statusCode, 200, "une autre adresse n'est pas touchée");
  for (let i = 0; i < 4; i += 1) {
    mock.timers.tick(61 * 1000);
    assert.equal((await ask()).statusCode, 200, `demande n°${i + 2}`);
  }
  mock.timers.tick(61 * 1000);
  assert.equal((await ask()).statusCode, 429, "6e demande dans l'heure");
  mock.timers.tick(60 * 60 * 1000);
  assert.equal((await ask()).statusCode, 200, "l'heure écoulée, c'est de nouveau possible");
});

test("C3 : adresse non autorisée → 403, sans toucher à la base ni envoyer de code", async () => {
  const request = await requestCode();
  const r = mockRes();
  await request(reqOf({ body: { email: "intrus@test.invalid" } }), r);
  assert.equal(r.statusCode, 403);
  assert.equal(fake.calls.length, 0);
});

test("C3 : table absente (migration non appliquée) → échec net 503, aucune session", async () => {
  fake.restore();
  fake = installFakeSupabase({ failTables: ["rpc/orkmap_request_login_challenge"] });
  const request = await requestCode();
  const r = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r);
  assert.ok([500, 503].includes(r.statusCode));
  assert.equal(r.headers["Set-Cookie"], undefined);
});

test("C3 : cookie falsifié ou à la signature tronquée → refus propre (pas d'exception)", async () => {
  const request = await requestCode();
  const verify = (await importFresh("api/verify-code.js")).default;
  const r = mockRes();
  await request(reqOf({ body: { email: ALEX } }), r);
  const good = cookieOf(r);
  const [name, value] = good.split("=");
  const body = value.split(".")[0];
  for (const forged of [`${name}=${body}.abc`, `${name}=${body}.`, `${name}=${body}.${"A".repeat(43)}`, `${name}=zzz`]) {
    const v = mockRes();
    await verify(reqOf({ body: { email: ALEX, code: r.body.devCode }, cookie: forged }), v);
    assert.equal(v.statusCode, 401, forged);
  }
});

test("C3 : la comparaison des signatures et des codes est en temps constant", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { ROOT } = await import("./support/lot1-env.mjs");
  const src = fs.readFileSync(path.join(ROOT, "api/auth-utils.js"), "utf8");
  assert.match(src, /timingSafeEqual/);
  assert.doesNotMatch(src, /sign\(body\)\s*!==\s*mac/);
  assert.doesNotMatch(src, /payload\.codeHash\s*===/);
});

test("C3 non-régression : la session créée fonctionne toujours", async () => {
  const auth = await importFresh("api/auth-utils.js");
  const cookie = auth.createSession(ALEX).split(";")[0];
  assert.deepEqual(auth.getSession({ headers: { cookie } }), { email: ALEX });
  assert.equal(auth.getSession({ headers: { cookie: cookie.slice(0, -3) + "AAA" } }), null);
  assert.equal(auth.getSession({ headers: { cookie: "orkmap_session=x.y" } }), null);
});
