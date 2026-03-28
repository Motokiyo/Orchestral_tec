import { BARNIER } from './data.js';

export function uid() {
  return Math.random().toString(36).slice(2, 8);
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

export function generateTxt(piece) {
  if (!piece) return "";
  const col = BARNIER[piece.couleur];
  const lines = [];

  lines.push("=".repeat(50));
  lines.push("  " + piece.titre);
  if (piece.compositeur) lines.push("  " + piece.compositeur + (piece.duree ? " — " + piece.duree : ""));
  if (piece.date || piece.salle) lines.push("  " + [piece.salle, piece.date].filter(Boolean).join(" — "));
  if (piece.chef) lines.push("  Chef : " + piece.chef);
  if (piece.effectif) lines.push("  Effectif : " + piece.effectif);
  lines.push("  Barnier : " + (col ? col.name : piece.couleur));
  lines.push("=".repeat(50));
  lines.push("");

  if (piece.orchestre) {
    const sections = [
      { key: "bois", label: "BOIS" },
      { key: "cuivres", label: "CUIVRES" },
      { key: "cordes", label: "CORDES" },
      { key: "autres", label: "AUTRES" },
    ];
    const hasItems = sections.some((s) => (piece.orchestre[s.key] || []).length > 0);
    if (hasItems) {
      lines.push("-".repeat(40));
      lines.push("  ORCHESTRE");
      lines.push("-".repeat(40));
      for (const s of sections) {
        const items = piece.orchestre[s.key] || [];
        if (items.length > 0) {
          lines.push("");
          lines.push("  " + s.label);
          for (const it of items) lines.push("    - " + it);
        }
      }
      lines.push("");
    }
  }

  for (const percu of piece.percus) {
    lines.push("-".repeat(40));
    lines.push("  " + percu.nom.toUpperCase());
    lines.push("-".repeat(40));
    const byCat = groupItemsByCategory(percu.items);
    for (const [cat, items] of Object.entries(byCat)) {
      lines.push("");
      lines.push("  " + cat.toUpperCase());
      lines.push(...formatItemLines(items));
    }
    lines.push("");
  }

  // ── Mobilier section ──
  const mob = piece.mobilier;
  if (mob) {
    lines.push("═".repeat(35));
    lines.push("📦 MOBILIER");
    lines.push("═".repeat(35));
    lines.push("");

    // Décompte général
    lines.push("DÉCOMPTE GÉNÉRAL");
    lines.push("─".repeat(16));
    if (mob.general) {
      lines.push("• Pupitres : " + (mob.general.pupitres || 0));
      lines.push("• Chaises normales : " + (mob.general.chaisesNormales || 0));
      lines.push("• Chaises hautes : " + (mob.general.chaisesHautes || 0));
      lines.push("• Chaises spéciales : " + (mob.general.chaisesSpeciales || 0));
    }
    lines.push("");

    // Stands par section
    lines.push("STANDS PAR SECTION");
    lines.push("─".repeat(18));

    const standSections = [
      { key: "cordes", emoji: "🎻", label: "CORDES" },
      { key: "bois", emoji: "🎺", label: "BOIS" },
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

      // Custom stands (autresCustom)
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
    lines.push("");
  }

  return lines.join("\n");
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
