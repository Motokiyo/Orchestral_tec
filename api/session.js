import { getSession, noStore } from "./auth-utils.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({ user: getSession(req) });
}
