/**
 * PDF Import — extract orchestra data from stage plan PDFs
 * Handles multiple formats: EIC, Radio France, Orchestre Lamoureux, generic
 * Uses pdf.js (Mozilla) for client-side parsing
 */

import * as pdfjs from "pdfjs-dist/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).href;

// ══════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════

export async function extractFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  // ── 1. Extract text items with positions ──
  const allItems = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      if (item.str && item.str.trim()) {
        allItems.push({
          str: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
          page: i,
        });
      }
    }
  }

  // Sort top-to-bottom, left-to-right
  allItems.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) < 4) return a.x - b.x;
    return b.y - a.y;
  });

  // Group into lines (items at similar y)
  const lines = [];
  let curLine = [];
  let curY = null;
  for (const item of allItems) {
    if (curY !== null && Math.abs(item.y - curY) > 4) {
      if (curLine.length) lines.push(curLine.join(" "));
      curLine = [];
    }
    curLine.push(item.str.trim());
    curY = item.y;
  }
  if (curLine.length) lines.push(curLine.join(" "));

  const fullText = lines.join("\n");
  console.log("[PlateauMap] Lines:", lines);

  // ── 2. Render page 1 as image for plan display ──
  let planDataUrl = null;
  try {
    planDataUrl = await renderPageToImage(pdf);
  } catch (err) {
    console.warn("[PlateauMap] Could not render plan:", err);
  }

  // ── 3. Detect format & parse ──
  const result = {
    titre: "",
    compositeur: "",
    duree: "",
    salle: "",
    chef: "",
    date: "",
    effectif: "",
    effectifDetail: null,
    orchestre: null,  // { bois: [...], cuivres: [...], cordes: [...], autres: [...] }
    percus: [],
    planDataUrl,
  };

  const format = detectFormat(lines);
  console.log("[PlateauMap] Detected format:", format);

  if (format === "radiofrance") {
    parseRadioFrance(lines, result);
  } else if (format === "eic") {
    parseEic(lines, result);
  } else if (format === "lamoureux") {
    parseLamoureux(lines, result);
  } else {
    parseGeneric(lines, result);
  }

  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
  }

  // Build orchestre from effectifDetail — always overrides label-based detection
  if (result.effectifDetail) {
    result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }

  // Create percu slots from effectif if none found
  if (result.percus.length === 0 && result.effectifDetail?.percussions) {
    const perc = result.effectifDetail.percussions;
    // Timbales → Timbalier(s) — always with 4 timbales by default
    const timb = perc["Timbales"] || 0;
    for (let i = 1; i <= timb; i++) {
      result.percus.push({
        nom: timb === 1 ? "Timbalier" : `Timbalier ${i}`,
        items: [{ cat: "Timbales & Peaux", nom: "4 Timbales" }],
      });
    }
    // Percussion → Percu N
    const percCount = perc["Percussion"] || 0;
    for (let i = 1; i <= percCount; i++) {
      result.percus.push({ nom: `Percu ${i}`, items: [] });
    }
    // If nothing was created but total > 0, create generic slots
    if (result.percus.length === 0) {
      const total = perc.total || 0;
      for (let i = 1; i <= total; i++) {
        result.percus.push({ nom: `Percu ${i}`, items: [] });
      }
    }
  }

  // Ensure timbaliers exist if effectif has timbales but percus were already parsed
  if (result.percus.length > 0 && result.effectifDetail?.percussions) {
    const timb = result.effectifDetail.percussions["Timbales"] || 0;
    const existingTimb = result.percus.filter(p => /timbal/i.test(p.nom)).length;
    for (let i = existingTimb + 1; i <= timb; i++) {
      result.percus.unshift({
        nom: timb === 1 ? "Timbalier" : `Timbalier ${i}`,
        items: [{ cat: "Timbales & Peaux", nom: "4 Timbales" }],
      });
    }
  }

  // Fallback title from filename
  if (!result.titre) {
    result.titre = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
  }

  return result;
}

