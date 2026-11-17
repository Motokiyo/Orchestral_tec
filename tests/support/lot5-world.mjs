// Monde de test des lots 5 et 6 (déplacé de tests/lot5-images.mjs, rien de changé) : le VRAI useConcerts
// (hooks et IndexedDB en mémoire, lot3-*.mjs) parle aux VRAIES routes api/sync.js et api/plan-image.js,
// elles-mêmes branchées sur le faux Supabase en mémoire. Aucun appel réseau réel.
import crypto from "node:crypto";
import { world, EMAIL, reset, imp } from "./lot3-env.mjs";
import { installFakeSupabase } from "./fake-supabase.mjs";

export const OTHER = "autre@test.invalid";
export const MO = 1024 * 1024;

export const image = (bytes = 60_000) => `data:image/jpeg;base64,${crypto.randomBytes(Math.floor((bytes * 3) / 4)).toString("base64")}`;
export const sha = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
export const ref = (dataUrl) => `orkimg:${sha(dataUrl)}`;
export const piece = (id, plans, extra = {}) => ({ id, titre: `P ${id}`, plans, planDataUrl: plans[plans.length - 1] || null, percus: [], ...extra });
export const pendingKey = `orkmap-pending:${EMAIL}:concerts`;

export function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

export function setEnv() {
  process.env.AUTH_SECRET = "secret-de-test-uniquement";
  process.env.ALLOWED_EMAILS = `${EMAIL},${OTHER}`;
  process.env.SUPABASE_URL = "https://x.fake.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-factice";
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
}

export async function sessionCookie(email) {
  const auth = await imp("api/auth-utils.js");
  return auth.createSession(email).split(";")[0];
}

// Le téléphone (fetch relatif « /api/… ») parle aux vraies routes ; les routes parlent au faux Supabase.
// Ordre des clés tel que le rend un vrai Postgres jsonb (longueur, puis octets) : sert à vérifier
// que le téléphone ne compare pas du texte JSON brut.
export function jsonbOrder(v) {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))) o[k] = jsonbOrder(v[k]);
    return o;
  }
  return v;
}

export async function setupWorld({ jsonb = false } = {}) {
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

export const seedLocal = (list) => { for (const c of list) world.stores.concerts.set(c.id, structuredClone(c)); };
export const idbConcert = (id) => world.stores.concerts.get(id);
// Envois réels (les demandes « lesquelles as-tu ? » { have } sont comptées à part).
export const posts = (log, p) => log.filter((e) => e.path === p && e.method === "POST" && !e.body?.have);
export const haves = (log) => log.filter((e) => e.path === "/api/plan-image" && e.method === "POST" && e.body?.have);
export const noInlineImage = (value) => !JSON.stringify(value).includes("data:image/");
// Lot 6 : sur le téléphone, une image est soit DANS le concert (ancien format, pas encore rangé), soit
// rangée à part dans le magasin « images » et citée par « orkimg:<empreinte> ». `surTel` rend ce que le
// téléphone affiche : la référence est remplacée par l'image du magasin, après vérification de son
// empreinte ; une référence sans image sur le téléphone reste une référence (cadre « Plan non disponible »).
export const surTel = (plans) => plans.map((v) => {
  if (typeof v !== "string" || !v.startsWith("orkimg:")) return v;
  const hash = v.slice("orkimg:".length);
  const img = world.stores.images.get(hash);
  return typeof img === "string" && sha(img) === hash ? img : v;
});
