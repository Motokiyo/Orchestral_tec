/**
 * PDF Import — extract orchestra data from stage plan PDFs
 * Handles multiple formats: EIC, Radio France, Orchestre Lamoureux, generic
 * Uses pdf.js (Mozilla) for client-side parsing
 */

import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import { shrinkPlanForStorage } from "./planImages.js";
import {
  AiExtractionError, AI_CLIENT_TIMEOUT_MS, UNKNOWN_POLE_NAME, UNKNOWN_CAT, MAX_AI_BODY_BYTES,
  planAiPages, noPageError, formatMo,
} from "./aiImport.js";

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
  // Toutes les pages sont comptées : celles qui ne peuvent pas être rendues sont listées (pagesFailed),
  // jamais perdues en silence. planPageNumbers = numéro de page d'origine de chaque image de planDataUrls.
  let planDataUrl = null;
  let planDataUrls = [];
  let planPageNumbers = [];
  let pagesFailed = [];
  try {
    const rendered = await renderAllPages(pdf);
    planDataUrls = rendered.urls;
    planPageNumbers = rendered.pageNumbers;
    pagesFailed = rendered.failed;
    planDataUrl = planDataUrls[0] || null;
  } catch (err) {
    console.warn("[OrkMap] Could not render plan:", err);
    pagesFailed = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
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
    pageCount: pdf.numPages,
    planPageNumbers,
    pagesFailed,
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

  // sansChef n'est JAMAIS déduit d'une absence (effectif vide, pas de nomenclature, pas de chef écrit) :
  // sans mention explicite il reste inconnu (null). Voir DECISIONS.md et le LOT 2.
  if (typeof result.sansChef !== "boolean") result.sansChef = null;

  console.log("[OrkMap] Extracted:", {
    titre: result.titre, compositeur: result.compositeur, effectif: result.effectif,
    chef: result.chef, date: result.date, salle: result.salle, percus: result.percus.length,
    sansChef: result.sansChef,
  });

  etendreLigneEffectif(lines, result);
  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
  }

  // Build orchestre from effectifDetail — always overrides label-based detection
  if (result.effectifDetail) {
    result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }

  // Fallback title from filename
  if (!result.titre) {
    result.titre = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
  }

  finaliserLecture(result, lines);
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
  const pageNumbers = [];
  const failed = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const url = await renderPageToImage(pdf, i);
      urls.push(url);
      pageNumbers.push(i);
    } catch (err) {
      console.warn(`[OrkMap] Could not render page ${i}:`, err);
      failed.push(i);
    }
  }
  return { urls, pageNumbers, failed };
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

  // Search line-by-line to avoid matching venue numbers (e.g. "Studio 104")
  let musicianCount = 0;
  for (const line of lines) {
    const lineLower = line.trim().toLowerCase();
    // Match "oui 7 pupitres" or "7 pupitres pliants" or "7 petits pupitres musiciens"
    const pm = lineLower.match(/(\d+)\s*(?:petits?\s+)?pupitres?\s+(?:pliants?|musiciens?)?/i);
    if (pm) {
      musicianCount = parseInt(pm[1]);
      break;
    }
  }
  if (!musicianCount) {
    for (const line of lines) {
      const lineLower = line.trim().toLowerCase();
      // Match "oui 7" or "7 chaises"
      const cm = lineLower.match(/(\d+)\s*chaises?\b/i);
      if (cm) {
        musicianCount = parseInt(cm[1]);
        break;
      }
    }
  }

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

  // ── Chef: "Chef d'équipe" in contacts is a technical crew role, not a music director.
  // Un ensemble de chambre « peut ou non » avoir un chef : on ne le déduit pas, sansChef reste inconnu.
  result.chef = "";

  // ── Orchestre: build from detected instruments/count ──
  if (instruments.length > 0 && count > 0) {
    result.orchestre = { bois: [], cuivres: [], cordes: [`${count} ${instruments.join(", ")}`], autres: [] };
  } else if (count > 0) {
    result.orchestre = { bois: [], cuivres: [], cordes: [`${count} musicien${count > 1 ? "s" : ""}`], autres: [] };
  }

  console.log("[OrkMap] DCM parse: ensemble count:", count, "instruments:", instruments, "hasChef: false");
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
  "Guitare basse": "Guitares basses", "Accordéon": "Accordéons", "Soprano": "Sopranos",
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
  // Extras (keyboard instruments in brackets): [Cel/Pno]. C'est une annotation du claviériste déjà
  // compté (« 1 Clavier »), pas une ligne de musiciens : elle reste entre crochets pour ne pas être
  // comptée « sans quantité » (voir isAnnotationItem dans utils.js).
  if (detail.extras) {
    orchestre.autres.push(`[${detail.extras}]`);
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

  // Autres musiciens nommés dans la nomenclature (guitare basse, accordéon, soprano...)
  if (detail.autres) {
    for (const [name, count] of Object.entries(detail.autres)) {
      if (count > 0) orchestre.autres.push(formatEntry(name, count));
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
// Separators: "/" or " - " between groups, "." or "-" within groups.
// Notations acceptées : points + tirets (espacés ou collés), slashs (espacés ou collés), tirets dans les
// groupes + slashs entre eux, crochets [Cel/Pno], « Cordes[…] », format mixte « 3.3.3.3/4.3.3.1 - 14.12.10.8.6 »,
// points traînants. Tout le reste (mots, nombre de groupes inattendu) donne null : on ne devine pas.

// Un groupe numérique = des nombres séparés par « . », « - » ou des espaces, avec suffixes éventuels :
// "3.3.3.3", "1-1-1-2sax", "2(pic).2(eh)", "*1+eh", "6+2.2.5+2" (« +N » = N auxiliaires), "1-1-1-SaxTénor".
const DANIELS_TOKEN = String.raw`(?:\*?\d+(?:\+\d+)?(?:\s?\([A-Za-zéèà]{1,6}\)|\+[A-Za-zéèà]{1,6})?(?:sax|picc?|afl|eh|ca|bcl|ecl|cbn|cfg)?|sax[A-Za-zéèà]{0,9})`;
const DANIELS_GROUP_RE = new RegExp(`^${DANIELS_TOKEN}(?:[\\s.\\-\u2013\u2014]+${DANIELS_TOKEN})*$`, "i");
const BRACKET_MARK = /\u0001(\d+)\u0002/g;
const DASHES = "\\-\u2013\u2014";

const stripAccents = (w) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function saxLabel(word) {
  const q = stripAccents(word.slice(3));
  if (!q) return "Saxophone";
  if (q === "a" || q === "alto") return "Saxophone alto";
  if (q === "t" || q === "tenor") return "Saxophone ténor";
  if (q === "b" || q === "bar" || q === "baryton") return "Saxophone baryton";
  if (q === "s" || q === "sop" || q === "soprano") return "Saxophone soprano";
  return "Saxophone";
}

/**
 * Éléments nommés d'une ligne d'effectif (« T+2 », « 2hp », « cel », « orgue », « 3Perc », « SaxA »,
 * « guitbasse », « 1timb.1perc.1harpe »). Un nom seul vaut 1 musicien (convention de la nomenclature).
 * Renvoie false (refus) si un mot est inconnu ou ambigu (« 2 timb. » : 2 timbaliers ou 2 timbales ?).
 */
function parseLabelledElements(text, acc) {
  const re = /(\d+)?\s*([A-Za-zÀ-ÿ]+)\.?(?:\+(\d+))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const hasN = m[1] !== undefined;
    const n = hasN ? parseInt(m[1], 10) : 1;
    const raw = m[2];
    const w = stripAccents(raw);
    if (w === "t" || /^timb/.test(w)) {
      if (hasN && n > 1) return false; // « 2 timb. » : nombre de timbaliers ou de timbales ? on ne devine pas
      acc.timbales += n;
      if (m[3] !== undefined) acc.percussion += parseInt(m[3], 10); // T+2 = 1 timbalier + 2 percussionnistes
    } else if (/^perc/.test(w)) acc.percussion += n;
    else if (/^(?:hp|harpes?)$/.test(w)) acc.harpe += n;
    else if (/^(?:cel|celesta|orgue|piano|pno|clavecin|cembalo)$/.test(w) || /^clav/.test(w)) { acc.clavier += n; acc.clavierNoms.push(raw); }
    else if (/^ondes?$/.test(w) || /^martenot$/.test(w)) acc.autres["Ondes Martenot"] = (acc.autres["Ondes Martenot"] || 0) + n;
    else if (/^acc/.test(w)) acc.autres["Accordéon"] = (acc.autres["Accordéon"] || 0) + n;
    else if (/^sax/.test(w)) { const l = saxLabel(w.length === raw.length ? w : raw.toLowerCase()); acc.saxes[l] = (acc.saxes[l] || 0) + n; }
    else if (/^guit/.test(w)) { const l = /bass/.test(w) ? "Guitare basse" : "Guitare"; acc.autres[l] = (acc.autres[l] || 0) + n; }
    else if (/^sop/.test(w)) acc.autres["Soprano"] = (acc.autres["Soprano"] || 0) + n;
    else if (/^(?:banda|soliste|solo)$/.test(w)) acc.remarques.push(raw);
    else return false;
  }
  return true;
}

const newLabelled = () => ({ timbales: 0, percussion: 0, harpe: 0, clavier: 0, clavierNoms: [], saxes: {}, autres: {}, remarques: [] });

/** Fabrique le résultat commun aux deux formes de notation. */
function buildDetail(notation, { boisG, cuivresG, percG, cordesG, lab, extras, remarques }) {
  const detail = { raw: notation, bois: null, cuivres: null, percussions: null, cordes: null, extras: null, autres: null, remarques: [], summary: [] };

  const sw = boisG ? saxWordsOut(boisG) : { text: "", saxes: {} };
  detail.bois = mapPartsWithDoublings(boisG ? parseGroup(sw.text) : [], ["Flûte", "Hautbois", "Clarinette", "Basson"]);
  for (const [name, n] of Object.entries(sw.saxes)) detail.bois[name] = (detail.bois[name] || 0) + n;
  detail.cuivres = mapPartsWithDoublings(cuivresG ? parseGroup(cuivresG) : [], ["Cor", "Trompette", "Trombone", "Tuba"]);
  for (const [name, n] of Object.entries(lab.saxes)) if (n > 0) detail.bois[name] = (detail.bois[name] || 0) + n;
  if (boisG === null) detail.bois = null;
  if (cuivresG === null) detail.cuivres = null;
  if (detail.bois) addSummary(detail.summary, detail.bois);
  if (detail.cuivres) addSummary(detail.summary, detail.cuivres);

  // Percussions : groupe numérique (Timb . Perc . Hp . Clav) + éléments nommés
  const hasLab = lab.timbales || lab.percussion || lab.harpe || lab.clavier;
  if (percG !== null || hasLab) {
    const percParts = percG ? parseGroup(percG) : [];
    const perc = mapParts(percParts, ["Timbales", "Percussion", "Harpe", "Clavier"]);
    const add = (k, n) => { if (n > 0) perc[k] = (perc[k] || 0) + n; };
    add("Timbales", lab.timbales); add("Percussion", lab.percussion); add("Harpe", lab.harpe); add("Clavier", lab.clavier);
    perc.total = ["Timbales", "Percussion", "Harpe", "Clavier"].reduce((s, k) => s + (perc[k] || 0), 0);
    detail.percussions = perc;
  }
  if (extras) { detail.extras = extras; detail.summary.push(extras); }
  else if (lab.clavierNoms.length) detail.extras = lab.clavierNoms.join(", ");
  if (detail.percussions) addSummary(detail.summary, detail.percussions);

  if (cordesG) {
    detail.cordes = mapParts(parseGroup(cordesG), ["Violon I", "Violon II", "Alto", "Violoncelle", "Contrebasse"]);
    addSummary(detail.summary, detail.cordes);
  }
  if (Object.keys(lab.autres).length) detail.autres = lab.autres;
  detail.remarques = [...remarques, ...lab.remarques];
  detail.effectifPercus = computeEffectifPercus(percG, lab);
  return detail;
}

/**
 * Timbaliers et percussionnistes lus (musiciens, pas instruments) : { timbaliers, percussionnistes }.
 * « T+2 » = 1 timbalier + 2 percussionnistes. Un champ non écrit reste null ; null entier si rien n'est dit.
 * (« 2 timb. » ambigu fait refuser tout le décodage en amont : on n'arrive jamais ici.)
 */
function computeEffectifPercus(percG, lab) {
  let timb = null; let perc = null;
  if (percG) {
    const parts = parseGroup(percG);
    if (parts[0]) timb = parts[0].count;
    if (parts[1]) perc = parts[1].count;
  }
  if (lab.timbales) timb = (timb || 0) + lab.timbales;
  if (lab.percussion) perc = (perc || 0) + lab.percussion;
  if (timb === null && perc === null) return null;
  // Convention Daniels : « -Timb » seul dit 1 timbalier et aucun percussionniste nommé.
  return { timbaliers: timb === null ? 0 : timb, percussionnistes: perc === null ? 0 : perc };
}

// Notation anglaise du LSO : « 2220 / 0400 / 0T 2P 2 x Vibraphones 0H 2Pno / 1BassGuitar / 10.8.6.6.0 ».
// Lettres collées aux chiffres (T timbales, P percussionnistes, H harpes, Pno pianos, Kb claviers).
// Des exposants aplatis (« 104 2sopsax 0 ») ne sont PAS devinés : ce groupe reste null.
function decodeLetterNotation(notation, s0) {
  const remarques = [];
  let t = s0.replace(/\(([^)]*)\)/g, (_, inner) => { remarques.push(inner.trim()); return /\d\s?Kb\b/.test(inner) ? ` ${inner} ` : " "; });
  const ens = /ENSEMBLE\s*:\s*[\d.]+/i.exec(t);
  if (ens) { remarques.push(ens[0].replace(/\s+/g, " ")); t = t.replace(ens[0], " "); }
  let cordesG = null;
  const lab1 = /(?:FULL ORCHESTRA\s*)?STRINGS?\s*:?\s*(\d+(?:\.\d+){4})/i.exec(t);
  const lab2 = /(?:^|[\s/])(\d+(?:\.\d+){4})\s*$/.exec(t);
  const none = /(?:^|[\s/])(?:-\.){4}-\s*$/.exec(t);
  if (lab1) { cordesG = lab1[1]; t = t.replace(lab1[0], " "); }
  else if (lab2) { cordesG = lab2[1]; t = t.slice(0, lab2.index) + " "; }
  else if (none) { t = t.slice(0, none.index) + " "; }
  const segs = t.split("/").map((x) => x.trim()).filter(Boolean);
  const quad = (x) => (x && /^\d{4}$/.test(x) ? x.split("").join(".") : null);
  const boisG = quad(segs[0]);
  const cuivresG = quad(segs[1]);
  if (!boisG) remarques.push("bois non lus : exposants aplatis dans le texte");
  if (!cuivresG) remarques.push("cuivres non lus : exposants aplatis dans le texte");
  const lab = newLabelled();
  const tokRe = /(?<![A-Za-z\d.])(\d+)\s?(T|P|H|Pno|Kb|BassGuitar)(?![A-Za-z])/g;
  let m; let found = 0;
  while ((m = tokRe.exec(t)) !== null) {
    const n = parseInt(m[1], 10); found++;
    if (m[2] === "T") lab.timbales += n;
    else if (m[2] === "P") lab.percussion += n;
    else if (m[2] === "H") lab.harpe += n;
    else if (m[2] === "BassGuitar") lab.autres["Guitare basse"] = (lab.autres["Guitare basse"] || 0) + n;
    else { lab.clavier += n; if (n > 0) lab.clavierNoms.push(m[2] === "Pno" ? `${n} piano${n > 1 ? "s" : ""}` : `${n} clavier${n > 1 ? "s" : ""}`); }
  }
  if (!found) return null;
  const d = buildDetail(notation, { boisG, cuivresG, percG: null, cordesG, lab, extras: null, remarques });
  if (d.percussions === null) d.percussions = { total: 0 };
  // « 0T 2P » : les deux chiffres sont écrits, donc connus (zéro compris).
  const hasT = /(?<![A-Za-z\d.])\d+\s?T(?![A-Za-z])/.test(t); const hasP = /(?<![A-Za-z\d.])\d+\s?P(?![A-Za-z])/.test(t);
  d.effectifPercus = (hasT || hasP) ? { timbaliers: lab.timbales, percussionnistes: lab.percussion } : null;
  // Instruments de percussion écrits avec leur nombre : « 2 x Vibraphones », « (2 Marimba, 2 Xylo, Vibraphone) ».
  const inst = lireInstrumentsPercuEcrits(s0);
  if (inst.length) d.instrumentsPercu = inst;
  return d;
}

/**
 * Décode une nomenclature d'effectif (Daniels : Bois / Cuivres / Percussions / Cordes, et variantes).
 * Renvoie null plutôt que deviner : mots inconnus, nombre de groupes inattendu, nombre ambigu.
 * Notations acceptées : points + tirets (espacés ou collés), slashs, tirets dans les groupes + slashs entre
 * eux, espaces, tirets longs, crochets [Cel/Pno], « Cordes[…] » ou « [Cordes …] », cordes en dernier groupe
 * ou en 5 nombres collés (« 6-5-4-3-1 », « 0/0/0/0/0 »), doublures (pic) (eh) [pic et sol], auxiliaires
 * « 6+2 », percussions nommées (« T+2 -2hp -cel -orgue »), saxophones (« 2sax », « SaxTénor »), points
 * traînants, cordes en premier (« 7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe ») et notation LSO.
 */
export function decodeEffectif(notation) {
  if (typeof notation !== "string") return null;
  const remarques = [];
  let s = notation.trim()
    .replace(/^(?:effectif|nomenclature|daniels)\s*:?\s*/i, "")        // étiquette recopiée du cartouche
    .replace(/\s*\((?:daniels|nomenclature)[^)]*\)\s*$/i, "")          // remarque finale « (Daniels) »
    .replace(/[\s\-\u2013\u2014]*soit\s+\d+\s*mus\w*\.?\s*$/i, "")      // total CNSM « - soit 23 mus » (le total n'est pas un groupe)
    .replace(/\.(?=\s*[\/\-\u2013\u2014])/g, "")                         // points traînants avant un séparateur
    .replace(/[\s.]+$/, "");                                              // et en fin de ligne
  if (!s) return null;

  if ((s.match(/(?<![A-Za-z\d.])\d+\s?(?:T|P|H|Pno|Kb)(?![A-Za-z])/g) || []).length >= 2) return decodeLetterNotation(notation, s);

  // LSO sans percussions : « 2220 / 0400 » = 2.2.2.0 / 0.4.0.0 (bois / cuivres, rien d'autre n'est dit).
  const compact = /^(\d{4})\s*\/\s*(\d{4})$/.exec(s);
  if (compact) {
    return buildDetail(notation, { boisG: compact[1].split("").join("."), cuivresG: compact[2].split("").join("."), percG: null, cordesG: null, lab: newLabelled(), extras: null, remarques });
  }

  // Cordes données à part : « Cordes[12.10.8.6.4] », « [Cordes 8.8.6.5.3] », « - cordes 16.14… »
  let cordesG = null;
  const takeCordes = (inner) => { const nums = String(inner).match(/\d+/g); if (nums && nums.length >= 1) cordesG = nums.join("."); };
  s = s.replace(/\[\s*(?:cordes?|strings?)\s*:?\s*([\d.\-\s\/]+)\]/i, (_, inner) => { takeCordes(inner); return " "; });
  if (cordesG === null) s = s.replace(/(?:cordes?|strings?)\s*:?\s*\[([\d.\-\s\/]+)\]/i, (_, inner) => { takeCordes(inner); return " "; });
  // Prose après « ; » (ex. cordes écrites en toutes lettres) et remarques entre parenthèses précédées d'un espace
  const semi = s.indexOf(";");
  if (semi >= 0) { remarques.push(s.slice(semi + 1).trim()); s = s.slice(0, semi); }
  s = s.replace(/\s+\(([^)]*)\)/g, (_, inner) => { remarques.push(inner.trim()); return " "; });
  s = s.replace(/\s*\+\s*soliste\w*\s*$/i, () => { remarques.push("soliste"); return ""; });
  // Cordes en dernier : 5 nombres reliés par « . », « - » ou « / » (ex. « 16.14.12.10.8 », « 6-5-4-3-1 », « 0/0/0/0/0 »)
  if (cordesG === null) {
    const m = /(?:^|[\s\/])(\d+(?:\.\d+){4,}|\d+(?:-\d+){4,}|\d+(?:\s*\/\s*\d+){4,})\s*\+?\s*$/.exec(s);
    if (m) { takeCordes(m[1]); s = s.slice(0, m.index) + " "; }
  }
  s = s.replace(/(?:cordes?|strings?)\s*$/i, "").replace(/(?:^|[\s\/\-\u2013\u2014])[\s\/\-\u2013\u2014]+$/, " ");
  // Doublures écrites contre un chiffre : « 1[pic et sol] », « 3[III+Pic] » (information gardée en remarque)
  s = s.replace(/(\d)\[([^\]]*)\]/g, (_, d, inner) => { remarques.push(`${d}[${inner}]`); return d; });
  // Précision écrite contre un nom (CNSM) : « Pno[Prép] », « Hp[Prép] », « Sax[S+Bar] », « Pno[Droit] » : gardée en remarque,
  // le nom seul compte le musicien. (« Cordes[…] » est déjà retiré plus haut ; « [Cel/Pno] » seul, précédé d'un espace, reste un extra.)
  s = s.replace(/([A-Za-zÀ-ÿ]+)\[([^\]]*)\]/g, (_, w, inner) => {
    remarques.push(`${w}[${inner}]`);
    // « Sax[A] » = un saxophone alto : la précision donne le type (une seule lettre ou un seul mot connu).
    if (/^sax$/i.test(w) && /^\s*(?:a|alto|t|t[ée]nor|b|bar|baryton|s|sop|soprano)\s*$/i.test(inner)) return `Sax${inner.trim()}`;
    return w;
  });
  // Crochets restants (« [Cel/Pno] ») : mis de côté, leur « / » n'est pas un séparateur de groupe
  const brackets = [];
  s = s.replace(/\[([^\]]*)\]/g, (_, inner) => { brackets.push(inner.trim()); return `\u0001${brackets.length - 1}\u0002`; });
  s = s.replace(/^[\s\/\-\u2013\u2014]+|[\s\/\-\u2013\u2014]+$/g, "");

  const hasDots = /\d\.\d/.test(s);
  const sepRe = hasDots
    ? new RegExp(`\\s*[/${DASHES}]\\s*`)                         // points dans les groupes : tout tiret sépare
    : new RegExp(`\\s*/\\s*|\\s*[\u2013\u2014]\\s*|\\s+-\\s*|\\s*-\\s+`); // sinon : « / », tirets longs, tiret espacé
  const items = s.split(sepRe).map((x) => x.trim()).filter(Boolean);

  const extrasFound = [];
  const numerics = []; const labelled = [];
  for (const it of items) {
    const bare = it.replace(BRACKET_MARK, (_, i) => { extrasFound.push(brackets[Number(i)]); return ""; }).trim();
    if (!bare) continue;
    // Groupe numérique : au moins un chiffre, et soit plusieurs nombres, soit un nombre seul (« 1 »).
    // « 3sax », « 2hp », « 3perc » (un seul nombre collé à un mot) sont des éléments nommés.
    const isGroup = /\d/.test(bare) && DANIELS_GROUP_RE.test(bare) && (tokCount(bare) >= 2 || /^\d+$/.test(bare));
    (isGroup ? numerics : labelled).push(bare);
  }
  const tok = tokCount;

  // Cordes en premier (7.6.5.4.3 / 2.1.2.1 / 3.2.2.0 / 1timb.1perc.1harpe) : un groupe à 5 nombres en tête,
  // alors que la dernière ligne est nommée.
  if (cordesG === null && numerics.length >= 3 && tok(numerics[0]) === 5 && labelled.length > 0) cordesG = numerics.shift();
  // Même cas sans ligne nommée : 5 nombres décroissants en tête (7.6.5.4.3), les autres groupes n'en ont pas 5.
  if (cordesG === null && numerics.length === 4 && ressembleACordes(numerics[0]) && tok(numerics[3]) !== 5) cordesG = numerics.shift();
  // 4 groupes numériques : le dernier est celui des cordes
  if (cordesG === null && numerics.length === 4) cordesG = numerics.pop();
  // 3 groupes numériques dont le dernier a 5 pupitres ou plus : cordes (bois/cuivres + cordes)
  if (cordesG === null && numerics.length === 3 && tok(numerics[2]) >= 5) cordesG = numerics.pop();
  if (numerics.length < 2 || numerics.length > 3) return null;
  if (tok(cordesG || "") > 5) return null;
  const boisG = numerics[0]; const cuivresG = numerics[1]; const percG = numerics[2] || null;
  if (tok(boisG) > 4 && !/sax/i.test(boisG)) return null;
  if (tok(cuivresG) > 4 || (percG && tok(percG) > 4)) return null;
  const lab = newLabelled();
  for (const l of labelled) if (!parseLabelledElements(l, lab)) return null;
  // Trois groupes au moins : bois, cuivres, + percussions (numériques ou nommées) ou cordes
  const hasLab = lab.timbales || lab.percussion || lab.harpe || lab.clavier || Object.keys(lab.saxes).length || Object.keys(lab.autres).length;
  if (numerics.length + (cordesG ? 1 : 0) + (percG === null && hasLab ? 1 : 0) < 3) return null;

  const extras = extrasFound.find(Boolean) || null;
  return buildDetail(notation, { boisG, cuivresG, percG, cordesG, lab, extras, remarques: remarques.filter(Boolean) });
}

