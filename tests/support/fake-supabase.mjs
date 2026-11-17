// Faux PostgREST en mémoire (sous-ensemble utilisé par les API OrkMap).
// Remplace globalThis.fetch : AUCUN appel réseau réel n'est possible.
import crypto from "node:crypto";

export function installFakeSupabase({ failTables = [], delay = true } = {}) {
  const tables = {};
  const calls = [];
  const realFetch = globalThis.fetch;
  const table = (n) => (tables[n] ||= []);

  function matches(row, filters) {
    return filters.every(([col, expr]) => {
      const [op, ...rest] = expr.split(".");
      const val = rest.join(".");
      const cell = row[col];
      if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").includes(String(cell));
      if (op === "is") return val === "null" ? cell == null : cell != null;
      if (op === "eq") return String(cell) === val;
      if (op === "neq") return String(cell) !== val;
      if (op === "gte") return String(cell) >= val;
      if (op === "gt") return String(cell) > val;
      if (op === "lt") return typeof cell === "number" ? cell < Number(val) : String(cell) < val;
      if (op === "lte") return String(cell) <= val;
      throw new Error(`filtre non géré: ${op}`);
    });
  }

  // Reproduit public.orkmap_request_login_challenge (migration 006) : mêmes limites, d'un seul bloc.
  function rpcRequestLoginChallenge(a) {
    const rows = table("orkmap_login_challenges");
    const now = Date.now();
    const hourAgo = now - 3600e3;
    const recent = rows.filter((r) => r.email === a.p_email && Date.parse(r.created_at) > hourAgo).map((r) => Date.parse(r.created_at)).sort((x, y) => y - x);
    const minInterval = (a.p_min_interval_seconds ?? 60) * 1000;
    const maxHour = a.p_max_per_hour ?? 5;
    const maxHourIp = a.p_max_per_hour_ip ?? 10;
    if (recent.length && recent[0] > now - minInterval) return { ok: false, reason: "email_interval", retry_after: Math.max(1, Math.ceil((recent[0] + minInterval - now) / 1000)) };
    if (recent.length >= maxHour) return { ok: false, reason: "email_hour", retry_after: Math.max(1, Math.ceil((recent[maxHour - 1] + 3600e3 - now) / 1000)) };
    if (a.p_ip) {
      const ipRecent = rows.filter((r) => r.ip === a.p_ip && Date.parse(r.created_at) > hourAgo).map((r) => Date.parse(r.created_at)).sort((x, y) => y - x);
      if (ipRecent.length >= maxHourIp) return { ok: false, reason: "ip_hour", retry_after: Math.max(1, Math.ceil((ipRecent[maxHourIp - 1] + 3600e3 - now) / 1000)) };
    }
    if (a.p_replace_id) {
      for (const r of rows) if (r.id === a.p_replace_id && r.email === a.p_email && !r.used_at) r.used_at = new Date(now).toISOString();
    }
    rows.push({ id: a.p_id, email: a.p_email, code_hash: a.p_code_hash, attempts: 0, created_at: new Date(now).toISOString(), expires_at: a.p_expires_at, used_at: null, ip: a.p_ip ?? null });
    return { ok: true };
  }

  globalThis.fetch = async (url, opts = {}) => {
    // Chaque appel cède la main : deux requêtes simultanées s'entrelacent comme sur le vrai réseau.
    // Un « vérifier puis insérer » en deux appels est donc vulnérable ici aussi ; une fonction
    // SQL (RPC) s'exécute d'un bloc, comme avec le verrou Postgres.
    if (delay) await new Promise((r) => setImmediate(r));
    const u = new URL(String(url));
    if (!u.hostname.endsWith("fake.supabase.invalid")) {
      throw new Error(`appel réseau réel interdit dans les tests : ${url}`);
    }
    const name = u.pathname.replace("/rest/v1/", "");
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ table: name, method, query: u.search, body });
    if (failTables.includes(name)) return new Response("table absente", { status: 404 });
    const reserved = new Set(["select", "order", "limit", "on_conflict"]);
    const filters = [...u.searchParams.entries()].filter(([k]) => !reserved.has(k));
    const wantRows = /return=representation/.test(opts.headers?.Prefer || "");
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (name === "rpc/orkmap_request_login_challenge") return json(rpcRequestLoginChallenge(body));
    const rows = table(name);

    if (method === "GET") {
      let out = rows.filter((r) => matches(r, filters));
      const order = u.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1));
      }
      const limit = Number(u.searchParams.get("limit") || 0);
      if (limit) out = out.slice(0, limit);
      return json(out.map((r) => structuredClone(r)));
    }
    if (method === "POST") {
      const items = Array.isArray(body) ? body : [body];
      const created = [];
      for (const item of items) {
        const conflict = u.searchParams.get("on_conflict");
        if (conflict) {
          const cols = conflict.split(",");
          const idx = rows.findIndex((r) => cols.every((c) => r[c] === item[c]));
          if (idx >= 0) { rows[idx] = { ...rows[idx], ...item }; created.push(rows[idx]); continue; }
        }
        const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...item };
        if (name === "orkmap_login_challenges" && row.attempts == null) row.attempts = 0;
        rows.push(row);
        created.push(row);
      }
      return wantRows ? json(created.map((r) => structuredClone(r)), 201) : new Response(null, { status: 201 });
    }
    if (method === "PATCH") {
      const hit = rows.filter((r) => matches(r, filters));
      for (const r of hit) Object.assign(r, body);
      return wantRows ? json(hit.map((r) => structuredClone(r))) : new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      const hit = rows.filter((r) => matches(r, filters));
      tables[name] = rows.filter((r) => !hit.includes(r));
      return wantRows ? json(hit) : new Response(null, { status: 204 });
    }
    throw new Error(`méthode non gérée: ${method}`);
  };

  return {
    tables, calls, table,
    restore() { globalThis.fetch = realFetch; },
  };
}