async function renderPageToImage(pdf) {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ══════════════════════════════════════════
// FORMAT DETECTION
// ══════════════════════════════════════════

function detectFormat(lines) {
  const joined = lines.join(" ");

  // Radio France: has labeled cartouche fields "Objet :", "Lieu :", "Nomenclature :"
  if (/Objet\s*:/i.test(joined) && /Nomenclature\s*:/i.test(joined)) {
    return "radiofrance";
  }

  // EIC: has "Perc N :" with instrument lists
  if (/Perc\s*\d+\s*:/i.test(joined)) {
    return "eic";
  }

  // Lamoureux / generic with effectif: has "Effectif" or "E ff ectif" with slash notation
  if (/[Ee]\s*ff\s*ectif\s*:/i.test(joined) && /\d[\d\-]+\/\d/.test(joined)) {
    return "lamoureux";
  }

  // Short P1: P2: format (could be Radio France without full cartouche)
  if (/\bP\d\s*:/i.test(joined)) {
    return "radiofrance";
  }

  return "generic";
}

// ══════════════════════════════════════════
// RADIO FRANCE FORMAT
// ══════════════════════════════════════════
// Cartouche: Objet, Lieu, Concert, Direction, Nomenclature, Programme
// Percussions: P1:, P2:, P3:, P4: sections with instrument lists
// Nomenclature: 3.3.3.3 - 4.3.3.1 - 2.4.0.1 [Cel/Pno] - 14.12.10.8.6

function parseRadioFrance(lines, result) {
  const all = lines.join(" ");

  // ── Cartouche: Radio France uses a 2-column table layout.
  // pdf.js merges columns left-to-right per line, mixing fields.
  // Strategy: search for specific patterns anywhere in the text.

  // Nomenclature: distinctive dot-dash pattern "3.3.3.3 - 4.3.3.1 - ..."
  // Groups can have 3-5 dot-separated numbers, separated by " - "
  const nomMatch = all.match(/([\d]+(?:\.[\d]+){2,}(?:\s*[-–]\s*[\d]+(?:\.[\d]+){2,}(?:\s*\[[^\]]*\])?)+)/);
  if (nomMatch) result.effectif = nomMatch[1].trim();

  // Programme: "COMPOSER - Title" pattern (e.g. "B. JOLAS - Tales of A Summer Sea")
  const progMatch = all.match(/([A-ZÀ-Ü]\.?\s+[A-ZÀ-Ü]{2,})\s*[-–—]\s*(.+?)(?=\s+\d{1,3}['''′]|\s+Effectué|\s+Créé|\s*$)/);
  if (progMatch) {
    result.compositeur = progMatch[1].trim();
    // Clean trailing single-letter codes (plan version letter like "D")
    result.titre = progMatch[2].trim().replace(/\s+[A-Z]$/, "").trim();
  }

  // Duration: "12'" anywhere
  const dureeMatch = all.match(/(\d{1,3})\s*['''′]/);
  if (dureeMatch) result.duree = dureeMatch[1] + "'";

  // Lieu
  const lieuMatch = all.match(/Lieu\s*:\s*(.+?)(?=\s+\d+\.\d+\.\d+|\s+(?:Nomenclature|Concert|Direction|Programme|Objet|Effectué|Créé)\s*:)/i);
  if (lieuMatch) result.salle = lieuMatch[1].trim();

  // Concert (date/time)
  const concertMatch = all.match(/Concert\s*:\s*(.+?)(?=\s+Programme\s*:|\s+(?:Nomenclature|Direction|Objet|Lieu|Effectué|Créé)\s*:)/i);
  if (concertMatch) result.date = concertMatch[1].trim();

  // Direction: "Direction : Name" — stop before the programme composer pattern
  const dirMatch = all.match(/Direction\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-Za-zà-ü]+)*?)(?=\s+[A-Z]\.?\s+[A-Z]{2,}\s*[-–]|\s+(?:Nomenclature|Programme|Concert|Objet|Lieu|Effectué|Créé)\s*:)/i);
  if (dirMatch) result.chef = dirMatch[1].trim();

  // ── Percussion sections: P1:, P2:, P3:, P4: ──
  parsePercuSectionsFlexible(lines, result);

  // Orchestre from plan labels
  if (!result.orchestre) {
    result.orchestre = extractOrchestreFromLabels(lines);
  }
}

// ══════════════════════════════════════════
// EIC FORMAT
// ══════════════════════════════════════════
// "Perc N :" with instrument lists (may be on same line)
// Cartouche: Composer, Title, Duration, Dir:, Venue, Date

