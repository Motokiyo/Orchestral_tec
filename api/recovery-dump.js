import { isAllowedEmail, noStore, normalizeEmail } from "./auth-utils.js";

const TABLE = "orkmap_recovery_dumps";
const ALLOWED_ORIGINS = new Set([
  "https://orkmap.eiffelai.io",
  "https://orchestral-tec.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

async function supabaseFetch(path, options = {}) {
  const config = supabaseConfig();
  if (!config) {
    const error = new Error("Supabase is not configured");
    error.status = 503;
    throw error;
  }

  const resp = await fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    const error = new Error(`Supabase ${resp.status}: ${body.slice(0, 300)}`);
    error.status = resp.status;
    throw error;
  }

  if (resp.status === 204) return null;
  return resp.json();
}

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!supabaseConfig()) return res.status(503).json({ error: "Supabase is not configured" });

  const origin = String(req.headers.origin || req.body?.sourceOrigin || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: "Origin not allowed" });

  const email = normalizeEmail(req.body?.email);
  if (!isAllowedEmail(email)) return res.status(403).json({ error: "Email not allowed" });

  const dumpType = String(req.body?.dumpType || "").slice(0, 80);
  const recordKey = String(req.body?.recordKey || "").slice(0, 240);
  if (!dumpType || !recordKey) return res.status(400).json({ error: "dumpType and recordKey are required" });

  try {
    const rows = await supabaseFetch(TABLE, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        email,
        source_origin: origin || null,
        dump_type: dumpType,
        record_key: recordKey,
        payload: req.body?.payload ?? null,
        meta: req.body?.meta ?? {},
      }),
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    return res.status(200).json({ ok: true, id: row?.id ?? null });
  } catch (err) {
    console.error("[orkmap-recovery] dump failed:", err);
    return res.status(err.status || 500).json({ error: "Impossible d'enregistrer le dump de récupération." });
  }
}
