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

const KNOWN_COMPOSERS_SET = new Set([
  "BACH", "MOZART", "BEETHOVEN", "HAYDN", "SCHUBERT", "SCHUMANN", "BRAHMS",
  "WAGNER", "MENDELSSOHN", "BRUCKNER", "MAHLER", "R. STRAUSS", "DVORAK",
  "TCHAIKOVSKY", "RACHMANINOV", "PROKOFIEV", "SHOSTAKOVICH", "STRAVINSKY",
  "BARTOK", "DEBUSSY", "RAVEL", "FAURÉ", "SAINT-SAËNS", "BERLIOZ", "BIZET",
  "MASSENET", "POULENC", "MESSIAEN", "DUTILLEUX", "BOULEZ", "LIGETI",
  "STOCKHAUSEN", "BERIO", "NONO", "XENAKIS", "GRISEY", "MURAIL", "DUFOURT",
  "KURTÁG", "LACHENMANN", "SCELSI", "FELDMAN", "CAGE", "ADAMS", "GLASS",
  "REICH", "PÄRT", "GÓRECKI", "PENDERECKI", "LUTOSLAWSKI", "SIBELIUS",
  "GRIEG", "NIELSEN", "ELGAR", "BRITTEN", "VAUGHAN WILLIAMS", "HOLST",
  "WALTON", "VERDI", "ROSSINI", "PUCCINI", "DONIZETTI", "BELLINI",
  "MONTEVERDI", "RIMSKY-KORSAKOV", "MUSSORGSKY", "BORODIN", "GLINKA",
  "SCRIABIN", "JANÁČEK", "SMETANA", "MARTINŮ", "KODÁLY", "ENESCU",
  "WEBERN", "SCHOENBERG", "BERG", "ZEMLINSKY", "KORNGOLD", "COPLAND",
  "BERNSTEIN", "BARBER", "IVES", "GERSHWIN", "VARÈSE", "SAARIAHO",
  "LINDBERG", "UNSUK CHIN", "HAAS", "HANDEL", "HÄNDEL", "VIVALDI",
  "TELEMANN", "RAMEAU", "LULLY", "COUPERIN", "PURCELL", "CORELLI",
  "ALBINONI", "PERGOLESI", "GLUCK", "WEBER", "LISZT", "CHOPIN",
  "PAGANINI", "FRANCK", "LALO", "CHABRIER", "DELIBES", "DUKAS",
  "MAGNARD", "D'INDY", "CHAUSSON", "SATIE", "ROUSSEL", "HONEGGER",
  "MILHAUD", "JOLIVET", "IBERT", "SCHMITT", "KOECHLIN", "CAPLET",
  "ENESCO", "HINDEMITH", "ORFF", "WEILL", "EISLER", "HARTMANN",
  "ZIMMERMANN", "HENZE", "RIHM", "WIDMANN", "MUNDRY",
  "FURRER", "SCIARRINO", "NØRGÅRD", "ABRAHAMSEN", "SØRENSEN",
  "SALONEN", "RAUTAVAARA", "NORDHEIM",
  "TIPPETT", "MAXWELL DAVIES", "BIRTWISTLE", "TURNAGE", "ADÈS",
  "BENJAMIN", "KNUSSEN", "HARVEY", "FERNEYHOUGH", "FINNISSY",
  "CHIN", "HOSOKAWA", "TAKEMITSU", "FUJIKURA",
  "TAN DUN", "CHEN", "ZHOU LONG", "BRIGHT SHENG",
  "PIAZZOLLA", "GINASTERA", "VILLA-LOBOS", "REVUELTAS", "CHÁVEZ",
  "BARRIOS", "CARTER", "ELLIOTT CARTER", "BABBITT", "WUORINEN",
  "CRUMB", "DRUCKMAN", "TOWER", "CORIGLIANO", "ROUSE",
  "HIGDON", "MACKEY", "JOHN ADAMS", "THOMAS ADÈS", "MANOURY",
  "RESPIGHI", "MASCAGNI", "LEONCAVALLO", "PONCHIELLI", "CATALANI",
  "WOLF", "BRUCH", "SPOHR", "HUMPERDINCK", "PFITZNER",
  "SZYMANOWSKI", "MONIUSZKO", "WEINBERG", "SCHNITTKE", "GUBAIDULINA",
  "USTVOLSKAYA", "KABALEVSKY", "KHACHATURIAN", "GLAZUNOV", "TANEYEV",
  "ARENSKY", "BALAKIREV", "CUI", "TCHÉREPNINE", "LIADOV",
  "FALLA", "GRANADOS", "ALBÉNIZ", "RODRIGO", "TURINA",
  "DELIUS", "BAX", "BLISS", "IRELAND",
  "FRANÇAIX", "TOMASI", "ESCAICH", "DUSAPIN",
  "JOLAS", "PESSON"
].map(n => n.toLowerCase()));

function findKnownComposer(text) {
  const words = text.replace(/[,;:()[\]{}]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    // Try 3-word, 2-word, 1-word combos
    for (let len = 3; len >= 1; len--) {
      if (i + len > words.length) continue;
      const candidate = words.slice(i, i + len).join(" ").toLowerCase();
      if (KNOWN_COMPOSERS_SET.has(candidate)) {
        return words.slice(i, i + len).join(" ");
      }
    }
  }
  return null;
}

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
        // Skip text rotated 90° (transform[1] or transform[2] significantly non-zero)
        const t = item.transform;
        if (Math.abs(t[1]) > 0.5 || Math.abs(t[2]) > 0.5) continue;
        allItems.push({
          str: item.str,
          x: Math.round(t[4]),
          y: Math.round(t[5]),
          page: i,
        });
      }
    }
  }

  // Sort top-to-bottom, left-to-right
  allItems.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) < 6) return a.x - b.x;
    return b.y - a.y;
  });

  // Group into lines (items at similar y)
  const lines = [];
  let curLine = [];
  let curY = null;
  for (const item of allItems) {
    if (curY !== null && Math.abs(item.y - curY) > 6) {
      if (curLine.length) lines.push(curLine.join(" "));
      curLine = [];
    }
    curLine.push(item.str.trim());
    curY = item.y;
  }
  if (curLine.length) lines.push(curLine.join(" "));

  const fullText = lines.join("\n");
  console.log("[OrkMap] Lines:", lines);

  // ── 2. Render all pages as images for plan display ──
  let planDataUrl = null;
  let planDataUrls = [];
  try {
    planDataUrls = await renderAllPages(pdf);
    planDataUrl = planDataUrls[0] || null;
  } catch (err) {
    console.warn("[OrkMap] Could not render plan:", err);
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
    planDataUrls,
  };

  const format = detectFormat(lines);
  console.log("[OrkMap] Detected format:", format, "| Lines:", lines.length);

  if (format === "radiofrance") {
    parseRadioFrance(lines, result);
  } else if (format === "dcm") {
    parseDcm(lines, result);
  } else if (format === "eic") {
    parseEic(lines, result);
  } else if (format === "lamoureux") {
    parseLamoureux(lines, result);
  } else if (format === "orchestredeparis") {
    parseOrchDeParis(lines, result);
  } else if (format === "cnsm") {
    parseCnsm(lines, result);
  } else {
    parseGeneric(lines, result);
  }

  console.log("[OrkMap] Extracted:", {
    titre: result.titre, compositeur: result.compositeur, effectif: result.effectif,
    chef: result.chef, date: result.date, salle: result.salle, percus: result.percus.length,
  });

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