function parseEic(lines, result) {
  const all = lines.join(" ");

  // Orchestra label abbreviations to skip when looking for composer/title
  const PLAN_LABELS = /^(Fl|Picc|Htb|Hb|Cla|Cl|Fg|Bn|Cor|Cors|Tp|Trp|Tb|Trb|Tuba|Vl|Vla|Vlc|Vc|CB\d*|HP|Pno|Cel|SOLO|[12]\s*Vl|Vl\s*[12]|Fl\s*Picc|\d+\s*meter|\d+x|[+-]?\d+\.\d+|Steinway\s*C°?)$/i;

  // Cartouche is typically at the BOTTOM of the plan.
  // Search lines from bottom to top for composer/title.
  const reversedLines = [...lines].reverse();

  for (const line of reversedLines) {
    const trimmed = line.trim();
    if (!trimmed || PLAN_LABELS.test(trimmed)) continue;
    if (/Perc\s*\d/i.test(trimmed)) continue;
    if (/^(Dir|Salle|Fait|Lieu|\d{1,2}\s+(jan|fév|mar|avr|mai|jui|aoû|sep|oct|nov|déc))/i.test(trimmed)) continue;
    if (/^\d{1,3}['''′]$/.test(trimmed)) continue; // duration alone

    // "Prénom NOM" — first name lowercase-start, surname ALL CAPS
    const m = trimmed.match(/^([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü]{2,}(?:\s+[A-ZÀ-Ü]{2,})?)$/);
    if (m && !result.compositeur) {
      result.compositeur = m[1].trim();
      continue;
    }

    // Title: a line near the composer that is not a metadata field, long enough to be a title
    if (result.compositeur && !result.titre && trimmed.length > 3) {
      result.titre = trimmed;
      break; // We have both, stop
    }
  }

  // Strategy 2: combined line "Luca FRANCESCONI Unexpected End of Formula 18' Dir..."
  if (!result.compositeur) {
    const combo = all.match(
      /([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü]{2,})\s+(.+?)(?=\s+\d{1,3}[''']|\s+Dir)/
    );
    if (combo) {
      result.compositeur = combo[1].trim();
      result.titre = combo[2].trim();
    }
  }

  // Duration
  const dureeMatch = all.match(/(\d{1,3})\s*['''′]/);
  if (dureeMatch) result.duree = dureeMatch[1] + "'";

  // Conductor
  const chefMatch = all.match(/Dir\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i);
  if (chefMatch) result.chef = chefMatch[1].trim();

  // Venue
  const salleMatch = all.match(/(?:Salle des concerts|CMPP|SdC)(?:\s*,\s*\w+)*/i);
  if (salleMatch) result.salle = salleMatch[0].trim();

  // Date
  const dateMatch = all.match(/(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i);
  if (dateMatch) result.date = dateMatch[1];

  // Percussion sections: "Perc N :" at START of line
  parsePercuSections(lines, result, /^\s*Perc\s*(\d+)\s*:\s*/i);

  // EIC sometimes has "Perc N :" in the middle/end of a line with items before or after
  if (result.percus.length === 0) {
    parsePercuFromJoinedLines(lines, result);
  }

  // EIC AutoCAD: items listed BEFORE "Perc N :" on the same line (reversed layout)
  if (result.percus.length === 0) {
    parsePercuReversed(lines, result);
  }

  // Extract orchestra sections from plan labels
  if (!result.orchestre) {
    result.orchestre = extractOrchestreFromLabels(lines);
  }
}

// ══════════════════════════════════════════
// LAMOUREUX FORMAT
// ══════════════════════════════════════════

function parseLamoureux(lines, result) {
  const all = lines.join(" ");

  // Concert title
  const concertMatch = all.match(/CONCERT\s+(?:DE\s+)?(.+?)(?=\s+(?:LA\s+GRANDE|SALLE|CMPP|RIFFX|\d{1,2}\s+\w+\s+\d{4}|Effectif|$))/i);
  if (concertMatch) result.titre = concertMatch[1].trim();

  // Effectif (may be fragmented as "E ff ectif")
  const effectifMatch = all.match(/[Ee]\s*ff\s*ectif\s*:\s*([\d\-/]+(?:\w+[\d\-/]*)*)/i);
  if (effectifMatch) result.effectif = effectifMatch[1].trim();

  // Venue
  const venueMatch = all.match(/(LA GRANDE SEINE|PHILHARMONIE|SALLE PLEYEL|TH[ÉE][ÂA]TRE DES CHAMPS[- ][ÉE]LYS[ÉE]ES|RIFFX\s*\d*|MAISON DE LA RADIO|SALLE GAVEAU|SALLE CORTOT)/i);
  if (venueMatch) result.salle = venueMatch[0].trim();

  // Date
  const dateMatch = all.match(/(\d{1,2}\s+(?:JAN(?:VIER)?|F[EÉ]V(?:RIER)?|MARS?|AVR(?:IL)?|MAI|JUIN|JUIL(?:LET)?|AO[UÛ]T|SEPT(?:EMBRE)?|OCT(?:OBRE)?|NOV(?:EMBRE)?|D[EÉ]C(?:EMBRE)?)\s+\d{4})/i);
  if (dateMatch) result.date = dateMatch[1].trim();

  // No instrument lists in text for Lamoureux — instruments are only visual
  // Create empty percu slots from effectif if possible
}

// ══════════════════════════════════════════
// GENERIC FORMAT (fallback)
// ══════════════════════════════════════════

function parseGeneric(lines, result) {
  const all = lines.join(" ");

  // Try common patterns
  const dureeMatch = all.match(/(\d{1,3})\s*['''′]/);
  if (dureeMatch) result.duree = dureeMatch[1] + "'";

  const chefMatch = all.match(/Dir(?:ection)?\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i);
  if (chefMatch) result.chef = chefMatch[1].trim();

  const dateMatch = all.match(/(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i);
  if (dateMatch) result.date = dateMatch[1];

  // Try to find any perc sections
  parsePercuSections(lines, result, /^\s*(?:Perc(?:u|ussion)?\s*|P)(\d+)\s*:\s*/i);
}