/** 5 nombres décroissants (jamais croissants, premier > dernier, premier au moins 3) : ressemble à des cordes (7.6.5.4.3, 16.14.12.10.8). */
function ressembleACordes(g) {
  const n = String(g).replace(/\+\d+/g, "").match(/\d+/g) || [];
  if (n.length !== 5) return false;
  const v = n.map(Number);
  return v[0] >= 3 && v[0] > v[4] && v.every((x, i) => i === 0 || x <= v[i - 1]);
}

// Nombre de pupitres d'un groupe : « 6+2 » compte pour un seul (le « +2 » sont des auxiliaires).
const tokCount = (g) => (String(g).replace(/\+\d+/g, "").match(/\d+/g) || []).length;

function saxWordsOut(str) {
  // Sort les mots « SaxTénor », « SaxBaryton » d'un groupe numérique ; renvoie { text, saxes }
  const saxes = {};
  const text = str.replace(/sax[A-Za-zéèà]{0,9}/gi, (w, offset, whole) => {
    // « 2sax » (chiffre collé) est un suffixe géré plus loin ; seuls les mots seuls sont retirés ici
    if (offset > 0 && /\d/.test(whole[offset - 1])) return w;
    const l = saxLabel(w); saxes[l] = (saxes[l] || 0) + 1; return " ";
  });
  return { text, saxes };
}

