// Environnement commun des tests du lot 3 : navigateur factice, faux serveur, hooks React en mémoire.
// Le code testé est le vrai src/useStorage.js (voir lot3-loader.mjs), pas une copie.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// LOT3_ROOT permet de rejouer les mêmes tests contre une copie du code d'avant correction.
export const ROOT = process.env.LOT3_ROOT || path.resolve(here, "../..");
register(pathToFileURL(path.join(here, "lot3-loader.mjs")));

export const imp = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
export const { world, renderHook, unmountAll } = await import(pathToFileURL(path.join(here, "lot3-stubs.mjs")).href);
export const EMAIL = "owner@test.invalid";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const concert = (id, extra = {}) => ({ id, titre: `C ${id}`, pieces: [], ...extra });
export const owned = (id, extra = {}) => ({ ...concert(id, extra), ownerEmail: EMAIL });

class FakeStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// Faux serveur : applique la règle 409 de api/sync.js (refuser si des ids connus manquent sans être déclarés supprimés).
export const server = { data: {}, posts: [] };

export function reset() {
  globalThis.localStorage = new FakeStorage();
  const listeners = {};
  const target = {
    addEventListener(t, f) { (listeners[t] ||= new Set()).add(f); },
    removeEventListener(t, f) { listeners[t]?.delete(f); },
    dispatchEvent(e) { for (const f of listeners[e.type] || []) f(e); return true; },
  };
  globalThis.window = Object.assign(target, { location: { origin: "https://t.invalid" } });
  globalThis.document = Object.assign({ visibilityState: "visible" }, { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true, userAgent: "test", storage: {} }, configurable: true, writable: true });
  for (const s of Object.values(world.stores)) s.clear();
  world.delay = 0; world.onPut = null; world.onOp = null; world.frozen = false; world.hold = null;
  server.data = { concerts: null, photos: null, "omr-scores": null }; server.posts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url, "https://t.invalid");
    const type = u.searchParams.get("type");
    const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });
    if (!init.method || init.method === "GET") return res(200, { data: server.data[type] ?? null });
    const b = JSON.parse(init.body);
    server.posts.push(b);
    const existing = server.data[b.type];
    if (Array.isArray(existing) && b.type !== "photos") {
      const have = new Set((b.data || []).map((x) => x.id));
      const removed = new Set((b.removedIds || []).map(String));
      if (existing.some((x) => !have.has(x.id) && !removed.has(String(x.id)))) return res(409, { error: "destructive" });
    }
    server.data[b.type] = structuredClone(b.data);
    return res(200, { ok: true });
  };
}

let n = 0;
export async function freshStorage() {
  n += 1;
  return import(`${pathToFileURL(path.join(ROOT, "src/useStorage.js")).href}?lot3=${n}`);
}

// Attend qu'une condition devienne vraie (ou échoue après `ms`).
export async function waitFor(cond, ms = 8000, what = "condition") {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`délai dépassé : ${what}`);
    await sleep(20);
  }
}
