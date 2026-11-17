// Équivalents minimaux de « react » (hooks) et « idb » (IndexedDB), en mémoire, pour piloter useConcerts.
// Un seul module pour les deux : le test et useStorage.js partagent ainsi le même `world`.

// ───────── idb ─────────
export const world = {
  // « images » : magasin du lot 6 (images des plans rangées à part, clé = empreinte).
  stores: { concerts: new Map(), photos: new Map(), "omr-scores": new Map(), images: new Map() },
  delay: 0,        // ms de latence sur chaque opération
  onPut: null,     // (store, clé) appelé juste avant chaque écriture : sert à « faire une modification pile à ce moment »
  // Lot 6 : (opération, store, clé) appelé avant CHAQUE opération ; peut lever une erreur (écriture refusée).
  onOp: null,
  // Lot 6 : application « tuée » : plus aucune opération ne se termine (promesse jamais résolue, sans minuterie).
  frozen: false,
  // Lot 6 : (opération, store, clé) → promesse à attendre avant l'opération (retenir une écriture précise).
  hold: null,
};
const keyPaths = { concerts: "id", photos: null, "omr-scores": "id", images: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => (v === undefined ? v : structuredClone(v));
async function gate(op, name, key) {
  if (world.hold) await world.hold(op, name, key);
  if (world.frozen) await new Promise(() => {});
  if (world.delay) await sleep(world.delay);
  if (world.frozen) await new Promise(() => {});
}
function storeApi(name) {
  const m = () => world.stores[name];
  return {
    async get(k) { world.onOp?.("get", name, k); await gate("get", name, k); return clone(m().get(k)); },
    async getAll() { world.onOp?.("getAll", name); await gate("getAll", name); return Array.from(m().values()).map(clone); },
    async getAllKeys() { world.onOp?.("getAllKeys", name); await gate("getAllKeys", name); return Array.from(m().keys()); },
    async put(v, k) {
      const key = keyPaths[name] ? v[keyPaths[name]] : k;
      world.onOp?.("put", name, key);
      world.onPut?.(name, key);
      await gate("put", name, key);
      m().set(key, clone(v));
      return key;
    },
    async delete(k) { world.onOp?.("delete", name, k); await gate("delete", name, k); m().delete(k); },
  };
}
export async function openDB() {
  return {
    objectStoreNames: { contains: () => true, [Symbol.iterator]: function* () { yield* Object.keys(world.stores); } },
    async getAll(n) { return storeApi(n).getAll(); },
    async getAllKeys(n) { return storeApi(n).getAllKeys(); },
    async get(n, k) { return storeApi(n).get(k); },
    async put(n, v, k) { return storeApi(n).put(v, k); },
    async delete(n, k) { return storeApi(n).delete(k); },
    transaction(n) {
      const s = storeApi(n);
      let chain = Promise.resolve();
      const wrap = (f) => (...a) => { const p = chain.then(() => f(...a)); chain = p.catch(() => {}); return p; };
      return { store: { get: wrap(s.get), put: wrap(s.put), delete: wrap(s.delete), getAllKeys: wrap(s.getAllKeys) }, get done() { return chain.then(() => undefined); } };
    },
  };
}

// ───────── react ─────────
let cur = null;
const mounted = new Set();
// Démonte tous les hooks encore montés (arrête leurs minuteries, sinon le processus de test ne se termine pas).
export function unmountAll() { for (const c of mounted) c.unmount(); mounted.clear(); }
export function renderHook(fn, args) {
  const comp = { hooks: [], idx: 0, fn, args, effects: [], result: undefined, dirty: false, rendering: false };
  const run = () => {
    if (comp.rendering) { comp.dirty = true; return; }
    do {
      comp.dirty = false; comp.rendering = true; comp.idx = 0; comp.effects = []; cur = comp;
      try { comp.result = comp.fn(...comp.args); } finally { cur = null; comp.rendering = false; }
      for (const e of comp.effects) e.cleanup?.();
      for (const e of comp.effects) { const c = e.fn(); e.slot.cleanup = typeof c === "function" ? c : undefined; }
    } while (comp.dirty);
  };
  comp.run = run;
  comp.setArgs = (...a) => { comp.args = a; run(); };
  comp.unmount = () => { for (const h of comp.hooks) h?.cleanup?.(); };
  mounted.add(comp);
  run();
  return comp;
}
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
export function useState(init) {
  const c = cur; const i = c.idx++;
  if (!c.hooks[i]) {
    const slot = { v: typeof init === "function" ? init() : init };
    slot.set = (nv) => { const v = typeof nv === "function" ? nv(slot.v) : nv; if (Object.is(v, slot.v)) return; slot.v = v; c.run(); };
    c.hooks[i] = slot;
  }
  return [c.hooks[i].v, c.hooks[i].set];
}
export function useRef(init) { const c = cur; const i = c.idx++; if (!c.hooks[i]) c.hooks[i] = { current: init }; return c.hooks[i]; }
export function useCallback(f, deps) { const c = cur; const i = c.idx++; const s = c.hooks[i]; if (s && same(s.deps, deps)) return s.f; c.hooks[i] = { f, deps }; return f; }
export function useEffect(f, deps) {
  const c = cur; const i = c.idx++; const s = c.hooks[i];
  if (s && deps && same(s.deps, deps)) return;
  const slot = s || {}; slot.deps = deps; c.hooks[i] = slot;
  c.effects.push({ fn: f, slot, cleanup: s?.cleanup });
}