function parseGroup(str) {
  const parts = [];
  // Split by . or - (within a group), handle suffixes like "2sax", "(pic)", "+eh", "+2" (auxiliaires)
  const regex = /(\*?)(\d+)(?:\+(\d+))?(?:\s*(?:\(([^)]+)\)|\+([a-zA-Zéèà]+)))?([a-zA-ZéèàÀ-Ü]*)/g;
  let m;
  while ((m = regex.exec(str)) !== null) {
    parts.push({
      count: parseInt(m[2]),
      dedicated: m[1] === "*",  // * = dedicated auxiliary player
      plus: m[3] ? parseInt(m[3], 10) : 0, // 6+2 : 6 + 2 auxiliaires
      doubling: m[4] || m[5] || "", // (pic) or +eh
      suffix: m[6] || "",  // 2sax → suffix="sax"
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

    // « 6+2 » : 6 musiciens + 2 auxiliaires dédiés ; « 2+3sax » : 2 + 3 saxophones
    if (p.plus > 0) {
      if (p.count > 0) result[baseName] = p.count;
      const aux = p.suffix ? (DOUBLING_NAMES[p.suffix.toLowerCase()] || `${baseName} (${p.suffix})`) : `${baseName} (auxiliaire)`;
      result[aux] = (result[aux] || 0) + p.plus;
      return;
    }

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
    if (p.plus > 0) result[`${name} (auxiliaire)`] = p.plus;
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
// LOT 4B — ORDRE DANIELS, EFFECTIF DES PERCUSSIONS, NOMS BAROQUES, PLAN DE DÉTAIL PERCUSSION
// ══════════════════════════════════════════

/** Instruments de percussion à clavier écrits avec leur nombre : « 2 x Vibraphones », « (2 Marimba, 2 Xylo, Vibraphone) ». */
export function lireInstrumentsPercuEcrits(text) {
  const out = {};
  const re = /(?:(\d+)\s*(?:x\s*)?)?\b(vibraphones?|marimbas?|xylophones?|xylos?|glockenspiels?|glocks?|crotales?)\b/gi;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const w = stripAccents(m[2]);
    const nom = /^vibra/.test(w) ? "Vibraphone" : /^marimba/.test(w) ? "Marimba" : /^xylo/.test(w) ? "Xylophone" : /^glock/.test(w) ? "Glockenspiel" : "Crotales";
    out[nom] = (out[nom] || 0) + (m[1] ? parseInt(m[1], 10) : 1);
  }
  return Object.entries(out).map(([nom, qte]) => ({ nom, qte }));
}

// ── Ligne d'effectif remise en ordre Daniels ──

const SLOTS_BOIS = ["Flûte", "Hautbois", "Clarinette", "Basson"];
const SLOTS_CUIVRES = ["Cor", "Trompette", "Trombone", "Tuba"];
const SLOTS_CORDES = ["Violon I", "Violon II", "Alto", "Violoncelle", "Contrebasse"];
// Instrument « dédié » écrit seul (Piccolo, Cor anglais…) : rattaché à son pupitre, compté comme auxiliaire.
const DEDIES = { "Piccolo": ["Flûte", "pic"], "Flûte alto": ["Flûte", "afl"], "Cor anglais": ["Hautbois", "eh"], "Clarinette basse": ["Clarinette", "bcl"], "Petite clarinette (Mib)": ["Clarinette", "ecl"], "Contrebasson": ["Basson", "cbn"] };
const ABBR_DOUBLING = { "Piccolo": "pic", "Flûte alto": "afl", "Cor anglais": "eh", "Clarinette basse": "bcl", "Petite clarinette (Mib)": "ecl", "Contrebasson": "cbn" };

function ligneGroupe(group, slots) {
  if (group === null || group === undefined) return null;
  const aux = Array(slots.length).fill(0); const base = Array(slots.length).fill(0); const dbl = Array(slots.length).fill("");
  let sax = 0;
  for (const [k, n] of Object.entries(group)) {
    if (typeof n !== "number" || n <= 0 || k === "total") continue;
    if (/^Saxophone/.test(k)) { sax += n; continue; }
    if (DEDIES[k]) { const i = slots.indexOf(DEDIES[k][0]); if (i >= 0) aux[i] += n; continue; }
    const i = slots.findIndex((s) => k === s || k.startsWith(s + " ("));
    if (i < 0) continue;
    if (/\(auxiliaire\)/.test(k)) aux[i] += n;
    else if (/\(\+/.test(k)) { base[i] += n; const nm = /\(\+([^)]+)\)/.exec(k); const ab = nm && ABBR_DOUBLING[nm[1]]; if (ab) dbl[i] = ab; }
    else base[i] += n;
  }
  const toks = slots.map((_, i) => `${base[i]}${aux[i] ? "+" + aux[i] : ""}${dbl[i] ? "(" + dbl[i] + ")" : ""}`);
  if (sax > 0) toks.push(`${sax}sax`);
  return toks.join(".");
}

function singulier(w) { return stripAccents(w).replace(/\b(\w{3,})s\b/g, (m, b) => (b === "hautboi" ? m : b)); }

/** « Orchestre » de l'app (listes de chaînes « 2 Flûtes ») ramené à la forme du décodeur. */
function orchestreVersDetail(orch) {
  const d = { bois: {}, cuivres: {}, cordes: {}, percussions: {}, autres: {}, extras: null };
  const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
  const read = (s) => { const m = /^\s*(\d+)?\s*(?:x\s*)?(.+?)\s*$/i.exec(String(s)); return m ? { n: m[1] ? parseInt(m[1], 10) : 1, w: singulier(m[2]) } : null; };
  for (const s of orch.bois || []) { const r = read(s); if (!r) continue;
    if (/^flute$/.test(r.w)) add(d.bois, "Flûte", r.n); else if (/^hautbois$/.test(r.w)) add(d.bois, "Hautbois", r.n);
    else if (/^clarinette$/.test(r.w)) add(d.bois, "Clarinette", r.n); else if (/^basson$/.test(r.w)) add(d.bois, "Basson", r.n);
    else if (/^piccolo$/.test(r.w)) add(d.bois, "Piccolo", r.n); else if (/^cor anglais$/.test(r.w)) add(d.bois, "Cor anglais", r.n);
    else if (/^clarinette basse$/.test(r.w)) add(d.bois, "Clarinette basse", r.n); else if (/^contrebasson$/.test(r.w)) add(d.bois, "Contrebasson", r.n);
    else if (/^saxophone/.test(r.w)) add(d.bois, "Saxophone", r.n); }
  for (const s of orch.cuivres || []) { const r = read(s); if (!r) continue;
    if (/^cor$/.test(r.w)) add(d.cuivres, "Cor", r.n); else if (/^trompette$/.test(r.w)) add(d.cuivres, "Trompette", r.n);
    else if (/^trombone$/.test(r.w)) add(d.cuivres, "Trombone", r.n); else if (/^tuba$/.test(r.w)) add(d.cuivres, "Tuba", r.n); }
  for (const s of orch.cordes || []) { const r = read(s); if (!r) continue;
    if (/^violon\s*(?:i|1)$/.test(r.w)) add(d.cordes, "Violon I", r.n); else if (/^violon\s*(?:ii|2)$/.test(r.w)) add(d.cordes, "Violon II", r.n);
    else if (/^alto$/.test(r.w)) add(d.cordes, "Alto", r.n); else if (/^violoncelle$/.test(r.w)) add(d.cordes, "Violoncelle", r.n);
    else if (/^contrebasse$/.test(r.w)) add(d.cordes, "Contrebasse", r.n); }
  const noms = [];
  for (const s of orch.autres || []) { const r = read(s); if (!r) continue;
    if (/^harpe$/.test(r.w)) add(d.percussions, "Harpe", r.n);
    else if (/^(?:celesta|piano|orgue|clavecin|clavier)$/.test(r.w)) { add(d.percussions, "Clavier", r.n); noms.push(r.w); }
    else if (/^guitare basse$/.test(r.w)) add(d.autres, "Guitare basse", r.n); else if (/^accordeon$/.test(r.w)) add(d.autres, "Accordéon", r.n); else if (/^soprano$/.test(r.w)) add(d.autres, "Soprano", r.n); }
  if (noms.length) d.extras = noms.join(", ");
  return d;
}

const estDetail = (x) => x && typeof x === "object" && !Array.isArray(x.bois) && !Array.isArray(x.cordes) && ("bois" in x || "cordes" in x || "percussions" in x);

/**
 * Ligne d'effectif en ORDRE DANIELS, cordes à la fin, nombres séparés par des points :
 * bois / cuivres / timbales + percussions / claviers et harpes / autres musiciens / cordes.
 * Exemple : « 2.2.2.0 / 0.4.0.0 / T+2 / 2hp+cel / 16.14.12.10.8 ».
 * source : chaîne de notation (Daniels, LSO, cordes d'abord…), détail décodé (decodeEffectif), orchestre de
 * l'app (listes « 2 Flûtes »), ou pièce ({ effectifDetail, effectif }). options.effectifPercus complète le cas
 * orchestre (qui ne porte pas les percussionnistes). Un groupe non lu est écrit « -.-.-.- » (jamais des zéros
 * inventés) ; renvoie "" si rien n'est lisible.
 */
export function formatEffectifDaniels(source, options = {}) {
  let d = source;
  if (typeof source === "string") d = decodeEffectif(source);
  else if (source && !estDetail(source) && !Array.isArray(source.bois) && (source.effectifDetail || source.effectif)) d = source.effectifDetail || decodeEffectif(source.effectif);
  else if (source && Array.isArray(source.bois)) d = orchestreVersDetail(source);
  if (!d || typeof d !== "object") return "";
  const sections = [];
  sections.push(ligneGroupe(d.bois, SLOTS_BOIS) || "-.-.-.-");
  sections.push(ligneGroupe(d.cuivres, SLOTS_CUIVRES) || "-.-.-.-");

  const ep = options.effectifPercus || d.effectifPercus || null;
  const perc = d.percussions || {};
  if (ep) {
    const t = ep.timbaliers || 0; const p = ep.percussionnistes || 0;
    if (t > 0 && p > 0) sections.push(t === 1 ? `T+${p}` : `${t}T+${p}`);
    else if (t > 0) sections.push(t === 1 ? "T" : `${t}T`);
    else if (p > 0) sections.push(`${p}perc`);
  }
  const claviers = [];
  if (perc.Harpe > 0) claviers.push(`${perc.Harpe}hp`);
  if (perc.Clavier > 0) {
    const noms = typeof d.extras === "string" ? d.extras.split(/[,/]/).map((x) => x.trim().toLowerCase()).filter(Boolean) : [];
    const pianos = typeof d.extras === "string" ? /^(\d+)\s*pianos?$/i.exec(d.extras.trim()) : null;
    if (pianos && parseInt(pianos[1], 10) === perc.Clavier) claviers.push(`${perc.Clavier}pno`);
    else if (noms.length === perc.Clavier && noms.every((x) => /^(?:cel|celesta|orgue|piano|pno|clavecin|cembalo)$/.test(stripAccents(x)))) claviers.push(...noms.map((x) => (/^celesta$/.test(stripAccents(x)) ? "cel" : stripAccents(x))));
    else claviers.push(`${perc.Clavier}clav`);
  }
  if (claviers.length) sections.push(claviers.join("+"));
  const autres = [];
  for (const [k, n] of Object.entries(d.autres || {})) {
    if (!(n > 0)) continue;
    autres.push(k === "Guitare basse" ? `${n}guitbasse` : k === "Guitare" ? `${n}guit` : k === "Accordéon" ? `${n}acc` : k === "Soprano" ? `${n}sop` : k === "Ondes Martenot" ? `${n}ondes` : null);
  }
  const autresOk = autres.filter(Boolean);
  if (autresOk.length) sections.push(autresOk.join("+"));
  if (d.cordes && typeof d.cordes === "object" && SLOTS_CORDES.some((k) => d.cordes[k] > 0)) {
    sections.push(SLOTS_CORDES.map((k) => d.cordes[k] || 0).join("."));
  }
  if (sections.every((x) => x === "-.-.-.-")) return "";
  return sections.join(" / ");
}

const GROUPES_COMPARES = ["bois", "cuivres", "percussions", "cordes", "autres"];
export function memeDetail(a, b) {
  if (!a || !b) return false;
  for (const g of GROUPES_COMPARES) {
    const x = Object.entries(a[g] || {}).filter(([k, v]) => k !== "total" && v > 0).sort(); const y = Object.entries(b[g] || {}).filter(([k, v]) => k !== "total" && v > 0).sort();
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

// ── Noms baroques ──

// Chaque entrée : motif (accents et pluriel ignorés), nom canonique, pluriel, famille. moderne = sert seulement
// de compagnon dans une liste qui contient au moins un nom baroque.
const BAROQUE = [
  { re: /^(?:traverso|flute traversiere baroque|flute traversiere ancienne)$/, nom: "Traverso", pl: "Traversos", fam: "bois" },
  { re: /^hautbois baroque$/, nom: "Hautbois baroque", pl: "Hautbois baroques", fam: "bois" },
  { re: /^basson baroque$/, nom: "Basson baroque", pl: "Bassons baroques", fam: "bois" },
  { re: /^flute a bec$/, nom: "Flûte à bec", pl: "Flûtes à bec", fam: "bois" },
  { re: /^cornet a bouquin$/, nom: "Cornet à bouquin", pl: "Cornets à bouquin", fam: "cuivres" },
  { re: /^(?:sacqueboute|saqueboute)$/, nom: "Sacqueboute", pl: "Sacqueboutes", fam: "cuivres" },
  { re: /^cor naturel$/, nom: "Cor naturel", pl: "Cors naturels", fam: "cuivres" },
  { re: /^trompette naturelle$/, nom: "Trompette naturelle", pl: "Trompettes naturelles", fam: "cuivres" },
  { re: /^viole de gambe$/, nom: "Viole de gambe", pl: "Violes de gambe", fam: "cordes" },
  { re: /^viole$/, nom: "Viole", pl: "Violes", fam: "cordes" },
  { re: /^violone$/, nom: "Violone", pl: "Violones", fam: "cordes" },
  { re: /^dessus(?: de violon)?$/, nom: "Dessus de violon", pl: "Dessus de violon", fam: "cordes" },
  { re: /^taille(?: de violon)?$/, nom: "Taille", pl: "Tailles", fam: "cordes" },
  { re: /^haute-?contre(?: de violon)?$/, nom: "Haute-contre", pl: "Hautes-contre", fam: "cordes" },
  { re: /^quinte(?: de violon)?$/, nom: "Quinte", pl: "Quintes", fam: "cordes" },
  { re: /^theorbe$/, nom: "Théorbe", pl: "Théorbes", fam: "continuo" },
  { re: /^archiluth$/, nom: "Archiluth", pl: "Archiluths", fam: "continuo" },
  { re: /^luth$/, nom: "Luth", pl: "Luths", fam: "continuo" },
  { re: /^clavecin$/, nom: "Clavecin", pl: "Clavecins", fam: "continuo" },
  { re: /^orgue positif$/, nom: "Orgue positif", pl: "Orgues positifs", fam: "continuo" },
  { re: /^violon$/, nom: "Violon", pl: "Violons", fam: "cordes", moderne: true },
  { re: /^alto$/, nom: "Alto", pl: "Altos", fam: "cordes", moderne: true },
  { re: /^violoncelle$/, nom: "Violoncelle", pl: "Violoncelles", fam: "cordes", moderne: true },
  { re: /^contrebasse$/, nom: "Contrebasse", pl: "Contrebasses", fam: "cordes", moderne: true },
];

const normNom = (t) => stripAccents(String(t || "")).replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
// Les pluriels sont ramenés au singulier mot à mot (« violes de gambe », « cors naturels », « hautes-contre »).
const sansPluriel = (t) => normNom(t).replace(/\b(\w{3,}?)s\b/g, "$1").replace(/\bhaute-contre/, "haute-contre");

/**
 * Reconnaît un nom d'instrument baroque (traverso, hautbois baroque, basson baroque, théorbe, archiluth,
 * viole de gambe, violone, clavecin, orgue positif, cornet à bouquin, sacqueboute, cor naturel, trompette
 * naturelle, dessus, taille…). Renvoie { famille, nom, pluriel, moderne } ou null. Famille : bois | cuivres |
 * cordes | continuo (théorbe, luth, clavecin, orgue positif : la basse continue).
 */
export function classerInstrumentBaroque(texte) {
  const n = normNom(texte).replace(/^(?:\d+\s*(?:x\s*)?|un |une |le |la |les |des )/, "");
  const cands = [n, sansPluriel(n), n.replace(/s$/, "")];
  for (const c of cands) for (const e of BAROQUE) if (e.re.test(c)) return { famille: e.fam, nom: e.nom, pluriel: e.pl, moderne: !!e.moderne };
  return null;
}

/**
 * Liste écrite d'instruments (« 5 dessus, 2 tailles, 1 viole, 1 violoncelle, 1 théorbe, 1 violone ») rangée par
 * famille. Renvoie null si aucun nom baroque n'y figure (une liste moderne n'est pas touchée). Rien n'est inventé :
 * un nom sans nombre reste sans nombre.
 */
export function lireOrchestreBaroque(texte) {
  const parts = String(texte || "").replace(/[()]/g, ",").split(/[,;\n]|\s+et\s+|\s+&\s+|\s+\+\s+/).map((x) => x.trim()).filter(Boolean);
  const orch = { bois: [], cuivres: [], cordes: [], autres: [], continuo: [] };
  let baroque = 0;
  const found = [];
  for (const p of parts) {
    const m = /^(\d+)?\s*(?:x\s*)?(.+)$/i.exec(p);
    if (!m) continue;
    const c = classerInstrumentBaroque(m[2]);
    if (!c) continue;
    if (!c.moderne) baroque++;
    found.push({ n: m[1] ? parseInt(m[1], 10) : null, c });
  }
  if (!baroque) return null;
  for (const { n, c } of found) {
    const sec = c.famille === "continuo" ? "continuo" : c.famille;
    const label = n === null ? c.nom : `${n} ${n > 1 ? c.pluriel : c.nom}`;
    if (!orch[sec].includes(label)) orch[sec].push(label);
  }
  return orch;
}

/** Ajoute à result.orchestre les instruments baroques lus dans le texte, sans doublon ni écrasement. */
function fusionnerBaroque(result, text) {
  const bar = lireOrchestreBaroque(text);
  if (!bar) return;
  result.orchestre = result.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] };
  const cle = (s) => sansPluriel(String(s).replace(/^\d+\s*/, ""));
  for (const sec of ["bois", "cuivres", "cordes", "autres", "continuo"]) {
    if (!bar[sec].length) continue;
    const cur = Array.isArray(result.orchestre[sec]) ? result.orchestre[sec] : [];
    const existantes = new Set(cur.map(cle));
    result.orchestre[sec] = [...cur, ...bar[sec].filter((x) => !existantes.has(cle(x)))];
  }
}

// ── Plan de détail percussion (un ou plusieurs postes dessinés à part) ──

const PERCU_ECRITE = /(?:^|\s)(?:\d+\s*)?(?:timbales?|cymbales?|caisse|grosse caisse|tablette|triangle|tambour|tam-?tam|gong|vibraphone|xylophone|marimba|glockenspiel|crotales?|temple-?blocks?|claves|tom|toms|bongos?|congas?|cloches?|tambourin)\b/i;

const catDetail = (nom) => (/^(?:tablette|si[eè]ge|r[aâ]teau|pied|stand|support)/i.test(nom) ? "Stands & supports" : categorizeInstrument(nom));
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Lit un plan de poste(s) de percussion seul : une ligne = un poste. « 4 timbales + siège + râteau » donne
 * 4 timbales (un item par timbale), 1 siège de timbalier, 1 râteau ; « Caisse claire (+ siège de caisse) »
 * donne la caisse et son siège. Renvoie { percus, detailPercussion: true } ou null si aucune ligne n'est un poste.
 * Les lignes qui ne sont pas des instruments (« Pupitres », « Chaises ») sont ignorées.
 */
export function lireDetailPercussion(input) {
  const lines = (Array.isArray(input) ? input : String(input || "").split(/\r?\n/)).map((l) => String(l).trim()).filter(Boolean);
  const percus = [];
  let k = 0;
  for (const line of lines) {
    if (/:/.test(line) || /\b(?:aucune?|n[ée]ant|sans)\b/i.test(line)) continue; // « Timbales : aucune » n'est pas un poste
    const segs = line.replace(/[()]/g, " + ").split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
    if (!segs.length || !PERCU_ECRITE.test(" " + segs[0]) || /^(?:pupitres?|chaises?)\b/i.test(segs[0])) continue;
    const timb = /^(\d+)\s*timbales?$/i.exec(segs[0]) || /^timbales?$/i.test(segs[0]);
    const items = [];
    if (timb) {
      const n = timb === true ? 1 : parseInt(timb[1], 10);
      for (let i = 1; i <= n; i++) items.push({ cat: "Timbales & Peaux", nom: `Timbale ${i}` });
    } else {
      const nom = majuscule(segs[0].replace(/\s+/g, " "));
      items.push({ cat: catDetail(nom), nom });
    }
    for (const seg of segs.slice(1)) {
      if (/^si[eè]ge$/i.test(seg)) items.push({ cat: "Stands & supports", nom: timb ? "Siège de timbalier" : "Siège" });
      else if (/^r[aâ]teau$/i.test(seg)) items.push({ cat: "Stands & supports", nom: "Râteau" });
      else { const nom = majuscule(seg.replace(/\s+/g, " ")); items.push({ cat: catDetail(nom), nom }); }
    }
    percus.push({ nom: timb ? "Timbalier" : `Percu ${++k}`, items });
  }
  return percus.length ? { percus, detailPercussion: true } : null;
}

const orchestreVide = (o) => !o || !["bois", "cuivres", "cordes", "autres", "continuo"].some((s) => Array.isArray(o[s]) && o[s].length > 0);

/**
 * Dernière passe commune à toutes les lectures locales (PDF, image, texte) : instruments baroques écrits, plan de
 * détail percussion, effectif des percussions et ligne d'effectif en ordre Daniels.
 * Ajoute à result : effectifPercus ({ timbaliers, percussionnistes } ou null), detailPercussion (booléen),
 * effectifBrut (texte écrit, seulement si la ligne a été remise en ordre).
 */
export function finaliserLecture(result, lines) {
  const texte = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  if (texte) fusionnerBaroque(result, texte);
  appliquerOrdreDaniels(result);
  if (!result.effectif && orchestreVide(result.orchestre) && !(result.percus && result.percus.length) && texte) {
    const det = lireDetailPercussion(texte);
    if (det) result.percus = det.percus;
  }
  result.detailPercussion = !result.effectif && orchestreVide(result.orchestre) && Array.isArray(result.percus) && result.percus.length > 0;
  return result;
}

/**
 * Les motifs de lecture s'arrêtent après deux ou trois groupes (ils ne connaissent pas « T+2 », « 2hp »,
 * « 1timb.1perc.1harpe », « 0T 2P 0H 2Pno »). On repart de la ligne trouvée et on garde la PLUS LONGUE
 * portion de ligne que decodeEffectif sait lire. La ligne écrite n'est jamais raccourcie : sans portion plus
 * longue décodable, result.effectif reste tel quel. Forme LSO « 2220 / 0400 / … » retrouvée si rien n'a été lu.
 */
export function etendreLigneEffectif(lines, result) {
  if (!result) return result;
  const texte = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  if (!texte) return result;
  const cur = typeof result.effectif === "string" ? result.effectif.trim() : "";
  let start = -1;
  if (cur) start = texte.indexOf(cur);
  else { const m = /(?<![\d.])\d{4}\s*\/\s*\d{4}(?![\d.])/.exec(texte); if (m) start = m.index; }
  if (start < 0) return result;
  const tail = texte.slice(start).split("\n")[0].replace(/\s+$/, "");
  let best = null;
  for (let end = tail.length; end > cur.length && end >= 9; end--) {
    if (end < tail.length && !/[\s\/\-\u2013]/.test(tail[end]) && !/[\s\/\-\u2013]/.test(tail[end - 1])) continue;
    const cand = tail.slice(0, end).trim();
    if (cand.length > cur.length && decodeEffectif(cand)) { best = cand; break; }
  }
  if (best) result.effectif = best;
  return result;
}

/** Remplit effectifPercus et remet result.effectif en ordre Daniels (la ligne écrite est gardée dans effectifBrut). */
export function appliquerOrdreDaniels(result) {
  result.effectifPercus = result.effectifDetail && result.effectifDetail.effectifPercus ? result.effectifDetail.effectifPercus : null;
  if (!result.effectifDetail || !result.effectif) return result;
  const ordre = formatEffectifDaniels(result.effectifDetail);
  if (ordre && ordre !== result.effectif && memeDetail(decodeEffectif(ordre), result.effectifDetail)) {
    result.effectifBrut = result.effectif;
    result.effectif = ordre;
  }
  return result;
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

  // Convert file to dataUrl for plan display, réduite pour tenir largement sous la limite d'envoi au compte
  // (voir planImages.js ; la lecture OCR ci-dessous lit le fichier d'origine, pas cette copie).
  const dataUrl = await shrinkPlanForStorage(await fileToDataUrlLocal(file));
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

  finaliserLecture(result, ocrText);
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

  finaliserLecture(result, text);
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
  etendreLigneEffectif(lines, result);
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
      const items = splitWrittenItems(percText);
      if (items.length > 0) {
        const categorizedItems = items.map(nom => {
          const cat = categorizeInstrument(nom);
          return { cat, nom };
        });
        result.percus.push({ nom: "Percussion", items: categorizedItems });
      }
    }

    // Look for "Timbales : ..." and "Percussion : ..." on separate lines.
    // Seul ce qui est ÉCRIT est repris : aucun instrument n'est ajouté (plus de « 4 Timbales » en dur),
    // et « Timbales : aucune » ne crée rien.
    if (result.percus.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const timbMatch = line.match(/timbales?\s*:\s*(.+)/i);
        if (timbMatch) {
          const items = splitWrittenItems(timbMatch[1]);
          if (items.length > 0) {
            result.percus.push({
              nom: "Timbalier",
              items: items.map(nom => ({ cat: categorizeInstrument(nom), nom })),
            });
          }
        }
        const percLineMatch = line.match(/percussions?\s*\d*\s*:\s*(.+)/i);
        if (percLineMatch && !timbMatch) {
          const percNum = line.match(/percussions?\s*(\d+)\s*:/i);
          const items = splitWrittenItems(percLineMatch[1]);
          if (items.length > 0) {
            result.percus.push({
              nom: percNum ? `Percu ${percNum[1]}` : "Percussion",
              items: items.map(nom => ({ cat: categorizeInstrument(nom), nom })),
            });
          }
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
 * Découpe une liste écrite « a, b ; c » en éléments, en écartant les marqueurs d'absence
 * (« aucune », « néant », « sans », « non », « 0 », « - ») : une absence écrite n'est pas un instrument.
 */
function splitWrittenItems(text) {
  return String(text || "").split(/[,;]/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/^(?:aucune?s?|n[ée]ant|sans|non|pas de .*|0|[-–—])$/i.test(s));
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
  // Percussions must never be auto-generated from effectif notation.
  // They come only from explicit parsing (P1:, P2:, DCM, EIC format, AI).
  // This function is intentionally empty.
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

const AI_ERROR_MESSAGES = {
  401: "Session expirée : reconnecte-toi puis relance la lecture IA.",
  413: `Envoi refusé : le plan est trop volumineux pour le serveur (limite de la plateforme : 4,5 Mo par envoi). Réduis le PDF (moins de pages ou résolution plus faible) puis réessaie.`,
};

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const asText = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Extract data from a plan image via serverless endpoint (/api/extract-ai).
 * The API key stays server-side only — never exposed to the browser.
 *
 * Avant l'envoi : contrôle du nombre de pages, des formats et de la taille (sous la limite de 4,5 Mo de la
 * plateforme), sans jamais compresser. Toute page non envoyée est comptée dans result.aiMeta.pages.
 * Toute erreur est une AiExtractionError (kind : too_large, no_page, network, timeout, payload_too_large,
 * truncated, invalid, …) : un échec ne passe jamais pour une lecture vide.
 * options : { pageNumbers, totalPages, failedPages, timeoutMs }
 */
export async function extractWithGemini(imageDataUrls, mode, options = {}) {
  if (!mode) throw new Error("Mode d'extraction IA manquant");
  // Accept a single dataURL (string) or several pages (array).
  const images = Array.isArray(imageDataUrls)
    ? imageDataUrls.filter(Boolean)
    : (imageDataUrls ? [imageDataUrls] : []);
  const plan = planAiPages(images, options);
  if (plan.sent === 0) throw noPageError(plan);

  const timeoutMs = options.timeoutMs > 0 ? options.timeoutMs : AI_CLIENT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp; let parsed;
  try {
    try {
      resp = await fetch("/api/extract-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: plan.images, pageNumbers: plan.pageNumbers, mode }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw new AiExtractionError(`Délai dépassé : la lecture IA n'a pas répondu en ${Math.round(timeoutMs / 1000)} s.`, { kind: "timeout" });
      throw new AiExtractionError("Réseau indisponible ou serveur injoignable : la lecture IA n'a pas pu être faite.", { kind: "network" });
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const body = isRecord(err) ? err : {};
      const kind = resp.status === 413 ? "payload_too_large" : (typeof body.code === "string" ? body.code : "server");
      throw new AiExtractionError(AI_ERROR_MESSAGES[resp.status] || body.error || `Erreur serveur ${resp.status}`, {
        kind, status: resp.status, code: body.code || null,
        warnings: Array.isArray(body.warnings) ? body.warnings.filter((w) => typeof w === "string") : [],
        pages: plan.total > 0 ? { total: plan.total, analysed: 0, skipped: plan.skipped } : null,
      });
    }
    try {
      parsed = await resp.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw new AiExtractionError(`Délai dépassé : la lecture IA n'a pas répondu en ${Math.round(timeoutMs / 1000)} s.`, { kind: "timeout" });
      throw new AiExtractionError("Réponse du serveur illisible.", { kind: "invalid" });
    }
  } finally {
    clearTimeout(timer);
  }
  if (!isRecord(parsed)) throw new AiExtractionError("Réponse du serveur illisible (objet attendu).", { kind: "invalid" });

  // Adaptateur : on ne remplace JAMAIS une donnée absente par une valeur plausible.
  const result = {
    titre: asText(parsed.titre), compositeur: asText(parsed.compositeur),
    duree: asText(parsed.duree), salle: asText(parsed.salle),
    chef: asText(parsed.chef), date: asText(parsed.date),
    sansChef: typeof parsed.sansChef === "boolean" ? parsed.sansChef : null,
    effectif: asText(parsed.effectif), cartoucheBrut: asText(parsed.cartoucheBrut), effectifDetail: null,
    orchestre: isRecord(parsed.orchestre) ? parsed.orchestre : null,
    percus: (Array.isArray(parsed.percus) ? parsed.percus : []).filter(isRecord).map((p) => ({
      nom: asText(p.nom) || UNKNOWN_POLE_NAME,
      items: (Array.isArray(p.items) ? p.items : []).filter(isRecord)
        .map((it) => ({ cat: asText(it.cat) || UNKNOWN_CAT, nom: asText(it.nom) }))
        .filter((it) => it.nom),
    })),
    // Mobilier lu sur le plan : champ séparé, jamais mélangé au mobilier calculé (piece.mobilier).
    mobilierObserve: (Array.isArray(parsed.mobilierObserve) ? parsed.mobilierObserve : [])
      .filter((m) => isRecord(m) && typeof m.type === "string" && m.type.trim()),
  };
  if (result.effectif) {
    result.effectifDetail = decodeEffectif(result.effectif);
    if (result.effectifDetail && !result.orchestre) result.orchestre = orchestreFromEffectif(result.effectifDetail);
  }
  appliquerOrdreDaniels(result);
  // Plan de détail percussion : le moteur le dit, ou il n'y a ni effectif ni orchestre mais des postes de percussion.
  result.detailPercussion = parsed.detailPercussion === true
    || (!result.effectif && orchestreVide(result.orchestre) && result.percus.length > 0);

  // Décompte des pages : celles écartées avant l'envoi + celles que le serveur a écartées.
  const meta = isRecord(parsed.meta) ? parsed.meta : {};
  const serverPages = isRecord(meta.pages) ? meta.pages : {};
  const serverSkipped = (Array.isArray(serverPages.skipped) ? serverPages.skipped : [])
    .filter((s) => isRecord(s) && Number.isInteger(s.page) && typeof s.reason === "string");
  const skipped = [...plan.skipped, ...serverSkipped].sort((a, b) => a.page - b.page);
  const analysed = Number.isInteger(serverPages.analysed) ? serverPages.analysed : plan.sent - serverSkipped.length;
  result.aiMeta = {
    warnings: (Array.isArray(parsed.warnings) ? parsed.warnings : []).filter((w) => typeof w === "string"),
    percusStatut: ["lues", "aucune", "inconnu"].includes(meta.percusStatut) ? meta.percusStatut : "inconnu",
    pages: { total: plan.total, analysed, skipped },
  };
  return result;
}

export async function extractOmrWithAudiveris(imageDataUrl) {
  const endpoint = `${window.location.protocol}//${window.location.hostname}:8766/omr`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Erreur OMR ${resp.status}`);
  }
  const parsed = await resp.json();
  return {
    title: parsed.title || "",
    composer: parsed.composer || "",
    year: parsed.year || "",
    notesText: parsed.notesText || "",
    bpm: parsed.bpm || 60,
    timeSignature: parsed.timeSignature || null,
    confidence: Number(parsed.confidence) || 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}
