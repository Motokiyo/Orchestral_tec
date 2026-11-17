import { BARNIER } from './data.js';
import { calculateMobilier } from './mobilier.js';

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
    banquettes: 0,
  },
  stands: {
    cordes: [],
    bois: [],
    cuivres: [],
    percus: [],
    autres: [],
    autresCustom: [],
    speciaux: [],
  },
  infos: [],
  _edited: false,
};

// ── Ensure mobilier has all fields, merging existing data ──
export function ensureMobilierStructure(mob) {
  return deepMerge(DEFAULT_MOBILIER, mob || {});
}

export function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ── Extract the written quantity of an orchestral item string ──
// "14 Violons I" → 14, "4Flûtes" → 4, "Violons I : 16" → 16, "Un piano" → 1.
// Une quantité qui n'est pas écrite reste INCONNUE (null) : "Flûte" n'est plus compté 1.
// Une notation brute ("4.3.3.1") n'est pas une quantité non plus.
export function extractNumberFromItem(item) {
  if (typeof item !== "string") return null;
  const s = item.trim();
  let m = /^(\d+)(?![\d.,\-\/])/.exec(s);
  if (m) return parseInt(m[1], 10);
  m = /[:：]\s*(\d+)\s*$/.exec(s) || /\s[x×]\s*(\d+)\s*$/i.exec(s);
  if (m) return parseInt(m[1], 10);
  if (/^(?:un|une|one)\s/i.test(s)) return 1;
  return null;
}

// Une annotation entre crochets (« [Cel/Pno] ») précise un instrument déjà compté : ce n'est pas
// une ligne de musiciens, elle n'est ni additionnée ni signalée « sans quantité ».
export function isAnnotationItem(item) {
  return typeof item === "string" && /^\s*\[[^\]]*\]\s*$/.test(item);
}

// ── Total d'une liste de lignes d'effectif : quantités lues + nombre de lignes sans quantité ──
export function sumItemQuantities(items) {
  let total = 0;
  let unknown = 0;
  for (const it of items || []) {
    if (typeof it !== "string" || !it.trim()) continue;
    if (isAnnotationItem(it)) continue;
    const n = extractNumberFromItem(it);
    if (n === null) unknown++; else total += n;
  }
  return { total, unknown };
}

// Total de musiciens de l'orchestre (bois, cuivres, cordes, autres) : { total, unknown }.
export function countOrchestreMusicians(orchestre) {
  let total = 0;
  let unknown = 0;
  if (orchestre) {
    for (const section of ["bois", "cuivres", "cordes", "autres"]) {
      const r = sumItemQuantities(orchestre[section]);
      total += r.total;
      unknown += r.unknown;
    }
  }
  return { total, unknown };
}

// "76", "76 + ? (2 lignes sans quantité)", "? (1 ligne sans quantité)"
export function formatMusicianTotal({ total, unknown }) {
  if (!unknown) return String(total);
  const lignes = `${unknown} ligne${unknown > 1 ? "s" : ""} sans quantité`;
  return total > 0 ? `${total} + ? (${lignes})` : `? (${lignes})`;
}

// ── Chef : trois états (sansChef vaut true, false ou null/absent = inconnu) ──
// Un chef présent (sansChef === false) a son mobilier ; un chef absent (true) n'en a pas ;
// un chef inconnu (null, ou champ absent) n'est PAS compté comme s'il était certain : le mobilier du
// chef (podium, pupitre, chaise haute) est laissé de côté et signalé « à confirmer ».
export function chefOptions(sansChef) {
  if (sansChef === false) return { hasChef: true, chefInconnu: false };
  if (sansChef === true) return { hasChef: false, chefInconnu: false };
  return { hasChef: false, chefInconnu: true };
}