async function renderPageToImage(pdf, pageNum = 1) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function renderAllPages(pdf) {
  const urls = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const url = await renderPageToImage(pdf, i);
      urls.push(url);
    } catch (err) {
      console.warn(`[OrkMap] Could not render page ${i}:`, err);
    }
  }
  return urls;
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

  // Orchestre de Paris
  if (/orchestre\s*de\s*paris/i.test(joined)) {
    return "orchestredeparis";
  }

  // CNSM
  if (/cnsm|conservatoire\s*national\s*sup/i.test(joined)) {
    return "cnsm";
  }

  // Short P1: P2: format (could be Radio France without full cartouche)
  if (/\bP\d\s*:/i.test(joined)) {
    return "radiofrance";
  }

  // DCM Radio France: "RÉGIE GÉNÉRALE | DEMANDE TECHNIQUE" is the signature header
  if (/R[ÉE]GIE\s*G[ÉE]N[ÉE]RALE/i.test(joined) && /DEMANDE\s*TECHNIQUE/i.test(joined)) {
    return "dcm";
  }
  // Alternative DCM detection: "VALIDÉ" + "DCM" as production type
  if (/\bVALID[ÉE]\b/i.test(joined) && /\bDCM\b/i.test(joined) && /PRODUCTION/i.test(joined)) {
    return "dcm";
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
  if (dirMatch) {
    const chefName = dirMatch[1].trim();
    // Filter out crew roles: "Chef d'équipe", "Chef de plateau" are not music directors
    if (!/\b(?:[ée]quipe|plateau|sc[èe]ne|salle|accueil|bureau|maintenance|machiniste|technique|production|administration|communication|s[ée]curit[ée])\b/i.test(chefName)) {
      result.chef = chefName;
    }
  }

  // ── Percussion sections: P1:, P2:, P3:, P4: ──
  parsePercuSectionsFlexible(lines, result);

  // Orchestre from plan labels
  if (!result.orchestre) {
    result.orchestre = extractOrchestreFromLabels(lines);
  }
}

// ══════════════════════════════════════════
// DCM RADIO FRANCE FORMAT
// ══════════════════════════════════════════
// A DCM (Demande de Concert/Mounting) is a technical production document.
// Header: "RÉGIE GÉNÉRALE | DEMANDE TECHNIQUE" + "VALIDÉ"
// Production type: "DCM"
// Unlike stage plans, DCMs have no Daniels notation, no chef, and no percussion
// sections. The ensemble info is in free text ("pupitres", "chaises", artist list).

