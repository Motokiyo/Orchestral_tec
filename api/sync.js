import { noStore, requireSession } from "./auth-utils.js";

const TABLE = "orkmap_user_data";
const TYPES = new Set(["concerts", "photos", "omr-scores"]);

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

function parseType(value) {
  const type = String(value || "").trim();
  return TYPES.has(type) ? type : "";
}

export default async function handler(req, res) {
  noStore(res);
  const session = requireSession(req, res);
  if (!session) return;

  if (!supabaseConfig()) {
    return res.status(503).json({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required" });
  }

  if (req.method === "GET") {
    const type = parseType(req.query?.type);
    if (!type) return res.status(400).json({ error: "Invalid sync type" });

    try {
      const rows = await supabaseFetch(
        `${TABLE}?email=eq.${encodeURIComponent(session.email)}&type=eq.${encodeURIComponent(type)}&select=data,updated_at&limit=1`
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      return res.status(200).json({ data: row?.data ?? null, updatedAt: row?.updated_at ?? null });
    } catch (err) {
      console.error("[orkmap-sync] load failed:", err);
      return res.status(err.status || 500).json({ error: "Impossible de charger la synchronisation." });
    }
  }

  if (req.method === "POST") {
    const type = parseType(req.body?.type);
    if (!type) return res.status(400).json({ error: "Invalid sync type" });

    try {
      const rows = await supabaseFetch(`${TABLE}?on_conflict=email,type`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({
          email: session.email,
          type,
          data: req.body?.data ?? null,
          updated_at: new Date().toISOString(),
        }),
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      return res.status(200).json({ ok: true, updatedAt: row?.updated_at ?? null });
    } catch (err) {
      console.error("[orkmap-sync] save failed:", err);
      return res.status(err.status || 500).json({ error: "Impossible d'enregistrer la synchronisation." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
