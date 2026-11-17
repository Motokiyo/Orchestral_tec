// Crochet de chargement Node du lot 3 : fait tourner le VRAI src/useStorage.js hors du navigateur.
//  - « react » et « idb » sont remplacés par de petits équivalents en mémoire (lot3-stubs.mjs) ;
//  - import.meta.env (propre à Vite) devient un objet fixe ;
//  - les délais (4 s, 15 s, 5 s…) sont divisés par 10 pour que les scénarios « IndexedDB lent » durent
//    des secondes et non des minutes. Si un de ces délais change dans le code, ce crochet échoue
//    franchement au lieu de tester autre chose.
const here = new URL(".", import.meta.url).href;

const TIMINGS = [
  [/const LOCAL_LOAD_TIMEOUT_MS = 4000;/, "const LOCAL_LOAD_TIMEOUT_MS = 400;"],
  [/export const LOCAL_RETRY_TIMEOUTS_MS = \[15000, 30000, 60000\];/, "export const LOCAL_RETRY_TIMEOUTS_MS = [1500, 3000, 6000];"],
  [/const LOCAL_RETRY_PAUSE_MS = 5000;/, "const LOCAL_RETRY_PAUSE_MS = 500;"],
  [/const DEBOUNCE_MS = 500;/, "const DEBOUNCE_MS = 50;"],
];

export async function resolve(specifier, context, next) {
  if (specifier === "react") return { url: here + "lot3-stubs.mjs", shortCircuit: true };
  if (specifier === "idb") return { url: here + "lot3-stubs.mjs", shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!/\/src\/useStorage\.js(\?|$)/.test(url)) return result;
  let source = String(result.source).replace(/import\.meta\.env/g, '({ VITE_OWNER_EMAIL: "owner@test.invalid" })');
  for (const [pattern, replacement] of TIMINGS) {
    if (!pattern.test(source)) throw new Error(`lot3-loader : délai introuvable dans useStorage.js (${pattern}), mettre le crochet à jour`);
    source = source.replace(pattern, replacement);
  }
  return { ...result, source, shortCircuit: true };
}