function parseDcm(lines, result) {
  const all = lines.join(" ");
  const textLower = all.toLowerCase();

  // ── Title: After "TITRE" label, before "TYPE" ──
  let titreFound = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^TITRE$/i.test(line)) {
      titreFound = true;
      continue;
    }
    if (titreFound) {
      if (!line || /^TYPE$/i.test(line)) {
        if (/^TYPE$/i.test(line)) titreFound = false;
        continue;
      }
      if (/^(DCM|CONCERT|OPERA|BALLET|R[ÉE]CITAL|SPECTACLE|PRODUCTION)$/i.test(line)) continue;
      result.titre = line;
      titreFound = false;
      break;
    }
  }

  // Fallback title search
  if (!result.titre) {
    const titreIdx = lines.findIndex(l => /^TITRE$/i.test(l.trim()));
    if (titreIdx >= 0) {
      for (let j = titreIdx + 1; j < Math.min(titreIdx + 5, lines.length); j++) {
        const cand = lines[j].trim();
        if (cand && !/^(TYPE|DCM|CONCERT|DATE|LIEU|DEBUT|FIN|PRODUCTION|VALID[ÉE]|R[ÉE]GIE|BESOINS|CONFIGURATION)/i.test(cand) && cand.length > 5) {
          result.titre = cand;
          break;
        }
      }
    }
  }

  // ── Venue: after "CONFIGURATION DE LA SALLE" ──
  const salleCfgIdx = lines.findIndex(l => /CONFIGURATION\s*DE\s*LA\s*SALLE/i.test(l));
  if (salleCfgIdx >= 0) {
    const afterCfg = lines[salleCfgIdx].replace(/CONFIGURATION\s*DE\s*LA\s*SALLE/i, "").trim();
    if (afterCfg && /[A-Z]/.test(afterCfg) && afterCfg.length > 2) {
      result.salle = afterCfg;
    } else {
      for (let j = salleCfgIdx + 1; j < Math.min(salleCfgIdx + 4, lines.length); j++) {
        const cand = lines[j].trim();
        if (cand && !/^(Parterre|RA|EP|R\+\d|N[°º]|BESOINS|PROGRAMME|PLANNING)/i.test(cand) && cand.length > 2) {
          const m = cand.match(/^([A-Z]{2,}\s+)?(?:Studio\s+)?(Auditorium\s*\d*|Studio\s*\d+|[A-Z][a-zà-ü]+\s+[A-Z][a-zà-ü]+)/i);
          if (m) {
            result.salle = m[0].trim();
            break;
          }
        }
      }
    }
  }

  // Fallback: "GS Auditorium" or "Auditorium" anywhere
  if (!result.salle) {
    const audMatch = all.match(/\b(GS\s+)?Auditorium\b/i);
    if (audMatch) result.salle = audMatch[0].trim();
  }

  // Also try "Lieu :" label
  if (!result.salle) {
    const lieu2 = all.match(/Lieu\s*:\s*(.+?)(?=\s+N[°º]|\s+$|\n)/i);
    if (lieu2) result.salle = lieu2[1].trim();
  }

  // ── Date: French date format ──
  const dateMatch = all.match(/(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i);
  if (dateMatch) result.date = dateMatch[1];

  // ── Composer(s): from PROGRAMME section (DCM-specific) ──
  // Strategy: extract all "FirstName LastName :" patterns from programme lines
  const dcmComposers = new Set();
  for (const line of lines) {
    // Match: "Henry Purcell :" or "Orlando Gibbons :" — composer name before colon
    // Only match lines that look like programme entries (not "TITRE :" or "Lieu :")
    const compMatch = line.match(/^([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)+)\s*:/);
    if (compMatch) {
      const name = compMatch[1].trim();
      // Filter out non-composer labels
      if (/^(?:TITRE|TYPE|DATE|DEBUT|FIN|LIEU|CONFIGURATION|BESOINS|PROGRAMME|TIMING|PLANNING|FONCTION|PRENOM|CONTACTS|OBSERVATIONS|SONORISATION|LUMIERES|MACHINERIE|CAPTATION|LOGES|ACCUEIL|SECURIT[ÉE]|PROPRET[ÉE]|COMPLEMENT|D[ÉE]L[ÉE]GATION|DESCRIPTION|N[°º]|OU|QUI|ACTIONS|INTERVENANT|DEMANDE|R[ÉE]GIE|R[ÉE]ALISATION|CHEF|ECLAIRAGE|POINTS|CONSORT|ENSEMBLE|ORCHESTRE|CHOEUR|SOLISTE|BALLET|DANSEUR|COM[ÉE]DIEN|R[ÉE]CITANT|NARRATEUR)\b/i.test(name)) continue;
      // Check if this is a known composer OR looks like a proper name (FirstName LastName)
      if (KNOWN_COMPOSERS_SET.has(name.toLowerCase()) || /^[A-Z][a-zà-ü]+\s+[A-Z][a-zà-ü]+/.test(name)) {
        dcmComposers.add(name);
      }
    }
  }

  // Also use findKnownComposer as fallback
  const knownFound = findKnownComposer(all);
  if (knownFound && ![...dcmComposers].some(c => c.toLowerCase().includes(knownFound.toLowerCase()))) {
    dcmComposers.add(knownFound);
  }

  if (dcmComposers.size === 1) {
    result.compositeur = [...dcmComposers][0];
  } else if (dcmComposers.size > 1) {
    const arr = [...dcmComposers];
    result.compositeur = arr.slice(0, 4).join(", ");
    if (arr.length > 4) result.compositeur += "...";
  }

  // ── Duration: multiple formats in DCM ──
  // Format 1: "Durée totale : 1h45" (complement de production)
  let dureeMatch = all.match(/Dur[ée]e\s*tot(?:ale)?\s*:?\s*(\d+h\d{2})\b/i);
  if (dureeMatch) {
    result.duree = dureeMatch[1];
  }
  // Format 2: "Durée tot" followed by "01:45:00" somewhere nearby
  if (!result.duree) {
    dureeMatch = all.match(/Dur[ée]e\s*tot\b.{0,50}?(\d{1,2}:\d{2}(?::\d{2})?)/i);
    if (dureeMatch) {
      result.duree = dureeMatch[1];
    }
  }
  // Format 3: isolated HH:MM:SS that looks like a total duration (numeric only)
  if (!result.duree) {
    const isoMatch = all.match(/(?:^|\s)(\d{2}:\d{2}:\d{2})(?:\s|$)/);
    if (isoMatch) result.duree = isoMatch[1];
  }

  // ── EFFECTIF: from "pupitres" / "chaises" / artist list ──
  const effParts = [];

  const pupitreMatch = textLower.match(/(\d+)\s*(?:petits?\s+)?pupitres?\s+(?:pliants?|musiciens?)?/i);
  const chaiseMatch = textLower.match(/(\d+)\s*chaises?\s+(?:d['o]rchestres?|stables?)?/i);
  let musicianCount = 0;
  if (pupitreMatch) musicianCount = parseInt(pupitreMatch[1]);
  if (!musicianCount && chaiseMatch) musicianCount = parseInt(chaiseMatch[1]);

  // Detect instruments from artist line — use word boundaries to avoid false positives
  // "cor" must not match inside "corbeille", "corps", etc.
  const instrumentMatch = all.match(/\b(?:violes?\s*de\s*gambe|violoncelles?|violons?|altos?|contrebasses?|fl[ûu]tes?|hautbois|clarinettes?|bassons?|trompettes?|trombones?|tuba|harpe|piano|clavecin|orgue|luth|th[ée]orbe)\b/gi);
  // Only add "cors?" if it's a standalone word (not part of "corbeille", "record", etc.)
  const corMatch = all.match(/\bcors?\b/gi);
  const rawInstruments = instrumentMatch ? [...instrumentMatch] : [];
  if (corMatch && corMatch.some(m => /^cors?$/i.test(m))) {
    rawInstruments.push("cors");
  }
  const instruments = [...new Set(rawInstruments.map(s => s.trim().toLowerCase()))];

  // Count artists explicitly listed
  const artistMatch = all.match(/Consort\s+Les\s+Lucioles\s*:?\s*(.+?)(?:violes?\s*de\s*gambe|$)/i);
  let artistCount = 0;
  if (artistMatch) {
    const artistNames = artistMatch[1].match(/[A-Z][a-zà-ü]+\s+[A-Z][a-zà-ü]+/g);
    if (artistNames) artistCount = artistNames.length;
  }

  const count = musicianCount || artistCount || 0;

  if (count > 0) {
    effParts.push(`${count} musicien${count > 1 ? "s" : ""}`);
  }
  if (instruments.length > 0) {
    effParts.push(instruments.join(", "));
  }

  if (effParts.length > 0) {
    result.effectif = effParts.join(", ");
  }

  // ── Chef: explicitly NONE for DCM (consorts, chamber music have no conductor) ──
  // "Chef d'équipe" in contacts is a technical crew role, not a music director
  result.chef = "";

  // ── Orchestre: build from detected instruments/count ──
  if (instruments.length > 0 && count > 0) {
    result.orchestre = { bois: [], cuivres: [], cordes: [instruments.join(", ")], autres: [] };
  } else if (count > 0) {
    result.orchestre = { bois: [], cuivres: [], cordes: [`${count} musicien${count > 1 ? "s" : ""}`], autres: [] };
  }

  console.log("[OrkMap] DCM parse: ensemble count:", count, "instruments:", instruments);
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
  if (chefMatch) {
    const chefName = chefMatch[1].trim();
    if (!/\b(?:[ée]quipe|plateau|sc[èe]ne|salle|accueil|bureau|maintenance|machiniste)\b/i.test(chefName)) {
      result.chef = chefName;
    }
  }

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
  const allLower = all.toLowerCase();

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

  // Fill in remaining fields with free-form parser
  parseFreeForm(lines, result, all, allLower);

  // No instrument lists in text for Lamoureux — instruments are only visual
  // Create empty percu slots from effectif if possible
}

// ══════════════════════════════════════════
// GENERIC FORMAT (fallback)
// ══════════════════════════════════════════

function parseGeneric(lines, result) {
  const all = lines.join(" ");
  const allLower = all.toLowerCase();

  // Try common patterns
  const dureeMatch = all.match(/(\d{1,3})\s*['''′]/);
  if (dureeMatch) result.duree = dureeMatch[1] + "'";

  // Chef patterns — expanded for free-form text (with crew-role guard)
  const isCrewRole = (name) => /\b(?:[ée]quipe|plateau|sc[èe]ne|salle|accueil|bureau|maintenance|machiniste|technique|production|administration|communication|s[ée]curit[ée])\b/i.test(name);
  const chefPatterns = [
    /Dir(?:ection)?(?:\s*musicale)?\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i,
    /dirig[ée]e?s?\s*(?:par)?\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i,
    /sous\s+la\s+direction\s+(?:de\s+)?([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i,
    /chef\s*(?:d'orchestre)?\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)+)/i,
    /([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)\s*,\s*direction/i,
  ];
  for (const re of chefPatterns) {
    const m = all.match(re);
    if (m && !isCrewRole(m[1].trim())) { result.chef = m[1].trim(); break; }
  }

  // French date
  const dateMatch = all.match(/(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i);
  if (dateMatch) result.date = dateMatch[1];

  // Also try JJ/MM/AAAA format
  if (!result.date) {
    const dateSlash = all.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateSlash) result.date = dateSlash[1];
  }

  // Also try ISO date format
  if (!result.date) {
    const isoDate = all.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoDate) result.date = isoDate[1];
  }

  // Daniels notation — flexible regex supporting mixed slash/dash/cordes format
  const danielsMatch = all.match(
    /(\d+\.[\d.]+\d\.?\s*[\/\-–]\s*\d+\.[\d.]+\d\.?(?:\s*[\/\-–]\s*(?:cordes?\s+)?\d+\.[\d.]+\d\.?(?:\s*\[[^\]]*\])?)*)/i
  );
  if (danielsMatch) {
    result.effectif = danielsMatch[1].trim().replace(/cordes?\s+/gi, "");
  }

  // Also try standard dash-separated Daniels
  if (!result.effectif) {
    const nomMatch = all.match(/([\d]+(?:\.[\d]+){2,}(?:\s*[-–]\s*[\d]+(?:\.[\d]+){2,}(?:\s*\[[^\]]*\])?)+)/);
    if (nomMatch) result.effectif = nomMatch[1].trim();
  }

  // Try effectif with timb/perc/hp annotations
  if (!result.effectif) {
    const annMatch = all.match(/([\d]+(?:\.[\d]+)*\s*[-–]\s*[\d]+(?:\.[\d]+)*\s*[-–]\s*(?:timb\.?\s*)?[\d]+(?:perc)?\.?(?:[\d]*)?(?:perc|timb)?\.?\s*(?:[-–]\s*(?:hp|cel|pno|clav)\s*)?[-–]\s*[\d]+(?:\.[\d]+)*(?:\s*[-–]\s*[\d]+(?:\.[\d]+)*)*)/i);
    if (annMatch) result.effectif = annMatch[1].trim();
  }

  // Known composer search
  if (!result.compositeur) {
    const found = findKnownComposer(all);
    if (found) result.compositeur = found;
  }

  // Title detection from first lines
  if (!result.titre && lines.length > 0) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      // Check for "Composer Title" pattern
      const knownComp = findKnownComposer(line);
      if (knownComp) {
        result.compositeur = result.compositeur || knownComp;
        const titlePart = line.substring(line.indexOf(knownComp) + knownComp.length).trim();
        if (titlePart && titlePart.length > 1) {
          result.titre = titlePart.replace(/^[,\-–:|]\s*/, "").trim();
        }
        break;
      }
      // Fallback: first non-metadata line as title
      if (!result.titre && line.length > 3 && line.length < 120 &&
          !/^(?:objet|lieu|concert|direction|effectif|nomenclature|programme|date|chef|orchestre|ensemble|philhar|avec le|et le|\d)/i.test(line)) {
        result.titre = line;
      }
    }
  }

  // Salle / lieu detection
  if (!result.salle) {
    const lieuPatterns = [
      /(?:Philharmonie|Auditorium|Th[ée][âa]tre|Op[ée]ra|Salle|Maison de la Radio)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)*)/i,
      /(?:à|au)\s+(?:la\s+)?(Philharmonie|Auditorium|Maison de la Radio|Th[ée][âa]tre|Salle)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)*)/i,
    ];
    for (const re of lieuPatterns) {
      const m = all.match(re);
      if (m) { result.salle = m[0].trim(); break; }
    }
  }

  // Try to find any perc sections
  parsePercuSections(lines, result, /^\s*(?:Perc(?:u|ussion)?\s*|P)(\d+)\s*:\s*/i);

  // Orchestre from plan labels
  if (!result.orchestre) {
    result.orchestre = extractOrchestreFromLabels(lines);
  }
}

// ══════════════════════════════════════════
// ORCHESTRE DE PARIS FORMAT
// ══════════════════════════════════════════

function parseOrchDeParis(lines, result) {
  const all = lines.join(" ");
  const allLower = all.toLowerCase();

  // Try Radio France cartouche first (some ODP plans have similar layout)
  parseRadioFrance(lines, result);

  // If fields are still empty, apply free-form patterns
  if (!result.titre || !result.compositeur || !result.chef) {
    parseFreeForm(lines, result, all, allLower);
  }
}

// ══════════════════════════════════════════
// CNSM FORMAT
// ══════════════════════════════════════════

function parseCnsm(lines, result) {
  const all = lines.join(" ");
  const allLower = all.toLowerCase();
  // Similar to generic but with CNSM-specific patterns
  parseGeneric(lines, result);
  // Fill in remaining fields
  parseFreeForm(lines, result, all, allLower);
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

function romanToInt(str) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const s = str.toUpperCase();
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    result += cur < next ? -cur : cur;
  }
  return result || 1;
}

/**
 * Flexible: finds "P1:", "P2:", "Perc 1:" etc. ANYWHERE in a line (start, middle, end)
 * Then collects the following lines as instrument items until the next section or cartouche.
 */
function parsePercuSectionsFlexible(lines, result) {
  // Find all lines containing a perc header
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    // Match P1: or Perc 1: or Percu I: or Percussion 2: or Timbalier: anywhere in line
    const m = lines[i].match(/(?:^|\s)(?:P|Perc(?:u|ussion|ussions?)?\s*|Timbalier\s*)(\d+|I{1,3}V?|IV|V?I{0,3})\s*:\s*/i);
    if (m) {
      const numStr = m[1];
      const num = /^\d+$/.test(numStr) ? parseInt(numStr) : romanToInt(numStr);
      sections.push({ num, lineIdx: i });
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
  "tambour militaire", "conga", "congas", "tumba", "quinto",
  "timbale baroque", "glockenspiel à pédale", "glockenspiel valise", "glock valise",
  "célesta", "cloche église", "cloche d'église",
  "cymbale charleston", "hi-hat", "charley", "cymbale splash",
  "arbre à cymbales", "piquininos", "pikininos",
  "plaque tonnerre", "temple block", "temple blocks",
  "tambour de bois", "spring coil", "lion's roar", "lions roar",
  "tambour à friction", "machine à vent",
  "bell tree", "bamboo tree", "bambou chime", "bamboo chime", "chime",
  "mark tree", "boobam", "darbouka", "cajon", "djembe", "pandeiro",
  "vibraslap", "cabasa", "sifflet", "sirène", "flexatone", "kalimba",
  "ocean drum", "rain stick", "waterphone", "wind chimes",
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

export function orchestreFromEffectif(detail) {
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

export function decodeEffectif(notation) {
  let clean = notation.trim()
    .replace(/\.(?=\s*[\/\-–])/g, "")
    .replace(/\.$/g, "")
    .replace(/\s*-\s*cordes?\s+/gi, " - ")
    .replace(/\s*-\s*strings?\s+/gi, " - ");
  const withoutBrackets = clean.replace(/\[[^\]]*\]/g, "").trim();

  // Detect separator style and split into 4 groups
  let groups;
  if (withoutBrackets.includes("/") && /\d\s*[\-\u2013\u2014]\s*\d/.test(withoutBrackets)) {
    // Mixed slash + dash format: "3.3.3.3/4.3.3.1 - 14.12.10.8.6"
    const slashParts = clean.split("/").map(g => g.trim());
    const lastPart = slashParts[slashParts.length - 1];
    const dashInLast = lastPart.match(/^(.+?)\s*[\-\u2013\u2014]\s*(.+)$/);
    if (dashInLast) {
      groups = [...slashParts.slice(0, -1), dashInLast[1].trim(), dashInLast[2].trim()];
    } else {
      groups = slashParts;
    }
  } else if (/\d\.\d/.test(withoutBrackets) && /\d\s*[\-\u2013\u2014]\s*\d/.test(withoutBrackets)) {
    // Dot notation with dash separators: "3.3.3.3 - 4.3.3.1 - 2.4.0.1 - 14.12.10.8.6"
    groups = clean.split(/\s*[\-\u2013\u2014]\s*(?=\d)/).map(g => g.trim());
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

// ══════════════════════════════════════════
// IMAGE EXTRACTION (JPEG/PNG) — OCR via Tesseract.js
// ══════════════════════════════════════════

/**
 * Extract orchestra data from an image file (JPEG/PNG).
 * Uses Tesseract.js for OCR, then parses the extracted text
 * with the same patterns used for PDF text parsing.
 * Falls back to basic metadata if OCR fails.
 */
export async function extractFromImage(file) {
  const result = {
    titre: "",
    compositeur: "",
    duree: "",
    salle: "",
    chef: "",
    date: "",
    effectif: "",
    effectifDetail: null,
    orchestre: null,
    percus: [],
    planDataUrl: null,
    planDataUrls: [],
    sourceFormat: "image",
  };

  // Convert file to dataUrl for plan display
  const dataUrl = await fileToDataUrlLocal(file);
  result.planDataUrl = dataUrl;
  result.planDataUrls = [dataUrl];

  // Try OCR with Tesseract.js
  let ocrText = "";
  try {
    console.log("[OrkMap] Starting OCR on image...");
    const Tesseract = await import("tesseract.js");
    const worker = await Tesseract.createWorker("fra+eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`[OrkMap] OCR progress: ${Math.round((m.progress || 0) * 100)}%`);
        }
      },
    });
    const { data } = await worker.recognize(file);
    ocrText = data.text || "";
    await worker.terminate();
    console.log("[OrkMap] OCR complete, text length:", ocrText.length);
  } catch (err) {
    console.warn("[OrkMap] OCR failed:", err.message);
  }

  if (ocrText.trim()) {
    // Parse OCR text using the same logic as PDF text parsing
    parseExtractedText(ocrText, result);
  }

  // Fallback title from filename
  if (!result.titre) {
    result.titre = file.name
      .replace(/\.(jpe?g|png)$/i, "")
      .replace(/[-_]/g, " ");
  }

  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
  }
  if (result.effectifDetail) {
    result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }

  // Create percu slots from effectif if none found
  buildPercuFromEffectif(result);

  return result;
}

// ══════════════════════════════════════════
// TXT EXTRACTION — Plain text file parsing
// ══════════════════════════════════════════

/**
 * Extract orchestra data from a plain text file (.txt).
 * Parses the text looking for Daniels notation, composer names,
 * dates, percussion sections, etc.
 */
export async function extractFromTxt(file) {
  const result = {
    titre: "",
    compositeur: "",
    duree: "",
    salle: "",
    chef: "",
    date: "",
    effectif: "",
    effectifDetail: null,
    orchestre: null,
    percus: [],
    planDataUrl: null,
    planDataUrls: [],
    sourceFormat: "txt",
  };

  // Read the text content
  const text = await file.text();
  console.log("[OrkMap] TXT file content length:", text.length);

  if (text.trim()) {
    parseExtractedText(text, result);
  }

  // Fallback title from filename
  if (!result.titre) {
    result.titre = file.name
      .replace(/\.txt$/i, "")
      .replace(/[-_]/g, " ");
  }

  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
  }
  if (result.effectifDetail) {
    result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }

  buildPercuFromEffectif(result);

  return result;
}

// ══════════════════════════════════════════
// UNIFIED FILE EXTRACTION — Routes by file type
// ══════════════════════════════════════════

/**
 * Unified extraction: detects file type and routes to the appropriate extractor.
 * Supports PDF, JPEG, PNG, and TXT files.
 * @param {File} file - The uploaded file
 * @returns {Promise<Object>} Extracted data (same shape as extractFromPdf output)
 */
export async function extractFromFile(file) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  // PDF
  if (type === "application/pdf" || type === "application/x-pdf" || name.endsWith(".pdf")) {
    return extractFromPdf(file);
  }

  // Images (JPEG/PNG)
  if (type.startsWith("image/") || /\.(jpe?g|png)$/.test(name)) {
    return extractFromImage(file);
  }

  // TXT
  if (type === "text/plain" || name.endsWith(".txt")) {
    return extractFromTxt(file);
  }

  // Fallback: try as PDF
  console.warn("[OrkMap] Unknown file type, attempting PDF extraction:", type, name);
  return extractFromPdf(file);
}

// ══════════════════════════════════════════
// SHARED TEXT PARSING — Used by Image OCR and TXT
// ══════════════════════════════════════════

/**
 * Parse extracted text (from OCR or TXT file) to find orchestra data.
 * Uses the same detection patterns as the PDF parsers.
 */
function parseExtractedText(text, result) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const all = lines.join(" ");
  const allLower = all.toLowerCase();

  console.log("[OrkMap] Parsing text, lines:", lines.length);

  // ── 1. Detect format and try specialized parsers first ──
  const format = detectFormat(lines);
  console.log("[OrkMap] Text format detected:", format);

  if (format === "radiofrance") {
    parseRadioFrance(lines, result);
  } else if (format === "dcm") {
    parseDcm(lines, result);
  } else if (format === "eic") {
    parseEic(lines, result);
  } else if (format === "lamoureux") {
    parseLamoureux(lines, result);
  } else if (format === "orchestredeparis") {
    parseOrchDeParis(lines, result);
  } else if (format === "cnsm") {
    parseCnsm(lines, result);
  } else {
    parseGeneric(lines, result);
  }

  // ── 2. Free-form text enhancements ──
  // These run AFTER the format-specific parsers and fill in what was missed
  parseFreeForm(lines, result, all, allLower);
}

/**
 * Enhanced free-form text parser — handles text files and OCR output
 * that don't match structured PDF formats.
 */
function parseFreeForm(lines, result, all, allLower) {
  // ═══ ORCHESTRE DETECTION (in free text) ═══
  if (!result.orchestre || !result.orchestreNom) {
    const orchPatterns = [
      /orchestre\s*(?:national|philharmonique|symphonique|de chambre)?\s*(?:de|d'|du)?\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?)/i,
      /(?:orchestre|ensemble|philhar)\.?\s*(?:national\s*)?(?:de\s*)?([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?)/i,
    ];
    for (const re of orchPatterns) {
      const m = all.match(re);
      if (m) {
        result.orchestre = result.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] };
        result.orchestreNom = m[0].trim();
        // Try to extract full name including de/d'
        const extendedMatch = all.match(/(?:Orchestre|Ensemble|Philhar)\.?\s*(?:National\s*)?(?:de\s*(?:l'|la\s+|le\s+)?)?((?:[A-ZÀ-Ü][a-zà-ü]+\s*)+)/i);
        if (extendedMatch) {
          result.orchestreNom = extendedMatch[0].trim();
        }
        break;
      }
    }
  }

  // ═══ TITLE & COMPOSER DETECTION (first lines) ═══
  // Strategy: scan first ~5 meaningful lines for composer+title patterns
  const candidateLines = lines.slice(0, Math.min(8, lines.length));
  
  // Pattern: "COMPOSER TITLE" (composer name then title on same line)
  for (const line of candidateLines) {
    if (line.length < 5 || line.length > 150) continue;
    // Skip metadata lines
    if (/^(?:objet|lieu|concert|direction|effectif|nomenclature|programme|date|chef|orchestre|ensemble|philhar)/i.test(line)) continue;
    
    // Try to find a known composer at the start of the line
    const found = findKnownComposer(line);
    if (found) {
      result.compositeur = result.compositeur || found;
      // The rest of the line is likely the title
      const titlePart = line.substring(line.indexOf(found) + found.length).trim();
      if (titlePart && titlePart.length > 1) {
        // Don't overwrite if already found from a structured parser
        if (!result.titre) {
          result.titre = titlePart.replace(/^[,\-–:|]\s*/, "").trim();
        }
      }
      break;
    }
  }

  // If no composer+title on same line, try line-by-line patterns
  if (!result.compositeur) {
    // Line before a title-only line is often the composer
    for (let i = 1; i < candidateLines.length; i++) {
      const prevLine = candidateLines[i - 1];
      const foundPrev = findKnownComposer(prevLine);
      if (foundPrev && candidateLines[i].length > 3 && candidateLines[i].length < 120) {
        result.compositeur = foundPrev;
        if (!result.titre) result.titre = candidateLines[i];
        break;
      }
    }
  }

  // Title fallback: first non-metadata, non-composer, non-orchestre line
  if (!result.titre && lines.length > 0) {
    for (const line of candidateLines) {
      if (line.length > 3 && line.length < 120 &&
          !/^(?:objet|lieu|concert|direction|effectif|nomenclature|programme|date|chef|orchestre|ensemble|philhar|avec le|et le|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|\d)/i.test(line) &&
          !findKnownComposer(line)) {
        result.titre = line;
        break;
      }
    }
  }

  // ═══ CHEF DETECTION ═══
  if (!result.chef) {
    const chefPatterns = [
      // "Direction musicale : Nom"
      /direction\s*(?:musicale)?\s*:\s*([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
      // "dirigé par Nom"
      /dirig[ée]e?s?\s*(?:par)?\s*:\s*([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
      // "sous la direction de Nom"
      /sous\s+la\s+direction\s+(?:de\s+)?([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
      // "chef d'orchestre : Nom"
      /chef\s*(?:d'orchestre)?\s*:\s*([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
      // "Dir. : Nom"
      /dir\.\s*:\s*([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
      // "Conductor: Nom"
      /conductor\s*:\s*([A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+(?:\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+){1,3})/i,
    ];
    for (const re of chefPatterns) {
      const m = all.match(re);
      if (m) { result.chef = m[1].trim(); break; }
    }
    // Fallback: look for "Nom, direction" pattern (common in French concert programs)
    if (!result.chef) {
      const dirCommaMatch = all.match(/([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)\s*,\s*direction/i);
      if (dirCommaMatch) result.chef = dirCommaMatch[1].trim();
    }
  }

  // ═══ SOLISTE DETECTION ═══
  const solistePatterns = [
    /(?:piano|pianiste)\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    /(?:violon(?:iste)?)\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    /(?:violoncelle|violoncelliste)\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    /(?:soprano|mezzo-soprano|t[ée]nor|baryton|basse|contralto)\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    /(?:fl[ûu]te|clarinette|hautbois|basson|trompette|cor|trombone|harpe)\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    /soliste\s*:\s*([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+){1,2})/i,
    // "Nom, piano" or "Nom, violon"
    /([A-ZÀ-Ü][a-zà-ü]+\s+[A-ZÀ-Ü][A-ZÀ-Üa-zà-ü]+)\s*,\s*(?:piano|violon|violoncelle|soprano|alto|t[ée]nor)/i,
  ];
  for (const re of solistePatterns) {
    const m = all.match(re);
    if (m && !result.soliste) {
      result.soliste = `${m[1].trim()} (${m[0].match(/piano|violon|violoncelle|soprano|mezzo|t[ée]nor|baryton|basse|contralto|fl[ûu]te|clarinette|hautbois|basson|trompette|cor|trombone|harpe/i)?.[0] || "soliste"})`;
      break;
    }
  }

  // ═══ DATE DETECTION ═══
  if (!result.date) {
    // French dates with day of week
    const datePatterns = [
      /(?:samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi)\s+(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i,
      /(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i,
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      /(\d{4})-(\d{2})-(\d{2})/,
    ];
    for (const re of datePatterns) {
      const m = all.match(re);
      if (m) {
        if (m[0].match(/^\d{1,2}\/\d{1,2}\/\d{4}/) || m[0].match(/^\d{4}-\d{2}-\d{2}/)) {
          result.date = m[0];
        } else if (m[3]) {
          result.date = `${m[1]} ${m[2]} ${m[3]}`;
        } else {
          result.date = `${m[1]} ${m[2]} ${m[3] || m[3]}`;
        }
        break;
      }
    }
  }

  // ═══ LIEU / SALLE DETECTION ═══
  if (!result.salle) {
    const lieuPatterns = [
      /(?:lieu|salle)\s*:\s*(.+?)(?=\s*[-–|]\s*|\s+(?:Compositeur|Titre|Durée|Effectif|Chef|Date|Direction)\s*:|\n|$)/i,
      /(?:Philharmonie|Auditorium|Th[ée][âa]tre|Op[ée]ra|Salle)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)*)/i,
      /(?:à|au)\s+(?:la\s+)?(?:Philharmonie|Auditorium|Maison de la Radio|Th[ée][âa]tre|Salle)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)*)/i,
    ];
    for (const re of lieuPatterns) {
      const m = all.match(re);
      if (m) { result.salle = m[1] ? m[1].trim() : m[0].trim(); break; }
    }
    // "— Philharmonie de Paris" at end of line
    if (!result.salle) {
      for (const line of lines) {
        const pm = line.match(/(?:—|–|-)\s*(Philharmonie|Auditorium|Th[ée][âa]tre|Salle|Op[ée]ra)\s+.+/i);
        if (pm) { result.salle = pm[0].replace(/^[-–—]\s*/, "").trim(); break; }
      }
    }
  }

  // ═══ EFFECTIF — enhanced Daniels detection ═══
  if (!result.effectif) {
    // More flexible: handles "timb." prefix, "hp", "cel" annotations
    const effectifPatterns = [
      // Standard: 3.3.3.3 - 4.3.3.1 - 2perc.1hp - 14.12.10.8.6
      /([\d]+(?:\.[\d]+)*\s*[-–]\s*[\d]+(?:\.[\d]+)*\s*[-–]\s*(?:[\d]+(?:perc|timb|hp|cel|pno|clav)\.?[\d]*(?:perc|timb|hp|cel|pno|clav)?\.?\s*[-–]\s*)?[\d]+(?:\.[\d]+)*\s*[-–]\s*[\d]+(?:\.[\d]+)*(?:\s*[-–]\s*[\d]+(?:\.[\d]+)*)*)/i,
      // Flexible: any sequence containing at least one "." with numbers
      /([\d]+(?:\.[\d]+){2,}(?:\s*[-–]\s*[\d]+(?:\.[\d]+){2,}(?:\s*\[[^\]]*\])?)+)/,
      // With timb/perc annotations: 3.3.3.3 - 4.3.3.1 - timb.3perc - hp - 14.12.10.8.6
      /([\d]+(?:\.[\d]+)*\s*[-–]\s*[\d]+(?:\.[\d]+)*\s*[-–]\s*(?:timb\.?\s*)?[\d]+(?:perc)?\.?(?:[\d]*)?(?:perc|timb)?\.?\s*(?:[-–]\s*(?:hp|cel|pno|clav)\s*)?[-–]\s*[\d]+(?:\.[\d]+)*(?:\s*[-–]\s*[\d]+(?:\.[\d]+)*)*)/i,
    ];
    for (const re of effectifPatterns) {
      const m = all.match(re);
      if (m) { result.effectif = m[1].trim(); break; }
    }
  }

  // ═══ PERCUSSION — free-form text sections ═══
  // Try standard P1: P2: headers first (parsePercuSections handles these)
  const existingPercuCount = result.percus.length;

  // If no percussion sections were found, try free-form patterns
  if (existingPercuCount === 0) {
    // "Percussion : instrument1, instrument2, instrument3"
    const percMatch = all.match(/(?:percussions?|perc)\s*:\s*(.+?)(?=\s*[-–|]\s*|\s+(?:Direction|Chef|Effectif|Lieu|Date|Titre|Compositeur|Orchestre|\d+[\.:])\s*|$)/i);
    if (percMatch) {
      const percText = percMatch[1].trim();
      const items = percText.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      if (items.length > 0) {
        const categorizedItems = items.map(nom => {
          const cat = categorizeInstrument(nom);
          return { cat, nom };
        });
        result.percus.push({ nom: "Percussion", items: categorizedItems });
      }
    }

    // Look for "Timbales : ..." and "Percussion : ..." on separate lines
    if (result.percus.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const timbMatch = line.match(/timbales?\s*:\s*(.+)/i);
        if (timbMatch) {
          const items = timbMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
          result.percus.push({
            nom: "Timbalier",
            items: [{ cat: "Timbales & Peaux", nom: "4 Timbales" }, ...items.map(nom => ({ cat: categorizeInstrument(nom), nom }))],
          });
        }
        const percLineMatch = line.match(/percussions?\s*\d*\s*:\s*(.+)/i);
        if (percLineMatch && !timbMatch) {
          const percNum = line.match(/percussions?\s*(\d+)\s*:/i);
          const items = percLineMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
          result.percus.push({
            nom: percNum ? `Percu ${percNum[1]}` : "Percussion",
            items: items.map(nom => ({ cat: categorizeInstrument(nom), nom })),
          });
        }
      }
    }
  }

  // ═══ LABELED FIELDS (fallback if still missing) ═══
  if (!result.compositeur) {
    const compMatch = all.match(/Compositeur\s*:\s*(.+?)(?=\s*[-–|]|\s+(?:Titre|Durée|Effectif|Chef|Lieu|Date|Direction)\s*:|\n|$)/i);
    if (compMatch) result.compositeur = compMatch[1].trim();
  }
  if (!result.titre) {
    const titreMatch = all.match(/Titre\s*:\s*(.+?)(?=\s*[-–|]|\s+(?:Compositeur|Durée|Effectif|Chef|Lieu|Date|Direction)\s*:|\n|$)/i);
    if (titreMatch) result.titre = titreMatch[1].trim();
  }
  if (!result.salle) {
    const lieuMatch = all.match(/(?:Lieu|Salle)\s*:\s*(.+?)(?=\s*[-–|]|\s+(?:Compositeur|Titre|Durée|Effectif|Chef|Date|Direction)\s*:|\n|$)/i);
    if (lieuMatch) result.salle = lieuMatch[1].trim();
  }
  if (!result.chef) {
    const chefMatch = all.match(/Chef\s*:\s*(.+?)(?=\s*[-–|]|\s+(?:Compositeur|Titre|Durée|Effectif|Lieu|Date|Direction)\s*:|\n|$)/i);
    if (chefMatch) result.chef = chefMatch[1].trim();
  }
  if (!result.date) {
    const dateMatch = all.match(/Date\s*:\s*(.+?)(?=\s*[-–|]|\s+(?:Compositeur|Titre|Durée|Effectif|Chef|Lieu|Direction)\s*:|\n|$)/i);
    if (dateMatch) result.date = dateMatch[1].trim();
  }
}

/**
 * Categorize an instrument name into one of the standard categories.
 */
function categorizeInstrument(nom) {
  const n = nom.toLowerCase().trim();
  if (/timbale|grosse caisse|caisse claire|tom|bongo|conga|djemb[ée]|tambour|caj[óo]n|batterie|peau/i.test(n)) {
    return "Timbales & Peaux";
  }
  if (/vibraphone|marimba|xylophone|glockenspiel|c[ée]lesta|cloches?(?:\s+tubes?)?|jeu de timbres|crotales/i.test(n)) {
    return "Claviers";
  }
  if (/tam-?tam|gong|t[ôo]le|enclume|cloche|grosse pi[eè]ce|contrebasse/i.test(n)) {
    return "Grosses pièces";
  }
  if (/stand|pied|support|tr[ée]pied|table/i.test(n)) {
    return "Stands & supports";
  }
  if (/baguette|mailloche|archet|balai/i.test(n)) {
    return "Baguettes & spécial";
  }
  // Default: Accessoires for everything else
  return "Accessoires";
}

/**
 * Build percussion slots from effectif detail (shared helper).
 */
function buildPercuFromEffectif(result) {
  if (result.percus.length === 0 && result.effectifDetail?.percussions) {
    const perc = result.effectifDetail.percussions;
    const timb = perc["Timbales"] || 0;
    for (let i = 1; i <= timb; i++) {
      result.percus.push({
        nom: timb === 1 ? "Timbalier" : `Timbalier ${i}`,
        items: [{ cat: "Timbales & Peaux", nom: "4 Timbales" }],
      });
    }
    const percCount = perc["Percussion"] || 0;
    for (let i = 1; i <= percCount; i++) {
      result.percus.push({ nom: `Percu ${i}`, items: [] });
    }
    if (result.percus.length === 0) {
      const total = perc.total || 0;
      for (let i = 1; i <= total; i++) {
        result.percus.push({ nom: `Percu ${i}`, items: [] });
      }
    }
  }
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
}

/**
 * Helper: read file as dataUrl (for image plan display)
 */
function fileToDataUrlLocal(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ══════════════════════════════════════════
// GEMINI AI EXTRACTION
// ══════════════════════════════════════════

/**
 * Extract data from a plan image via serverless endpoint (/api/extract-ai).
 * The API key stays server-side only — never exposed to the browser.
 */
export async function extractWithGemini(imageDataUrl) {
  const resp = await fetch("/api/extract-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Erreur serveur ${resp.status}`);
  }
  const parsed = await resp.json();
  const result = {
    titre: parsed.titre || "", compositeur: parsed.compositeur || "",
    duree: parsed.duree || "", salle: parsed.salle || "",
    chef: parsed.chef || "", date: parsed.date || "",
    effectif: parsed.effectif || "", effectifDetail: null,
    orchestre: parsed.orchestre || null,
    percus: (parsed.percus || []).map(p => ({
      nom: p.nom || "Percu", items: (p.items || []).map(it => ({ cat: it.cat || "Accessoires", nom: it.nom || "" })).filter(it => it.nom)
    })),
  };
  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
    if (result.effectifDetail && !result.orchestre) result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }
  return result;
}