// ══════════════════════════════════════════
// SHARED: PERCUSSION SECTION PARSER
// ══════════════════════════════════════════

/**
 * Parse percussion sections from lines using a regex to detect section headers.
 * Handles both multi-line (one instrument per line) and single-line (all on one line) formats.
 */
function parsePercuSections(lines, result, headerRegex) {
  // Find section starts
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRegex);
    if (m) {
      const num = parseInt(m[1]);
      const afterHeader = lines[i].slice(m[0].length).trim();
      sections.push({ num, lineIdx: i, afterHeader });
    }
  }

  if (sections.length === 0) return;

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const nextStart = s < sections.length - 1 ? sections[s + 1].lineIdx : lines.length;

    // Collect all text for this section
    let sectionItems = [];

    // Items on the header line itself (EIC format: "Perc 2 : 1 Flute 1 Xylo ...")
    if (sec.afterHeader) {
      sectionItems.push(...parseInstrumentText(sec.afterHeader));
    }

    // Items on subsequent lines until next section
    for (let j = sec.lineIdx + 1; j < nextStart; j++) {
      const line = lines[j].trim();
      // Stop at cartouche / metadata lines
      if (/^(Objet|Lieu|Concert|Direction|Effectué|Créé|Modifié|Nomenclature|Programme|Echelle|Fait le|Dir\s*:)/i.test(line)) break;
      // Skip noise: labels like "Vl", "Cor", "Tb", scale markers, etc.
      if (/^[A-Z][a-z]?$/.test(line)) continue;
      if (/^[\d.+]+$/.test(line)) continue;
      if (/^\d+x$/.test(line)) continue;
      if (line.length < 2) continue;
      // Skip section labels that are standalone (Fl, Htb, etc.)
      if (/^(Fl|Htb|Cla|Fg|Cor|Tp|Tb|Vl|Vla|Vlc|CB\d?|SOLO)$/i.test(line)) continue;
      if (/^(Picc|meter|\d+\s*meter)$/i.test(line)) continue;

      sectionItems.push(...parseInstrumentText(line));
    }

    if (sectionItems.length > 0) {
      result.percus.push({
        nom: `Percu ${sec.num}`,
        items: deduplicateItems(sectionItems),
      });
    }
  }
}

/**
 * For EIC format where "Perc N :" has all items joined on one line
 */
function parsePercuFromJoinedLines(lines, result) {
  for (const line of lines) {
    const m = line.match(/Perc\s*(\d+)\s*:\s*(.*)/i);
    if (m && m[2].trim()) {
      const num = parseInt(m[1]);
      const items = parseInstrumentText(m[2]);
      if (items.length > 0) {
        result.percus.push({
          nom: `Percu ${num}`,
          items: deduplicateItems(items),
        });
      }
    }
  }
}

/**
 * Flexible: finds "P1:", "P2:", "Perc 1:" etc. ANYWHERE in a line (start, middle, end)
 * Then collects the following lines as instrument items until the next section or cartouche.
 */
function parsePercuSectionsFlexible(lines, result) {
  // Find all lines containing a perc header
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    // Match P1: or Perc 1: anywhere in line
    const m = lines[i].match(/(?:^|\s)(?:P|Perc\s*)(\d+)\s*:\s*/i);
    if (m) {
      sections.push({ num: parseInt(m[1]), lineIdx: i });
    }
  }
  if (sections.length === 0) return;

  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    const nextStart = s < sections.length - 1 ? sections[s + 1].lineIdx : lines.length;
    const items = [];

    // Collect instrument lines after this header
    for (let j = sec.lineIdx + 1; j < nextStart; j++) {
      const line = lines[j].trim();
      // Stop at cartouche
      if (/^(Objet|Lieu|Concert|Direction|Effectué|Créé|Modifié|Nomenclature|Programme|Echelle)/i.test(line)) break;
      // Skip plan noise: scale labels, section labels, short codes
      if (/^\d+x$/.test(line)) continue;
      if (/^[+-]?\d+\.\d+$/.test(line)) continue;
      if (/^(GLOCK\s*P|S|XYLOPHONE|VIBRAPHONE)$/i.test(line)) continue; // plan labels, not items
      if (/^\s*P\d+\s*$/i.test(line)) continue; // standalone P1, P2 labels on plan
      if (line.length < 2) continue;

      // Parse the line for instruments
      const lineItems = parseInstrumentText(line);
      items.push(...lineItems);
    }

    if (items.length > 0) {
      result.percus.push({
        nom: `Percu ${sec.num}`,
        items: deduplicateItems(items),
      });
    }
  }
}

