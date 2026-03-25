import { BARNIER } from './data.js';

export function uid() {
  return Math.random().toString(36).slice(2, 8);
}

export function generateTxt(piece) {
  if (!piece) return "";
  const col = BARNIER[piece.couleur];
  const lines = [];
  lines.push("=".repeat(45));
  lines.push("  " + piece.titre);
  lines.push("  " + piece.compositeur + " — " + piece.duree);
  lines.push("  " + piece.salle + " — " + piece.date);
  lines.push("  Chef : " + piece.chef);
  lines.push("  Barnier : " + (col ? col.name : piece.couleur));
  lines.push("=".repeat(45));
  lines.push("");

  for (const percu of piece.percus) {
    lines.push("-".repeat(40));
    lines.push("  " + percu.nom.toUpperCase());
    lines.push("-".repeat(40));

    const byCat = {};
    for (const item of percu.items) {
      if (!byCat[item.cat]) byCat[item.cat] = [];
      byCat[item.cat].push(item.nom);
    }
    for (const [cat, items] of Object.entries(byCat)) {
      lines.push("");
      lines.push("  " + cat.toUpperCase());
      for (const it of items) {
        lines.push("    - " + it);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadTxt(piece) {
  const txt = generateTxt(piece);
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, piece.titre.replace(/\s+/g, "_") + "_matos.txt");
  URL.revokeObjectURL(url);
}

export function applyWatermark(canvas, ctx, opts) {
  const { titre, percuNom, zone, num, total, couleur } = opts;

  // Bottom band
  const bandH = canvas.height * 0.08;
  ctx.fillStyle = couleur.hex + "CC";
  ctx.fillRect(0, canvas.height - bandH, canvas.width, bandH);

  // Main text
  ctx.fillStyle = "#fff";
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
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px -apple-system, sans-serif";
  ctx.fillText(couleur.name.toUpperCase(), 18, 28);
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
