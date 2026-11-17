import crypto from "node:crypto";

// Liste d'accès du login par code : variable d'environnement ALLOWED_EMAILS
// (adresses séparées par des virgules). Sans variable, personne ne passe.
export function allowedEmails() {
  return new Set(
    String(process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

const CHALLENGE_COOKIE = "orkmap_login_challenge";
const SESSION_COOKIE = "orkmap_session";
const TEN_MINUTES = 10 * 60;
// Sliding session: renewed on every app opening (see api/session.js), so a
// regular user is never logged out, even after a long offline tour.
const SESSION_MAX_AGE = 90 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized) && allowedEmails().has(normalized);
}

function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return "orkmap-local-dev-secret";
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function pack(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

// Comparaison en temps constant (évite de deviner une signature octet par octet).
// timingSafeEqual lève une exception si les longueurs diffèrent : on les égalise d'abord.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

function unpack(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac || !safeEqual(sign(body), mac)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function readCookies(req) {
  return Object.fromEntries(
    String(req.headers?.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function cookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" || process.env.VERCEL ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name) {
  return cookie(name, "", 0);
}

// ── Code de connexion : l'état vit côté serveur (table orkmap_login_challenges) ──
// Le cookie ne contient que l'identifiant du défi (signé). Le code, le nombre
// d'essais et l'usage unique sont comptés dans la base : rejouer un ancien
// cookie ne remet donc plus rien à zéro. Voir supabase/migrations/004_*.sql.
const CHALLENGES = "orkmap_login_challenges";
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

// Appel PostgREST avec la clé service_role (jamais côté navigateur).
async function supabaseRest(path, options = {}) {
  const config = supabaseConfig();
  if (!config) {
    const error = new Error("Supabase is not configured");
    error.status = 503;
    error.supabase = true;
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
    const error = new Error(`Supabase ${resp.status}: ${body.slice(0, 200)}`);
    error.status = resp.status;
    error.supabase = true;
    throw error;
  }
  // return=minimal : 201 ou 204 sans corps.
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

function challengeCookieValue(id, email, expires) {
  return cookie(CHALLENGE_COOKIE, pack({ id, email: normalizeEmail(email), expires }), TEN_MINUTES);
}

function codeHash(id, email, code) {
  return sign(`${id}:${normalizeEmail(email)}:${String(code || "").trim()}`);
}

// Adresse IP du client : première adresse de x-forwarded-for (Vercel remplace cet
// en-tête, un client ne peut pas y glisser la sienne). null si absente ou invalide :
// la limite par IP est alors simplement sautée (jamais de blocage collectif).
export function clientIp(req) {
  const raw = String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "");
  const first = raw.split(",")[0].trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : null;
}

// Identifiant du défi lié au cookie de CETTE requête (même adresse, non expiré), sinon null.
export function ownChallengeId(req, email) {
  const payload = unpack(readCookies(req)[CHALLENGE_COOKIE]);
  if (!payload?.id || payload.email !== normalizeEmail(email) || payload.expires < Date.now()) return null;
  return payload.id;
}

// Demande de code, ATOMIQUE : la fonction SQL orkmap_request_login_challenge (migration 006)
// prend un verrou par adresse, vérifie 1/minute et 5/heure par adresse et par IP, annule
// seulement le défi du navigateur qui redemande (replaceId), puis insère. Le code n'est
// jamais stocké en clair. Renvoie { limited: true, retryAfter } ou { limited: false, challenge }.
export async function requestLoginChallenge(email, code, { ip = null, replaceId = null } = {}) {
  const norm = normalizeEmail(email);
  const id = crypto.randomUUID();
  const expires = Date.now() + TEN_MINUTES * 1000;
  const result = await supabaseRest("rpc/orkmap_request_login_challenge", {
    method: "POST",
    body: JSON.stringify({
      p_email: norm,
      p_ip: ip,
      p_id: id,
      p_code_hash: codeHash(id, norm, code),
      p_expires_at: new Date(expires).toISOString(),
      p_replace_id: replaceId,
    }),
  });
  if (!result?.ok) {
    return { limited: true, retryAfter: Math.max(1, Number(result?.retry_after) || 60), reason: result?.reason };
  }
  return { limited: false, challenge: { id, expires, cookie: challengeCookieValue(id, norm, expires) } };
}

// Rend un défi inutilisable (envoi du courriel raté).
export async function burnLoginChallenge(id) {
  await supabaseRest(`${CHALLENGES}?id=eq.${encodeURIComponent(id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  });
}

// Ménage : les défis de plus d'un jour ne servent plus à rien (best effort).
export async function purgeOldLoginChallenges() {
  const before = new Date(Date.now() - ONE_DAY_MS).toISOString();
  await supabaseRest(`${CHALLENGES}?created_at=lt.${encodeURIComponent(before)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

// Vérifie un code. Chaque essai est compté AVANT la comparaison, par une
// écriture conditionnelle (attempts doit être encore à la valeur lue) : deux
// requêtes simultanées ne peuvent pas obtenir le même essai gratuit. Le succès
// consomme le défi par une écriture conditionnelle (used_at encore vide) : un
// code ne sert qu'une fois.
// Renvoie { ok: true } | { ok: false, nextCookie? } ; lève une erreur Supabase si la base est injoignable.
export async function consumeLoginChallenge(req, email, code) {
  const norm = normalizeEmail(email);
  const payload = unpack(readCookies(req)[CHALLENGE_COOKIE]);
  if (!payload?.id || payload.email !== norm || payload.expires < Date.now()) return { ok: false };

  const rows = await supabaseRest(`${CHALLENGES}?id=eq.${encodeURIComponent(payload.id)}&select=*&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.used_at || normalizeEmail(row.email) !== norm) return { ok: false };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false };
  const attempts = Number(row.attempts || 0);
  if (attempts >= MAX_ATTEMPTS) return { ok: false, nextCookie: clearCookie(CHALLENGE_COOKIE) };

  const counted = await supabaseRest(
    `${CHALLENGES}?id=eq.${encodeURIComponent(row.id)}&used_at=is.null&attempts=eq.${attempts}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ attempts: attempts + 1 }),
    },
  );
  if (!Array.isArray(counted) || counted.length === 0) return { ok: false };

  if (!safeEqual(codeHash(row.id, norm, code), row.code_hash)) {
    return { ok: false, nextCookie: attempts + 1 >= MAX_ATTEMPTS ? clearCookie(CHALLENGE_COOKIE) : undefined };
  }

  const used = await supabaseRest(`${CHALLENGES}?id=eq.${encodeURIComponent(row.id)}&used_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString() }),
  });
  if (!Array.isArray(used) || used.length === 0) return { ok: false };
  return { ok: true };
}

export function createSession(email) {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  return cookie(SESSION_COOKIE, pack({ email: normalizeEmail(email), expires }), SESSION_MAX_AGE);
}

export function getSession(req) {
  const payload = unpack(readCookies(req)[SESSION_COOKIE]);
  if (!payload || payload.expires < Date.now() || !isAllowedEmail(payload.email)) return null;
  return { email: payload.email };
}

export function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export function randomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function sendLoginCode(email, code) {
  const from = String(process.env.AUTH_EMAIL_FROM || "").trim();
  const subject = "Code de connexion OrkMap";
  const text = `Ton code de connexion OrkMap est ${code}. Il expire dans 10 minutes.`;

  if (process.env.RESEND_API_KEY) {
    if (!from) throw new Error("AUTH_EMAIL_FROM is required to send login codes with Resend");
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, text }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Resend error: ${body.slice(0, 200)}`);
    }
    return { dev: false };
  }

  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: String(process.env.GMAIL_CLIENT_ID).trim(),
        client_secret: String(process.env.GMAIL_CLIENT_SECRET).trim(),
        refresh_token: String(process.env.GMAIL_REFRESH_TOKEN).trim(),
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResp.ok) {
      const body = await tokenResp.text();
      throw new Error(`Gmail token error: ${body.slice(0, 200)}`);
    }

    const { access_token: accessToken } = await tokenResp.json();
    const gmailFrom = String(process.env.GMAIL_FROM || "").trim();
    // Sans GMAIL_FROM, Gmail utilise l'adresse du compte authentifié.
    const raw = [
      ...(gmailFrom ? [`From: ${gmailFrom}`] : []),
      `To: ${email}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text,
    ].join("\r\n");

    const sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
    });
    if (!sendResp.ok) {
      const body = await sendResp.text();
      throw new Error(`Gmail send error: ${body.slice(0, 200)}`);
    }
    return { dev: false };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Email provider is required in production");
  }
  if (process.env.AUTH_DEV_CODES !== "true") {
    throw new Error("Email provider is required unless AUTH_DEV_CODES=true");
  }
  console.log(`[orkmap-auth] code for ${email}: ${code}`);
  return { dev: true };
}

export function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Connexion requise" });
    return null;
  }
  return session;
}