/**
 * EIC AutoCAD: instruments listed BEFORE "Perc N :" label on same line
 * e.g. "2 Polystirènes 1 Tôle tonnerre ... 1 Triangle Perc 1 :"
 */
function parsePercuReversed(lines, result) {
  for (const line of lines) {
    const m = line.match(/(.+?)\s*Perc\s*(\d+)\s*:\s*$/i);
    if (m && m[1].trim()) {
      const num = parseInt(m[2]);
      const items = parseInstrumentText(m[1].trim());
      if (items.length > 0) {
        result.percus.push({
          nom: `Percu ${num}`,
          items: deduplicateItems(items),
        });
      }
    }
  }
}

// ══════════════════════════════════════════
// INSTRUMENT TEXT PARSER
// ══════════════════════════════════════════

/**
 * Parse a string into instrument items.
 * Handles:
 *   - "1 Xylophone" "4 Timbales n°1>4" "Sand Blocks"
 *   - "3 CYMBALES SUSPENDUES" "VIBRAPHONE" "2 paires BONGOS"
 */
function parseInstrumentText(text) {
  const items = [];
  const seen = new Set();

  // Try quantity-prefixed: "N instrument..."
  // Match "1 Xylo" "4 Timbales n°1>4" "2 paires BONGOS" "3 Cloches tubes Do3 + Ré3 + Fa4"
  const qtyRegex = /(\d+)\s+(?:paires?\s+)?([A-Za-zÀ-ü][A-Za-zÀ-ü\s.''"\-()°+>#:]+?)(?=\s+\d+\s+[A-Za-zÀ-ü]|$)/g;
  let m;
  const consumed = new Set(); // track char ranges consumed

  while ((m = qtyRegex.exec(text)) !== null) {
    let nom = m[2].trim().replace(/\s+/g, " ");
    // Remove trailing noise
    nom = nom.replace(/\s+(Dir|Chef|Salle|Date|Fait|Lieu|Objet|Concert).*$/i, "").trim();
    if (nom.length < 2 || isNoise(nom)) continue;

    const qty = parseInt(m[1]);
    const paires = /paires?\s+/i.test(m[0]);
    let displayNom = paires ? `${m[1]} paires ${nom}` : (qty > 1 ? `${qty} ${nom}` : nom);

    const key = displayNom.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ cat: categorize(nom), nom: displayNom });
      // Mark range consumed
      for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
    }
  }

  // Now find standalone instrument names (no quantity prefix)
  // Split remaining text by common separators and check against known list
  const remaining = text.split("").map((c, i) => consumed.has(i) ? " " : c).join("");
  const parts = remaining.split(/\s{2,}|\n/).map(s => s.trim()).filter(s => s.length > 2);

  for (const part of parts) {
    if (isNoise(part)) continue;
    if (isKnownInstrument(part)) {
      const nom = part.charAt(0).toUpperCase() + part.slice(1);
      const key = nom.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ cat: categorize(nom), nom });
      }
    }
  }

  return items;
}

const KNOWN_INSTRUMENTS = [
  "vibraphone", "xylophone", "marimba", "glockenspiel", "glock",
  "timbale", "timbales", "tam-tam", "tamtam", "tam tam", "grosse caisse",
  "caisse claire", "bongo", "bongos", "conga", "triangle", "cymbale",
  "cymbales suspendues", "cymbales cloutees", "cymbales cloutées", "cymbales frappees", "cymbales frappées",
  "cymbale chinoise", "cymbale suspendue", "cymbale crash",
  "wood block", "wood-block", "woodblock", "wood board", "claves", "fouet",
  "castagnette", "maracas", "guiro", "gong", "steel drum",
  "enclume", "célesta", "cloches tubulaires", "cloches tubes",
  "crotale", "crotales", "bodhran", "roto-tom", "rototom", "tom", "toms",
  "spring drum", "springdrum", "thunder tongue",
  "tôle tonnerre", "tole tonnerre", "sand blocks", "sand block",
  "flûte à coulisse", "flute a coulisse",
  "grelots", "tambourin", "tambour de basque",
  "polystirène", "polystirènes", "gong d'opéra", "gong opera",
  "gc",
];

