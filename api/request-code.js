import {
  burnLoginChallenge,
  burnLoginChallenges,
  checkRequestRate,
  createLoginChallenge,
  isAllowedEmail,
  noStore,
  normalizeEmail,
  purgeOldLoginChallenges,
  randomCode,
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
    // 1 demande par minute et 5 par heure, par adresse (compté dans la base).
    const rate = await checkRequestRate(email);
    if (rate.limited) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      return res.status(429).json({ error: `Trop de demandes. Réessaie dans ${rate.retryAfter} s.` });
    }

    const code = randomCode();
    challenge = await createLoginChallenge(email, code);
    const result = await sendLoginCode(email, code);
    // Un nouveau code annule les précédents ; le ménage est facultatif.
    await burnLoginChallenges(email, challenge.id).catch((err) => console.warn("[orkmap-auth] burn failed:", err.message));
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
