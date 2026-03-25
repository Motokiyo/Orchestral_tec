/**
 * PDF Import — extract orchestra data from AutoCAD-style PDF plans
 * Uses pdf.js (Mozilla) for client-side parsing
 */

let pdfjsLib = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");
  // Use the bundled worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

/**
 * Parse a PDF File and extract structured orchestra data
 * @param {File} file - PDF file to parse
 * @returns {Promise<ExtractedData>}
 */
export async function extractFromPdf(file) {
  const pdfjs = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  // Extract text from all pages
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return parseEicPlanText(fullText);
}

/**
 * Parse extracted text to identify structured data
 * Patterns based on EIC AutoCAD PDF conventions
 */
function parseEicPlanText(text) {
  const result = {
    titre: "",
    compositeur: "",
    duree: "",
    salle: "",
    chef: "",
    date: "",
    percus: [],
    instruments: [],
    nbPercussions: 0,
    nbStands: 0,
    nbChaises: 0,
    nbPupitres: 0,
  };

  // Normalize whitespace
  const clean = text.replace(/\s+/g, " ").trim();

  // Extract duration (XX' or ~XX')
  const dureeMatch = clean.match(/~?\d{1,3}['']/);
  if (dureeMatch) result.duree = dureeMatch[0].replace("'", "'");

  // Extract conductor — "Dir :" or "Dir:" pattern
  const chefMatch = clean.match(/Dir\s*:\s*([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)/i);
  if (chefMatch) result.chef = chefMatch[1].trim();

  // Extract venue
  const sallePatterns = ["CMPP", "SdC", "PP2", "Salle des concerts", "Grande salle", "Studio"];
  for (const s of sallePatterns) {
    if (clean.includes(s)) {
      result.salle = s;
      break;
    }
  }

  // Extract date (various formats)
  const dateMatch = clean.match(
    /(\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4})/i
  );
  if (dateMatch) result.date = dateMatch[1];

  // Try to extract composer + title from the beginning
  // Pattern: "Prénom NOM Titre..."
  const composerTitleMatch = clean.match(
    /^([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü]{2,}(?:\s+[A-ZÀ-Ü]{2,})?)\s+(.+?)(?:\s+(?:~?\d{1,3}[''']|Dir\s*:))/
  );
  if (composerTitleMatch) {
    result.compositeur = composerTitleMatch[1].trim();
    result.titre = composerTitleMatch[2].trim();
  }

  // Extract percussion sections — "Perc N :" or "percu N :" patterns
  const percuRegex = /[Pp]erc(?:u|ussion)?\s*(\d+)\s*(?:\([^)]*\))?\s*:\s*/g;
  const percuMatches = [...clean.matchAll(percuRegex)];

  if (percuMatches.length > 0) {
    for (let i = 0; i < percuMatches.length; i++) {
      const match = percuMatches[i];
      const num = parseInt(match[1]);
      const startIdx = match.index + match[0].length;
      const endIdx =
        i < percuMatches.length - 1
          ? percuMatches[i + 1].index
          : Math.min(startIdx + 500, clean.length);

      const section = clean.slice(startIdx, endIdx).trim();
      const items = parseInstrumentList(section);

      result.percus.push({
        nom: `Percu ${num}`,
        items,
      });
    }
  }

  // If no percu sections found, try to extract instruments from full text
  if (result.percus.length === 0) {
    const instruments = extractInstrumentsFromText(clean);
    if (instruments.length > 0) {
      result.percus.push({
        nom: "Percu 1",
        items: instruments,
      });
    }
  }

  // Count specific items
  result.instruments = result.percus.flatMap((p) => p.items.map((it) => it.nom));
  result.nbPercussions = result.percus.length;

  // Count stands, chairs, music stands from text
  const standMatch = clean.match(/(\d+)\s*(?:stand|pieds?\s*de\s*cymb)/gi);
  if (standMatch) {
    result.nbStands = standMatch.reduce((sum, m) => {
      const n = parseInt(m);
      return sum + (isNaN(n) ? 1 : n);
    }, 0);
  }

  const chaiseMatch = clean.match(/(\d+)\s*chaise/gi);
  if (chaiseMatch) {
    result.nbChaises = chaiseMatch.reduce((sum, m) => {
      const n = parseInt(m);
      return sum + (isNaN(n) ? 1 : n);
    }, 0);
  }

  const pupitreMatch = clean.match(/(\d+)\s*pupitre/gi);
  if (pupitreMatch) {
    result.nbPupitres = pupitreMatch.reduce((sum, m) => {
      const n = parseInt(m);
      return sum + (isNaN(n) ? 1 : n);
    }, 0);
  }

  return result;
}

/**
 * Parse a section of text into instrument items with categories
 */
function parseInstrumentList(text) {
  const items = [];
  // Split by common delimiters
  const parts = text
    .split(/(?:\d+\s+(?=[A-ZÀ-Ü]))|[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Also try splitting by quantity patterns "N instrument"
  const quantityRegex = /(\d+)\s+([A-Za-zÀ-ü][A-Za-zÀ-ü\s.''"\-()]+)/g;
  const matches = [...text.matchAll(quantityRegex)];

  if (matches.length > 0) {
    for (const m of matches) {
      const nom = m[2].trim();
      if (nom.length > 1 && !isNoise(nom)) {
        items.push({
          cat: categorizeInstrument(nom),
          nom: `${m[1]} ${nom}`,
        });
      }
    }
  }

  // Also extract standalone instrument names
  const knownInstruments = [
    "vibraphone", "xylophone", "marimba", "glockenspiel", "glock",
    "timbale", "tam-tam", "tamtam", "tam tam", "grosse caisse",
    "caisse claire", "bongo", "conga", "triangle", "cymbale",
    "wood block", "wood-block", "woodblock", "claves", "fouet",
    "castagnette", "maracas", "guiro", "gong", "steel drum",
    "enclume", "célesta", "cloches tubulaires", "cloches tubes",
    "crotale", "bodhran", "roto-tom", "rototom",
  ];

  const lowerText = text.toLowerCase();
  for (const instr of knownInstruments) {
    if (lowerText.includes(instr) && !items.some((it) => it.nom.toLowerCase().includes(instr))) {
      // Find with context
      const idx = lowerText.indexOf(instr);
      const start = Math.max(0, idx - 3);
      const end = Math.min(text.length, idx + instr.length + 20);
      let extracted = text.slice(start, end).trim();
      // Clean up
      extracted = extracted.replace(/[,;].*$/, "").trim();
      if (extracted.length > 1) {
        items.push({
          cat: categorizeInstrument(instr),
          nom: extracted,
        });
      }
    }
  }

  return items;
}

function extractInstrumentsFromText(text) {
  return parseInstrumentList(text);
}

function isNoise(s) {
  const noise = ["dir", "chef", "salle", "date", "durée", "duree", "lieu"];
  return noise.some((n) => s.toLowerCase().startsWith(n));
}

/**
 * Categorize an instrument name into one of the 6 categories
 */
function categorizeInstrument(name) {
  const lower = name.toLowerCase();

  // Claviers
  if (
    /(vibraphone|xylophone|marimba|glockenspiel|glock|célesta|celesta|cloches?\s*tub)/i.test(lower)
  ) {
    return "Claviers";
  }

  // Timbales & Peaux
  if (
    /(timbale|caisse|bongo|conga|tambour|bodhran|roto.?tom|tom\b|darbouka)/i.test(lower)
  ) {
    return "Timbales & Peaux";
  }

  // Grosses pièces
  if (/(gong|tam.?tam|grosse caisse|steel drum|enclume|tôle)/i.test(lower)) {
    return "Grosses pièces";
  }

  // Stands & supports
  if (/(stand|pied|rack|table|tréteau|pupitre|support)/i.test(lower)) {
    return "Stands & supports";
  }

  // Baguettes & spécial
  if (/(baguette|mailloche|archet|ampli|électro)/i.test(lower)) {
    return "Baguettes & spécial";
  }

  // Default: Accessoires
  return "Accessoires";
}
