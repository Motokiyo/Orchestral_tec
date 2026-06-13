import { clearCookie, createSession, isAllowedEmail, noStore, normalizeEmail, verifyChallenge } from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!isAllowedEmail(email)) return res.status(403).json({ error: "Adresse non autorisée." });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Code invalide." });
  const result = verifyChallenge(req, email, code);
  if (!result.ok) {
    if (result.nextCookie) res.setHeader("Set-Cookie", result.nextCookie);
    return res.status(401).json({ error: "Code expiré ou incorrect." });
  }

  res.setHeader("Set-Cookie", [createSession(email), clearCookie("orkmap_login_challenge")]);
  return res.status(200).json({ email });
}
