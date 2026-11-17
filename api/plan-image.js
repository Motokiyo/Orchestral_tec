// Images des plans, une par requête (lot 5). Le JSON des concerts ne porte plus que des références
// « orkimg:<sha256 hex du data URL> » ; l'image elle-même est rangée ici, par compte.
//   POST { hash, dataUrl } : range l'image du compte connecté. Idempotent (déjà là = ok).
//   POST { have: [hash…] } : « lesquelles as-tu ? » → { known: [...] } (le compte fait foi, le
//                            téléphone n'a qu'un cache). Au plus MAX_HAVE_HASHES empreintes.
//   GET ?hash=…            : rend l'image SI elle appartient au compte connecté (404 sinon).
// Table : orkmap_plan_images (supabase/migrations/007_orkmap_plan_images.sql), clé (email, hash).
import crypto from "node:crypto";
import { noStore, requireSession } from "./auth-utils.js";
import { supabaseConfig, supabaseFetch } from "./sync.js";
// Une seule définition de « image acceptable », partagée avec le téléphone : ce que le téléphone
// juge envoyable est exactement ce que le serveur accepte (pas de refus en boucle).
import { isValidImageDataUrl, MAX_HAVE_HASHES, MAX_IMAGE_BYTES as SHARED_MAX_IMAGE_BYTES } from "../src/planImages.js";

const TABLE = "orkmap_plan_images";
// La plateforme refuse un corps de plus de 4,5 Mo : une image au-delà de 4 Mo est refusée franchement.
export const MAX_IMAGE_BYTES = SHARED_MAX_IMAGE_BYTES;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
  },
};

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function parseHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return HASH_PATTERN.test(hash) ? hash : "";
}

function rowFilter(email, hash) {
  return `email=eq.${encodeURIComponent(email)}&hash=eq.${encodeURIComponent(hash)}`;
}

export default async function handler(req, res) {
  noStore(res);
  const session = requireSession(req, res);
  if (!session) return;

  if (!supabaseConfig()) {
    return res.status(503).json({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" });
  }

  if (req.method === "GET") {
    const hash = parseHash(req.query?.hash);
    if (!hash) return res.status(400).json({ error: "Empreinte invalide" });
    try {
      const rows = await supabaseFetch(`${TABLE}?${rowFilter(session.email, hash)}&select=data&limit=1`);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || typeof row.data !== "string") return res.status(404).json({ error: "Image introuvable" });
      return res.status(200).json({ hash, dataUrl: row.data });
    } catch (err) {
      console.error("[orkmap-plan-image] load failed:", err);
      return res.status(err.status || 500).json({ error: "Impossible de charger l'image." });
    }
  }

  if (req.method === "POST" && req.body && Object.prototype.hasOwnProperty.call(req.body, "have")) {
    const have = req.body.have;
    if (!Array.isArray(have) || have.length > MAX_HAVE_HASHES) return res.status(400).json({ error: `Liste invalide (au plus ${MAX_HAVE_HASHES} empreintes)` });
    const hashes = Array.from(new Set(have.map(parseHash)));
    if (hashes.some((h) => !h)) return res.status(400).json({ error: "Empreinte invalide" });
    if (!hashes.length) return res.status(200).json({ known: [] });
    try {
      const rows = await supabaseFetch(`${TABLE}?email=eq.${encodeURIComponent(session.email)}&hash=in.(${hashes.join(",")})&select=hash`);
      return res.status(200).json({ known: (Array.isArray(rows) ? rows : []).map((r) => r.hash) });
    } catch (err) {
      console.error("[orkmap-plan-image] check failed:", err);
      return res.status(err.status || 500).json({ error: "Impossible de vérifier les images." });
    }
  }

  if (req.method === "POST") {
    const hash = parseHash(req.body?.hash);
    const dataUrl = req.body?.dataUrl;
    if (!hash) return res.status(400).json({ error: "Empreinte invalide" });
    if (typeof dataUrl !== "string") return res.status(400).json({ error: "Image absente" });
    const bytes = Buffer.byteLength(dataUrl, "utf8");
    if (bytes > MAX_IMAGE_BYTES) return res.status(413).json({ error: "Image trop lourde", bytes });
    if (!isValidImageDataUrl(dataUrl)) return res.status(400).json({ error: "Image mal formée (data URL base64 attendu)" });
    if (sha256Hex(dataUrl) !== hash) return res.status(400).json({ error: "L'empreinte ne correspond pas à l'image" });
    try {
      const existing = await supabaseFetch(`${TABLE}?${rowFilter(session.email, hash)}&select=hash&limit=1`);
      if (Array.isArray(existing) && existing.length > 0) return res.status(200).json({ ok: true, already: true });
      await supabaseFetch(`${TABLE}?on_conflict=email,hash`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ email: session.email, hash, data: dataUrl, bytes }),
      });
      return res.status(200).json({ ok: true, already: false });
    } catch (err) {
      console.error("[orkmap-plan-image] save failed:", err);
      return res.status(err.status || 500).json({ error: "Impossible d'enregistrer l'image." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