function isKnownInstrument(text) {
  const lower = text.toLowerCase().trim();
  return KNOWN_INSTRUMENTS.some(k => lower === k || lower.includes(k));
}

function isNoise(s) {
  const lower = s.toLowerCase().trim();
  const noise = [
    "dir", "chef", "salle", "date", "durée", "duree", "lieu", "placement",
    "disposition", "vers", "effectif", "concert", "repetition", "mise",
    "objet", "programme", "nomenclature", "effectué", "créé", "modifié",
    "echelle", "fait le", "orchestre",
  ];
  return noise.some(n => lower.startsWith(n)) || lower.length < 2;
}

// ══════════════════════════════════════════
// INSTRUMENT CATEGORIZATION
// ══════════════════════════════════════════

function categorize(name) {
  const lower = name.toLowerCase();
  if (/(vibraphone|xylophone|marimba|glockenspiel|glock|célesta|celesta|cloches?\s*tub)/i.test(lower))
    return "Claviers";
  if (/(timbale|caisse|bongo|conga|tambour|bodhran|roto.?tom|\btoms?\b|darbouka)/i.test(lower))
    return "Timbales & Peaux";
  if (/(gong|tam.?tam|grosse.?caisse|\bgc\b|steel drum|enclume|tôle|tole)/i.test(lower))
    return "Grosses pièces";
  if (/(stand|pied|rack|table|tréteau|pupitre|support)/i.test(lower))
    return "Stands & supports";
  if (/(baguette|mailloche|archet|ampli|électro)/i.test(lower))
    return "Baguettes & spécial";
  return "Accessoires";
}

function deduplicateItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.nom.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ══════════════════════════════════════════
// ORCHESTRE EXTRACTION
// ══════════════════════════════════════════

// Map of abbreviations found on plan labels to full instrument names
const LABEL_MAP = {
  "fl": "Flûte", "picc": "Piccolo", "fl picc": "Flûte / Piccolo",
  "htb": "Hautbois", "hb": "Hautbois",
  "cla": "Clarinette", "cl": "Clarinette",
  "fg": "Basson", "bn": "Basson",
  "cor": "Cor", "cors": "Cors",
  "tp": "Trompette", "trp": "Trompette",
  "tb": "Trombone", "trb": "Trombone",
  "tuba": "Tuba",
  "vl": "Violon", "vl 1": "Violon I", "vl1": "Violon I",
  "vl 2": "Violon II", "vl2": "Violon II",
  "1 vl": "Violon I", "2 vl": "Violon II",
  "vla": "Alto",
  "vlc": "Violoncelle", "vc": "Violoncelle",
  "cb": "Contrebasse",
  "hp": "Harpe", "harpe": "Harpe",
  "pno": "Piano", "piano": "Piano",
  "cel": "Célesta", "celesta": "Célesta",
  "solo": null, // skip
};

const SECTION_MAP = {
  "Flûte": "bois", "Piccolo": "bois", "Flûte / Piccolo": "bois",
  "Hautbois": "bois", "Clarinette": "bois", "Basson": "bois",
  "Cor": "cuivres", "Cors": "cuivres", "Trompette": "cuivres", "Trombone": "cuivres", "Tuba": "cuivres",
  "Violon I": "cordes", "Violon II": "cordes", "Violon": "cordes",
  "Alto": "cordes", "Violoncelle": "cordes", "Contrebasse": "cordes",
  "Harpe": "autres", "Piano": "autres", "Célesta": "autres",
};

/**
 * Extract orchestra composition from plan labels (Fl, Htb, Cor, Vl, etc.)
 * Found in EIC-style AutoCAD PDFs as standalone text items on the plan
 */
function extractOrchestreFromLabels(lines) {
  const found = new Set();
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    // Try exact match first
    if (LABEL_MAP[trimmed] !== undefined) {
      if (LABEL_MAP[trimmed]) found.add(LABEL_MAP[trimmed]);
      continue;
    }
    // Try matching parts (e.g. "Fl Picc" → two matches or one combined)
    for (const [abbr, name] of Object.entries(LABEL_MAP)) {
      if (name && trimmed === abbr) {
        found.add(name);
      }
    }
    // Check for "CB5" → Contrebasse, "Vl 1" etc.
    if (/^cb\d*$/i.test(trimmed)) found.add("Contrebasse");
    if (/^vl\s*1$/i.test(trimmed) || trimmed === "1 vl") found.add("Violon I");
    if (/^vl\s*2$/i.test(trimmed) || trimmed === "2 vl") found.add("Violon II");
  }

  if (found.size === 0) return null;

  const orchestre = { bois: [], cuivres: [], cordes: [], autres: [] };
  for (const name of found) {
    const section = SECTION_MAP[name] || "autres";
    if (!orchestre[section].includes(name)) {
      orchestre[section].push(name);
    }
  }
  return orchestre;
}

