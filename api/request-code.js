import {
  burnLoginChallenge,
  clientIp,
  isAllowedEmail,
  noStore,
  normalizeEmail,
  ownChallengeId,
  purgeOldLoginChallenges,
  randomCode,
  requestLoginChallenge,
  sendLoginCode,
} from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const email = normalizeEmail(req.body?.email);
  if (!isAllowedEmail(email)) {
    return res.status(403).json({ error: "Adresse non autorisée pour l'instant." });
  }

  let challenge = null;
  try {
    // Limites (1/minute et 5/heure par adresse, 10/heure par IP) et insertion en UN seul
    // appel atomique côté base. Un nouveau code n'annule que le défi lié au cookie de cette
    // requête : un tiers ne peut pas brûler le code en cours d'un autre navigateur.
    const code = randomCode();
    const attempt = await requestLoginChallenge(email, code, { ip: clientIp(req), replaceId: ownChallengeId(req, email) });
    if (attempt.limited) {
      res.setHeader("Retry-After", String(attempt.retryAfter));
      return res.status(429).json({ error: `Trop de demandes. Réessaie dans ${attempt.retryAfter} s.` });
    }
    challenge = attempt.challenge;
    const result = await sendLoginCode(email, code);
    purgeOldLoginChallenges().catch(() => {});
    res.setHeader("Set-Cookie", challenge.cookie);
    return res.status(200).json({ ok: true, devCode: result.dev ? code : undefined });
  } catch (err) {
    if (challenge) await burnLoginChallenge(challenge.id).catch(() => {});
    if (err.supabase) {
      console.error("[orkmap-auth] challenge store unavailable:", err.message);
      return res.status(503).json({ error: "Connexion momentanément indisponible. Réessaie dans quelques minutes." });
    }
    console.error("[orkmap-auth] email send failed:", err);
    return res.status(500).json({ error: "Impossible d'envoyer le code." });
  }
}
