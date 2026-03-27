/**
 * Vercel Serverless Function — Gemini Vision extraction
 * POST /api/extract-ai
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: { titre, compositeur, duree, salle, chef, date, effectif, orchestre, percus }
 */

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
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

  const prompt = `Tu es un régisseur d'orchestre professionnel (20 ans Radio France/Philharmonie). Tu lis des plans de scène orchestraux comme un expert du métier.

PROCÈDE EN 6 ÉTAPES :
1. OBSERVER : structure du document — cartouche info (haut), nomenclature (marge), plan de placement (vue dessus), légende.
2. IDENTIFIER LE STYLE : compositeur → baroque (<1750) / classique (1750-1830) / romantique (1830-1910) / contemporain (>1950). Adapte ton interprétation.
3. CHERCHER LA NOMENCLATURE DANIELS : format Bois/Cuivres/Percus/Cordes. Séparateurs : points (2.2.2.2) ou tirets (0-1-0-1). Normalise en points.
   - Bois : Fl.Hb.Cl.Bn | Cuivres : Cor.Tp.Tb.Tuba | Percus : Timb.Percu.Hp.Clav [spécif] | Cordes : Vl1.Vl2.Alt.Vlc.CB
4. DÉCODER DANIELS PERCUS (W.X.Y.Z) : W=Timbaliers, X=Percussionnistes, Y=Harpes→orchestre.autres, Z=Claviers→orchestre.autres. Crochets [Cel/Pno] = quels claviers.
5. LIRE LE TEXTE ÉCRIT : effectifs explicites, annotations, noms.
6. CROISER : Daniels > Texte > Visuel. En cas de conflit, priorité dans cet ordre.

ABRÉVIATIONS (FR/EN/DE) :
Fl/Flûte/Flöte, Picc/Petite flûte, Hb/Ob/Hautbois, CA/Cor anglais/Englischhorn, Cl/Clarinette/Klarinette, Bcl/Clarinette basse, Fg/Bn/Basson/Fagott, Cbn/Contrebasson/Kontrafagott, Cor/Hn/Horn, Tp/Trp/Trompette, Tb/Tbn/Trombone/Posaune/Pos, Tuba, Vl/Vn/Violon/Geige, Vla/Va/Alto/Bratsche, Vlc/Vc/Violoncelle/Cello, CB/Cb/DB/Kb/Contrebasse/Kontrabass, Hp/Harpe, Pno/Piano/Klavier, Cel→CONTEXTE(voir règle), Org/Orgue, Clav/Clavecin/Cembalo.
Baroque : Dessus, Tailles, Viole, Violone, Théorbe → GARDER tels quels.

RÈGLES CRITIQUES :
• Timbalier = poste SÉPARÉ des Percu. Ne JAMAIS mélanger.
• Chaque timbale = 1 item séparé ("Timbale 1", "Timbale 2"...), pas "4 Timbales".
• W=0 dans Daniels → pas de pôle Timbalier.
• "Cel" entre crochets [Cel] ou près claviers/percus = Célesta. "Cel" dans section cordes = Violoncelle. VÉRIFIER LE CONTEXTE.
• Baroque : clavecin/orgue → orchestre.continuo (pas orchestre.autres). Remplir continuo si basse continue visible.
• "Direction" = chef d'orchestre.
• Si illisible/ambigu : NE PAS inventer. Mettre "" ou [].

EXEMPLES :
Ex1 : "0-1-0-1 / 0-2-0-0 / 1-0-0-2" + Purcell → baroque. Bois: 1Hb, 1Bn. Cuivres: 2Trp naturelles. Percus: 1Timb, 0Percu, 0Hp, 2 claviers continuo (orgue+clavecin).
Ex2 : "2.2.2.2 / 4.2.3.1 / 1.3.2.1 [Cel/Pno]" + Mahler → romantique. 1Timbalier, 3Percu, 2Harpes, Célesta+Piano dans autres.

OUTPUT JSON STRICT (sans markdown, sans backticks) :
{
  "titre": "", "compositeur": "", "duree": "", "salle": "", "chef": "", "date": "",
  "effectif": "notation Daniels normalisée en points",
  "orchestre": {
    "bois": ["3 Flûtes", ...],
    "cuivres": ["4 Cors", ...],
    "cordes": ["16 Violons I", ...],
    "autres": ["2 Harpes", "Célesta", ...]
  },
  "percus": [
    {"nom": "Timbalier", "items": [{"cat": "Timbales & Peaux", "nom": "Timbale 1"}, ...]},
    {"nom": "Percu 1", "items": [{"cat": "Claviers", "nom": "Vibraphone"}, {"cat": "Accessoires", "nom": "Triangle"}]}
  ]
}
Catégories percus : "Claviers", "Timbales & Peaux", "Accessoires", "Grosses pièces", "Stands & supports", "Baguettes & spécial"`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 16384 }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
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
    console.log("[extract-ai] Gemini raw response length:", text.length);
    console.log("[extract-ai] Gemini raw text:", text.slice(0, 500));
    const jsonStr = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Try to repair truncated JSON by closing open braces/brackets
      console.warn("[extract-ai] JSON parse failed, attempting repair:", parseErr.message);
      let repaired = jsonStr;
      // Close any unclosed strings
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) repaired += '"';
      // Close open brackets and braces
      let opens = 0, closesArr = 0, opensBrace = 0, closesBrace = 0;
      for (const ch of repaired) {
        if (ch === '[') opens++;
        if (ch === ']') closesArr++;
        if (ch === '{') opensBrace++;
        if (ch === '}') closesBrace++;
      }
      for (let i = 0; i < opens - closesArr; i++) repaired += ']';
      for (let i = 0; i < opensBrace - closesBrace; i++) repaired += '}';
      try {
        parsed = JSON.parse(repaired);
        console.log("[extract-ai] JSON repaired successfully");
      } catch (e2) {
        console.error("[extract-ai] JSON repair failed too:", e2.message);
        return res.status(500).json({ error: "Réponse IA invalide", raw: text.slice(0, 500) });
      }
    }
    console.log("[extract-ai] Parsed keys:", Object.keys(parsed));
    console.log("[extract-ai] Parsed titre:", parsed.titre, "compositeur:", parsed.compositeur, "effectif:", parsed.effectif);

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