/**
 * Build orchestre from decoded effectif notation
 */
// French pluralization for orchestra instruments
const PLURALS = {
  "Flûte": "Flûtes", "Hautbois": "Hautbois", "Clarinette": "Clarinettes", "Basson": "Bassons",
  "Cor": "Cors", "Trompette": "Trompettes", "Trombone": "Trombones", "Tuba": "Tubas",
  "Timbales": "Timbales", "Harpe": "Harpes", "Percussion": "Percussions", "Clavier": "Claviers",
  "Violon I": "Violons I", "Violon II": "Violons II", "Alto": "Altos",
  "Violoncelle": "Violoncelles", "Contrebasse": "Contrebasses",
};

function pluralize(name, count) {
  if (count <= 1) return name;
  // Check if name has a suffix in parentheses: "Basson (sax)" → "Bassons (sax)"
  const parenMatch = name.match(/^(.+?)\s*(\(.+\))$/);
  if (parenMatch) {
    const base = parenMatch[1].trim();
    const suffix = parenMatch[2];
    return `${PLURALS[base] || base + "s"} ${suffix}`;
  }
  return PLURALS[name] || name + "s";
}

function formatEntry(name, count) {
  return `${count} ${pluralize(name, count)}`;
}

function orchestreFromEffectif(detail) {
  const orchestre = { bois: [], cuivres: [], cordes: [], autres: [] };

  if (detail.bois) {
    for (const [name, count] of Object.entries(detail.bois)) {
      if (count > 0) orchestre.bois.push(formatEntry(name, count));
    }
  }
  if (detail.cuivres) {
    for (const [name, count] of Object.entries(detail.cuivres)) {
      if (count > 0) orchestre.cuivres.push(formatEntry(name, count));
    }
  }
  if (detail.cordes) {
    for (const [name, count] of Object.entries(detail.cordes)) {
      if (count > 0) orchestre.cordes.push(formatEntry(name, count));
    }
  }
  // Extras (keyboard instruments in brackets): [Cel/Pno]
  if (detail.extras) {
    orchestre.autres.push(detail.extras);
  }
  // From perc group: Harpe and Clavier go in "autres" (orchestra section)
  // Timbales and Percussion are separate poles, not in orchestre
  if (detail.percussions) {
    for (const [name, count] of Object.entries(detail.percussions)) {
      if (name === "total") continue;
      // Harpe, Clavier → orchestre
      if (/harpe|clavier/i.test(name) && count > 0) {
        orchestre.autres.push(formatEntry(name, count));
      }
    }
  }

  return orchestre;
}

// ══════════════════════════════════════════
// EFFECTIF DECODER — Daniels' Orchestral Music notation
// ══════════════════════════════════════════
// Standard format: Bois / Cuivres / Percussions / Cordes
//
// Bois:        Fl . Hb . Cl . Bn       (+ suffixes: pic, eh, bcl, cbn, sax...)
// Cuivres:     Cor . Tp . Trb . Tuba
// Percussions: Timb . Perc . Hp . Clav  [Cel/Pno]
// Cordes:      Vl1 . Vl2 . Alt . Vlc . Cb
//
// Separators: "/" or " - " between groups, "." or "-" within groups

