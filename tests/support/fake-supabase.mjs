// Faux PostgREST en mémoire (sous-ensemble utilisé par les API OrkMap).
// Remplace globalThis.fetch : AUCUN appel réseau réel n'est possible.
import crypto from "node:crypto";

export function installFakeSupabase({ failTables = [] } = {}) {
  const tables = {};
  const calls = [];
  const realFetch = globalThis.fetch;
  const table = (n) => (tables[n] ||= []);

  function matches(row, filters) {
    return filters.every(([col, expr]) => {
      const [op, ...rest] = expr.split(".");
      const val = rest.join(".");
      const cell = row[col];
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

  globalThis.fetch = async (url, opts = {}) => {
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
