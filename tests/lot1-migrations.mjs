// LOT 1 : les migrations sont additives et activent la sécurité par lignes (RLS).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./support/lot1-env.mjs";

const dir = path.join(ROOT, "supabase/migrations");
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
const read = (prefix) => {
  const f = files.find((n) => n.startsWith(prefix));
  assert.ok(f, `migration ${prefix}_*.sql introuvable`);
  return fs.readFileSync(path.join(dir, f), "utf8");
};
const noDestructive = (sql) => assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /\b(drop|truncate|delete\s+from|alter\s+table\s+\S+\s+drop)\b/i);

test("004 : table des défis de connexion, RLS activée, additive", () => {
  const sql = read("004");
  assert.match(sql, /create table if not exists public\.orkmap_login_challenges/i);
  assert.match(sql, /alter table public\.orkmap_login_challenges enable row level security/i);
  for (const col of ["id", "email", "code_hash", "attempts", "created_at", "expires_at", "used_at"]) assert.match(sql, new RegExp(`\\b${col}\\b`));
  noDestructive(sql);
});

test("005 : RLS sur l'historique de synchro et les dumps de récupération, sans rien supprimer", () => {
  const sql = read("005");
  assert.match(sql, /alter table public\.orkmap_recovery_dumps enable row level security/i);
  assert.match(sql, /alter table public\.orkmap_sync_history enable row level security/i);
  noDestructive(sql);
});

test("I4 : le code n'utilise que la clé service_role pour ces tables", () => {
  const apiDir = path.join(ROOT, "api");
  for (const f of fs.readdirSync(apiDir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(apiDir, f), "utf8");
    assert.doesNotMatch(src, /SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE/i, f);
  }
  const srcDir = path.join(ROOT, "src");
  for (const f of fs.readdirSync(srcDir).filter((n) => /\.(js|jsx)$/.test(n))) {
    const src = fs.readFileSync(path.join(srcDir, f), "utf8");
    assert.doesNotMatch(src, /supabase/i, `${f} ne doit pas parler à Supabase directement`);
  }
});

test("006 : fonction atomique de demande de code (verrou par adresse, limites, IP), additive", () => {
  const sql = read("006");
  assert.match(sql, /create or replace function public\.orkmap_request_login_challenge/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\(/i);
  assert.match(sql, /add column if not exists ip/i);
  assert.match(sql, /revoke all on function public\.orkmap_request_login_challenge/i);
  assert.match(sql, /grant execute on function public\.orkmap_request_login_challenge[\s\S]*service_role/i);
  noDestructive(sql);
});