function decodeEffectif(notation) {
  const clean = notation.trim();
  // Strip bracket contents before detecting separator (brackets may contain "/" like [Cel/Pno])
  const withoutBrackets = clean.replace(/\[[^\]]*\]/g, "").trim();

  // Detect separator style and split into 4 groups
  let groups;
  if (/\d\.\d/.test(withoutBrackets) && /\d\s+[\-\u2013\u2014]\s+\d/.test(withoutBrackets)) {
    // Dot notation with dash separators: "3.3.3.3 - 4.3.3.1 - 2.4.0.1 - 14.12.10.8.6"
    groups = clean.split(/\s+[\-\u2013\u2014]\s+/).map(g => g.trim());
  } else if (withoutBrackets.includes("/")) {
    // Slash notation: "1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1"
    groups = clean.split("/").map(g => g.trim());
  } else {
    return null;
  }

  if (groups.length < 3) return null;

  const detail = { raw: notation, bois: null, cuivres: null, percussions: null, cordes: null, extras: null, summary: [] };

  // ── Bois: Fl . Hb . Cl . Bn ──
  const boisParts = parseGroup(groups[0]);
  const boisNames = ["Flûte", "Hautbois", "Clarinette", "Basson"];
  detail.bois = mapPartsWithDoublings(boisParts, boisNames);
  addSummary(detail.summary, detail.bois);

  // ── Cuivres: Cor . Tp . Trb . Tuba ──
  if (groups[1]) {
    const cuivresParts = parseGroup(groups[1]);
    const cuivresNames = ["Cor", "Trompette", "Trombone", "Tuba"];
    detail.cuivres = mapPartsWithDoublings(cuivresParts, cuivresNames);
    addSummary(detail.summary, detail.cuivres);
  }

  // ── Percussions: Timb . Perc . Hp . Clav [Cel/Pno] ──
  // Daniels order: Timpani . Percussion . Harp . Keyboard
  if (groups[2]) {
    const bracketMatch = groups[2].match(/\[([^\]]+)\]/);
    const percClean = groups[2].replace(/\[.*?\]/, "").trim();
    const percParts = parseGroup(percClean);
    const percNames = ["Timbales", "Percussion", "Harpe", "Clavier"];
    detail.percussions = mapParts(percParts, percNames);
    detail.percussions.total = percParts.reduce((s, p) => s + (p.count || 0), 0);
    if (bracketMatch) {
      detail.extras = bracketMatch[1];
      detail.summary.push(bracketMatch[1]);
    }
    addSummary(detail.summary, detail.percussions);
  }

  // ── Cordes: Vl1 . Vl2 . Alt . Vlc . Cb ──
  if (groups[3]) {
    const cordesParts = parseGroup(groups[3]);
    const cordesNames = ["Violon I", "Violon II", "Alto", "Violoncelle", "Contrebasse"];
    detail.cordes = mapParts(cordesParts, cordesNames);
    addSummary(detail.summary, detail.cordes);
  }

  return detail;
}

function parseGroup(str) {
  const parts = [];
  // Split by . or - (within a group), handle suffixes like "2sax", "(pic)", "+eh"
  const regex = /(\*?)(\d+)\s*(?:\(([^)]+)\)|\+([a-zA-Zéèà]+))?([a-zA-ZéèàÀ-Ü]*)/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    parts.push({
      count: parseInt(m[2]),
      dedicated: m[1] === "*",  // * = dedicated auxiliary player
      doubling: m[3] || m[4] || "", // (pic) or +eh
      suffix: m[5] || "",  // 2sax → suffix="sax"
    });
  }
  return parts;
}

// Standard Daniels auxiliary instrument names
const DOUBLING_NAMES = {
  "pic": "Piccolo", "picc": "Piccolo",
  "afl": "Flûte alto",
  "eh": "Cor anglais", "ca": "Cor anglais",
  "bcl": "Clarinette basse",
  "ecl": "Petite clarinette (Mib)",
  "cbn": "Contrebasson", "cfg": "Contrebasson",
  "sax": "Saxophone",
};

function mapPartsWithDoublings(parts, names) {
  const result = {};
  parts.forEach((p, i) => {
    const baseName = i < names.length ? names[i] : `Pupitre ${i + 1}`;

    // Handle suffix like "2sax"
    let label = baseName;
    if (p.suffix && DOUBLING_NAMES[p.suffix.toLowerCase()]) {
      label = DOUBLING_NAMES[p.suffix.toLowerCase()];
    } else if (p.suffix) {
      label = `${baseName} (${p.suffix})`;
    }

    if (p.count > 0) result[label] = p.count;

    // Handle doublings: add the auxiliary instrument
    const dbl = p.doubling.toLowerCase();
    if (dbl && DOUBLING_NAMES[dbl]) {
      const auxName = DOUBLING_NAMES[dbl];
      if (p.dedicated) {
        result[auxName] = 1; // dedicated player
      }
      // If not dedicated, it's a doubling — just note it in the name
      // e.g. "3 Flûtes (+ Piccolo)"
      else {
        // Modify the base entry label
        delete result[label];
        result[`${label} (+${auxName})`] = p.count;
      }
    }
  });
  return result;
}

function mapParts(parts, names) {
  const result = {};
  parts.forEach((p, i) => {
    const name = i < names.length ? names[i] : `Pupitre ${i + 1}`;
    const label = p.suffix ? `${name} (${p.suffix})` : name;
    if (p.count > 0) result[label] = p.count;
  });
  return result;
}

function addSummary(summary, group) {
  for (const [name, count] of Object.entries(group)) {
    if (typeof count === "number" && count > 0 && name !== "total") {
      summary.push(formatEntry(name, count));
    }
  }
}