// ── Calcul du mobilier : déplacé dans mobilier.js (lot 4A), ré-exporté ici pour ne rien casser ──
export { calculateMobilier } from './mobilier.js';

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
    text += `Pôle ${index + 1} : ${pole.nom}${pole.nonVerifie ? " (NON VÉRIFIÉ : lecture locale, pas lu par l'IA)" : ""}\n`;
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
    const modele = mob.general.chaisesHautesModele;
    if (modele) {
      const kol = [];
      if (modele.contrebasses === "Kolberg") kol.push("contrebasses");
      if (modele.percussions === "Kolberg") kol.push("percussions");
      if (kol.length > 0) lines.push("• Chaises tournantes Kolberg à la place des chaises hautes R&S pour : " + kol.join(" et "));
    }
    if (Array.isArray(mob.general.banquettesDetail) && mob.general.banquettesDetail.length > 0) {
      const det = mob.general.banquettesDetail
        .filter(b => b.qty > 0 || b.qty === null)
        .map(b => b.type.replace(/^Banquette /, "") + " " + (b.qty === null ? "?" : b.qty))
        .join(", ");
      lines.push("• Banquettes : " + (mob.general.banquettes || 0) + (det ? " (" + det + ")" : ""));
    } else if (mob.general.banquettes > 0) {
      lines.push("• Banquettes : " + mob.general.banquettes);
    }
    if (mob.general.quantitesInconnues > 0) {
      lines.push("• Lignes de l'effectif sans quantité (non comptées) : " + mob.general.quantitesInconnues);
    }
    if (mob.general.chefAConfirmer) {
      lines.push("• Chef : présence non lue, à confirmer (podium, pupitre et chaise haute du chef NON comptés)");
    }
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
    { key: "speciaux", emoji: "⭐", label: "STANDS SPÉCIAUX" },
    { key: "autres", emoji: "➕", label: "AUTRES" },
  ];

  if (mob.stands) {
    for (const sec of standSections) {
      const items = mob.stands[sec.key] || [];
      // qty === null : quantité inconnue, affichée « ? » (jamais masquée ni comptée 1)
      const visible = items.filter(s => s.qty > 0 || s.qty === null);
      if (visible.length > 0) {
        lines.push("");
        lines.push(sec.emoji + " " + sec.label);
        for (const s of visible) {
          lines.push("• " + s.type + " : " + (s.qty === null ? "?" : s.qty));
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

  if (Array.isArray(mob.infos) && mob.infos.length > 0) {
    lines.push("");
    lines.push("À SAVOIR");
    for (const t of mob.infos) lines.push("• " + t);
  }

  return lines.join("\n");
}

// ── Mobilier OBSERVÉ sur le plan (lu par l'IA), présenté à part du mobilier calculé ──
export function generateMobilierObserveText(list) {
  const items = Array.isArray(list) ? list.filter((m) => m && typeof m.type === "string" && m.type.trim()) : [];
  if (items.length === 0) return "";
  const lines = ["MOBILIER OBSERVÉ SUR LE PLAN (lu par l'IA, non calculé)", "─".repeat(32)];
  for (const m of items) {
    lines.push("• " + m.type + " : " + (Number.isInteger(m.qte) ? m.qte : "?") + (m.source ? "  [" + m.source + "]" : "") + (m.details ? "  (" + m.details + ")" : ""));
  }
  return lines.join("\n") + "\n";
}

// ── Generate standalone mobilier text (title + separator + content) ──
export function generateMobilierStandaloneText(piece) {
  if (!piece) return "";
  const mob = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, chefOptions(piece.sansChef));
  let text = "";
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER — " + (piece.titre || "Sans titre") + "\n";
  if (piece.compositeur) text += "    " + piece.compositeur + "\n";
  text += "═".repeat(35) + "\n\n";
  text += generateMobilierText(mob);
  const observe = generateMobilierObserveText(piece.mobilierObserve);
  if (observe) text += "\n" + observe;
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
  // Total des musiciens : seules les quantités écrites sont additionnées, les lignes sans quantité sont dites.
  text += "Nombre de musiciens : " + formatMusicianTotal(countOrchestreMusicians(piece.orchestre)) + "\n";
  text += "\n" + "─".repeat(37) + "\n\n";

  // SECTION 2: MOBILIER
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER\n";
  text += "═".repeat(35) + "\n\n";
  const mob1 = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, chefOptions(piece.sansChef));
  text += generateMobilierText(mob1) + "\n";
  const observe1 = generateMobilierObserveText(piece.mobilierObserve);
  if (observe1) text += "\n" + observe1 + "\n";
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
  text += "Nombre de musiciens : " + formatMusicianTotal(countOrchestreMusicians(piece.orchestre)) + "\n";

  // PAGE BREAK
  text += "\n\f\n\n";

  // SECTION 2: MOBILIER
  text += "═".repeat(35) + "\n";
  text += "📦 MOBILIER\n";
  text += "═".repeat(35) + "\n\n";
  const mob2 = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, chefOptions(piece.sansChef));
  text += generateMobilierText(mob2) + "\n";
  const observe2 = generateMobilierObserveText(piece.mobilierObserve);
  if (observe2) text += "\n" + observe2 + "\n";

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
