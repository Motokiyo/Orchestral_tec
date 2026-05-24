import { BARNIER } from './data.js';

// ── Deep merge helper (plain objects only, no arrays) ──
function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// ── Default mobilier structure ──
export const DEFAULT_MOBILIER = {
  general: {
    pupitres: 0,
    chaisesNormales: 0,
    chaisesHautes: 0,
    chaisesHautesDetail: "",
    chaisesSpeciales: [],
  },
  stands: {
    cordes: [],
    bois: [],
    cuivres: [],
    percus: [],
    autres: [],
    autresCustom: [],
  },
  _edited: false,
};

// ── Ensure mobilier has all fields, merging existing data ──
export function ensureMobilierStructure(mob) {
  return deepMerge(DEFAULT_MOBILIER, mob || {});
}

export function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ── Extract leading number from orchestral item string ──
export function extractNumberFromItem(item) {
  // Parse "14 Violons I" → 14, "3 Flûtes" → 3, "Flûte" → 1
  const m = (typeof item === "string" ? item : "").match(/^(\d+)\s/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Calculate mobilier (furniture) from orchestre + percus ──
export function calculateMobilier(orchestre, percus, options = {}) {
  if (!orchestre) return null;

  const { hasChef = false } = options;

  const boisItems = orchestre.bois || [];
  const cuivresItems = orchestre.cuivres || [];
  const cordesItems = orchestre.cordes || [];

  // ── Parse cordes counts ──
  const cordesCounts = { v1: 0, v2: 0, alto: 0, vlc: 0, cb: 0, other: 0 };
  for (const item of cordesItems) {
    const str = typeof item === "string" ? item : "";
    const num = extractNumberFromItem(str);
    if (/violons?\s*I(?:\b|$)/i.test(str)) cordesCounts.v1 = num;
    else if (/violons?\s*II/i.test(str)) cordesCounts.v2 = num;
    else if (/altos?/i.test(str)) cordesCounts.alto = num;
    else if (/violoncelles?|vlc|vc\b/i.test(str)) cordesCounts.vlc = num;
    else if (/contrebasses?|cb\b/i.test(str)) cordesCounts.cb = num;
    else cordesCounts.other = num; // violes de gambe, théorbes, luths, etc.
  }

  // ── Parse bois items → stands ──
  const boisStands = [];
  for (const item of boisItems) {
    const str = typeof item === "string" ? item : "";
    const num = extractNumberFromItem(str);
    const name = str.replace(/^\d+\s*/, "").trim() || str;
    boisStands.push({ type: `Stands pour ${name.toLowerCase()}`, qty: num });
  }

  // ── Parse cuivres items → stands ──
  const cuivresStands = [];
  for (const item of cuivresItems) {
    const str = typeof item === "string" ? item : "";
    const num = extractNumberFromItem(str);
    const name = str.replace(/^\d+\s*/, "").trim() || str;
    cuivresStands.push({ type: `Stands pour ${name.toLowerCase()}`, qty: num });
  }

  // ── Percussions ──
  const nbPercus = percus ? percus.length : 0;
  const percusStands = [];
  if (percus && percus.length > 0) {
    let chaisesTimbalier = 0;
    let chaisesHautesPercus = 0;
    percus.forEach(pole => {
      if (pole.nom && pole.nom.toLowerCase().includes('timbalier')) {
        chaisesTimbalier++;
      } else {
        chaisesHautesPercus++;
      }
    });
    if (chaisesTimbalier > 0) {
      percusStands.push({ type: "Chaise timbalier", qty: chaisesTimbalier });
    }
    if (chaisesHautesPercus > 0) {
      percusStands.push({ type: "Chaises hautes", qty: chaisesHautesPercus });
    }
  }

  // ── Autres (conditional on chef presence) ──
  const autresStands = [];
  if (hasChef) {
    autresStands.push({ type: "Podium chef", qty: 1 });
    autresStands.push({ type: "Pupitre chef", qty: 1 });
  }

  // ── Cordes stands ──
  const cordesStands = [];
  if (cordesCounts.cb > 0) {
    cordesStands.push({ type: "Stands de contrebasse", qty: cordesCounts.cb });
    cordesStands.push({ type: "Planches à pic CB", qty: cordesCounts.cb });
  }
  if (cordesCounts.vlc > 0) {
    cordesStands.push({ type: "Planches à pic Vlc", qty: cordesCounts.vlc });
  }

  // ── General counts ──
  // For non-standard cordes (violes, luths, etc.), each musician gets 1 pupitre
  const pupiCordes = Math.ceil(cordesCounts.v1 / 2) + Math.ceil(cordesCounts.v2 / 2) +
    Math.ceil(cordesCounts.alto / 2) + Math.ceil(cordesCounts.vlc / 2) + cordesCounts.other;
  const pupiBois = boisItems.length;
  const pupiCuivres = cuivresItems.length;
  const pupitres = pupiCordes + pupiBois + pupiCuivres + (nbPercus > 0 ? nbPercus : 0) + (hasChef ? 1 : 0);

  const totalBois = boisItems.reduce((sum, it) => sum + extractNumberFromItem(it), 0);
  const totalCuivres = cuivresItems.reduce((sum, it) => sum + extractNumberFromItem(it), 0);
  // Non-standard cordes (violes, etc.) use chaises normales (standard chairs, not high chairs)
  const chaisesNormales = cordesCounts.v1 + cordesCounts.v2 + cordesCounts.alto + cordesCounts.vlc +
    cordesCounts.other + totalBois + totalCuivres;

  // Chaises hautes = CB + chef (if present) + percussionists (if any)
  const chaisesHautes = cordesCounts.cb + (hasChef ? 1 : 0) + nbPercus;
  const chefPart = hasChef ? " + 1 (chef)" : "";
  const percusPart = nbPercus > 0 ? ` + ${nbPercus} (percus)` : "";
  let chaisesHautesDetail = `${cordesCounts.cb} (CB)${chefPart}${percusPart} = ${chaisesHautes}`;
  // If total is 0, skip the detail
  if (chaisesHautes === 0) {
    chaisesHautesDetail = "0";
  }

  return {
    general: {
      pupitres,
      chaisesNormales,
      chaisesHautes,
      chaisesHautesDetail,
      chaisesSpeciales: [],
    },
    stands: {
      cordes: cordesStands,
      bois: boisStands,
      cuivres: cuivresStands,
      percus: percusStands,
      autres: autresStands,
    },
  };
}

function groupItemsByCategory(items) {
  const byCat = {};
  for (const item of items) {
    if (!byCat[item.cat]) byCat[item.cat] = [];
    byCat[item.cat].push(item);
  }
  return byCat;
}

function formatItemLines(items) {
  return items.map((it) => {
    let line = "    - " + it.nom;
    if (it.notes) line += "  [" + it.notes + "]";
    return line;
  });
}

// ── Generate percussion global text from all poles ──
export function generatePercusGlobalText(percus) {
  if (!percus || percus.length === 0) return "";
  let text = "";
  percus.forEach((pole, index) => {
    text += `Pôle ${index + 1} : ${pole.nom}\n`;
    if (pole.items && pole.items.length > 0) {
      pole.items.forEach(item => {
        const nom = typeof item === "string" ? item : item.nom || "";
        text += `  • ${nom}\n`;
      });
    } else {
      text += "  (aucun instrument)\n";
    }
    if (index < percus.length - 1) text += "\n";
  });
  return text;
}

// ── Generate mobilier text section ──
function generateMobilierText(mob) {
  if (!mob) return "[Aucun mobilier]\n";
  const lines = [];

  if (mob._edited) {
    lines.push("⚠ MODIFIÉ MANUELLEMENT");
  }
  lines.push("DÉCOMPTE GÉNÉRAL");
  lines.push("─".repeat(16));
  if (mob.general) {
    lines.push("• Pupitres : " + (mob.general.pupitres || 0));
    lines.push("• Chaises normales : " + (mob.general.chaisesNormales || 0));
    lines.push("• Chaises hautes : " + (mob.general.chaisesHautesDetail || mob.general.chaisesHautes || 0));
    const cs = mob.general.chaisesSpeciales;
    if (Array.isArray(cs) && cs.length > 0) {
      const csText = cs
        .filter(item => item.qty > 0)
        .map(item => item.type + " : " + item.qty)
        .join(", ");
      if (csText) lines.push("• Chaises spéciales : " + csText);
    } else if (typeof cs === "number" && cs > 0) {
      // backward compat: old format (number)
      lines.push("• Chaises timbalier : " + cs);
    }
  }
  lines.push("");

  lines.push("STANDS PAR SECTION");
  lines.push("─".repeat(18));

  const standSections = [
    { key: "cordes", emoji: "🎻", label: "CORDES" },
    { key: "bois", emoji: "🎵", label: "BOIS" },
    { key: "cuivres", emoji: "🎺", label: "CUIVRES" },
    { key: "percus", emoji: "🥁", label: "PERCUSSIONS" },
    { key: "autres", emoji: "➕", label: "AUTRES" },
  ];

  if (mob.stands) {
    for (const sec of standSections) {
      const items = mob.stands[sec.key] || [];
      const visible = items.filter(s => s.qty > 0);
      if (visible.length > 0) {
        lines.push("");
        lines.push(sec.emoji + " " + sec.label);
        for (const s of visible) {
          lines.push("• " + s.type + " : " + s.qty);
        }
      }
    }

    const custom = mob.stands.autresCustom || [];
    const visibleCustom = custom.filter(s => s.qty > 0);
    if (visibleCustom.length > 0) {
      lines.push("");
      lines.push("🔧 PERSONNALISÉ");
      for (const s of visibleCustom) {
        lines.push("• " + s.type + " : " + s.qty);
      }
    }
  }

  return lines.join("\n");
}

// ── Generate standalone mobilier text (title + separator + content) ──
export function generateMobilierStandaloneText(piece) {
  if (!piece) return "";
  const mob = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, { hasChef: !piece.sansChef });
  let text = "";
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER — " + (piece.titre || "Sans titre") + "\n";
  if (piece.compositeur) text += "    " + piece.compositeur + "\n";
  text += "═".repeat(35) + "\n\n";
  text += generateMobilierText(mob);
  return text;
}

// ── Download mobilier-only TXT file ──
export function downloadMobilierTxt(piece) {
  if (!piece) return;
  const txt = generateMobilierStandaloneText(piece);
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (piece.titre || "Sans_titre").replace(/\s+/g, "_") + "_mobilier.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Generate orchestre text section ──
function generateOrchestreText(orchestre) {
  if (!orchestre) return "[Aucun orchestre]\n";
  const sections = [
    { key: "bois", label: "BOIS" },
    { key: "cuivres", label: "CUIVRES" },
    { key: "cordes", label: "CORDES" },
    { key: "autres", label: "AUTRES" },
  ];
  const lines = [];
  for (const s of sections) {
    const items = orchestre[s.key] || [];
    if (items.length > 0) {
      lines.push("  " + s.label);
      for (const it of items) lines.push("    - " + it);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ── Generate piece text for UI display (3 sections with separators) ──
export function generatePieceText(piece) {
  if (!piece) return "";
  let text = "";

  // SECTION 1: ORCHESTRE
  text += "═".repeat(35) + "\n";
  text += "🎼 ORCHESTRE\n";
  text += "═".repeat(35) + "\n\n";
  text += generateOrchestreText(piece.orchestre);
  if (piece.effectif) {
    text += "Nomenclature Daniels : " + piece.effectif + "\n";
  }
  // Calculate total musicians
  let totalMus = 0;
  if (piece.orchestre) {
    for (const section of ["bois", "cuivres", "cordes", "autres"]) {
      for (const item of piece.orchestre[section] || []) {
        const m = (typeof item === "string" ? item : "").match(/^(\d+)\s/);
        totalMus += m ? parseInt(m[1], 10) : 1;
      }
    }
  }
  text += "Nombre de musiciens : " + totalMus + "\n";
  text += "\n" + "─".repeat(37) + "\n\n";

  // SECTION 2: MOBILIER
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER\n";
  text += "═".repeat(35) + "\n\n";
  const mob1 = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, { hasChef: !piece.sansChef });
  text += generateMobilierText(mob1) + "\n";
  text += "\n" + "─".repeat(37) + "\n\n";

  // SECTION 3: PERCUSSIONS
  text += "═".repeat(35) + "\n";
  text += "🥁 PERCUSSIONS\n";
  text += "═".repeat(35) + "\n\n";
  text += piece.percusGlobalText || generatePercusGlobalText(piece.percus) || "[Aucune percussion]\n";

  return text;
}

// ── Generate TXT export (3 sections with form feed page breaks) ──
export function generateTxt(piece) {
  if (!piece) return "";
  const col = BARNIER[piece.couleur];
  let text = "";

  // Header
  text += "=".repeat(50) + "\n";
  text += "  " + piece.titre + "\n";
  if (piece.compositeur) text += "  " + piece.compositeur + (piece.duree ? " — " + piece.duree : "") + "\n";
  if (piece.date || piece.salle) text += "  " + [piece.salle, piece.date].filter(Boolean).join(" — ") + "\n";
  if (piece.chef) text += "  Chef : " + piece.chef + "\n";
  text += "  Barnier : " + (col ? col.name : piece.couleur) + "\n";
  text += "=".repeat(50) + "\n\n";

  // SECTION 1: ORCHESTRE
  text += "═".repeat(35) + "\n";
  text += "🎼 ORCHESTRE\n";
  text += "═".repeat(35) + "\n\n";
  text += generateOrchestreText(piece.orchestre);
  if (piece.effectif) {
    text += "Nomenclature Daniels : " + piece.effectif + "\n";
  }
  let totalMus = 0;
  if (piece.orchestre) {
    for (const section of ["bois", "cuivres", "cordes", "autres"]) {
      for (const item of piece.orchestre[section] || []) {
        const m = (typeof item === "string" ? item : "").match(/^(\d+)\s/);
        totalMus += m ? parseInt(m[1], 10) : 1;
      }
    }
  }
  text += "Nombre de musiciens : " + totalMus + "\n";

  // PAGE BREAK
  text += "\n\f\n\n";

  // SECTION 2: MOBILIER
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER\n";
  text += "═".repeat(35) + "\n\n";
  const mob2 = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, { hasChef: !piece.sansChef });
  text += generateMobilierText(mob2) + "\n";

  // PAGE BREAK
  text += "\n\f\n\n";

  // SECTION 3: PERCUSSIONS
  text += "═".repeat(35) + "\n";
  text += "🥁 PERCUSSIONS\n";
  text += "═".repeat(35) + "\n\n";
  text += piece.percusGlobalText || generatePercusGlobalText(piece.percus) || "[Aucune percussion]\n";

  return text;
}

export function downloadTxt(piece) {
  const txt = generateTxt(piece);
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = piece.titre.replace(/\s+/g, "_") + "_matos.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Compute contrast text color (black or white) for a given hex color.
 * Uses relative luminance formula: (0.299*R + 0.587*G + 0.114*B) / 255
 * Returns "#000" for light backgrounds, "#fff" for dark backgrounds.
 */
export function getContrastColor(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000" : "#fff";
}

export function applyWatermark(canvas, ctx, opts) {
  const { titre, percuNom, zone, num, total, couleur } = opts;
  const textColor = getContrastColor(couleur.hex);

  // Bottom band
  const bandH = canvas.height * 0.08;
  ctx.fillStyle = couleur.hex + "CC";
  ctx.fillRect(0, canvas.height - bandH, canvas.width, bandH);

  // Main text
  ctx.fillStyle = textColor;
  ctx.textBaseline = "middle";
  const y = canvas.height - bandH / 2;
  ctx.font = `bold ${Math.round(bandH * 0.4)}px -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`${titre} — ${percuNom} — ${zone}`, 16, y);

  // Number
  ctx.font = `bold ${Math.round(bandH * 0.5)}px -apple-system, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${num}/${total}`, canvas.width - 16, y);

  // Top badge
  ctx.textAlign = "left";
  ctx.fillStyle = couleur.hex + "AA";
  ctx.fillRect(10, 10, 140, 28);
  ctx.fillStyle = textColor;
  ctx.font = "bold 14px -apple-system, sans-serif";
  ctx.fillText(couleur.name.toUpperCase(), 18, 28);
}

export function generatePercuTxt(piece, percuId) {
  if (!piece) return "";
  const percu = piece.percus.find((r) => r.id === percuId);
  if (!percu) return "";
  const lines = [];
  lines.push("=".repeat(50));
  lines.push("  " + piece.titre + " — " + percu.nom);
  if (piece.compositeur) lines.push("  " + piece.compositeur);
  lines.push("=".repeat(50));
  lines.push("");

  const byCat = groupItemsByCategory(percu.items);
  for (const [cat, items] of Object.entries(byCat)) {
    lines.push("  " + cat.toUpperCase());
    lines.push(...formatItemLines(items));
    lines.push("");
  }
  return lines.join("\n");
}

export function copyToClipboard(text) {
  try {
    navigator.clipboard.writeText(text);
  } catch (e) {
    // Fallback for non-HTTPS
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
