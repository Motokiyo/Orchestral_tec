import { createSession, getSession, noStore } from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = getSession(req);
  // Renew the session cookie at each opening (sliding expiry).
  if (user) res.setHeader("Set-Cookie", createSession(user.email));
  return res.status(200).json({ user });
}
