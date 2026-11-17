// Outillage commun des tests du lot 1 (node:test, aucune dépendance).
// LOT1_ROOT permet de rejouer les mêmes tests contre une copie du code d'origine.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.LOT1_ROOT || path.resolve(here, "../..");

register(pathToFileURL(path.join(here, "lot1-loader.mjs")));

let counter = 0;
// Chaque appel renvoie une instance neuve du module (états de module remis à zéro).
export async function importFresh(relative) {
  counter += 1;
  return import(`${pathToFileURL(path.join(ROOT, relative)).href}?fresh=${counter}`);
}

export class FakeStorage {
  constructor() { this.map = new Map(); this.failWrites = false; this.failKeys = null; }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.failWrites || (this.failKeys && this.failKeys(k))) {
      const e = new Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}

export function installBrowserStubs() {
  const storage = new FakeStorage();
  globalThis.localStorage = storage;
  globalThis.window = globalThis.window || { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, location: { origin: "https://test.invalid" } };
  return storage;
}

// Faux IndexedDB minimal : seulement ce que useStorage.js appelle sur l'objet db.
export function fakeDb(initial = {}) {
  const stores = {
    concerts: new Map(Object.entries(initial.concerts || {})),
    photos: new Map(Object.entries(initial.photos || {})),
    "omr-scores": new Map(Object.entries(initial["omr-scores"] || {})),
  };
  return {
    stores,
    objectStoreNames: Object.keys(stores),
    async getAll(name) { return Array.from(stores[name].values()); },
    async getAllKeys(name) { return Array.from(stores[name].keys()); },
    async get(name, key) { return stores[name].get(key); },
    async put(name, value, key) { stores[name].set(key ?? value.id, value); return key ?? value.id; },
  };
}

export function mockRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
