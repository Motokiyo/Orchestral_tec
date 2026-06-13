import { createChallenge, isAllowedEmail, noStore, normalizeEmail, randomCode, sendLoginCode } from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const email = normalizeEmail(req.body?.email);
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ error: "Adresse non autorisée pour l'instant." });
  }

  const code = randomCode();
  try {
    const result = await sendLoginCode(email, code);
    res.setHeader("Set-Cookie", createChallenge(email, code));
    return res.status(200).json({ ok: true, devCode: result.dev ? code : undefined });
  } catch (err) {
    if (process.env.AUTH_FALLBACK_CODE) {
      console.warn("[orkmap-auth] email failed, fallback code enabled:", err.message);
      return res.status(200).json({ ok: true, fallback: true });
    }
    return res.status(500).json({ error: "Impossible d'envoyer le code.", detail: err.message });
  }
}
