import crypto from "node:crypto";

export const ALLOWED_EMAILS = new Set([
  "alexferran@gmail.com",
  "larminaux.claire@gmail.com",
  "galileo@leparede.org",
]);

const CHALLENGE_COOKIE = "orkmap_login_challenge";
const SESSION_COOKIE = "orkmap_session";
const TEN_MINUTES = 10 * 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isAllowedEmail(email) {
  return ALLOWED_EMAILS.has(normalizeEmail(email));
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

function unpack(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac || sign(body) !== mac) return null;
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
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name) {
  return cookie(name, "", 0);
}

export function createChallenge(email, code) {
  const expires = Date.now() + TEN_MINUTES * 1000;
  const codeHash = sign(`${normalizeEmail(email)}:${code}`);
  return cookie(CHALLENGE_COOKIE, pack({ email: normalizeEmail(email), codeHash, expires, attempts: 0 }), TEN_MINUTES);
}

export function verifyChallenge(req, email, code) {
  const token = readCookies(req)[CHALLENGE_COOKIE];
  const payload = unpack(token);
  if (!payload || payload.expires < Date.now()) return { ok: false, expired: true };
  if (payload.email !== normalizeEmail(email)) return { ok: false, nextCookie: bumpChallenge(payload) };
  if (payload.attempts >= MAX_ATTEMPTS) return { ok: false, expired: true };
  const expected = sign(`${normalizeEmail(email)}:${String(code || "").trim()}`);
  if (payload.codeHash === expected) return { ok: true };
  return { ok: false, nextCookie: bumpChallenge(payload) };
}

function bumpChallenge(payload) {
  const attempts = Number(payload.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) return clearCookie(CHALLENGE_COOKIE);
  const secondsLeft = Math.max(1, Math.floor((payload.expires - Date.now()) / 1000));
  return cookie(CHALLENGE_COOKIE, pack({ ...payload, attempts }), secondsLeft);
}

export function createSession(email) {
  const expires = Date.now() + THIRTY_DAYS * 1000;
  return cookie(SESSION_COOKIE, pack({ email: normalizeEmail(email), expires }), THIRTY_DAYS);
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
  const from = process.env.AUTH_EMAIL_FROM || process.env.SMTP_USER || "OrkMap <noreply@eiffelai.io>";
  const subject = "Code de connexion OrkMap";
  const text = `Ton code de connexion OrkMap est ${code}. Il expire dans 10 minutes.`;

  if (process.env.RESEND_API_KEY) {
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
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResp.ok) {
      const body = await tokenResp.text();
      throw new Error(`Gmail token error: ${body.slice(0, 200)}`);
    }
    const { access_token: accessToken } = await tokenResp.json();
    const gmailFrom = process.env.GMAIL_FROM || from;
    const raw = [
      `From: ${gmailFrom}`,
      `To: ${email}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text,
    ].join("\r\n");
    const encoded = Buffer.from(raw).toString("base64url");
    const sendResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!sendResp.ok) {
      const body = await sendResp.text();
      throw new Error(`Gmail send error: ${body.slice(0, 200)}`);
    }
    return { dev: false };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_CONNECT_HOST || process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      tls: {
        servername: process.env.SMTP_HOST,
      },
    });
    await transporter.sendMail({ from, to: email, subject, text });
    return { dev: false };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Email provider is required in production");
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
