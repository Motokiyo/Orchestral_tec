import { clearCookie, noStore } from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Set-Cookie", [clearCookie("orkmap_session"), clearCookie("orkmap_login_challenge")]);
  return res.status(200).json({ ok: true });
}
