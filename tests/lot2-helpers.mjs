// Aides communes des tests du LOT 2 (aucun réseau, aucun secret réel).
// Les réponses du fournisseur IA sont toujours simulées.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
export const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Import tolérant : le module peut ne pas exister encore (test écrit avant le code).
export async function impOrNull(p) {
  try { return await imp(p); } catch (e) { return null; }
}

// ── Passerelle /api/extract-ai : environnement factice + fournisseur simulé ──
process.env.AUTH_SECRET = 'test-only-secret';
process.env.ALLOWED_EMAILS = 'test@example.invalid';
process.env.DEEPSEEK_API_KEY = 'dummy-not-a-key';

const auth = await imp('api/auth-utils.js');
const cookie = auth.createSession('test@example.invalid').split(';')[0];
export const extractAi = await imp('api/extract-ai.js');
export const handler = extractAi.default;

export const IMG = 'data:image/jpeg;base64,AAAA';

/**
 * Appelle le vrai handler avec un fournisseur simulé.
 * provider : { content?, finish_reason?, status?, text?, throwError?, hang? }
 *   - content : chaîne ou objet (sérialisé) renvoyé comme message du modèle
 *   - status  : code HTTP du fournisseur (défaut 200)
 *   - hang    : true => la requête ne répond jamais (sauf abandon par AbortSignal)
 */
export async function callExtract({ images = [IMG], body = {}, provider = {}, noSession = false } = {}) {
  let sent = null;
  let fetchCalls = 0;
  globalThis.fetch = async (url, init) => {
    fetchCalls++;
    sent = JSON.parse(init.body);
    if (provider.throwError) throw provider.throwError;
    if (provider.hang) {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
        });
      });
    }
    const status = provider.status ?? 200;
    const content = typeof provider.content === 'string' ? provider.content : JSON.stringify(provider.content ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content }, finish_reason: provider.finish_reason ?? 'stop' }] }),
      text: async () => provider.text ?? 'erreur fournisseur simulée avec détail sensible SECRET-DETAIL-42',
    };
  };
  let status = 0; let json = null; const headers = {};
  const res = {
    setHeader(k, v) { headers[k] = v; },
    status(c) { status = c; return this; },
    json(b) { json = b; return this; },
  };
  const req = { method: 'POST', headers: noSession ? {} : { cookie }, body: { images, mode: 'concert', ...body } };
  await handler(req, res);
  return { status, body: json, sent, fetchCalls, headers };
}

export const promptOf = (c) => c.sent.messages[0].content[0].text;
export const imageParts = (c) => c.sent.messages[0].content.filter((p) => p.type === 'image_url');

// Parcourt un objet et signale tout nombre NaN / Infinity.
export function findBadNumbers(obj, pathStr = '') {
  const bad = [];
  if (typeof obj === 'number' && !Number.isFinite(obj)) bad.push(pathStr + '=' + obj);
  else if (Array.isArray(obj)) obj.forEach((v, i) => bad.push(...findBadNumbers(v, `${pathStr}[${i}]`)));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) bad.push(...findBadNumbers(v, `${pathStr}.${k}`));
  return bad;
}
