/**
 * Vercel Serverless Function — Gemini Vision extraction
 * POST /api/extract-ai
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { titre, compositeur, duree, salle, chef, date, effectif, orchestre, percus }
 */

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Debug: log available env vars (keys only, not values)
  console.log("[extract-ai] ENV keys:", Object.keys(process.env).filter(k => k.includes("GOOGLE") || k.includes("API")).join(", ") || "NONE");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GOOGLE_API_KEY not configured on server",
      debug: Object.keys(process.env).filter(k => k.includes("GOOGLE") || k.includes("KEY")).join(", ") || "no matching env vars"
    });
  }

  const { image } = req.body || {};
  if (!image) {
    return res.status(400).json({ error: "Missing image field" });
  }

  const base64 = image.replace(/^data:image\/\w+;base64,/, "");
  const mimeType = image.match(/^data:(image\/\w+);/)?.[1] || "image/jpeg";

  const prompt = `Tu es un assistant spécialisé dans l'extraction de données de plans de scène d'orchestre.

Analyse cette image de plan de scène et extrais les informations suivantes au format JSON strict :

{
  "titre": "titre de la pièce ou du concert",
  "compositeur": "nom du compositeur",
  "duree": "durée (ex: 25')",
  "salle": "nom de la salle / lieu",
  "chef": "nom du chef d'orchestre (peut être indiqué comme Direction)",
  "date": "date du concert",
  "effectif": "notation Daniels si visible (ex: 3.3.3.3 - 4.3.3.1 - 1.3.1.1 - 14.12.10.8.6)",
  "orchestre": {
    "bois": ["3 Flûtes", "3 Hautbois", ...],
    "cuivres": ["4 Cors", "3 Trompettes", ...],
    "cordes": ["16 Violons I", "14 Violons II", ...],
    "autres": ["2 Harpes", "Piano", ...]
  },
  "percus": [
    {
      "nom": "Timbalier",
      "items": [{"cat": "Timbales & Peaux", "nom": "4 Timbales"}]
    },
    {
      "nom": "Percu 1",
      "items": [
        {"cat": "Claviers", "nom": "Vibraphone"},
        {"cat": "Accessoires", "nom": "Triangle"}
      ]
    }
  ]
}

Règles :
- Ne retourne QUE le JSON, sans texte autour, sans backticks markdown.
- Si un champ n'est pas visible, mets une chaîne vide "" ou un tableau vide [].
- Pour les catégories d'instruments de percussion : "Claviers", "Timbales & Peaux", "Accessoires", "Grosses pièces", "Stands & supports", "Baguettes & spécial"
- "Direction" = chef d'orchestre.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(resp.status).json({ error: `Gemini API error: ${err.slice(0, 200)}` });
    }

    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return res.status(200).json({
      titre: parsed.titre || "",
      compositeur: parsed.compositeur || "",
      duree: parsed.duree || "",
      salle: parsed.salle || "",
      chef: parsed.chef || "",
      date: parsed.date || "",
      effectif: parsed.effectif || "",
      orchestre: parsed.orchestre || null,
      percus: (parsed.percus || []).map(p => ({
        nom: p.nom || "Percu",
        items: (p.items || []).map(it => ({
          cat: it.cat || "Accessoires",
          nom: it.nom || "",
        })).filter(it => it.nom),
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
// v3 1774639072
