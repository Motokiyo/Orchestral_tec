import { useState, useRef, useEffect } from "react";
import { BARNIER, CATEGORIES, DEMO_PIECES, DEMO_CONCERT } from "./data.js";
import { uid, generateTxt, generatePercuTxt, downloadTxt, applyWatermark, copyToClipboard, getContrastColor, generatePieceText, generatePercusGlobalText, extractNumberFromItem, calculateMobilier, DEFAULT_MOBILIER, ensureMobilierStructure, downloadMobilierTxt, generateMobilierStandaloneText } from "./utils.js";
import { extractFromPdf, extractFromFile, decodeEffectif, orchestreFromEffectif, extractWithGemini, extractOmrWithAudiveris } from "./pdfParser.js";
import { useConcerts, usePhotos, useOmrScores } from "./useStorage.js";
import { S } from "./styles.js";
import JSZip from "jszip";

// ── Shared helper: import image file, return raw dataUrl (no watermark baked) ──
function importImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jpg,.jpeg,.png,.webp,.heic";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) { resolve(null); return; }
      const fileDataUrl = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = fileDataUrl;
    };
    input.click();
  });
}

// ── Bake watermark onto image for export/download ──
function bakeWatermark(rawDataUrl, watermarkOpts) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      applyWatermark(canvas, ctx, watermarkOpts);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}

// ── Helper: dataUrl → Blob ──
function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ── Helper: sanitize filename part ──
function sanitize(str) {
  return (str || "Sans_titre").replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, "_");
}

async function postJson(url, body = {}) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || "Erreur réseau");
  return data;
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState("email");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #D6D3D1",
    borderRadius: 10,
    background: "#fff",
    color: "#1C1917",
    padding: "12px 14px",
    fontSize: 16,
    outline: "none",
  };

  async function requestCode(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const data = await postJson("/api/request-code", { email });
      setStep("code");
      setMessage(data.devCode ? `Code local: ${data.devCode}` : "Code envoyé par email.");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const data = await postJson("/api/verify-code", { email, code });
      onLogin(data.email);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.shell}>
      <div style={{ ...S.header, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src="/orkmap-logo.png" alt="OrkMap" style={{ height: 48 }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#78716C" }}>Connexion</div>
      </div>
      <form onSubmit={step === "email" ? requestCode : verifyCode} style={{ ...S.body, paddingTop: 26 }}>
        <div style={{ fontSize: 22, fontWeight: 850, color: "#1C1917", marginBottom: 8 }}>OrkMap</div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "#78716C", marginBottom: 18 }}>
          Entre ton adresse autorisée, puis le code reçu par email.
        </div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#57534E", marginBottom: 6 }}>
          Adresse email
        </label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          inputMode="email"
          autoComplete="email"
          disabled={step === "code" || loading}
          placeholder="user@mail.com"
          style={{ ...inputStyle, marginBottom: 12 }}
        />
        {step === "code" && (
          <>
            <label style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#57534E", marginBottom: 6 }}>
              Code
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              style={{ ...inputStyle, marginBottom: 12, fontSize: 22, letterSpacing: 4, fontWeight: 800 }}
            />
          </>
        )}
        {message && (
          <div style={{ fontSize: 13, color: message.includes("Code local") || message.includes("envoyé") ? "#166534" : "#991B1B", marginBottom: 12 }}>
            {message}
          </div>
        )}
        <button type="submit" disabled={loading || !email || (step === "code" && code.length !== 6)} style={{ ...S.btnPrimary("#1C1917"), opacity: loading ? 0.65 : 1 }}>
          {loading ? "Patiente..." : step === "email" ? "Recevoir le code" : "Se connecter"}
        </button>
        {step === "code" && (
          <button type="button" onClick={() => { setStep("email"); setCode(""); setMessage(""); }} style={{ ...S.btnSecondary, marginTop: 10 }}>
            Changer d'adresse
          </button>
        )}
      </form>
    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("Fichier trop lourd. Essaie une image ou un PDF de moins de 8 Mo."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downscaleImageDataUrl(dataUrl, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function prepareScoreImageForOmr(dataUrl, maxSide = 1800) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const source = document.createElement("canvas");
      source.width = img.naturalWidth;
      source.height = img.naturalHeight;
      const sctx = source.getContext("2d", { willReadFrequently: true });
      sctx.fillStyle = "#fff";
      sctx.fillRect(0, 0, source.width, source.height);
      sctx.drawImage(img, 0, 0);

      const image = sctx.getImageData(0, 0, source.width, source.height);
      const data = image.data;
      let minLum = 255, maxLum = 0;
      let pageMinX = source.width, pageMinY = source.height, pageMaxX = 0, pageMaxY = 0;

      for (let y = 0; y < source.height; y += 4) {
        for (let x = 0; x < source.width; x += 4) {
          const i = (y * source.width + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum > 150) {
            pageMinX = Math.min(pageMinX, x);
            pageMinY = Math.min(pageMinY, y);
            pageMaxX = Math.max(pageMaxX, x);
            pageMaxY = Math.max(pageMaxY, y);
          }
          minLum = Math.min(minLum, lum);
          maxLum = Math.max(maxLum, lum);
        }
      }

      const page = pageMinX < pageMaxX && pageMinY < pageMaxY
        ? { x: pageMinX, y: pageMinY, w: pageMaxX - pageMinX + 1, h: pageMaxY - pageMinY + 1 }
        : { x: 0, y: 0, w: source.width, h: source.height };

      const rowHits = [];
      for (let y = 0; y < page.h; y++) {
        if (y < page.h * 0.25 || y > page.h * 0.9) continue;
        let dark = 0;
        for (let x = 0; x < page.w; x += 2) {
          const sx = page.x + x;
          const sy = page.y + y;
          const i = (sy * source.width + sx) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum < 125) dark++;
        }
        if (dark > (page.w / 2) * 0.18) rowHits.push(y);
      }

      const lineClusters = [];
      for (const y of rowHits) {
        if (!lineClusters.length || y - lineClusters[lineClusters.length - 1][lineClusters[lineClusters.length - 1].length - 1] > 8) {
          lineClusters.push([]);
        }
        lineClusters[lineClusters.length - 1].push(y);
      }

      const systems = [];
      for (const cluster of lineClusters) {
        const y = Math.round((cluster[0] + cluster[cluster.length - 1]) / 2);
        if (systems.length && y - systems[systems.length - 1][systems[systems.length - 1].length - 1] < 80) {
          systems[systems.length - 1].push(y);
        } else {
          systems.push([y]);
        }
      }

      let safeCrop = page;
      if (systems.length) {
        const yValues = systems.flat();
        const marginY = Math.round(page.h * 0.04);
        const y0 = Math.max(0, Math.min(...yValues) - marginY);
        const y1 = Math.min(page.h, Math.max(...yValues) + marginY);
        let staffMinX = page.w, staffMaxX = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < page.w; x += 2) {
            const sx = page.x + x;
            const sy = page.y + y;
            const i = (sy * source.width + sx) * 4;
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum < 125) {
              staffMinX = Math.min(staffMinX, x);
              staffMaxX = Math.max(staffMaxX, x);
            }
          }
        }
        const marginX = Math.round(page.w * 0.04);
        const x0 = Math.max(0, staffMinX - marginX);
        const x1 = Math.min(page.w, staffMaxX + marginX);
        if (staffMinX < staffMaxX) {
          safeCrop = { x: page.x + x0, y: page.y + y0, w: x1 - x0, h: y1 - y0 };
        }
      }

      const minReadableHeight = 720;
      const minReadableWidth = 1800;
      const upscale = Math.max(
        1,
        minReadableHeight / Math.max(1, safeCrop.h),
        minReadableWidth / Math.max(1, safeCrop.w)
      );
      const scale = Math.min(3, upscale, 2600 / Math.max(safeCrop.w, safeCrop.h));

      const canvas = document.createElement("canvas");
      const pad = Math.round(80 * scale);
      canvas.width = Math.max(1, Math.round(safeCrop.w * scale) + pad * 2);
      canvas.height = Math.max(1, Math.round(safeCrop.h * scale) + pad * 2);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        source,
        safeCrop.x,
        safeCrop.y,
        safeCrop.w,
        safeCrop.h,
        pad,
        pad,
        Math.round(safeCrop.w * scale),
        Math.round(safeCrop.h * scale)
      );

      const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = out.data;
      const spread = Math.max(40, maxLum - minLum);
      for (let i = 0; i < pixels.length; i += 4) {
        const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        const normalized = Math.max(0, Math.min(255, ((lum - minLum) / spread) * 255));
        const boosted = normalized < 210 ? Math.max(0, normalized - 28) : 255;
        pixels[i] = boosted;
        pixels[i + 1] = boosted;
        pixels[i + 2] = boosted;
      }
      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function parseOmrNotes(raw) {
  const durationMap = {
    r: 4,
    ronde: 4,
    b: 2,
    blanche: 2,
    n: 1,
    noire: 1,
    c: 0.5,
    croche: 0.5,
  };
  return (raw || "")
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [notePart, durationPart] = token.split(":");
      const note = notePart.replace(/_/g, " ");
      const normalizedDuration = (durationPart || "n").toLowerCase();
      const rest = ["silence", "soupir", "pause", "rest"].includes(note.toLowerCase());
      return {
        note,
        rest,
        duration: durationMap[normalizedDuration] || Number(normalizedDuration) || 1,
      };
    });
}

function formatOmrNotes(notes) {
  return (notes || []).map((item) => `${item.rest ? "silence" : item.note}:${item.duration || 1}`).join(" ");
}

function pronounceOmrToken(item) {
  if (item.rest) {
    if (Math.abs(item.duration - 1) < 0.01) return "soupir";
    if (Math.abs(item.duration - 2) < 0.01) return "demi pause";
    if (Math.abs(item.duration - 4) < 0.01) return "pause";
    if (Math.abs(item.duration - 0.5) < 0.01) return "demi soupir";
    return "silence";
  }
  const [base, accidental = ""] = item.note.toLowerCase().split(/(?=[#b])/);
  const names = {
    do: "do",
    re: "ré",
    "ré": "ré",
    mi: "mi",
    fa: "fa",
    sol: "sol",
    la: "la",
    si: "si",
  };
  const spoken = names[base] || item.note;
  if (accidental === "#") return `${spoken} dièse`;
  if (accidental === "b") return `${spoken} bémol`;
  return spoken;
}

function heldVowelForOmrToken(item, step, steps) {
  const base = item.note.toLowerCase().replace(/[#b].*$/, "");
  const last = step === steps - 1;
  if (base === "sol") return last ? "all" : "oh";
  if (base === "ré" || base === "re") return "hé";
  if (base === "mi") return last ? "i" : "i";
  if (base === "si") return last ? "i" : "i";
  if (base === "do") return last ? "oh" : "oh";
  if (base === "fa" || base === "la") return last ? "a" : "a";
  return "e";
}

function attackSyllableForOmrToken(item, steps) {
  const base = item.note.toLowerCase().replace(/[#b].*$/, "");
  if (base === "sol" && steps > 1) return "so";
  return pronounceOmrToken(item);
}

function buildOmrReadingEvents(notes) {
  const events = [];
  let cursor = 0;
  notes.forEach((item, index) => {
    const duration = Math.max(0.25, Number(item.duration) || 1);
    const steps = duration < 1 ? 1 : Math.max(1, Math.round(duration));
    for (let step = 0; step < steps; step++) {
      const offset = duration < 1 ? 0 : step;
      const first = step === 0;
      let text;
      if (item.rest) {
        text = first ? pronounceOmrToken(item) : "chut";
      } else {
        text = first ? attackSyllableForOmrToken(item, steps) : heldVowelForOmrToken(item, step, steps);
      }
      events.push({ index, text, offsetTotal: cursor + offset, duration: duration < 1 ? duration : 1 });
    }
    cursor += duration;
  });
  return events;
}

function pronounceTimeSignature(timeSignature) {
  if (!timeSignature?.beats || !timeSignature?.beatType) return null;
  const numbers = {
    2: "deux",
    3: "trois",
    4: "quatre",
    6: "six",
    8: "huit",
  };
  return `${numbers[timeSignature.beats] || timeSignature.beats} ${numbers[timeSignature.beatType] || timeSignature.beatType}`;
}

function omrNoteFrequency(item, tuning = 442) {
  if (item.rest) return null;
  const match = /^([a-zé]+)([#b])?/i.exec(item.note.trim());
  if (!match) return null;
  const base = match[1].toLowerCase();
  const accidental = match[2] || "";
  const semitones = {
    do: 0,
    re: 2,
    "ré": 2,
    mi: 4,
    fa: 5,
    sol: 7,
    la: 9,
    si: 11,
  };
  if (semitones[base] === undefined) return null;
  const alter = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = 60 + semitones[base] + alter;
  return tuning * Math.pow(2, (midi - 69) / 12);
}

function omrMetaInputStyle(strong = false) {
  return {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 9px",
    border: "1px solid #D6D3D1",
    borderRadius: 8,
    fontSize: strong ? 15 : 13,
    fontWeight: strong ? 700 : 500,
    color: "#1C1917",
    outline: "none",
    background: "#fff",
  };
}

// ── Download photos as ZIP (piece level) ──
async function downloadPiecePhotosZip(piece, photosList, onProgress) {
  if (!photosList || photosList.length === 0) return;
  const zip = new JSZip();
  const col = BARNIER[piece.couleur] || BARNIER.blanc;

  for (let i = 0; i < photosList.length; i++) {
    const ph = photosList[i];
    const percu = piece.percus?.find((r) => r.id === ph.percuId);
    const wmOpts = {
      titre: piece.titre || "",
      percuNom: percu?.nom || "",
      zone: ph.zone || "",
      num: ph.num || i + 1,
      total: ph.total || photosList.length,
      couleur: col,
    };
    const baked = await bakeWatermark(ph.dataUrl, wmOpts);
    const blob = dataUrlToBlob(baked);
    const fname = `${sanitize(piece.titre)}_${sanitize(percu?.nom || "Percu")}_${sanitize(ph.zone || "Photo")}_${i + 1}.jpg`;
    zip.file(fname, blob);
    if (onProgress) onProgress(i + 1, photosList.length);
  }

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = `${sanitize(piece.titre)}_photos.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── Download photos as ZIP (concert level, multi-piece) ──
async function downloadConcertPhotosZip(concert, pieces, photos, selectedPieceIds, onProgress) {
  const zip = new JSZip();
  let total = 0;
  let done = 0;

  // Count total photos
  for (const pid of selectedPieceIds) {
    total += (photos[pid] || []).length;
  }
  if (total === 0) return;

  for (const pid of selectedPieceIds) {
    const piece = pieces.find((p) => p.id === pid);
    if (!piece) continue;
    const piecePhotos = photos[pid] || [];
    if (piecePhotos.length === 0) continue;

    const folder = zip.folder(sanitize(piece.titre));
    const col = BARNIER[piece.couleur] || BARNIER.blanc;

    for (let i = 0; i < piecePhotos.length; i++) {
      const ph = piecePhotos[i];
      const percu = piece.percus?.find((r) => r.id === ph.percuId);
      const wmOpts = {
        titre: piece.titre || "",
        percuNom: percu?.nom || "",
        zone: ph.zone || "",
        num: ph.num || i + 1,
        total: ph.total || piecePhotos.length,
        couleur: col,
      };
      const baked = await bakeWatermark(ph.dataUrl, wmOpts);
      const blob = dataUrlToBlob(baked);
      const fname = `${sanitize(piece.titre)}_${sanitize(percu?.nom || "Percu")}_${sanitize(ph.zone || "Photo")}_${i + 1}.jpg`;
      folder.file(fname, blob);
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = `${sanitize(concert.titre)}_photos.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ── Photo Download Modal (piece level) ──
function PhotoDownloadPieceModal({ piece, piecePhotos, onClose }) {
  const [mode, setMode] = useState(null); // null | "all" | "select"
  const [selected, setSelected] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDownload(photos) {
    setDownloading(true);
    setProgress({ done: 0, total: photos.length });
    await downloadPiecePhotosZip(piece, photos, (done, total) => setProgress({ done, total }));
    setDownloading(false);
    onClose();
  }

  const col = BARNIER[piece.couleur] || BARNIER.blanc;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "85vh", overflow: "auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1C1917" }}>📥 Télécharger photos</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#A8A29E", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "#78716C", marginBottom: 16 }}>{piece.titre} · {piecePhotos.length} photo{piecePhotos.length !== 1 ? "s" : ""}</div>

        {downloading ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1917", marginBottom: 8 }}>Préparation du ZIP...</div>
            <div style={{ width: "100%", height: 6, background: "#E7E5E4", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: "100%", background: col.hex, borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 12, color: "#A8A29E", marginTop: 6 }}>{progress.done}/{progress.total} photos traitées</div>
          </div>
        ) : !mode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => handleDownload(piecePhotos)} style={{ ...S.btnPrimary(col.hex), fontSize: 14, padding: "12px 16px" }}>
              📦 Toutes les photos ({piecePhotos.length})
            </button>
            <button onClick={() => setMode("select")} style={{ ...S.btnSecondary, fontSize: 14, padding: "12px 16px" }}>
              ☑️ Sélectionner des photos
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              {piecePhotos.map((ph) => {
                const isSelected = selected.has(ph.id);
                return (
                  <div key={ph.id} onClick={() => toggleSelect(ph.id)} style={{ position: "relative", borderRadius: 8, overflow: "hidden", cursor: "pointer", border: isSelected ? `3px solid ${col.hex}` : "2px solid #E7E5E4", aspectRatio: "1", opacity: isSelected ? 1 : 0.6 }}>
                    <img src={ph.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {isSelected && (
                      <div style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: col.hex, display: "flex", alignItems: "center", justifyContent: "center", color: getContrastColor(col.hex), fontSize: 13, fontWeight: 700 }}>✓</div>
                    )}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,.6))", padding: "8px 6px 4px" }}>
                      <div style={{ fontSize: 9, color: "#E7E5E4" }}>{ph.zone}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => handleDownload(piecePhotos.filter((ph) => selected.has(ph.id)))}
              disabled={selected.size === 0}
              style={{ ...S.btnPrimary(col.hex), fontSize: 14, padding: "12px 16px", width: "100%", opacity: selected.size === 0 ? 0.4 : 1 }}
            >
              📥 Télécharger {selected.size} photo{selected.size !== 1 ? "s" : ""}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Photo Download Modal (concert level) ──
function PhotoDownloadConcertModal({ concert, pieces, photos, onClose }) {
  const [mode, setMode] = useState(null); // null | "all" | "select"
  const [selected, setSelected] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Only pieces that have photos
  const piecesWithPhotos = pieces.filter((p) => (photos[p.id] || []).length > 0);
  const totalPhotos = piecesWithPhotos.reduce((s, p) => s + (photos[p.id] || []).length, 0);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDownload(pieceIds) {
    setDownloading(true);
    setProgress({ done: 0, total: pieceIds.reduce((s, pid) => s + (photos[pid] || []).length, 0) });
    await downloadConcertPhotosZip(concert, pieces, photos, pieceIds, (done, total) => setProgress({ done, total }));
    setDownloading(false);
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "85vh", overflow: "auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1C1917" }}>📥 Télécharger photos du concert</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#A8A29E", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "#78716C", marginBottom: 16 }}>{concert.titre} · {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""} · {piecesWithPhotos.length} pièce{piecesWithPhotos.length !== 1 ? "s" : ""}</div>

        {piecesWithPhotos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#A8A29E", fontSize: 14 }}>Aucune photo dans ce concert</div>
        ) : downloading ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1917", marginBottom: 8 }}>Préparation du ZIP...</div>
            <div style={{ width: "100%", height: 6, background: "#E7E5E4", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: "100%", background: "#1C1917", borderRadius: 3, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 12, color: "#A8A29E", marginTop: 6 }}>{progress.done}/{progress.total} photos traitées</div>
          </div>
        ) : !mode ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={() => handleDownload(piecesWithPhotos.map((p) => p.id))} style={{ ...S.btnPrimary("#1C1917"), fontSize: 14, padding: "12px 16px" }}>
              📦 Toutes les pièces ({totalPhotos} photos)
            </button>
            <button onClick={() => setMode("select")} style={{ ...S.btnSecondary, fontSize: 14, padding: "12px 16px" }}>
              ☑️ Sélectionner des pièces
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {piecesWithPhotos.map((p) => {
                const isSelected = selected.has(p.id);
                const col = BARNIER[p.couleur] || BARNIER.blanc;
                const count = (photos[p.id] || []).length;
                return (
                  <div key={p.id} onClick={() => toggleSelect(p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: isSelected ? `2px solid ${col.hex}` : "2px solid #E7E5E4", background: isSelected ? col.bg : "#FAFAF9" }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${col.hex}`, display: "flex", alignItems: "center", justifyContent: "center", background: isSelected ? col.hex : "transparent", color: isSelected ? getContrastColor(col.hex) : "transparent", fontSize: 14, fontWeight: 700 }}>
                      {isSelected ? "✓" : ""}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1917" }}>{p.titre}</div>
                      <div style={{ fontSize: 11, color: "#78716C" }}>{count} photo{count !== 1 ? "s" : ""}</div>
                    </div>
                    <div style={{ ...S.badge, background: col.bg, color: col.hex, fontSize: 10 }}>{col.name}</div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => handleDownload([...selected])}
              disabled={selected.size === 0}
              style={{ ...S.btnPrimary("#1C1917"), fontSize: 14, padding: "12px 16px", width: "100%", opacity: selected.size === 0 ? 0.4 : 1 }}
            >
              📥 Télécharger {selected.size} pièce{selected.size !== 1 ? "s" : ""}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── CSS Watermark overlay component (dynamic, not baked) ──
function WatermarkOverlay({ photo, pieces, couleurOverride }) {
  const piece = pieces?.find((p) => p.id === photo.pieceId);
  const couleurKey = couleurOverride || piece?.couleur || photo.couleur || "blanc";
  const col = BARNIER[couleurKey] || BARNIER.blanc;
  const textColor = getContrastColor(col.hex);
  const percu = piece?.percus?.find((r) => r.id === photo.percuId);

  return (
    <>
      {/* Top badge */}
      <div style={{
        position: "absolute", top: 10, left: 10, zIndex: 5,
        background: col.hex + "AA", padding: "4px 12px", borderRadius: 4,
      }}>
        <span style={{ color: textColor, fontWeight: 700, fontSize: 12, fontFamily: "-apple-system, sans-serif" }}>
          {col.name.toUpperCase()}
        </span>
      </div>
      {/* Bottom band */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5,
        background: col.hex + "CC", padding: "6px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        minHeight: "8%",
      }}>
        <span style={{ color: textColor, fontWeight: 700, fontSize: 13, fontFamily: "-apple-system, sans-serif" }}>
          {piece?.titre || "—"} — {percu?.nom || "—"} — {photo.zone || ""}
        </span>
        <span style={{ color: textColor, fontWeight: 700, fontSize: 15, fontFamily: "-apple-system, sans-serif" }}>
          {photo.num}/{photo.total}
        </span>
      </div>
    </>
  );
}

// ── Daniels Notation Calculator ──
// Standard orchestral nomenclature: Bois / Cuivres / Percus / Cordes
// Bois: Fl.Hb.Cl.Bn | Cuivres: Cor.Tp.Tb.Tuba | Percus: Timb.Perc.Hp.Clav | Cordes: V1.V2.Alt.Vlc.CB

const DANIELS_BOIS = [
  { key: "fl", regex: /fl[uû]/i, label: "Fl" },
  { key: "hb", regex: /hautb|hb|oboe/i, label: "Hb" },
  { key: "cl", regex: /clarin/i, label: "Cl" },
  { key: "bn", regex: /bassons?|bn|fagot/i, label: "Bn" },
];

const DANIELS_CUIVRES = [
  { key: "cor", regex: /cors?\b/i, label: "Cor" },
  { key: "tp", regex: /tromp/i, label: "Tp" },
  { key: "tb", regex: /tromb/i, label: "Tb" },
  { key: "tuba", regex: /tuba/i, label: "Tuba" },
];

const DANIELS_PERCUS = [
  { key: "timb", regex: /timbal/i, label: "Timb" },
  { key: "perc", regex: /percus?(?!sion)|batterie/i, label: "Perc" },
  { key: "hp", regex: /harpe/i, label: "Hp" },
  { key: "clav", regex: /piano|c[ée]lesta|clav/i, label: "Clav" },
];

const DANIELS_CORDES = [
  { key: "v1", regex: /violons?\s*I(?:\b|$)/i, label: "V1" },
  { key: "v2", regex: /violons?\s*II/i, label: "V2" },
  { key: "alt", regex: /altos?/i, label: "Alt" },
  { key: "vlc", regex: /violoncelles?|vlc|vc\b/i, label: "Vlc" },
  { key: "cb", regex: /contrebasses?|cb\b/i, label: "CB" },
];

// extractNumberFromItem is now imported from utils.js

function matchSection(items, patterns) {
  const counts = patterns.map(() => 0);
  const matched = new Set();
  for (const item of items) {
    const str = typeof item === "string" ? item : item.nom || "";
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].regex.test(str) && !matched.has(str)) {
        counts[i] += extractNumberFromItem(str);
        matched.add(str);
        break;
      }
    }
  }
  return counts;
}

function calculateDanielsNotation(orchestre, percus) {
  if (!orchestre) return "";
  
  const boisItems = orchestre.bois || [];
  const cuivresItems = orchestre.cuivres || [];
  const cordesItems = orchestre.cordes || [];
  const autresItems = orchestre.autres || [];
  
  // Collect percussion items from both orchestre.autres and percus poles
  // For Daniels, we look for timbalier, percussionists, harpist, keyboard in the orchestre context
  // Percus poles contain detailed instrument lists, not personnel counts
  const allPercuContext = [...autresItems];
  
  const boisCounts = matchSection(boisItems, DANIELS_BOIS);
  const cuivresCounts = matchSection(cuivresItems, DANIELS_CUIVRES);
  const percusCounts = matchSection(allPercuContext, DANIELS_PERCUS);
  const cordesCounts = matchSection(cordesItems, DANIELS_CORDES);
  
  // If percus poles exist, use them as authoritative source for timbalier/percussionist counts
  // (orchestre.autres may have harpe/clavier info but percus poles are the real personnel)
  if (percus && percus.length > 0) {
    const timbPoles = percus.filter(p => /timbal/i.test(p.nom));
    const percPoles = percus.filter(p => !/timbal/i.test(p.nom) && !/harp/i.test(p.nom) && !/piano|c[ée]lesta|clav/i.test(p.nom));
    percusCounts[0] = timbPoles.length; // Timb
    if (percPoles.length > 0) percusCounts[1] = percPoles.length; // Perc
  }
  
  const hasBois = boisCounts.some(c => c > 0);
  const hasCuivres = cuivresCounts.some(c => c > 0);
  const hasPercus = percusCounts.some(c => c > 0);
  const hasCordes = cordesCounts.some(c => c > 0);
  
  if (!hasBois && !hasCuivres && !hasPercus && !hasCordes) return "";
  
  const parts = [];
  parts.push(boisCounts.join("."));
  parts.push(cuivresCounts.join("."));
  parts.push(percusCounts.join("."));
  parts.push(cordesCounts.join("."));
  
  return parts.join(" / ");
}

function calculateTotalMusicians(orchestre) {
  if (!orchestre) return 0;
  let total = 0;
  for (const section of ["bois", "cuivres", "cordes", "autres"]) {
    for (const item of orchestre[section] || []) {
      total += extractNumberFromItem(item);
    }
  }
  return total;
}

// calculateMobilier is now imported from utils.js

export default function App() {
  const [authStatus, setAuthStatus] = useState("checking");
  const [authEmail, setAuthEmail] = useState("");
  const [concerts, setConcerts, dbLoaded] = useConcerts([{ ...DEMO_CONCERT, pieces: DEMO_PIECES }], authEmail);
  const [screen, setScreen] = useState("start");
  const [concertId, setConcertId] = useState(null);
  const [pieceId, setPieceId] = useState(null);
  const [percuId, setPercuId] = useState(null);
  const [photos, setPhotos, photosLoaded] = usePhotos(authEmail);
  const [omrScores, setOmrScores, omrLoaded] = useOmrScores(authEmail);
  const [omrScoreId, setOmrScoreId] = useState(null);
  const [omrReading, setOmrReading] = useState({ scoreId: null, index: -1 });
  const omrTimerRef = useRef(null);
  const omrSpeechClearTimersRef = useRef([]);
  const omrAudioContextRef = useRef(null);
  const omrAudioNodesRef = useRef([]);
  const omrVisualTimersRef = useRef([]);
  const omrPlaybackRef = useRef(0);
  const [omrAnalyzing, setOmrAnalyzing] = useState(false);
  const [capture, setCapture] = useState(null);
  const [fullPhoto, setFullPhoto] = useState(null);
  const [showPhotoDownload, setShowPhotoDownload] = useState(null); // "piece" | "concert" | null
  const [galleryFilter, setGalleryFilter] = useState("all");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [cameraMode, setCameraMode] = useState(null);
  const [zoneSelectMode, setZoneSelectMode] = useState(null);
  const [showArchives, setShowArchives] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveModal, setArchiveModal] = useState(null);
  const [mergeData, setMergeData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [mobilierEditing, setMobilierEditing] = useState(null); // pieceId currently editing mob
  const [mobilierBackup, setMobilierBackup] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/session", { credentials: "include" })
      .then((resp) => resp.json())
      .then((data) => {
        if (!alive) return;
        if (data.user?.email) {
          setAuthEmail(data.user.email);
        } else {
          setAuthStatus("anonymous");
        }
      })
      .catch(() => {
        if (alive) setAuthStatus("anonymous");
      });
    return () => { alive = false; };
  }, []);

  async function logout() {
    await postJson("/api/logout").catch(() => {});
    setAuthEmail("");
    setAuthStatus("anonymous");
    goStart();
  }

  const concert = concerts.find((c) => c.id === concertId);
  const pieces = concert ? concert.pieces : [];
  const piece = pieces.find((p) => p.id === pieceId);
  const percu = piece ? piece.percus.find((r) => r.id === percuId) : null;
  const omrScore = omrScores.find((score) => score.id === omrScoreId) || null;

  useEffect(() => {
    if (authEmail && dbLoaded && photosLoaded && omrLoaded) {
      setAuthStatus("authenticated");
    }
  }, [authEmail, dbLoaded, photosLoaded, omrLoaded]);

  // ── Navigation ──
  function goStart() { setScreen("start"); setConcertId(null); setPieceId(null); setPercuId(null); setOmrScoreId(null); }
  function goConcerts() { setScreen("concerts"); setConcertId(null); setPieceId(null); setPercuId(null); }
  function goConcert(id) { setConcertId(id); setPieceId(null); setPercuId(null); setScreen("home"); }
  function goHome() { setScreen("home"); setPieceId(null); setPercuId(null); }
  function goPiece(id) { setPieceId(id); setPercuId(null); setScreen("piece"); }
  function goTxt(id) { if (id) setPieceId(id); setScreen("txt"); }
  function goGallery(id) { if (id !== undefined) setPieceId(id); setScreen("gallery"); }
  function goOmr(id = null) { setOmrScoreId(id); setScreen("omr"); }

  // ── Concert mutations ──
  function updateConcert(id, fn) {
    setConcerts((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }
  function setPieces(fn) {
    if (!concertId) return;
    updateConcert(concertId, (c) => ({ ...c, pieces: typeof fn === "function" ? fn(c.pieces) : fn }));
  }

  // ── Piece mutations ──
  function updatePiece(id, fn) {
    setPieces((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
  }
  function deletePiece(id) {
    if (!confirm("Supprimer cette pièce ?")) return;
    setPieces((prev) => prev.filter((p) => p.id !== id));
    if (pieceId === id) goHome();
  }
  function addItem(pId, rId, cat, nom) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) =>
          r.id === rId ? { ...r, items: [...r.items, { cat, nom, notes: "" }] } : r
        ),
      };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  function deleteItem(pId, rId, idx) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) =>
          r.id === rId ? { ...r, items: r.items.filter((_, i) => i !== idx) } : r
        ),
      };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  function updateItemNotes(pId, rId, idx, notes) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) =>
          r.id === rId ? { ...r, items: r.items.map((it, i) => i === idx ? { ...it, notes } : it) } : r
        ),
      };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  function toggleItemCheck(pId, rId, idx) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) =>
          r.id === rId ? { ...r, items: r.items.map((it, i) => i === idx ? { ...it, checked: !it.checked } : it) } : r
        ),
      };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  // ── Reorder pieces ──
  function movePiece(fromIdx, toIdx) {
    setPieces((prev) => {
      const arr = [...prev];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
  }
  // ── Percu reorder / rename / add / delete ──
  function movePercu(pId, fromIdx, toIdx) {
    updatePiece(pId, (p) => {
      const arr = [...p.percus];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const updated = { ...p, percus: arr };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  function renamePercu(pId, rId, newName) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) => r.id === rId ? { ...r, nom: newName } : r),
      };
      return recalcDaniels(updated);
    });
  }
  function addPercu(pId) {
    const nom = prompt("Nom du pôle (ex: Percu 3, Timbalier) :");
    if (!nom || !nom.trim()) return;
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: [...p.percus, { id: `p${Date.now()}`, nom: nom.trim(), items: [] }],
      };
      return recalcDaniels(updated);
    });
  }
  function deletePercu(pId, rId) {
    if (!confirm("Supprimer ce pôle ?")) return;
    updatePiece(pId, (p) => {
      const updated = { ...p, percus: p.percus.filter((r) => r.id !== rId) };
      return recalcDaniels(updated);
    });
  }
  // ── Cordes auto-completion helpers ──
  // Detects instrument type from a string like "14 Violons I" or "Violons I"
  const CORDES_PATTERNS = [
    { key: "v1", regex: /violons?\s*I(?:\b|$)/i, label: "Violons I", offset: 0 },
    { key: "v2", regex: /violons?\s*II/i, label: "Violons II", offset: -2 },
    { key: "alto", regex: /altos?/i, label: "Altos", offset: -4 },
    { key: "vlc", regex: /violoncelles?/i, label: "Violoncelles", offset: -6 },
    { key: "cb", regex: /contrebasses?/i, label: "Contrebasses", offset: -8 },
  ];

  function parseCordeName(nom) {
    // Returns { key, number, label } or null
    for (const pat of CORDES_PATTERNS) {
      if (pat.regex.test(nom)) {
        const numMatch = nom.match(/^(\d+)\s/);
        return { key: pat.key, number: numMatch ? parseInt(numMatch[1], 10) : null, label: pat.label, offset: pat.offset };
      }
    }
    return null;
  }

  function findCordeIndex(cordes, key) {
    return cordes.findIndex(item => {
      const parsed = parseCordeName(item);
      return parsed && parsed.key === key;
    });
  }

  // Apply V1 auto-completion: given V1 value X, fill V2=X-2, Alto=X-4, Vlc=X-6, CB=X-8
  function applyCordesAutoComplete(cordes, v1Value) {
    let newCordes = [...cordes];
    for (const pat of CORDES_PATTERNS) {
      if (pat.key === "v1") continue; // skip V1 itself
      const calculated = Math.max(1, v1Value + pat.offset);
      const existingIdx = findCordeIndex(newCordes, pat.key);
      const newEntry = `${calculated} ${pat.label}`;
      if (existingIdx >= 0) {
        newCordes[existingIdx] = newEntry;
      } else {
        newCordes.push(newEntry);
      }
    }
    return newCordes;
  }

  // ── Helper: recalculate Daniels notation + mobilier + percusGlobalText for a piece ──
  function recalcDaniels(p) {
    const notation = calculateDanielsNotation(p.orchestre, p.percus);
    // ── If mobilier was manually edited, preserve it ──
    if (p.mobilier && p.mobilier._edited === true) {
      const updated = notation ? { ...p, effectif: notation } : { ...p };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus || []);
      return updated;
    }
    const mobilier = calculateMobilier(p.orchestre, p.percus, { hasChef: !p.sansChef });
    const updated = notation ? { ...p, effectif: notation } : { ...p };
    if (mobilier) {
      // Preserve manually edited chaisesSpeciales and autresStands
      const prev = p.mobilier || {};
      if (prev.general && Array.isArray(prev.general.chaisesSpeciales)) {
        mobilier.general.chaisesSpeciales = prev.general.chaisesSpeciales;
      }
      if (prev.stands && prev.stands.autresCustom) {
        mobilier.stands.autresCustom = prev.stands.autresCustom;
      }
      updated.mobilier = mobilier;
    }
    // Always regenerate percussion global text
    updated.percusGlobalText = generatePercusGlobalText(updated.percus || []);
    return updated;
  }

  // ── Orchestre mutations ──
  function addOrchestreItem(pId, section, nom) {
    updatePiece(pId, (p) => {
      const orch = p.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] };
      let newSection = [...(orch[section] || []), nom];
      // Auto-complete cordes if V1 was just added
      if (section === "cordes") {
        const parsed = parseCordeName(nom);
        if (parsed && parsed.key === "v1" && parsed.number !== null) {
          newSection = applyCordesAutoComplete(newSection, parsed.number);
        }
      }
      const updated = { ...p, orchestre: { ...orch, [section]: newSection } };
      return recalcDaniels(updated);
    });
  }
  function deleteOrchestreItem(pId, section, idx) {
    updatePiece(pId, (p) => {
      const orch = { ...p.orchestre };
      orch[section] = orch[section].filter((_, i) => i !== idx);
      const updated = { ...p, orchestre: orch };
      return recalcDaniels(updated);
    });
  }
  function renameOrchestreItem(pId, section, idx, newName) {
    updatePiece(pId, (p) => {
      const orch = { ...p.orchestre };
      orch[section] = orch[section].map((it, i) => i === idx ? newName : it);
      // Auto-complete cordes if V1 was just renamed
      if (section === "cordes") {
        const parsed = parseCordeName(newName);
        if (parsed && parsed.key === "v1" && parsed.number !== null) {
          orch[section] = applyCordesAutoComplete(orch[section], parsed.number);
        }
      }
      const updated = { ...p, orchestre: orch };
      return recalcDaniels(updated);
    });
  }
  function renameItem(pId, rId, idx, newName) {
    updatePiece(pId, (p) => {
      const updated = {
        ...p,
        percus: p.percus.map((r) =>
          r.id === rId
            ? { ...r, items: r.items.map((it, i) => (i === idx ? { ...it, nom: newName } : it)) }
            : r
        ),
      };
      updated.percusGlobalText = generatePercusGlobalText(updated.percus);
      return updated;
    });
  }
  function addPhoto(pieceKey, photoData) {
    setPhotos((prev) => ({
      ...prev,
      [pieceKey]: [...(prev[pieceKey] || []), photoData],
    }));
  }
  function deletePhoto(pieceKey, photoId) {
    setPhotos((prev) => ({
      ...prev,
      [pieceKey]: (prev[pieceKey] || []).filter((ph) => ph.id !== photoId),
    }));
  }

  function updateOmrScore(id, fn) {
    setOmrScores((prev) => prev.map((score) => (score.id === id ? fn(score) : score)));
  }

  function deleteOmrScore(id) {
    if (!confirm("Supprimer cette partition ?")) return;
    setOmrScores((prev) => prev.filter((score) => score.id !== id));
    if (omrScoreId === id) setOmrScoreId(null);
    stopOmrReading();
  }

  async function handleOmrImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png,.webp";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        alert("Fichier trop lourd. Essaie une partition de moins de 12 Mo.");
        return;
      }
      setPdfLoading(true);
      try {
        const name = (file.name || "").toLowerCase();
        const type = (file.type || "").toLowerCase();
        const isPdf = type.includes("pdf") || name.endsWith(".pdf");
        const pages = isPdf ? (await extractFromPdf(file)).planDataUrls || [] : [await fileToDataUrl(file)];
        if (pages.length === 0) {
          alert("Aucune page lisible dans ce fichier.");
          return;
        }
        await addOmrPagesFromImages(pages, file.name.replace(/\.(pdf|jpe?g|png|webp)$/i, "").replace(/[-_]/g, " "), true);
      } catch (err) {
        alert("Impossible d'importer la partition : " + err.message);
      } finally {
        setPdfLoading(false);
      }
    };
    input.click();
  }

  function handleOmrPhotoCapture() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        await addOmrPagesFromImages([dataUrl], "Partition photographiée", true);
      } catch (err) {
        alert("Impossible de lire la photo : " + err.message);
      }
    };
    input.click();
  }

  async function analyzeOmrImage(imageDataUrl) {
    const prepared = await prepareScoreImageForOmr(imageDataUrl);
    const ai = await extractOmrWithAudiveris(prepared);
    if (!ai.notesText || parseOmrNotes(ai.notesText).length === 0) {
      return {
        ...ai,
        notesText: "",
        warnings: [...(ai.warnings || []), "Je n'ai pas réussi à identifier les notes. Essaie de relancer avec un cadrage serré sur une portée."],
      };
    }
    return ai;
  }

  async function reanalyzeOmrScore(scoreId) {
    const score = omrScores.find((item) => item.id === scoreId);
    const page = score?.pages?.[0];
    if (!score || !page) return;
    setOmrAnalyzing(true);
    try {
      const ai = await analyzeOmrImage(page);
      updateOmrScore(score.id, (current) => ({
        ...current,
        title: ai.title || current.title || "",
        composer: ai.composer || current.composer || "",
        year: ai.year || current.year || "",
        notesText: ai.notesText || current.notesText || "",
        bpm: ai.bpm || current.bpm || 60,
        timeSignature: ai.timeSignature || current.timeSignature || null,
        confidence: ai.confidence ?? current.confidence,
        warnings: ai.warnings || [],
      }));
    } catch (err) {
      updateOmrScore(score.id, (current) => ({
        ...current,
        warnings: [`Lecture échouée : ${err.message}`],
      }));
    } finally {
      setOmrAnalyzing(false);
    }
  }

  async function addOmrPagesFromImages(imageDataUrls, sourceTitle = "Nouvelle partition", analyzeFirstPage = true) {
    const pages = await Promise.all(imageDataUrls.map((url) => downscaleImageDataUrl(url)));
    if (pages.length === 0) {
      alert("Aucune page lisible.");
      return;
    }
    setOmrAnalyzing(analyzeFirstPage);
    let ai = null;
    try {
      if (analyzeFirstPage) {
        ai = await analyzeOmrImage(pages[0]);
      }
    } catch (err) {
      alert("Je n'ai pas réussi à lire automatiquement les notes. La photo est gardée, vous pouvez réessayer.");
    } finally {
      setOmrAnalyzing(false);
    }

    if (omrScoreId && omrScore) {
      updateOmrScore(omrScoreId, (score) => ({
        ...score,
        title: ai?.title || score.title || "",
        composer: ai?.composer || score.composer || "",
        year: ai?.year || score.year || "",
        pages: [...(score.pages || []), ...pages],
        notesText: ai?.notesText || score.notesText || "",
        bpm: ai?.bpm || score.bpm || 60,
        timeSignature: ai?.timeSignature || score.timeSignature || null,
        confidence: ai?.confidence ?? score.confidence,
        warnings: ai?.warnings || score.warnings || [],
      }));
      return;
    }

    const score = {
      id: uid(),
      title: ai?.title || sourceTitle,
      composer: ai?.composer || "",
      year: ai?.year || "",
      createdAt: new Date().toISOString(),
      pages,
      notesText: ai?.notesText || "",
      bpm: ai?.bpm || 60,
      tuning: 442,
      timeSignature: ai?.timeSignature || null,
      playMode: "pitched",
      confidence: ai?.confidence || 0,
      warnings: ai?.warnings || [],
    };
    setOmrScores((prev) => [score, ...prev]);
    setOmrScoreId(score.id);
  }

  function stopOmrReading() {
    omrPlaybackRef.current += 1;
    if (omrTimerRef.current) {
      window.clearTimeout(omrTimerRef.current);
      omrTimerRef.current = null;
    }
    omrSpeechClearTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    omrSpeechClearTimersRef.current = [];
    omrVisualTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    omrVisualTimersRef.current = [];
    omrAudioNodesRef.current.forEach((node) => {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    });
    omrAudioNodesRef.current = [];
    window.speechSynthesis?.cancel();
    setOmrReading({ scoreId: null, index: -1 });
  }

  function speakOmrScore(score) {
    if (!score) return;
    const notes = parseOmrNotes(score.notesText);
    if (notes.length === 0) {
      alert("Écris d'abord les notes à lire sous la partition.");
      return;
    }
    if (!("speechSynthesis" in window)) {
      alert("La lecture vocale n'est pas disponible sur ce navigateur.");
      return;
    }
    stopOmrReading();
    const playbackId = omrPlaybackRef.current;
    const bpm = Math.max(30, Math.min(180, Number(score.bpm) || 60));
    const beatMs = 60000 / bpm;
    const meterText = pronounceTimeSignature(score.timeSignature);
    const events = [
      ...(meterText ? [{ index: -1, text: meterText, offsetTotal: 0, duration: 1 }] : []),
      ...buildOmrReadingEvents(notes).map((event) => ({ ...event, offsetTotal: event.offsetTotal + (meterText ? 1.5 : 0) })),
    ];
    const startTime = performance.now() + 120;
    let activeSpeechEvent = -1;
    const clearSpeechBeforeNext = (delay, eventIndex) => {
      const clearDelay = Math.max(40, delay - 180);
      omrSpeechClearTimersRef.current.push(window.setTimeout(() => {
        if (playbackId === omrPlaybackRef.current && activeSpeechEvent === eventIndex) {
          window.speechSynthesis.cancel();
        }
      }, clearDelay));
    };
    const speakEvent = (eventIndex) => {
      if (playbackId !== omrPlaybackRef.current) return;
      if (eventIndex >= events.length) {
        setOmrReading({ scoreId: null, index: -1 });
        return;
      }
      const event = events[eventIndex];
      activeSpeechEvent = eventIndex;
      setOmrReading({ scoreId: score.id, index: event.index });
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(event.text);
      utterance.lang = "fr-FR";
      utterance.rate = 1.35;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
      const next = events[eventIndex + 1];
      if (!next) {
        const delay = Math.max(120, event.duration * beatMs);
        clearSpeechBeforeNext(delay, eventIndex);
        omrTimerRef.current = window.setTimeout(() => speakEvent(eventIndex + 1), delay);
        return;
      }
      const target = startTime + next.offsetTotal * beatMs;
      const delay = Math.max(20, target - performance.now());
      clearSpeechBeforeNext(delay, eventIndex);
      omrTimerRef.current = window.setTimeout(() => speakEvent(eventIndex + 1), delay);
    };
    omrTimerRef.current = window.setTimeout(() => speakEvent(0), Math.max(20, startTime - performance.now()));
  }

  async function playOmrPitchedScore(score) {
    if (!score) return;
    const notes = parseOmrNotes(score.notesText);
    if (notes.length === 0) {
      alert("Aucune note à lire.");
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      alert("La lecture audio précise n'est pas disponible sur ce navigateur.");
      return;
    }

    stopOmrReading();
    const playbackId = omrPlaybackRef.current;
    const ctx = omrAudioContextRef.current || new AudioContextClass();
    omrAudioContextRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const bpm = Math.max(30, Math.min(220, Number(score.bpm) || 60));
    const tuning = Math.max(400, Math.min(480, Number(score.tuning) || 442));
    const beatSec = 60 / bpm;
    const startAt = ctx.currentTime + 0.16;
    let cursor = 0;

    notes.forEach((item, index) => {
      const duration = Math.max(0.25, Number(item.duration) || 1);
      const freq = omrNoteFrequency(item, tuning);
      const t0 = startAt + cursor * beatSec;
      const noteSec = duration * beatSec;

      omrVisualTimersRef.current.push(window.setTimeout(() => {
        if (playbackId === omrPlaybackRef.current) setOmrReading({ scoreId: score.id, index });
      }, Math.max(0, (t0 - ctx.currentTime) * 1000)));

      if (freq) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
        gain.gain.setValueAtTime(0.16, Math.max(t0 + 0.02, t0 + noteSec - 0.045));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + noteSec + 0.01);
        omrAudioNodesRef.current.push(osc, gain);
      }

      cursor += duration;
    });

    omrVisualTimersRef.current.push(window.setTimeout(() => {
      if (playbackId === omrPlaybackRef.current) setOmrReading({ scoreId: null, index: -1 });
    }, Math.max(0, (startAt + cursor * beatSec - ctx.currentTime) * 1000)));
  }

  // ── File Import: new piece (from home screen) — supports PDF, JPEG, PNG, TXT ──
  async function handlePdfImportNew() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setPdfLoading(true);
      try {
        const localData = await extractFromFile(file);
        const data = await enrichWithAi(localData);
        const percusList = data.percus.length > 0
            ? data.percus.map((p, i) => ({
                id: `p${i + 1}`,
                nom: p.nom,
                items: p.items,
              }))
            : [];
        const newPiece = {
          id: uid(),
          titre: data.titre || file.name.replace(/\.(pdf|jpe?g|png|txt)$/i, ""),
          compositeur: data.compositeur || "",
          duree: data.duree || "",
          salle: data.salle || "",
          chef: data.chef || "",
          date: data.date || "",
          effectif: data.effectif || "",
          effectifDetail: data.effectifDetail || null,
          orchestre: data.orchestre || null,
          mobilier: data.orchestre ? calculateMobilier(data.orchestre, percusList, { hasChef: !data.sansChef }) : null,
          planDataUrl: data.planDataUrl || null,
          plans: data.planDataUrls?.length > 0 ? data.planDataUrls : (data.planDataUrl ? [data.planDataUrl] : []),
          couleur: "blanc",
          percus: percusList,
          percusGlobalText: generatePercusGlobalText(percusList),
        };
        setPieces((prev) => [...prev, newPiece]);
        setPieceId(newPiece.id);
        setScreen("piece");
      } catch (err) {
        alert("Erreur lors de l'import : " + err.message);
      } finally {
        setPdfLoading(false);
      }
    };
    input.click();
  }

  // ── Add plan to piece (PDF, image, or TXT) ──
  async function handleAddPlan(targetPieceId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setPdfLoading(true);
      try {
        const name = (file.name || "").toLowerCase();
        const type = (file.type || "").toLowerCase();
        const isPdf = type === "application/pdf" || type === "application/x-pdf" || name.endsWith(".pdf");
        const isTxt = type === "text/plain" || name.endsWith(".txt");

        let planDataUrl;
        if (isPdf) {
          const data = await extractFromPdf(file);
          planDataUrl = data.planDataUrl;
        } else if (isTxt) {
          // TXT files don't have a visual plan, but we extract data from them
          const data = await extractFromFile(file);
          // Auto-fill empty fields from TXT extraction
          const FIELDS = ["titre", "compositeur", "duree", "salle", "chef", "date", "effectif"];
          updatePiece(targetPieceId, (p) => {
            const updates = {};
            for (const key of FIELDS) {
              if (!p[key] && data[key]) updates[key] = data[key];
            }
            if (data.orchestre && !p.orchestre) updates.orchestre = data.orchestre;
            if (data.effectifDetail && !p.effectifDetail) updates.effectifDetail = data.effectifDetail;
            // Add percu poles if piece has none or only empty ones
            if (data.percus?.length > 0) {
              const hasItems = p.percus.some(r => r.items.length > 0);
              if (!hasItems && p.percus.length <= 1) {
                updates.percus = data.percus.map((pole, i) => ({
                  id: `p${Date.now()}_${i}`,
                  nom: pole.nom,
                  items: pole.items,
                }));
                updates.percusGlobalText = generatePercusGlobalText(updates.percus);
              }
            }
            return { ...p, ...updates };
          });
          alert("Données extraites du fichier TXT et appliquées aux champs vides.");
          setPdfLoading(false);
          return;
        } else {
          // Image file — convert to dataUrl
          planDataUrl = await fileToDataUrl(file);
        }
        if (planDataUrl) {
          updatePiece(targetPieceId, (p) => {
            const plans = [...(p.plans || []), planDataUrl];
            return { ...p, plans, planDataUrl };
          });
        }
      } catch (err) {
        alert("Erreur : " + err.message);
      } finally {
        setPdfLoading(false);
      }
    };
    input.click();
  }

  async function enrichWithAi(localData) {
    const score = [localData.titre, localData.compositeur, localData.effectif, localData.chef]
      .filter(Boolean).length + (localData.percus.length > 0 ? 1 : 0);
    if (score >= 3) return localData;
    const image = localData.planDataUrls?.[0] || localData.planDataUrl;
    if (!image) return localData;
    try {
      const aiData = await extractWithGemini(image, "concert");
      return {
        ...localData,
        titre: localData.titre || aiData.titre || "",
        compositeur: localData.compositeur || aiData.compositeur || "",
        duree: localData.duree || aiData.duree || "",
        salle: localData.salle || aiData.salle || "",
        chef: localData.chef || aiData.chef || "",
        date: localData.date || aiData.date || "",
        effectif: localData.effectif || aiData.effectif || "",
        effectifDetail: localData.effectifDetail || aiData.effectifDetail || null,
        orchestre: localData.orchestre || aiData.orchestre || null,
        percus: localData.percus.length > 0 ? localData.percus : (aiData.percus || []),
      };
    } catch (err) {
      console.warn("[OrkMap] AI enrichment failed:", err.message);
      return localData;
    }
  }

  function extractNum(nom) {
    const m = nom.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  async function handleAiExtract(targetPieceId) {
    const targetPiece = pieces.find(p => p.id === targetPieceId);
    if (!targetPiece || !(targetPiece.plans || []).length) {
      alert("Ajoutez d'abord un plan à cette pièce.");
      return;
    }
    setAiLoading(true);
    try {
      const extracted = await extractWithGemini(targetPiece.plans[0], "concert");
      const ex = extracted || {};
      const autoFilled = [];

      const LABELS = { titre: "Titre", compositeur: "Compositeur", duree: "Durée", salle: "Lieu", chef: "Chef", date: "Date", effectif: "Effectif" };

      // Auto-fill empty scalar fields
      for (const key of Object.keys(LABELS)) {
        if (!targetPiece[key] && ex[key]) {
          updatePiece(targetPieceId, p => ({ ...p, [key]: ex[key] }));
          autoFilled.push(LABELS[key]);
        }
      }

      // Auto-fill empty orchestre sections
      if (ex.orchestre) {
        for (const sec of ["bois", "cuivres", "cordes", "autres"]) {
          const cur = targetPiece.orchestre?.[sec] || [];
          const aiItems = ex.orchestre[sec] || [];
          if (cur.length === 0 && aiItems.length > 0) {
            updatePiece(targetPieceId, p => ({
              ...p,
              orchestre: { ...(p.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] }), [sec]: aiItems },
            }));
            autoFilled.push(`Orchestre ${sec}`);
          }
        }
      }

      // Auto-fill empty or missing percus poles
      if (ex.percus) {
        for (const aiPole of ex.percus) {
          const aiNum = extractNum(aiPole.nom);
          const existing = targetPiece.percus.find(p => {
            if (p.nom.toLowerCase() === aiPole.nom.toLowerCase()) return true;
            const pNum = extractNum(p.nom);
            return aiNum !== null && pNum !== null && aiNum === pNum;
          });
          if (!existing) {
            updatePiece(targetPieceId, p => {
              const newPercus = [...p.percus, { id: uid(), nom: aiPole.nom, items: aiPole.items }];
              return { ...p, percus: newPercus, percusGlobalText: generatePercusGlobalText(newPercus) };
            });
            autoFilled.push(aiPole.nom);
          } else if (existing.items.length === 0) {
            updatePiece(targetPieceId, p => {
              const newPercus = p.percus.map(r => r.id === existing.id ? { ...r, items: aiPole.items } : r);
              return { ...p, percus: newPercus, percusGlobalText: generatePercusGlobalText(newPercus) };
            });
            autoFilled.push(aiPole.nom);
          }
        }
      }

      setMergeData({ pieceId: targetPieceId, extracted, autoFilled, showMerge: true });
    } catch (err) {
      alert("Erreur extraction IA : " + err.message);
    } finally {
      setAiLoading(false);
    }
  }

  function deletePlan(pId, planIdx) {
    updatePiece(pId, (p) => {
      const plans = (p.plans || []).filter((_, i) => i !== planIdx);
      return { ...p, plans, planDataUrl: plans[plans.length - 1] || null };
    });
  }

  // ════════════════════════════════
  // LOADING
  // ════════════════════════════════
  if (authStatus === "checking") {
    return (
      <div style={{ ...S.shell, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <img src="/orkmap-logo.png" alt="OrkMap" style={{ height: 80, marginBottom: 16 }} />
          <div style={{ fontSize: 14, color: "#78716C" }}>Connexion...</div>
        </div>
      </div>
    );
  }

  if (authStatus !== "authenticated") {
    return <LoginScreen onLogin={(email) => { setAuthStatus("checking"); setAuthEmail(email); }} />;
  }

  if (!dbLoaded) {
    return (
      <div style={{ ...S.shell, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <img src="/orkmap-logo.png" alt="OrkMap" style={{ height: 80, marginBottom: 16 }} />
          <div style={{ fontSize: 14, color: "#78716C" }}>Chargement...</div>
        </div>
      </div>
    );
  }

  // ZONE SELECT (before standalone camera)
  // ════════════════════════════════
  if (zoneSelectMode) {
    const zsPiece = pieces.find((p) => p.id === zoneSelectMode.pieceId);
    const zsPercu = zsPiece?.percus.find((r) => r.id === zoneSelectMode.percuId);
    const zsCol = BARNIER[zoneSelectMode.couleur || "blanc"];
    return (
      <ZoneSelectView
        piece={zsPiece}
        percu={zsPercu}
        col={zsCol}
        onSelect={(zone) => {
          setCameraMode({ ...zoneSelectMode, zone });
          setZoneSelectMode(null);
        }}
        onImport={(zone, dataUrl) => {
          const photoData = {
            id: uid(),
            dataUrl,
            pieceId: zoneSelectMode.pieceId || "standalone",
            percuId: zoneSelectMode.percuId || null,
            zone,
            num: 1,
            total: 1,
            couleur: zoneSelectMode.couleur || "blanc",
          };
          if (zoneSelectMode.pieceId) {
            addPhoto(zoneSelectMode.pieceId, photoData);
          }
          setZoneSelectMode(null);
        }}
        onCancel={() => setZoneSelectMode(null)}
      />
    );
  }

  // ════════════════════════════════
  // STANDALONE CAMERA (with watermark)
  // ════════════════════════════════
  if (cameraMode) {
    const cmPiece = pieces.find((p) => p.id === cameraMode.pieceId);
    const cmPercu = cmPiece?.percus.find((r) => r.id === cameraMode.percuId);
    const cmCol = BARNIER[cameraMode.couleur || "blanc"];
    return (
      <StandaloneCamera
        onCapture={(dataUrl) => {
          const photoData = {
            id: uid(),
            dataUrl,
            pieceId: cameraMode.pieceId || "standalone",
            percuId: cameraMode.percuId || null,
            zone: cameraMode.zone || "Photo libre",
            num: 1,
            total: 1,
            couleur: cameraMode.couleur || "blanc",
          };
          if (cameraMode.pieceId) {
            addPhoto(cameraMode.pieceId, photoData);
          }
          setCameraMode(null);
        }}
        onCancel={() => setCameraMode(null)}
        couleur={cameraMode.couleur || "blanc"}
        watermark={{
          titre: cmPiece?.titre || "",
          percuNom: cmPercu?.nom || "",
          zone: cameraMode.zone || "Photo libre",
          couleur: cmCol,
        }}
      />
    );
  }

  // ════════════════════════════════
  // CAPTURE SCREEN (protocol photo)
  // ════════════════════════════════
  if (capture) {
    return (
      <CaptureView
        capture={capture}
        pieces={pieces}
        onPhoto={(data) => addPhoto(capture.pieceId, data)}
        onNext={(c) => setCapture(c)}
        onDone={() => { setCapture(null); setScreen("gallery"); }}
        onCancel={() => { setCapture(null); setScreen("piece"); }}
      />
    );
  }

  // ════════════════════════════════
  // MERGE DATA (AI extraction results) — MUST be before screen routing
  // ════════════════════════════════
  if (mergeData && mergeData.showMerge) {
    const mergePiece = pieces.find(p => p.id === mergeData.pieceId);
    const ex = mergeData.extracted || {};
    const autoFilled = mergeData.autoFilled || [];
    const LABELS = { titre: "Titre", compositeur: "Compositeur", duree: "Durée", salle: "Lieu", chef: "Chef", date: "Date", effectif: "Effectif" };
    const btnApply = { fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E", cursor: "pointer", fontWeight: 600 };
    const btnChoice = { fontSize: 11, padding: "6px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 600, border: "1px solid #D6D3D1", background: "#fff", color: "#1C1917", minHeight: 36 };
    const btnActive = { ...btnChoice, background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" };

    // Fields where both sides have a value and they differ — user must choose
    const needsChoice = Object.keys(LABELS).filter(key => {
      const cur = mergePiece?.[key] || "";
      const ai = ex[key] || "";
      return cur && ai && cur !== ai;
    });
    const orchNeedsChoice = ex.orchestre ? ["bois", "cuivres", "cordes", "autres"].filter(sec => {
      const cur = mergePiece?.orchestre?.[sec] || [];
      const ai = ex.orchestre[sec] || [];
      return cur.length > 0 && ai.length > 0 && JSON.stringify(cur) !== JSON.stringify(ai);
    }) : [];
    const percuNeedsChoice = (ex.percus || []).filter(aiPole => {
      const aiNum = extractNum(aiPole.nom);
      const existing = mergePiece?.percus.find(p => {
        if (p.nom.toLowerCase() === aiPole.nom.toLowerCase()) return true;
        const pNum = extractNum(p.nom);
        return aiNum !== null && pNum !== null && aiNum === pNum;
      });
      return existing && existing.items.length > 0;
    });
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setMergeData(null)} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Résultats IA</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{mergePiece?.titre || "Fusion"}</div>
            </div>
          </div>
        </div>
        <div style={S.body}>
          {/* Auto-filled summary */}
          {autoFilled.length > 0 && (
            <div style={{ marginBottom: 12, padding: "8px 10px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#166534" }}>✓ Rempli automatiquement :</div>
              <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>{autoFilled.join(", ")}</div>
            </div>
          )}
          {/* Fields needing choice */}
          {needsChoice.length === 0 && orchNeedsChoice.length === 0 && percuNeedsChoice.length === 0 && (
            <div style={{ fontSize: 13, color: "#78716C", marginBottom: 12 }}>
              {autoFilled.length > 0 ? "Tous les champs vides ont été remplis. Rien d'autre à modifier." : "Aucune donnée nouvelle extraite par l'IA."}
            </div>
          )}
          {needsChoice.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 700, color: "#78716C", marginBottom: 6, textTransform: "uppercase" }}>Champs différents — choisir :</div>
          )}
          {needsChoice.map(key => {
            const aiVal = ex[key];
            const curVal = mergePiece[key];
            return (
              <div key={key} style={{ marginBottom: 8, padding: "8px 10px", background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase" }}>{LABELS[key]}</div>
                <div style={{ fontSize: 12, color: "#78716C", marginTop: 2 }}>Actuel : {curVal}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1917", flex: 1 }}>IA : {aiVal}</div>
                  <button onClick={() => updatePiece(mergeData.pieceId, p => ({ ...p, [key]: aiVal }))} style={btnApply}>
                    Remplacer
                  </button>
                </div>
              </div>
            );
          })}
          {/* Orchestre sections needing choice */}
          {orchNeedsChoice.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#78716C", marginBottom: 6, textTransform: "uppercase" }}>Orchestre — sections différentes :</div>
              {orchNeedsChoice.map(sec => {
                const cur = mergePiece.orchestre[sec];
                const ai = ex.orchestre[sec];
                return (
                  <div key={sec} style={{ marginBottom: 8, padding: "8px 10px", background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase" }}>{sec}</div>
                    <div style={{ fontSize: 11, color: "#A8A29E", marginTop: 2 }}>Actuel : {cur.join(", ")}</div>
                    <div style={{ fontSize: 11, color: "#1C1917", marginTop: 2 }}>IA : {ai.join(", ")}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={() => updatePiece(mergeData.pieceId, p => ({
                        ...p, orchestre: { ...p.orchestre, [sec]: ai },
                      }))} style={btnActive}>Remplacer</button>
                      <button style={btnChoice} disabled>Garder</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Percus needing choice */}
          {percuNeedsChoice.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#78716C", marginBottom: 6, textTransform: "uppercase" }}>Percussions — pôles différents :</div>
              {percuNeedsChoice.map((aiPole, i) => {
                const aiNum = extractNum(aiPole.nom);
                const existingPole = mergePiece.percus.find(p => {
                  if (p.nom.toLowerCase() === aiPole.nom.toLowerCase()) return true;
                  const pNum = extractNum(p.nom);
                  return aiNum !== null && pNum !== null && aiNum === pNum;
                });
                const existingNames = new Set(existingPole.items.map(it => it.nom.toLowerCase()));
                const aiNames = new Set(aiPole.items.map(it => it.nom.toLowerCase()));
                const onlyExisting = existingPole.items.filter(it => !aiNames.has(it.nom.toLowerCase()));
                const onlyAi = aiPole.items.filter(it => !existingNames.has(it.nom.toLowerCase()));
                const common = existingPole.items.filter(it => aiNames.has(it.nom.toLowerCase()));
                return (
                  <div key={i} style={{ marginBottom: 10, padding: "10px", background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1917", marginBottom: 6 }}>{aiPole.nom} {existingPole.nom !== aiPole.nom ? `(= ${existingPole.nom})` : ""}</div>
                    {common.length > 0 && (
                      <div style={{ fontSize: 11, color: "#78716C", marginBottom: 3 }}>
                        <span style={{ fontWeight: 600 }}>Commun :</span> {common.map(it => it.nom).join(", ")}
                      </div>
                    )}
                    {onlyExisting.length > 0 && (
                      <div style={{ fontSize: 11, color: "#A8A29E", marginBottom: 3 }}>
                        <span style={{ fontWeight: 600 }}>Seulement existant :</span> {onlyExisting.map(it => it.nom).join(", ")}
                      </div>
                    )}
                    {onlyAi.length > 0 && (
                      <div style={{ fontSize: 11, color: "#166534", marginBottom: 3 }}>
                        <span style={{ fontWeight: 600 }}>Nouveaux (IA) :</span> {onlyAi.map(it => it.nom).join(", ")}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button onClick={() => updatePiece(mergeData.pieceId, p => {
                        const newPercus = p.percus.map(r => r.id === existingPole.id ? { ...r, items: aiPole.items } : r);
                        return { ...p, percus: newPercus, percusGlobalText: generatePercusGlobalText(newPercus) };
                      })} style={btnActive}>Écraser tout</button>
                      {onlyAi.length > 0 && (
                        <button onClick={() => updatePiece(mergeData.pieceId, p => {
                          const newPercus = p.percus.map(r => {
                            if (r.id !== existingPole.id) return r;
                            const names = new Set(r.items.map(it => it.nom.toLowerCase()));
                            const add = aiPole.items.filter(it => !names.has(it.nom.toLowerCase()));
                            return { ...r, items: [...r.items, ...add] };
                          });
                          return { ...p, percus: newPercus, percusGlobalText: generatePercusGlobalText(newPercus) };
                        })} style={btnActive}>+ Ajouter {onlyAi.length} nouveau{onlyAi.length > 1 ? "x" : ""}</button>
                      )}
                      <button style={btnChoice} disabled>Ignorer</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button onClick={() => setMergeData(null)} style={{ ...S.btnPrimary("#1C1917"), marginTop: 16 }}>
            Terminé
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════
  // START — direct family access
  // ════════════════════════════════
  if (screen === "start") {
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src="/orkmap-logo.png" alt="OrkMap" style={{ height: 48 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#78716C", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{authEmail}</div>
            <button onClick={logout} style={{ background: "none", border: "1px solid #D6D3D1", borderRadius: 8, color: "#57534E", fontSize: 12, fontWeight: 700, padding: "6px 8px", cursor: "pointer" }}>Sortir</button>
          </div>
        </div>
        <div style={{ ...S.body, paddingTop: 18 }}>
          <button
            onClick={goConcerts}
            style={{
              width: "100%", minHeight: 132, marginBottom: 12, padding: 18,
              background: "#fff", border: "1px solid #D6D3D1", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 16, textAlign: "left", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 36, width: 52, textAlign: "center" }}>♫</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 22, fontWeight: 800, color: "#1C1917" }}>Concerts & régie</span>
              <span style={{ display: "block", fontSize: 13, lineHeight: 1.35, color: "#78716C", marginTop: 4 }}>
                Régie, plans, matériel, photos et listes TXT.
              </span>
            </span>
          </button>
          <button
            onClick={() => goOmr(null)}
            style={{
              width: "100%", minHeight: 154, marginBottom: 12, padding: 18,
              background: "#1C1917", border: "1px solid #1C1917", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 16, textAlign: "left", cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 38, width: 52, textAlign: "center" }}>♬</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 23, fontWeight: 800, color: "#fff" }}>OrkScore</span>
              <span style={{ display: "block", fontSize: 13, lineHeight: 1.35, color: "#D6D3D1", marginTop: 4 }}>
                Lire une partition : photo, notes, rythme et écoute.
              </span>
            </span>
          </button>
          {omrScores.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#78716C", textTransform: "uppercase", marginBottom: 8 }}>
                OrkScore · partitions récentes
              </div>
              {omrScores.slice(0, 3).map((score) => (
                <button key={score.id} onClick={() => goOmr(score.id)} style={{ ...S.btnSecondary, justifyContent: "flex-start", marginBottom: 8 }}>
                  ♬ {score.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════
  // OMR — score reader
  // ════════════════════════════════
  if (screen === "omr") {
    const activeScore = omrScore;
    const parsedNotes = parseOmrNotes(activeScore?.notesText || "");
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => { stopOmrReading(); goStart(); }} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>OrkScore</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#1C1917", marginTop: 1 }}>
                {activeScore ? activeScore.title : "Lire une partition"}
              </div>
            </div>
            {activeScore && (
              <button onClick={() => deleteOmrScore(activeScore.id)} style={{ background: "none", border: "none", fontSize: 16, color: "#A8A29E", cursor: "pointer", padding: 4 }}>✕</button>
            )}
          </div>
        </div>
        <div style={S.body}>
          <button onClick={handleOmrPhotoCapture} disabled={omrAnalyzing} style={{ ...S.btnPrimary("#1C1917"), marginBottom: 8, opacity: omrAnalyzing ? 0.65 : 1 }}>
            {omrAnalyzing ? "Lecture de la partition..." : activeScore ? "Photographier une autre page" : "Photographier la partition"}
          </button>
          <button onClick={handleOmrImport} disabled={pdfLoading || omrAnalyzing} style={{ ...S.btnSecondary, marginBottom: 12, opacity: pdfLoading || omrAnalyzing ? 0.65 : 1 }}>
            {pdfLoading ? "Import en cours..." : activeScore ? "+ Ajouter un PDF ou une image" : "Importer un PDF ou une image"}
          </button>

          {!activeScore && (
            <>
              {omrAnalyzing ? (
                <div style={{ textAlign: "center", padding: "52px 16px", color: "#1D4ED8" }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>♬</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>Lecture de la partition...</div>
                  <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45, color: "#78716C" }}>
                    Les notes vont se remplir automatiquement.
                  </div>
                </div>
              ) : omrScores.length === 0 ? (
                <div style={{ textAlign: "center", padding: "52px 16px", color: "#78716C" }}>
                  <div style={{ fontSize: 44, marginBottom: 8 }}>♬</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1C1917" }}>Aucune partition</div>
                  <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45 }}>
                    Ajoute une photo ou un PDF de partition pour commencer.
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#78716C", textTransform: "uppercase", marginBottom: 8 }}>Mes partitions</div>
                  {omrScores.map((score) => (
                    <div key={score.id} onClick={() => setOmrScoreId(score.id)} style={{ ...S.card("#1C1917"), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#1C1917" }}>{score.title}</div>
                        <div style={{ fontSize: 12, color: "#78716C", marginTop: 2 }}>
                          {(score.pages || []).length} page{(score.pages || []).length > 1 ? "s" : ""} · {parseOmrNotes(score.notesText).length} note{parseOmrNotes(score.notesText).length > 1 ? "s" : ""}
                        </div>
                      </div>
                      <span style={{ color: "#A8A29E", fontSize: 20 }}>›</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeScore && (
            <>
              <div style={{ background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#78716C", textTransform: "uppercase", marginBottom: 8 }}>
                  Infos partition
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  <input
                    value={activeScore.title || ""}
                    onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, title: e.target.value }))}
                    placeholder="Titre"
                    style={omrMetaInputStyle(true)}
                  />
                  <input
                    value={activeScore.composer || ""}
                    onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, composer: e.target.value }))}
                    placeholder="Compositeur"
                    style={omrMetaInputStyle()}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      value={activeScore.year || ""}
                      onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, year: e.target.value }))}
                      placeholder="Année"
                      style={omrMetaInputStyle()}
                    />
                    <input
                      type="number"
                      min="30"
                      max="220"
                      value={activeScore.bpm || 60}
                      onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, bpm: e.target.value }))}
                      placeholder="BPM"
                      style={omrMetaInputStyle()}
                    />
                    <input
                      type="number"
                      min="400"
                      max="480"
                      value={activeScore.tuning || 442}
                      onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, tuning: e.target.value }))}
                      placeholder="Diapason"
                      style={omrMetaInputStyle()}
                    />
                  </div>
                </div>
              </div>
              {parsedNotes.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button onClick={() => (activeScore.playMode || "pitched") === "spoken" ? speakOmrScore(activeScore) : playOmrPitchedScore(activeScore)} style={{ ...S.btnPrimary("#1C1917"), flex: 1 }}>
                    ▶ Lire les notes trouvées
                  </button>
                  <button onClick={stopOmrReading} style={{ ...S.btnSecondary, width: 86, flex: "0 0 86px" }}>
                    Stop
                  </button>
                </div>
              )}
              {(activeScore.pages || []).length > 0 && (
                <button
                  onClick={() => reanalyzeOmrScore(activeScore.id)}
                  disabled={omrAnalyzing}
                  style={{ ...S.btnSecondary, marginBottom: 10, opacity: omrAnalyzing ? 0.65 : 1 }}
                >
                  {omrAnalyzing ? "Lecture en cours..." : activeScore.notesText ? "Relancer la lecture des notes" : "Réessayer de lire les notes"}
                </button>
              )}
              {omrAnalyzing && (
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#1D4ED8", marginBottom: 10 }}>
                  Lecture automatique de la partition...
                </div>
              )}
              {(activeScore.pages || []).map((page, idx) => (
                <div key={idx} style={{ background: "#fff", border: "1px solid #D6D3D1", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
                  <img src={page} alt={`Partition page ${idx + 1}`} style={{ width: "100%", display: "block" }} />
                  <div style={{ padding: "5px 8px", fontSize: 11, fontWeight: 700, color: "#78716C", background: "#FAFAF9" }}>Page {idx + 1}</div>
                </div>
              ))}

              <div style={{ background: "#fff", border: "1px solid #D6D3D1", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#78716C", textTransform: "uppercase", marginBottom: 6 }}>
                  {activeScore.notesText ? "Notes trouvées" : "Notes à trouver"}
                </div>
                <textarea
                  value={activeScore.notesText || ""}
                  onChange={(e) => updateOmrScore(activeScore.id, (score) => ({ ...score, notesText: e.target.value }))}
                  placeholder={omrAnalyzing ? "Lecture de la partition..." : "Les notes apparaîtront ici après la photo."}
                  style={{ width: "100%", minHeight: 86, boxSizing: "border-box", padding: 10, border: "1px solid #E7E5E4", borderRadius: 8, fontSize: 15, lineHeight: 1.45, color: "#1C1917", outline: "none", resize: "vertical" }}
                />
                <div style={{ fontSize: 11, color: "#A8A29E", lineHeight: 1.4, marginTop: 6 }}>
                  Si besoin, les notes peuvent être corrigées ici. Option rythme : ajoute `:b` blanche, `:r` ronde, `:c` croche.
                </div>
              </div>

              {activeScore.warnings?.length > 0 && (
                <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#92400E", lineHeight: 1.4, marginBottom: 10 }}>
                  {activeScore.warnings.join(" ")}
                </div>
              )}

              {parsedNotes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {parsedNotes.map((item, idx) => (
                    <span key={`${item.note}-${idx}`} style={{ ...S.tag, background: omrReading.scoreId === activeScore.id && omrReading.index === idx ? "#1C1917" : "#E7E5E4", color: omrReading.scoreId === activeScore.id && omrReading.index === idx ? "#fff" : "#57534E", fontSize: 12 }}>
                      {item.note}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {[
                    { key: "pitched", label: "Pitché" },
                    { key: "spoken", label: "Parlé" },
                  ].map((mode) => {
                    const active = (activeScore.playMode || "pitched") === mode.key;
                    return (
                      <button
                        key={mode.key}
                        onClick={() => updateOmrScore(activeScore.id, (score) => ({ ...score, playMode: mode.key }))}
                        style={{
                          flex: 1,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: active ? "1px solid #1C1917" : "1px solid #D6D3D1",
                          background: active ? "#1C1917" : "#fff",
                          color: active ? "#fff" : "#57534E",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
                {activeScore.timeSignature?.beats && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 700, color: "#57534E", marginBottom: 8 }}>
                    <span>Mesure</span>
                    <span style={{ padding: "5px 10px", border: "1px solid #D6D3D1", borderRadius: 8, background: "#fff", color: "#1C1917" }}>
                      {activeScore.timeSignature.beats}/{activeScore.timeSignature.beatType}
                    </span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 700, color: "#57534E" }}>
                  <span>Tempo</span>
                  <span style={{ padding: "5px 10px", border: "1px solid #D6D3D1", borderRadius: 8, background: "#fff", color: "#1C1917" }}>
                    {activeScore.bpm || 60} BPM
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 700, color: "#57534E", marginTop: 8 }}>
                  <span>Diapason</span>
                  <span style={{ padding: "5px 10px", border: "1px solid #D6D3D1", borderRadius: 8, background: "#fff", color: "#1C1917" }}>
                    {activeScore.tuning || 442} Hz
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => (activeScore.playMode || "pitched") === "spoken" ? speakOmrScore(activeScore) : playOmrPitchedScore(activeScore)} style={{ ...S.btnPrimary("#1C1917"), flex: 1 }}>
                  ▶ Lire
                </button>
                <button onClick={stopOmrReading} style={{ ...S.btnSecondary, flex: 1 }}>
                  Stop
                </button>
              </div>
              <button
                onClick={() => updateOmrScore(activeScore.id, (score) => ({ ...score, notesText: formatOmrNotes(parseOmrNotes(score.notesText)) }))}
                style={{ ...S.btnSecondary, marginTop: 8 }}
              >
                Nettoyer les notes
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════
  // CONCERTS LIST
  // ════════════════════════════════
  if (screen === "concerts") {
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <img src="/orkmap-logo.png" alt="OrkMap" style={{ height: 48 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: "#78716C" }}>Mes concerts</div>
        </div>
        <div style={S.body}>
          <button
            onClick={() => {
              const titre = prompt("Nom du concert :");
              if (!titre || !titre.trim()) return;
              const newConcert = {
                id: uid(),
                titre: titre.trim(),
                date: prompt("Date :") || "",
                lieu: prompt("Lieu :") || "",
                orchestre: prompt("Orchestre :") || "",
                chef: prompt("Chef :") || "",
                pieces: [],
              };
              setConcerts((prev) => [...prev, newConcert]);
              goConcert(newConcert.id);
            }}
            style={{ ...S.btnPrimary("#1C1917"), marginBottom: 14 }}
          >
            + Nouveau concert
          </button>

          {concerts.filter(c => !c.archived).map((c, ci, arr) => (
            <div key={c.id} onClick={() => goConcert(c.id)} style={{ ...S.card("#57534E"), marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1917" }}>{c.titre}</div>
                  <div style={{ fontSize: 12, color: "#78716C", marginTop: 2 }}>
                    {[c.orchestre, c.lieu, c.date].filter(Boolean).join(" — ")}
                  </div>
                  {c.chef && <div style={{ fontSize: 12, color: "#A8A29E" }}>Chef : {c.chef}</div>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 12, color: "#78716C", fontWeight: 600 }}>{c.pieces.length} pièce{c.pieces.length !== 1 ? "s" : ""}</span>
                  <DragHandle onMove={(dir) => {
                    const idx = concerts.findIndex(x => x.id === c.id);
                    if (dir === -1 && idx > 0) setConcerts(prev => { const a = [...prev]; const [m] = a.splice(idx, 1); a.splice(idx - 1, 0, m); return a; });
                    if (dir === 1 && idx < concerts.length - 1) setConcerts(prev => { const a = [...prev]; const [m] = a.splice(idx, 1); a.splice(idx + 1, 0, m); return a; });
                  }} />
                  <button onClick={() => { setConcerts(prev => prev.map(x => x.id === c.id ? { ...x, archived: true } : x)); }}
                    style={{ background: "none", border: "none", fontSize: 16, color: "#A8A29E", cursor: "pointer", padding: "2px 4px" }} title="Archiver">📦</button>
                  <button onClick={() => { if (confirm("Supprimer ce concert ?")) setConcerts(prev => prev.filter(x => x.id !== c.id)); }}
                    style={{ background: "none", border: "none", fontSize: 16, color: "#A8A29E", cursor: "pointer", padding: "2px 4px" }}>✕</button>
                </div>
              </div>
            </div>
          ))}

          {/* Archives section */}
          {concerts.filter(c => c.archived).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setShowArchives(!showArchives)}
                style={{ ...S.btnSecondary, width: "100%", fontSize: 13, marginBottom: 8 }}>
                📦 Archives ({concerts.filter(c => c.archived).length}) {showArchives ? "▾" : "▸"}
              </button>
              {showArchives && (
                <>
                  <input
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                    placeholder="Rechercher dans les archives..."
                    style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #E7E5E4", borderRadius: 8, marginBottom: 8, outline: "none", background: "#FAFAF9" }}
                  />
                  {concerts.filter(c => c.archived).filter(c =>
                    !archiveSearch || [c.titre, c.orchestre, c.lieu, c.chef, c.date].filter(Boolean).join(" ").toLowerCase().includes(archiveSearch.toLowerCase())
                  ).map(c => (
                    <div key={c.id} style={{ ...S.card("#A8A29E"), marginBottom: 6, opacity: 0.75 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1 }} onClick={() => goConcert(c.id)}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#57534E" }}>{c.titre}</div>
                          <div style={{ fontSize: 11, color: "#A8A29E" }}>{[c.orchestre, c.lieu, c.date].filter(Boolean).join(" — ")}</div>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setConcerts(prev => prev.map(x => x.id === c.id ? { ...x, archived: false } : x))}
                            style={{ background: "none", border: "none", fontSize: 14, color: "#78716C", cursor: "pointer" }} title="Désarchiver">↩</button>
                          <button onClick={() => { if (confirm("Supprimer ce concert ?")) setConcerts(prev => prev.filter(x => x.id !== c.id)); }}
                            style={{ background: "none", border: "none", fontSize: 14, color: "#A8A29E", cursor: "pointer" }}>✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════
  // HOME (pieces d'un concert)
  // ════════════════════════════════
  if (screen === "home" && concert) {
    const totalPhotos = Object.values(photos).flat().length;
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={goConcerts} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>
                {[concert.orchestre, concert.lieu].filter(Boolean).join(" — ")}
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{concert.titre}</div>
              {concert.chef && <div style={{ fontSize: 12, color: "#A8A29E" }}>Chef : {concert.chef} — {concert.date}</div>}
            </div>
            <button onClick={() => {
              const t = prompt("Titre :", concert.titre); if (!t) return;
              updateConcert(concert.id, c => ({ ...c,
                titre: t,
                date: prompt("Date :", c.date) || c.date,
                lieu: prompt("Lieu :", c.lieu) || c.lieu,
                orchestre: prompt("Orchestre :", c.orchestre) || c.orchestre,
                chef: prompt("Chef :", c.chef) || c.chef,
              }));
            }} style={{ background: "none", border: "none", fontSize: 14, color: "#A8A29E", cursor: "pointer" }}>✎</button>
          </div>
        </div>
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 14, color: "#78716C", fontWeight: 600 }}>{pieces.length} pièces</span>
          </div>

          {/* Action buttons: Import PDF (new piece) + Camera */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={handlePdfImportNew}
              disabled={pdfLoading}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px", opacity: pdfLoading ? 0.6 : 1 }}
            >
              {pdfLoading ? "⏳ Import..." : "📄 Importer fichier"}
            </button>
            <button
              onClick={() => {
                const titre = prompt("Titre de la pièce :");
                if (!titre || !titre.trim()) return;
                const newPiece = {
                  id: uid(),
                  titre: titre.trim(),
                  compositeur: prompt("Compositeur :") || "",
                  duree: "",
                  salle: "",
                  chef: "",
                  date: "",
                  effectif: "",
                  effectifDetail: null,
                  orchestre: null,
                  planDataUrl: null,
                  couleur: "blanc",
                  percus: [],
                };
                setPieces((prev) => [...prev, newPiece]);
                goPiece(newPiece.id);
              }}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px" }}
            >
              + Nouvelle pièce
            </button>
          </div>

          {pieces.map((p, pi) => {
            const col = BARNIER[p.couleur];
            const itemCount = p.percus.reduce((s, r) => s + r.items.length, 0);
            const photoCount = (photos[p.id] || []).length;
            return (
              <div key={p.id} onClick={() => goPiece(p.id)} style={S.card(col.hex)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1917" }}>{p.titre}</div>
                    <div style={{ fontSize: 12, color: "#78716C", marginTop: 1 }}>{p.compositeur}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <DragHandle onMove={(dir) => { if (dir === -1 && pi > 0) movePiece(pi, pi - 1); if (dir === 1 && pi < pieces.length - 1) movePiece(pi, pi + 1); }} />
                    <button onClick={() => deletePiece(p.id)} style={{ background: "none", border: "none", fontSize: 16, color: "#A8A29E", cursor: "pointer", padding: "2px 4px" }} title="Supprimer">✕</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {p.duree && <span style={S.tag}>{p.duree}</span>}
                  <span style={S.tag}>{p.percus.length} percu{p.percus.length > 1 ? "s" : ""}</span>
                  <span style={S.tag}>{itemCount} instr.</span>
                  {photoCount > 0 && <span style={S.tag}>{photoCount} photo{photoCount > 1 ? "s" : ""}</span>}
                </div>
              </div>
            );
          })}

          {totalPhotos > 0 && (
            <>
              <button onClick={() => goGallery(null)} style={{ ...S.btnSecondary, marginTop: 8 }}>
                📷 Toutes les photos ({totalPhotos})
              </button>
              <button onClick={() => setShowPhotoDownload("concert")} style={{ ...S.btnSecondary, marginTop: 6 }}>
                📥 Télécharger photos du concert
              </button>
            </>
          )}

          {/* Concert notes */}
          <textarea
            value={concert.notes || ""}
            onChange={(e) => updateConcert(concert.id, (c) => ({ ...c, notes: e.target.value }))}
            placeholder="Notes du concert..."
            style={{
              width: "100%", minHeight: 80, marginTop: 14, padding: 10, fontSize: 13,
              border: "1px solid #E7E5E4", borderRadius: 8, background: "#FAFAF9",
              color: "#1C1917", fontFamily: "'DM Sans', sans-serif", resize: "vertical",
              outline: "none",
            }}
          />
        </div>
        <NavBar active="pieces" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => { setPieceId(null); setScreen("txt"); }} />
        {showPhotoDownload === "concert" && concert && (
          <PhotoDownloadConcertModal concert={concert} pieces={pieces} photos={photos} onClose={() => setShowPhotoDownload(null)} />
        )}
      </div>
    );
  }

  // ════════════════════════════════
  // PIECE DETAIL
  // ════════════════════════════════
  if (screen === "piece" && piece) {
    const col = BARNIER[piece.couleur];
    const orchestre = piece.orchestre;
    const orchCount = orchestre
      ? [orchestre.bois, orchestre.cuivres, orchestre.cordes, orchestre.autres].flat().length
      : 0;
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, borderBottom: `3px solid ${col.hex}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={goHome} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>{piece.compositeur || "Compositeur"}</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{piece.titre || "Sans titre"}</div>
            </div>
            <button onClick={goHome} style={{ background: "none", border: "none", fontSize: 18, color: "#A8A29E", cursor: "pointer", padding: "4px 6px" }} title="Fermer">✕</button>
          </div>
        </div>
        <div style={S.body}>
          {/* Barnier color picker */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {Object.entries(BARNIER).map(([key, b]) => (
              <button
                key={key}
                onClick={() => updatePiece(piece.id, (p) => ({ ...p, couleur: key }))}
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: b.hex,
                  border: piece.couleur === key ? "3px solid #1C1917" : "2px solid #E7E5E4",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: getContrastColor(b.hex), fontWeight: 700,
                }}
                title={b.name}
              >
                {piece.couleur === key ? "✓" : ""}
              </button>
            ))}
          </div>
          {/* Editable metadata fields */}
          <div style={{ background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
            {[
              { key: "titre", label: "Titre" },
              { key: "compositeur", label: "Compositeur" },
              { key: "duree", label: "Durée" },
              { key: "salle", label: "Lieu" },
              { key: "chef", label: "Chef" },
              { key: "date", label: "Date" },
              { key: "effectif", label: "Effectif" },
            ].map(f => (
              <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", width: 70, flexShrink: 0 }}>{f.label}</span>
                <input
                  value={piece[f.key] || ""}
                  onChange={(e) => updatePiece(piece.id, (p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.label}
                  style={{
                    flex: 1, fontSize: 12, color: "#1C1917", background: "transparent",
                    border: "none", borderBottom: "1px solid #E7E5E4", padding: "3px 0",
                    fontFamily: f.key === "effectif" ? "monospace" : "inherit", outline: "none",
                  }}
                />
              </div>
            ))}
          </div>

          {/* Plans (PDF rendered images) */}
          {(piece.plans || []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {(piece.plans || []).map((planUrl, idx) => (
                <div key={idx} style={{ marginBottom: 6, borderRadius: 8, overflow: "hidden", border: `2px solid ${col.hex}33`, position: "relative" }}>
                  <img
                    src={planUrl}
                    onClick={() => setFullPhoto({ id: `plan-${idx}`, dataUrl: planUrl })}
                    style={{ width: "100%", display: "block", cursor: "pointer" }}
                    alt={`Plan ${idx + 1}`}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: col.bg, padding: "4px 10px" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: col.hex }}>
                      Plan {(piece.plans || []).length > 1 ? `${idx + 1}/${(piece.plans || []).length}` : ""}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePlan(piece.id, idx); }}
                      style={{ background: "none", border: "none", fontSize: 14, color: "#A8A29E", cursor: "pointer" }}
                      title="Supprimer ce plan"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => handleAddPlan(piece.id)}
              disabled={pdfLoading}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 12, padding: "8px 10px" }}
            >
              {pdfLoading ? "⏳..." : "📄 Ajouter plan"}
            </button>
            <button
              onClick={() => setZoneSelectMode({ pieceId: piece.id, couleur: piece.couleur })}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 12, padding: "8px 10px" }}
            >
              📸 Photo libre
            </button>
          </div>

          {(piece.plans || []).length > 0 && (
            <button onClick={() => handleAiExtract(piece.id)} disabled={aiLoading}
              style={{ ...S.btnSecondary, marginBottom: 14, fontSize: 12, padding: "8px 10px", background: aiLoading ? "#F5F5F4" : "#FFFBEB", borderColor: "#FCD34D", color: "#92400E" }}>
              {aiLoading ? "⏳ Extraction IA en cours..." : "🤖 Extraire les données par IA"}
            </button>
          )}

          {/* Percus with reorder */}
          {piece.percus.map((r, ri) => {
            const isOpen = percuId === r.id;
            const rPhotos = (photos[piece.id] || []).filter((ph) => ph.percuId === r.id);
            const byCat = {};
            r.items.forEach((it, idx) => {
              if (!byCat[it.cat]) byCat[it.cat] = [];
              byCat[it.cat].push({ ...it, _i: idx });
            });

            return (
              <div key={r.id} style={{ marginBottom: 10 }}>
                <div
                  onClick={() => setPercuId(isOpen ? null : r.id)}
                  style={{
                    background: isOpen ? col.bg : "#FAFAF9",
                    border: `1px solid ${isOpen ? col.hex + "44" : "#E7E5E4"}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917" }}>{r.nom}</div>
                      <div style={{ fontSize: 12, color: "#78716C" }}>
                        {(() => {
                          const checkedCount = r.items.filter(it => it.checked).length;
                          const total = r.items.length;
                          if (checkedCount === 0) return `${total} instruments`;
                          if (checkedCount === total) return `${total}/${total} installé${total > 1 ? "s" : ""} ✓`;
                          return `${checkedCount}/${total} installés`;
                        })()}{rPhotos.length > 0 ? ` · ${rPhotos.length} photos` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <DragHandle onMove={(dir) => { if (dir === -1 && ri > 0) movePercu(piece.id, ri, ri - 1); if (dir === 1 && ri < piece.percus.length - 1) movePercu(piece.id, ri, ri + 1); }} />
                      <button onClick={() => { const n = prompt("Renommer :", r.nom); if (n && n.trim()) renamePercu(piece.id, r.id, n.trim()); }} style={{ background: "none", border: "none", fontSize: 12, color: "#A8A29E", cursor: "pointer", padding: "4px" }}>✎</button>
                      <button onClick={() => deletePercu(piece.id, r.id)} style={{ background: "none", border: "none", fontSize: 14, color: "#A8A29E", cursor: "pointer", padding: "4px" }}>✕</button>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "8px 4px 0" }}>
                    {Object.entries(byCat).map(([cat, items]) => {
                      // Sort: unchecked first, checked last
                      const sorted = [...items].sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0));
                      return (
                        <div key={cat}>
                          <div style={S.catLabel(col.hex)}>{cat}</div>
                          {sorted.map((it) => (
                            <EditableItem
                              key={it._i}
                              nom={it.nom}
                              color={col.hex}
                              checked={!!it.checked}
                              onToggle={() => toggleItemCheck(piece.id, r.id, it._i)}
                              onRename={(v) => renameItem(piece.id, r.id, it._i, v)}
                              onDelete={() => deleteItem(piece.id, r.id, it._i)}
                            />
                          ))}
                        </div>
                      );
                    })}

                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button
                        onClick={() => {
                          setPieceId(piece.id);
                          setPercuId(r.id);
                          setScreen("photoSetup");
                        }}
                        style={{ ...S.btnPrimary(col.hex), flex: 1, fontSize: 13, padding: "10px 12px" }}
                      >
                        📸 Photos
                      </button>
                      <button
                        onClick={() => {
                          const nom = prompt("Nom de l'instrument :");
                          if (nom && nom.trim()) addItem(piece.id, r.id, "Accessoires", nom.trim());
                        }}
                        style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px" }}
                      >
                        + Ajouter
                      </button>
                    </div>
                    <button
                      onClick={() => copyToClipboard(generatePercuTxt(piece, r.id))}
                      style={{ ...S.btnSecondary, marginTop: 6, fontSize: 11, padding: "6px 10px" }}
                    >
                      Copier TXT {r.nom}
                    </button>

                    <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4, alignItems: "flex-start" }}>
                      {rPhotos.map((ph) => (
                        <div key={ph.id} style={{ position: "relative", flexShrink: 0 }}>
                          <img src={ph.dataUrl} onClick={() => setFullPhoto(ph)}
                            style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 6, border: `2px solid ${col.hex}`, cursor: "pointer" }}
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm("Supprimer cette photo ?")) deletePhoto(piece.id, ph.id); }}
                            style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#EF4444", border: "none", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                          >✕</button>
                        </div>
                      ))}
                      <button
                        onClick={() => setZoneSelectMode({ pieceId: piece.id, percuId: r.id, couleur: piece.couleur })}
                        style={{ width: 80, height: 60, borderRadius: 6, border: `2px dashed ${col.hex}`, background: "transparent", color: col.hex, fontSize: 22, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Ajouter une photo"
                      >+</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add pole button */}
          <button onClick={() => addPercu(piece.id)} style={{ ...S.btnSecondary, marginTop: 4, fontSize: 12 }}>+ Ajouter un pôle</button>

          {/* Orchestre section — below percus */}
          <div style={{ marginTop: 14, marginBottom: 10 }}>
            {(() => {
              const daniels = calculateDanielsNotation(piece.orchestre, piece.percus);
              const totalMus = calculateTotalMusicians(piece.orchestre);
              return (
                <div
                  onClick={() => setPercuId(percuId === "orchestre" ? null : "orchestre")}
                  style={{
                    background: percuId === "orchestre" ? col.bg : "#FAFAF9",
                    border: `1px solid ${percuId === "orchestre" ? col.hex + "44" : "#E7E5E4"}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917" }}>Orchestre</div>
                        {totalMus > 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: col.hex, background: col.bg, padding: "1px 8px", borderRadius: 10 }}>
                            {totalMus} mus.
                          </span>
                        )}
                      </div>
                      {daniels
                        ? <div style={{ fontSize: 12, color: "#78716C", fontFamily: "monospace", marginTop: 2 }}>{daniels}</div>
                        : piece.effectif
                          ? <div style={{ fontSize: 12, color: "#78716C", fontFamily: "monospace", marginTop: 2 }}>{piece.effectif}</div>
                          : <div style={{ fontSize: 12, color: "#A8A29E", marginTop: 2 }}>{orchCount > 0 ? `${orchCount} pupitres` : "Aucun pupitre"}</div>
                      }
                    </div>
                    <span style={{ color: "#A8A29E" }}>{percuId === "orchestre" ? "▾" : "▸"}</span>
                  </div>
                </div>
              );
            })()}
            {percuId === "orchestre" && (
              <div style={{ padding: "10px 4px 4px" }}>
                {/* Daniels notation banner */}
                {(() => {
                  const daniels = calculateDanielsNotation(piece.orchestre, piece.percus);
                  return daniels ? (
                    <div style={{
                      background: col.bg, border: `1px solid ${col.hex}33`, borderRadius: 8,
                      padding: "8px 12px", marginBottom: 10, display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 8,
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1 }}>Nomenclature Daniels</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917", fontFamily: "monospace", marginTop: 2 }}>{daniels}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updatePiece(piece.id, (p) => recalcDaniels(p));
                        }}
                        style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", padding: "4px", flexShrink: 0 }}
                        title="Recalculer nomenclature"
                      >🔄</button>
                    </div>
                  ) : null;
                })()}
                {[
                  { key: "bois", label: "Bois" },
                  { key: "cuivres", label: "Cuivres" },
                  { key: "cordes", label: "Cordes" },
                  { key: "autres", label: "Autres" },
                ].map(g => {
                  const items = piece.orchestre?.[g.key] || [];
                  return (
                    <div key={g.key} style={{ marginBottom: 8 }}>
                      <div style={S.catLabel(col.hex)}>{g.label}</div>
                      {items.map((item, i) => (
                        <EditableItem
                          key={i}
                          nom={item}
                          color={col.hex}
                          onRename={(v) => renameOrchestreItem(piece.id, g.key, i, v)}
                          onDelete={() => deleteOrchestreItem(piece.id, g.key, i)}
                        />
                      ))}
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button
                          onClick={() => {
                            const nom = prompt(`Ajouter (${g.label}) — ex: "16 Violons I" :`);
                            if (nom && nom.trim()) addOrchestreItem(piece.id, g.key, nom.trim());
                          }}
                          style={{ fontSize: 11, color: col.hex, background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontWeight: 600 }}
                        >
                          + Ajouter
                        </button>
                        {g.key === "cordes" && (
                          <button
                            onClick={() => {
                              const v1Input = prompt("Nombre de Violons I (ex: 14) :");
                              if (!v1Input) return;
                              const v1 = parseInt(v1Input, 10);
                              if (isNaN(v1) || v1 < 0) return;
                              updatePiece(piece.id, (p) => {
                                const orch = p.orchestre || { bois: [], cuivres: [], cordes: [], autres: [] };
                                let cordes = [...(orch.cordes || [])];
                                // Set or update V1
                                const v1Idx = findCordeIndex(cordes, "v1");
                                if (v1Idx >= 0) { cordes[v1Idx] = `${v1} Violons I`; } else { cordes.push(`${v1} Violons I`); }
                                // Apply auto-complete for other strings
                                cordes = applyCordesAutoComplete(cordes, v1);
                                const updated = { ...p, orchestre: { ...orch, cordes } };
                                return recalcDaniels(updated);
                              });
                            }}
                            style={{ fontSize: 11, color: col.hex, background: col.hex + "15", border: `1px solid ${col.hex}33`, borderRadius: 6, cursor: "pointer", padding: "3px 8px", fontWeight: 600 }}
                          >
                            🔄 Ratio standard
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 📦 Mobilier section ── */}
          {piece.orchestre && (() => {
            const mob = piece.mobilier || calculateMobilier(piece.orchestre, piece.percus, { hasChef: !piece.sansChef });
            if (!mob) return null;
            const isMobOpen = percuId === "mobilier";
            const isEditing = mobilierEditing === piece.id;

            // ── Helper: update mobilier from editor ──
            function updateMob(updater) {
              updatePiece(piece.id, (p) => {
                const m = ensureMobilierStructure(p.mobilier || calculateMobilier(p.orchestre, p.percus, { hasChef: !p.sansChef }));
                updater(m);
                return { ...p, mobilier: m };
              });
            }

            // ── Helper: live mobilier text for preview ──
            function getLiveMob() {
              const p = pieces.find(pp => pp.id === piece.id);
              if (!p) return "";
              const m = p.mobilier || calculateMobilier(p.orchestre, p.percus, { hasChef: !p.sansChef });
              return m ? generateMobilierStandaloneText({ ...p, mobilier: m }) : "";
            }

            // ── Stand sections config ──
            const standSections = [
              { key: "cordes", label: "🎻 Cordes" },
              { key: "bois", label: "🎵 Bois" },
              { key: "cuivres", label: "🎺 Cuivres" },
              { key: "percus", label: "🥁 Percussions" },
              { key: "autres", label: "➕ Autres" },
            ];

            return (
              <div style={{ marginTop: 14, marginBottom: 10 }}>
                {/* ── Header toggle card ── */}
                <div
                  onClick={() => { if (!isEditing) setPercuId(isMobOpen ? null : "mobilier"); }}
                  style={{
                    background: isMobOpen ? col.bg : "#FAFAF9",
                    border: `1px solid ${isMobOpen ? col.hex + "44" : "#E7E5E4"}`,
                    borderRadius: 10, padding: "12px 14px", cursor: isEditing ? "default" : "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917" }}>📦 Mobilier</div>
                        {mob._edited && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#D97706", background: "#FFFBEB", border: "1px solid #FCD34D", padding: "1px 6px", borderRadius: 8 }}>✎</span>
                        )}
                        <span style={{ fontSize: 11, fontWeight: 600, color: col.hex, background: col.bg, padding: "1px 8px", borderRadius: 10 }}>
                          {mob.general.pupitres} pup. · {mob.general.chaisesNormales + mob.general.chaisesHautes} ch.
                        </span>
                      </div>
                    </div>
                    <span style={{ color: "#A8A29E" }}>{isMobOpen ? "▾" : "▸"}</span>
                  </div>
                </div>

                {/* ── VIEW MODE (read-only) ── */}
                {isMobOpen && !isEditing && (
                  <div style={{ padding: "10px 4px 4px" }}>
                    {/* MOBILIER GÉNÉRAL */}
                    <div style={{
                      background: col.bg, border: `1px solid ${col.hex}33`, borderRadius: 8,
                      padding: "10px 12px", marginBottom: 10,
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>📦 Mobilier Général</div>
                      <div style={{ fontSize: 13, color: "#1C1917", lineHeight: 1.8 }}>
                        <div>• Pupitres : <strong>{mob.general.pupitres}</strong></div>
                        <div>• Chaises normales : <strong>{mob.general.chaisesNormales}</strong></div>
                        <div>• Chaises hautes : <strong>{mob.general.chaisesHautesDetail || mob.general.chaisesHautes}</strong></div>
                        {(Array.isArray(mob.general.chaisesSpeciales) && mob.general.chaisesSpeciales.filter(s => s.qty > 0).length > 0) ? (
                          <div>• Chaises spéciales : {mob.general.chaisesSpeciales.filter(s => s.qty > 0).map((s, i, arr) => (
                            <span key={i}><strong>{s.type} ({s.qty})</strong>{i < arr.length - 1 ? ', ' : ''}</span>
                          ))}</div>
                        ) : (typeof mob.general.chaisesSpeciales === 'number' && mob.general.chaisesSpeciales > 0) ? (
                          <div>• Chaises timbalier : <strong>{mob.general.chaisesSpeciales}</strong></div>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const backup = JSON.parse(JSON.stringify(mob));
                            setMobilierBackup(backup);
                            setMobilierEditing(piece.id);
                          }}
                          style={{ fontSize: 11, background: col.hex + "20", border: `1px solid ${col.hex}44`, borderRadius: 6, cursor: "pointer", padding: "4px 12px", fontWeight: 600, color: col.hex }}
                        >✎ Modifier</button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updatePiece(piece.id, (p) => recalcDaniels({ ...p, mobilier: { ...p.mobilier, _edited: false } }));
                          }}
                          style={{ fontSize: 11, background: col.hex + "10", border: `1px solid ${col.hex}33`, borderRadius: 6, cursor: "pointer", padding: "4px 10px", fontWeight: 600, color: col.hex }}
                        >🔄 Recalculer</button>
                      </div>
                    </div>

                    {/* STANDS PAR SECTION */}
                    {standSections.map(section => {
                      const items = mob.stands[section.key] || [];
                      return (
                        <div key={section.key} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: col.hex, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{section.label}</div>
                          {items.filter(s => s.qty > 0).map((stand, idx) => (
                            <div key={idx} style={{ fontSize: 13, color: "#44403C", paddingLeft: 8, lineHeight: 1.7 }}>
                              • {stand.type} : <strong>{stand.qty}</strong>
                            </div>
                          ))}
                          {items.filter(s => s.qty > 0).length === 0 && (
                            <div style={{ fontSize: 12, color: "#A8A29E", paddingLeft: 8, fontStyle: "italic" }}>Aucun</div>
                          )}
                        </div>
                      );
                    })}

                    {/* Custom autres stands */}
                    {(mob.stands.autresCustom || []).filter(s => s.qty > 0).length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: col.hex, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>🔧 Personnalisé</div>
                        {(mob.stands.autresCustom || []).filter(s => s.qty > 0).map((item, idx) => (
                          <div key={`custom-v-${idx}`} style={{ fontSize: 13, color: "#44403C", paddingLeft: 8, lineHeight: 1.7, display: "flex", alignItems: "center", gap: 6 }}>
                            • {item.type} : <strong>{item.qty}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── EDIT MODE ── */}
                {isMobOpen && isEditing && (() => {
                  const editMob = piece.mobilier || ensureMobilierStructure(calculateMobilier(piece.orchestre, piece.percus, { hasChef: !piece.sansChef }));
                  const liveText = generateMobilierStandaloneText({ ...piece, mobilier: editMob });

                  return (
                    <div style={{
                      padding: "10px 4px 4px",
                      background: "#FFFBEB",
                      border: `2px solid #FCD34D`,
                      borderRadius: 10,
                      marginTop: 6,
                    }}>
                      {/* Warning banner */}
                      <div style={{
                        fontSize: 11, fontWeight: 600, color: "#92400E",
                        background: "#FEF3C7", borderRadius: 6, padding: "6px 10px",
                        marginBottom: 10, display: "flex", alignItems: "center", gap: 6,
                      }}>
                        ✏️ Édition manuelle — ces valeurs ne seront plus recalculées automatiquement
                      </div>

                      {/* GENERAL */}
                      <div style={{
                        background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8,
                        padding: "10px 12px", marginBottom: 8,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Général</div>
                        {[
                          { key: "pupitres", label: "Pupitres" },
                          { key: "chaisesNormales", label: "Chaises normales" },
                          { key: "chaisesHautes", label: "Chaises hautes" },
                        ].map(field => (
                          <div key={field.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "#44403C" }}>{field.label}</span>
                            <input
                              type="number"
                              min="0"
                              value={editMob.general[field.key] || 0}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10) || 0;
                                updateMob(m => { m.general[field.key] = val; });
                              }}
                              style={{
                                width: 70, fontSize: 13, fontWeight: 600, padding: "4px 8px",
                                border: `1px solid ${col.hex}44`, borderRadius: 6, textAlign: "center",
                                background: "#fff", color: "#1C1917", outline: "none",
                              }}
                            />
                          </div>
                        ))}
                        {/* Chaises hautes detail (text) */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ fontSize: 11, color: "#A8A29E" }}>Détail chaises hautes</span>
                          <input
                            type="text"
                            value={editMob.general.chaisesHautesDetail || ""}
                            onChange={(e) => updateMob(m => { m.general.chaisesHautesDetail = e.target.value; })}
                            placeholder="ex: 3 (CB) + 1 (chef) + 2 (percus) = 6"
                            style={{
                              width: 180, fontSize: 11, padding: "3px 6px",
                              border: `1px solid ${col.hex}22`, borderRadius: 4,
                              background: "#FAFAF9", color: "#78716C", outline: "none",
                            }}
                          />
                        </div>
                      </div>

                      {/* Chaises spéciales (editable list) */}
                      <div style={{
                        background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8,
                        padding: "10px 12px", marginBottom: 8,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1 }}>🪑 Chaises spéciales</div>
                          <button
                            onClick={() => updateMob(m => {
                              if (!Array.isArray(m.general.chaisesSpeciales)) m.general.chaisesSpeciales = [];
                              m.general.chaisesSpeciales = [...m.general.chaisesSpeciales, { type: "Nouveau type", qty: 1 }];
                            })}
                            style={{ fontSize: 16, fontWeight: 700, background: col.hex + "15", border: `1px solid ${col.hex}33`, borderRadius: 6, cursor: "pointer", padding: "2px 8px", color: col.hex, lineHeight: 1 }}
                          >+</button>
                        </div>
                        {(() => {
                          const items = Array.isArray(editMob.general.chaisesSpeciales) ? editMob.general.chaisesSpeciales : [];
                          if (items.length === 0) return (
                            <div style={{ fontSize: 11, color: "#A8A29E", fontStyle: "italic", padding: "4px 0" }}>Aucune chaise spéciale — ajoutez des types (Tabouret piano, Chaise australienne, Chaise timbalier...)</div>
                          );
                          return items.map((item, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <input
                                type="text"
                                value={item.type}
                                onChange={(e) => updateMob(m => {
                                  if (!Array.isArray(m.general.chaisesSpeciales)) return;
                                  m.general.chaisesSpeciales[idx].type = e.target.value;
                                })}
                                style={{
                                  flex: 1, fontSize: 12, padding: "4px 8px",
                                  border: `1px solid ${col.hex}22`, borderRadius: 6,
                                  background: "#FAFAF9", color: "#1C1917", outline: "none",
                                }}
                              />
                              <span style={{ fontSize: 11, color: "#A8A29E" }}>×</span>
                              <input
                                type="number"
                                min="0"
                                value={item.qty}
                                onChange={(e) => updateMob(m => {
                                  if (!Array.isArray(m.general.chaisesSpeciales)) return;
                                  m.general.chaisesSpeciales[idx].qty = parseInt(e.target.value, 10) || 0;
                                })}
                                style={{
                                  width: 55, fontSize: 13, fontWeight: 600, padding: "4px 6px",
                                  border: `1px solid ${col.hex}44`, borderRadius: 6, textAlign: "center",
                                  background: "#fff", color: "#1C1917", outline: "none",
                                }}
                              />
                              <button
                                onClick={() => updateMob(m => {
                                  if (!Array.isArray(m.general.chaisesSpeciales)) return;
                                  m.general.chaisesSpeciales = m.general.chaisesSpeciales.filter((_, i) => i !== idx);
                                })}
                                style={{ background: "none", border: "none", fontSize: 14, color: "#EF4444", cursor: "pointer", padding: "2px 4px" }}
                              >✕</button>
                            </div>
                          ));
                        })()}
                      </div>

                      {/* STANDS PAR SECTION (editable) */}
                      {standSections.map(section => {
                        const items = editMob.stands[section.key] || [];
                        // Show all items (even qty=0) in edit mode — no fallback: user can delete everything
                        const allItems = items;
                        return (
                          <div key={section.key} style={{
                            background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8,
                            padding: "10px 12px", marginBottom: 8,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: col.hex, textTransform: "uppercase", letterSpacing: 1 }}>{section.label}</div>
                              <button
                                onClick={() => updateMob(m => {
                                  m.stands[section.key] = [...(m.stands[section.key] || []), { type: "Nouveau stand", qty: 1 }];
                                })}
                                style={{ fontSize: 16, fontWeight: 700, background: col.hex + "15", border: `1px solid ${col.hex}33`, borderRadius: 6, cursor: "pointer", padding: "2px 8px", color: col.hex, lineHeight: 1 }}
                              >+</button>
                            </div>
                            {allItems.map((stand, idx) => (
                              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                <input
                                  type="text"
                                  value={stand.type}
                                  onChange={(e) => updateMob(m => { m.stands[section.key][idx].type = e.target.value; })}
                                  style={{
                                    flex: 1, fontSize: 12, padding: "4px 8px",
                                    border: `1px solid ${col.hex}22`, borderRadius: 6,
                                    background: "#FAFAF9", color: "#1C1917", outline: "none",
                                  }}
                                />
                                <span style={{ fontSize: 11, color: "#A8A29E" }}>×</span>
                                <input
                                  type="number"
                                  min="0"
                                  value={stand.qty}
                                  onChange={(e) => updateMob(m => { m.stands[section.key][idx].qty = parseInt(e.target.value, 10) || 0; })}
                                  style={{
                                    width: 55, fontSize: 13, fontWeight: 600, padding: "4px 6px",
                                    border: `1px solid ${col.hex}44`, borderRadius: 6, textAlign: "center",
                                    background: "#fff", color: "#1C1917", outline: "none",
                                  }}
                                />
                                <button
                                  onClick={() => updateMob(m => {
                                    m.stands[section.key] = m.stands[section.key].filter((_, i) => i !== idx);
                                  })}
                                  style={{ background: "none", border: "none", fontSize: 14, color: "#EF4444", cursor: "pointer", padding: "2px 4px" }}
                                >✕</button>
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      {/* Custom autres */}
                      <div style={{
                        background: "#fff", border: "1px solid #E7E5E4", borderRadius: 8,
                        padding: "10px 12px", marginBottom: 8,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: col.hex, textTransform: "uppercase", letterSpacing: 1 }}>🔧 Personnalisé</div>
                          <button
                            onClick={() => updateMob(m => {
                              m.stands.autresCustom = [...(m.stands.autresCustom || []), { type: "Élément", qty: 1 }];
                            })}
                            style={{ fontSize: 16, fontWeight: 700, background: col.hex + "15", border: `1px solid ${col.hex}33`, borderRadius: 6, cursor: "pointer", padding: "2px 8px", color: col.hex, lineHeight: 1 }}
                          >+</button>
                        </div>
                        {(editMob.stands.autresCustom || []).map((item, idx) => (
                          <div key={`custom-e-${idx}`} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <input
                              type="text"
                              value={item.type}
                              onChange={(e) => updateMob(m => { m.stands.autresCustom[idx].type = e.target.value; })}
                              style={{
                                flex: 1, fontSize: 12, padding: "4px 8px",
                                border: `1px solid ${col.hex}22`, borderRadius: 6,
                                background: "#FAFAF9", color: "#1C1917", outline: "none",
                              }}
                            />
                            <span style={{ fontSize: 11, color: "#A8A29E" }}>×</span>
                            <input
                              type="number"
                              min="0"
                              value={item.qty}
                              onChange={(e) => updateMob(m => { m.stands.autresCustom[idx].qty = parseInt(e.target.value, 10) || 0; })}
                              style={{
                                width: 55, fontSize: 13, fontWeight: 600, padding: "4px 6px",
                                border: `1px solid ${col.hex}44`, borderRadius: 6, textAlign: "center",
                                background: "#fff", color: "#1C1917", outline: "none",
                              }}
                            />
                            <button
                              onClick={() => updateMob(m => {
                                m.stands.autresCustom = m.stands.autresCustom.filter((_, i) => i !== idx);
                              })}
                              style={{ background: "none", border: "none", fontSize: 14, color: "#EF4444", cursor: "pointer", padding: "2px 4px" }}
                            >✕</button>
                          </div>
                        ))}
                      </div>

                      {/* LIVE PREVIEW */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>👁 Aperçu TXT</div>
                        <pre style={{
                          fontSize: 10, color: "#44403C", background: "#fff",
                          border: "1px solid #E7E5E4", borderRadius: 8, padding: 8,
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                          fontFamily: "'DM Mono', 'Courier New', monospace", lineHeight: 1.4,
                          maxHeight: 120, overflowY: "auto", margin: 0,
                        }}>
                          {liveText}
                        </pre>
                      </div>

                      {/* ACTION BAR */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => {
                            updateMob(m => { m._edited = true; });
                            setMobilierEditing(null);
                            setMobilierBackup(null);
                          }}
                          style={{ flex: 1, minWidth: 90, fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: "#16A34A", color: "#fff", border: "none", cursor: "pointer" }}
                        >✅ Enregistrer</button>
                        <button
                          onClick={() => {
                            // Force recalc: remove _edited, recalculate mobilier
                            updatePiece(piece.id, (p) => {
                              const newMob = calculateMobilier(p.orchestre, p.percus, { hasChef: !p.sansChef });
                              if (newMob) newMob._edited = false;
                              return { ...p, mobilier: newMob };
                            });
                            setMobilierEditing(null);
                            setMobilierBackup(null);
                          }}
                          style={{ flex: 1, minWidth: 90, fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: col.hex + "20", color: col.hex, border: `1px solid ${col.hex}44`, cursor: "pointer" }}
                        >🔄 Recalculer</button>
                        <button
                          onClick={() => {
                            // Restore backup
                            if (mobilierBackup) {
                              updatePiece(piece.id, (p) => ({ ...p, mobilier: mobilierBackup }));
                            }
                            setMobilierEditing(null);
                            setMobilierBackup(null);
                          }}
                          style={{ flex: 1, minWidth: 90, fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: "#fff", color: "#78716C", border: "1px solid #D6D3D1", cursor: "pointer" }}
                        >❌ Annuler</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* ── 📋 Texte de la pièce (3 sections : Orchestre + Mobilier + Percussions) ── */}
          <div style={{ marginTop: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#78716C", textTransform: "uppercase", marginBottom: 6 }}>📋 Texte de la pièce</div>
            <pre style={{
              fontSize: 11, color: "#1C1917", background: "#FAFAF9", border: "1px solid #E7E5E4",
              borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "'DM Mono', 'Courier New', monospace", lineHeight: 1.5,
              maxHeight: "40vh", overflowY: "auto",
            }}>
              {generatePieceText(piece)}
            </pre>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={() => copyToClipboard(generatePieceText(piece))} style={{ ...S.btnSecondary, flex: 1, fontSize: 11 }}>📋 Copier texte</button>
              <button onClick={() => downloadTxt(piece)} style={{ ...S.btnSecondary, flex: 1, fontSize: 11 }}>↓ Télécharger TXT</button>
              <button onClick={() => downloadMobilierTxt(piece)} style={{ ...S.btnSecondary, flex: 1, fontSize: 11 }}>📦 Mobilier seul</button>
            </div>
          </div>

          {/* Notes */}
          <textarea
            value={piece.notes || ""}
            onChange={(e) => updatePiece(piece.id, (p) => ({ ...p, notes: e.target.value }))}
            placeholder="Notes..."
            style={{
              width: "100%", minHeight: 80, marginTop: 14, padding: 10, fontSize: 13,
              border: "1px solid #E7E5E4", borderRadius: 8, background: "#FAFAF9",
              color: "#1C1917", fontFamily: "'DM Sans', sans-serif", resize: "vertical",
              outline: "none",
            }}
          />

          <button onClick={() => goTxt(piece.id)} style={{ ...S.btnSecondary, marginTop: 10 }}>☰ Liste TXT</button>
          {(photos[piece.id] || []).length > 0 && (
            <button onClick={() => setShowPhotoDownload("piece")} style={{ ...S.btnSecondary, marginTop: 6 }}>📥 Télécharger photos</button>
          )}
        </div>
        <NavBar active="pieces" onPieces={goHome} onPhotos={() => goGallery(pieceId)} onTxt={() => { setPieceId(pieceId); setScreen("txt"); }} />
        {fullPhoto && <Lightbox photo={fullPhoto} photos={photos[piece.id] || []} pieces={pieces} onClose={() => setFullPhoto(null)} onDelete={() => { deletePhoto(fullPhoto.pieceId, fullPhoto.id); setFullPhoto(null); }} onNavigate={(ph) => setFullPhoto(ph)} />}
        {showPhotoDownload === "piece" && piece && (
          <PhotoDownloadPieceModal piece={piece} piecePhotos={photos[piece.id] || []} onClose={() => setShowPhotoDownload(null)} />
        )}
      </div>
    );
  }

  // ════════════════════════════════
  // PHOTO SETUP
  // ════════════════════════════════
  if (screen === "photoSetup" && piece && percu) {
    const col = BARNIER[piece.couleur];
    return (
      <PhotoSetupView
        piece={piece}
        percu={percu}
        col={col}
        existingPhotos={photos[piece.id] || []}
        onStart={(zones) => {
          setCapture({ pieceId: piece.id, percuId: percu.id, zones, currentZone: 0, couleur: piece.couleur });
        }}
        onSelectExisting={(selectedPhotos) => {
          // Re-tag selected photos with current percu context and add as new entries
          const zoneNames = ["Jardin", "Milieu", "Cour"];
          selectedPhotos.forEach((photo, idx) => {
            const newPhoto = {
              ...photo,
              id: uid(),
              percuId: percu.id,
              zone: photo.zone || zoneNames[idx % zoneNames.length] || "Photo",
              num: idx + 1,
              total: selectedPhotos.length,
            };
            addPhoto(piece.id, newPhoto);
          });
          setScreen("gallery");
        }}
        onBack={() => setScreen("piece")}
      />
    );
  }

  // ════════════════════════════════
  // GALLERY
  // ════════════════════════════════
  if (screen === "gallery") {
    const allPhotos = pieceId ? (photos[pieceId] || []) : Object.values(photos).flat();
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => (pieceId ? goPiece(pieceId) : goHome())} style={S.backBtn}>←</button>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Galerie</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>
                {pieceId ? piece?.titre : "Toutes les pièces"} · {allPhotos.length} photo{allPhotos.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
        <div style={S.body}>
          {!pieceId && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
              <FilterBtn label="Toutes" active={galleryFilter === "all"} onClick={() => setGalleryFilter("all")} />
              {pieces.map((p) => (
                <FilterBtn key={p.id} label={p.titre} color={BARNIER[p.couleur].hex} active={galleryFilter === p.id} onClick={() => setGalleryFilter(p.id)} />
              ))}
            </div>
          )}
          {pieceId && (
            <button
              onClick={() => setZoneSelectMode({ pieceId, couleur: piece?.couleur || "blanc" })}
              style={{ ...S.btnPrimary(BARNIER[piece?.couleur || "blanc"].hex), marginBottom: 12, fontSize: 13 }}
            >
              📸 Ajouter une photo
            </button>
          )}
          {allPhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#A8A29E" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 14 }}>Aucune photo</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Utilisez le bouton ci-dessus ou ouvrez un pôle percu</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {allPhotos.filter((ph) => galleryFilter === "all" || ph.pieceId === galleryFilter || pieceId).map((ph) => {
                const col = BARNIER[ph.couleur];
                return (
                  <div key={ph.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `2px solid ${col.hex}`, cursor: "pointer", aspectRatio: "4/3" }}>
                    <img src={ph.dataUrl} onClick={() => setFullPhoto(ph)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm("Supprimer cette photo ?")) deletePhoto(ph.pieceId, ph.id); }}
                      style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%", background: "rgba(239,68,68,0.9)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}
                    >✕</button>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,.7))", padding: "12px 8px 6px" }}>
                      <div style={{ fontSize: 10, color: col.hex, fontWeight: 700 }}>{pieces.find((x) => x.id === ph.pieceId)?.titre}</div>
                      <div style={{ fontSize: 11, color: "#E7E5E4" }}>{ph.zone} · {ph.num}/{ph.total}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <NavBar active="photos" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => goTxt(pieces[0]?.id)} />
        {fullPhoto && <Lightbox photo={fullPhoto} photos={allPhotos.filter((ph) => galleryFilter === "all" || ph.pieceId === galleryFilter || pieceId)} pieces={pieces} onClose={() => setFullPhoto(null)} onDelete={() => { deletePhoto(fullPhoto.pieceId, fullPhoto.id); setFullPhoto(null); }} onNavigate={(ph) => setFullPhoto(ph)} />}
      </div>
    );
  }

  // ════════════════════════════════
  // TXT — full concert or single piece
  // ════════════════════════════════
  if (screen === "txt") {
    // No pieceId → full concert TXT (all pieces)
    if (!pieceId && concert) {
      const allTxt = pieces.map(p => generateTxt(p)).join("\n\n");
      const fullTxt = allTxt + (concert.notes ? "\n\n" + "=".repeat(50) + "\n  NOTES\n" + "=".repeat(50) + "\n" + concert.notes : "");
      return (
        <div style={S.shell}>
          <div style={S.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={goHome} style={S.backBtn}>←</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Liste matériel complète</div>
                <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{concert.titre}</div>
              </div>
            </div>
          </div>
          <div style={S.body}>
            <pre style={{ fontSize: 12, color: "#1C1917", background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'DM Sans', monospace", lineHeight: 1.6, maxHeight: "60vh", overflowY: "auto" }}>
              {fullTxt}
            </pre>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={() => { const blob = new Blob([fullTxt], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = concert.titre.replace(/\s+/g, "_") + "_complet.txt"; a.click(); }} style={{ ...S.btnPrimary("#1C1917"), flex: 1 }}>↓ Télécharger</button>
              <button onClick={() => copyToClipboard(fullTxt)} style={{ ...S.btnSecondary, flex: 1 }}>Copier</button>
            </div>
          </div>
          <NavBar active="txt" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => { setPieceId(null); setScreen("txt"); }} />
        </div>
      );
    }

    // Single piece TXT
    const tp = piece || pieces[0];
    if (!tp) return null;
    const col = BARNIER[tp.couleur];
    const pieceTxt = generateTxt(tp) + (tp.notes ? "\n\nNotes : " + tp.notes : "");
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, borderBottom: `3px solid ${col.hex}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => goPiece(tp.id)} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Liste matériel</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{tp.titre}</div>
            </div>
            <span style={{ ...S.badge, background: col.bg, color: col.hex }}>{col.name}</span>
          </div>
        </div>
        <div style={S.body}>
          {/* Piece selector tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
            {pieces.map((p) => {
              const c = BARNIER[p.couleur];
              return <FilterBtn key={p.id} label={p.titre} color={c.hex} active={p.id === tp.id} onClick={() => setPieceId(p.id)} />;
            })}
          </div>

          <pre style={{ fontSize: 12, color: "#1C1917", background: "#FAFAF9", border: "1px solid #E7E5E4", borderRadius: 8, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'DM Sans', monospace", lineHeight: 1.6, maxHeight: "60vh", overflowY: "auto" }}>
            {pieceTxt}
          </pre>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => downloadTxt(tp)} style={{ ...S.btnPrimary(col.hex), flex: 1 }}>↓ Télécharger</button>
            <button onClick={() => copyToClipboard(pieceTxt)} style={{ ...S.btnSecondary, flex: 1 }}>Copier</button>
          </div>
        </div>
        <NavBar active="txt" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => { setPieceId(null); setScreen("txt"); }} />
      </div>
    );
  }

  return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Chargement...</div>;
}

// ════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════

/** Long-press drag handle: tap shows ▲▼, long press + vertical drag reorders */
function DragHandle({ onMove }) {
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef(null);
  const startY = useRef(0);
  const moved = useRef(false);

  function handleTouchStart(e) {
    startY.current = e.touches[0].clientY;
    moved.current = false;
    timerRef.current = setTimeout(() => {
      setExpanded(true);
    }, 300);
  }

  function handleTouchMove(e) {
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dy) > 30) {
      clearTimeout(timerRef.current);
      onMove(dy < 0 ? -1 : 1);
      startY.current = e.touches[0].clientY;
      moved.current = true;
    }
  }

  function handleTouchEnd() {
    clearTimeout(timerRef.current);
    if (!moved.current && !expanded) {
      setExpanded((v) => !v);
    }
    if (expanded) {
      setTimeout(() => setExpanded(false), 2000);
    }
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", touchAction: "none", userSelect: "none", cursor: "grab", padding: "2px 4px" }}
    >
      {expanded ? (
        <>
          <button onClick={() => { onMove(-1); }} style={{ background: "none", border: "none", fontSize: 12, color: "#A8A29E", cursor: "pointer", padding: "2px" }}>▲</button>
          <button onClick={() => { onMove(1); }} style={{ background: "none", border: "none", fontSize: 12, color: "#A8A29E", cursor: "pointer", padding: "2px" }}>▼</button>
        </>
      ) : (
        <span style={{ fontSize: 16, color: "#A8A29E", lineHeight: 1 }}>≡</span>
      )}
    </div>
  );
}

function NavBar({ active, onPieces, onPhotos, onTxt }) {
  return (
    <div style={S.nav}>
      <button style={S.navBtn(active === "pieces")} onClick={onPieces}><span style={{ fontSize: 18 }}>♫</span>Pièces</button>
      <button style={S.navBtn(active === "photos")} onClick={onPhotos}><span style={{ fontSize: 18 }}>📷</span>Photos</button>
      <button style={S.navBtn(active === "txt")} onClick={onTxt}><span style={{ fontSize: 18 }}>☰</span>TXT</button>
    </div>
  );
}

function FilterBtn({ label, color, active, onClick }) {
  const bg = active ? (color || "#2563EB") : "#E7E5E4";
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: bg,
      color: active ? getContrastColor(bg) : "#78716C",
      border: "none", cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  );
}

function EditableItem({ nom, color, onRename, onDelete, checked, onToggle }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nom);

  useEffect(() => {
    setValue(nom);
  }, [nom]);

  if (editing) {
    return (
      <div style={S.itemRow}>
        {onToggle && <CheckBox checked={checked} color={color} onToggle={onToggle} />}
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim()) onRename(value.trim()); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (value.trim()) onRename(value.trim()); setEditing(false); }
            if (e.key === "Escape") { setValue(nom); setEditing(false); }
          }}
          style={{ ...S.itemInput(color), flex: 1 }} />
        <button onClick={onDelete} style={S.deleteBtn}>×</button>
      </div>
    );
  }
  return (
    <div style={S.itemRow}>
      {onToggle && <CheckBox checked={checked} color={color} onToggle={onToggle} />}
      <div style={{ ...S.itemText(color), flex: 1, textDecoration: checked ? "line-through" : "none", opacity: checked ? 0.5 : 1 }} onClick={() => setEditing(true)}>{nom}</div>
      <button onClick={onDelete} style={S.deleteBtn}>×</button>
    </div>
  );
}

function CheckBox({ checked, color, onToggle }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
        border: `2px solid ${checked ? color : "#D6D3D1"}`,
        background: checked ? color : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", marginRight: 6, transition: "all 0.15s",
      }}
    >
      {checked && <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>}
    </div>
  );
}

function Lightbox({ photo, photos, pieces, onClose, onDelete, onNavigate }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const lastTouch = useRef({});
  const lastDist = useRef(0);
  const dragging = useRef(false);
  const swipeStart = useRef(null);

  // Reset zoom when photo changes
  useEffect(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, [photo?.id]);

  // Navigation: find current index in photos array
  const currentIdx = photos ? photos.findIndex((p) => p.id === photo.id) : -1;
  const hasPrev = currentIdx > 0;
  const hasNext = photos && currentIdx < photos.length - 1;

  function goPrev(e) {
    if (e) e.stopPropagation();
    if (hasPrev && onNavigate) onNavigate(photos[currentIdx - 1]);
  }
  function goNext(e) {
    if (e) e.stopPropagation();
    if (hasNext && onNavigate) onNavigate(photos[currentIdx + 1]);
  }

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIdx, photos]);

  // Download with baked watermark (current color)
  async function handleDownload(e) {
    e.stopPropagation();
    const piece = pieces?.find((p) => p.id === photo.pieceId);
    const col = BARNIER[piece?.couleur || photo.couleur || "blanc"] || BARNIER.blanc;
    const percu = piece?.percus?.find((r) => r.id === photo.percuId);
    const wmOpts = {
      titre: piece?.titre || "",
      percuNom: percu?.nom || "",
      zone: photo.zone || "",
      num: photo.num || 1,
      total: photo.total || 1,
      couleur: col,
    };
    const exportUrl = await bakeWatermark(photo.dataUrl, wmOpts);
    const a = document.createElement("a");
    a.href = exportUrl;
    a.download = `photo_${photo.zone || "libre"}_${photo.id}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function dist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      lastDist.current = dist(e.touches);
      swipeStart.current = null;
    } else if (e.touches.length === 1) {
      dragging.current = true;
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      // Track swipe start for navigation (only when not zoomed)
      if (scale <= 1) {
        swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      // Pinch zoom
      const d = dist(e.touches);
      if (lastDist.current > 0) {
        const ratio = d / lastDist.current;
        setScale((s) => Math.min(Math.max(s * ratio, 0.5), 8));
      }
      lastDist.current = d;
      dragging.current = false;
      swipeStart.current = null;
    } else if (e.touches.length === 1 && dragging.current && scale > 1) {
      // Pan (only when zoomed in)
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      setPos((p) => ({ x: p.x + dx, y: p.y + dy }));
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  function onTouchEnd(e) {
    // Detect horizontal swipe for navigation (only when not zoomed)
    if (swipeStart.current && scale <= 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - swipeStart.current.x;
      const dy = e.changedTouches[0].clientY - swipeStart.current.y;
      const dt = Date.now() - swipeStart.current.time;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 500) {
        if (dx > 0 && hasPrev) { goPrev(); swipeStart.current = null; lastDist.current = 0; dragging.current = false; return; }
        if (dx < 0 && hasNext) { goNext(); swipeStart.current = null; lastDist.current = 0; dragging.current = false; return; }
      }
    }
    swipeStart.current = null;
    lastDist.current = 0;
    dragging.current = false;
  }

  // Double-tap to toggle zoom
  const lastTap = useRef(0);
  function onDoubleTap(e) {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      e.preventDefault();
      if (scale > 1.5) {
        setScale(1);
        setPos({ x: 0, y: 0 });
      } else {
        setScale(3);
      }
    }
    lastTap.current = now;
  }

  const navBtnStyle = {
    position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 100,
    background: "rgba(0,0,0,0.45)", border: "none", borderRadius: "50%",
    width: 44, height: 44, color: "#fff", fontSize: 22, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(4px)",
  };

  return (
    <div
      style={{ ...S.overlay, touchAction: "none", overflow: "hidden" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onDoubleTap}
    >
      {/* Close button */}
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{
        position: "absolute", top: 16, right: 16, zIndex: 100,
        background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%",
        width: 40, height: 40, color: "#fff", fontSize: 20, cursor: "pointer",
      }}>✕</button>

      {/* Counter */}
      {photos && photos.length > 1 && (
        <div style={{
          position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 100,
          background: "rgba(0,0,0,0.5)", borderRadius: 12, padding: "4px 14px",
          color: "#fff", fontSize: 14, fontWeight: 600, backdropFilter: "blur(4px)",
        }}>
          {currentIdx + 1} / {photos.length}
        </div>
      )}

      {/* Prev button */}
      {hasPrev && (
        <button onClick={goPrev} style={{ ...navBtnStyle, left: 12 }}>‹</button>
      )}

      {/* Next button */}
      {hasNext && (
        <button onClick={goNext} style={{ ...navBtnStyle, right: 12 }}>›</button>
      )}

      {/* Photo with dynamic watermark overlay */}
      <div style={{ position: "relative", maxWidth: "100vw", maxHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          position: "relative",
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transition: dragging.current ? "none" : "transform 0.1s",
        }}>
          <img
            src={photo.dataUrl}
            style={{
              maxWidth: "100vw", maxHeight: "100vh", objectFit: "contain",
              userSelect: "none", WebkitUserSelect: "none", display: "block",
            }}
            draggable={false}
          />
          {/* Dynamic watermark overlay — follows current piece color */}
          {scale <= 1.5 && <WatermarkOverlay photo={photo} pieces={pieces} />}
        </div>
      </div>

      <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, display: "flex", gap: 10, justifyContent: "center", zIndex: 100 }}>
        <button onClick={handleDownload} style={{ background: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          ↓ Télécharger
        </button>
        {onDelete && (
          <button onClick={(e) => { e.stopPropagation(); if (confirm("Supprimer cette photo ?")) onDelete(); }} style={{ background: "#EF4444", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer" }}>
            🗑 Supprimer
          </button>
        )}
        {scale !== 1 && (
          <button onClick={(e) => { e.stopPropagation(); setScale(1); setPos({ x: 0, y: 0 }); }} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "10px 20px", fontSize: 14, color: "#fff", cursor: "pointer" }}>
            Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════
// STANDALONE CAMERA
// ════════════════════════════════
function ZoneSelectView({ piece, percu, col, onSelect, onImport, onCancel }) {
  const [zone, setZone] = useState("");
  const defaultZones = ["Cour", "Jardin", "Centre", "Détail", "Devant", "Derrière", "Pôle complet", "Ensemble"];

  async function handleImportWithZone(selectedZone) {
    const dataUrl = await importImageFile();
    if (dataUrl && onImport) onImport(selectedZone, dataUrl);
  }

  const [importMode, setImportMode] = useState(false);

  return (
    <div style={{ background: "#F5F5F4", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
      <div style={{ background: col.hex, padding: "14px 16px", color: getContrastColor(col.hex), flexShrink: 0 }}>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {piece?.titre}{percu ? ` — ${percu.nom}` : ""}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{importMode ? "📁 Importer — Quelle zone ?" : "📸 Quelle zone ?"}</div>
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
        {/* Mode toggle: Camera vs Import */}
        {onImport && (
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={() => setImportMode(false)}
              style={{
                flex: 1, padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: !importMode ? col.hex : "#fff",
                color: !importMode ? "#fff" : col.hex,
                border: `2px solid ${col.hex}`, cursor: "pointer",
              }}
            >
              📸 Caméra
            </button>
            <button
              onClick={() => setImportMode(true)}
              style={{
                flex: 1, padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: importMode ? col.hex : "#fff",
                color: importMode ? "#fff" : col.hex,
                border: `2px solid ${col.hex}`, cursor: "pointer",
              }}
            >
              📁 Importer fichier
            </button>
          </div>
        )}

        <div style={{ fontSize: 13, color: "#78716C", marginBottom: 12 }}>
          {importMode ? "Choisissez la zone, puis sélectionnez un fichier image :" : "Sélectionnez ou saisissez la zone de la photo :"}
        </div>

        {/* Quick zone buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {defaultZones.map((z) => (
            <button
              key={z}
              onClick={() => importMode ? handleImportWithZone(z) : onSelect(z)}
              style={{
                padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: "#fff", border: `2px solid ${col.hex}`, color: col.hex,
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              {z}
            </button>
          ))}
        </div>

        {/* Custom zone input */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#78716C", marginBottom: 6, fontWeight: 600 }}>Ou saisir une zone personnalisée :</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder="Ex: Fond de scène..."
              onKeyDown={(e) => { if (e.key === "Enter" && zone.trim()) { importMode ? handleImportWithZone(zone.trim()) : onSelect(zone.trim()); } }}
              style={{
                flex: 1, padding: "12px 14px", fontSize: 14, borderRadius: 10,
                border: `2px solid ${col.hex}44`, background: "#fff", color: "#1C1917",
                fontFamily: "'DM Sans', sans-serif", outline: "none",
              }}
            />
            <button
              disabled={!zone.trim()}
              onClick={() => importMode ? handleImportWithZone(zone.trim()) : onSelect(zone.trim())}
              style={{
                padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: zone.trim() ? col.hex : "#E7E5E4",
                color: zone.trim() ? "#fff" : "#A8A29E",
                border: "none", cursor: zone.trim() ? "pointer" : "default",
              }}
            >
              Valider
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{
            width: "100%", padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 500,
            background: "none", border: "1px solid #D6D3D1", color: "#78716C", cursor: "pointer",
          }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

function StandaloneCamera({ onCapture, onCancel, couleur, watermark }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const col = BARNIER[couleur] || BARNIER.blanc;

  async function handleImportFile() {
    const dataUrl = await importImageFile();
    if (dataUrl) setPreview(dataUrl);
  }

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (mounted && videoRef.current) {
          streamRef.current = stream;
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        alert("Impossible d'accéder à la caméra. Vérifiez les permissions. (" + e.message + ")");
      }
    }
    startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    ctx.drawImage(video, 0, 0);

    // Store raw image without baked watermark
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(dataUrl);
  }

  function handleValidate() {
    stopCamera();
    onCapture(preview);
  }

  async function handleDownload() {
    if (!preview) return;
    let exportUrl = preview;
    if (watermark) {
      exportUrl = await bakeWatermark(preview, {
        titre: watermark.titre, percuNom: watermark.percuNom,
        zone: watermark.zone, num: 1, total: 1, couleur: watermark.couleur,
      });
    }
    const a = document.createElement("a");
    a.href = exportUrl;
    a.download = `photo_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleRetake() {
    setPreview(null);
  }

  function handleCancel() {
    stopCamera();
    onCancel();
  }

  // Preview mode — show captured photo with options
  if (preview) {
    const headerTextColor = getContrastColor(col.hex);
    return (
      <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
        <div style={{ background: col.hex, padding: "12px 16px", color: headerTextColor, textAlign: "center", flexShrink: 0 }}>
          {watermark && <div style={{ fontSize: 12, opacity: 0.85 }}>{watermark.titre}{watermark.percuNom ? ` — ${watermark.percuNom}` : ""}</div>}
          <div style={{ fontSize: 16, fontWeight: 700 }}>{watermark ? `Aperçu — ${watermark.zone}` : "Aperçu photo"}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, minHeight: 0, overflow: "hidden" }}>
          <img src={preview} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          <button onClick={handleValidate} style={{ background: col.hex, color: headerTextColor, border: "none", borderRadius: 10, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            ✓ Valider la photo
          </button>
          <button onClick={handleDownload} style={{ background: "#fff", color: "#1C1917", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            ↓ Télécharger la photo
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleRetake} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              ↻ Reprendre
            </button>
            <button onClick={handleCancel} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Camera live view
  const liveTextColor = getContrastColor(col.hex);
  return (
    <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
      <div style={{ background: col.hex, padding: "12px 16px", color: liveTextColor, textAlign: "center", flexShrink: 0 }}>
        {watermark && <div style={{ fontSize: 12, opacity: 0.85 }}>{watermark.titre}{watermark.percuNom ? ` — ${watermark.percuNom}` : ""}</div>}
        <div style={{ fontSize: 16, fontWeight: 700 }}>{watermark ? `📸 ${watermark.zone}` : "📸 Prendre une photo"}</div>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexShrink: 0 }}>
        <button onClick={handleCancel} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>
          Annuler
        </button>
        <button onClick={takePhoto} style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", border: `4px solid ${col.hex}`, cursor: "pointer" }} />
        <button onClick={handleImportFile} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 14px", fontSize: 12, cursor: "pointer" }}>📁</button>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

function PhotoSetupView({ piece, percu, col, onStart, onBack, existingPhotos, onSelectExisting }) {
  const [zones, setZones] = useState(["Jardin", "Milieu", "Cour"]);
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState("setup"); // "setup" | "select"
  const [selected, setSelected] = useState(new Set());

  // Filter existing photos for this piece (optionally this percu)
  const availablePhotos = (existingPhotos || []);

  function togglePhoto(photoId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === availablePhotos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(availablePhotos.map((p) => p.id)));
    }
  }

  function handleValidateSelection() {
    const selectedPhotos = availablePhotos.filter((p) => selected.has(p.id));
    if (selectedPhotos.length > 0 && onSelectExisting) {
      onSelectExisting(selectedPhotos);
    }
  }

  // ── Select existing photos mode ──
  if (mode === "select") {
    return (
      <div style={{ ...S.shell, height: "100dvh", minHeight: 0, display: "flex", flexDirection: "column", background: "rgba(0,0,0,.6)", overflow: "hidden" }}>
        <div style={{ background: "#fff", borderRadius: 16, margin: "auto", padding: 20, width: "90%", maxWidth: 420, maxHeight: "85dvh", display: "flex", flexDirection: "column" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#1C1917" }}>Sélectionner des photos</h3>
          <p style={{ color: "#78716C", fontSize: 13, margin: "0 0 12px" }}>
            {percu.nom} — {piece.titre}<br />
            <span style={{ color: "#2563EB" }}>Cochez les photos à utiliser pour la série</span>
          </p>

          {availablePhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "#A8A29E" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 13 }}>Aucune photo existante pour cette pièce</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "#D6D3D1" }}>Utilisez "Nouvelles photos" pour capturer</div>
            </div>
          ) : (
            <>
              {/* Select all toggle */}
              <button
                onClick={selectAll}
                style={{
                  padding: "6px 12px", marginBottom: 10, borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: selected.size === availablePhotos.length ? col.hex : "#F5F5F4",
                  color: selected.size === availablePhotos.length ? "#fff" : "#78716C",
                  border: `1px solid ${col.hex}44`, cursor: "pointer",
                }}
              >
                {selected.size === availablePhotos.length ? "✓ Tout désélectionner" : "☐ Tout sélectionner"} ({availablePhotos.length})
              </button>

              {/* Photo grid with checkboxes */}
              <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
                {availablePhotos.map((photo) => {
                  const isSelected = selected.has(photo.id);
                  return (
                    <div
                      key={photo.id}
                      onClick={() => togglePhoto(photo.id)}
                      style={{
                        position: "relative", cursor: "pointer", borderRadius: 8, overflow: "hidden",
                        border: isSelected ? `3px solid ${col.hex}` : "3px solid transparent",
                        aspectRatio: "1", background: "#E7E5E4",
                      }}
                    >
                      <img src={photo.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      {/* Checkbox overlay */}
                      <div style={{
                        position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 6,
                        background: isSelected ? col.hex : "rgba(255,255,255,0.85)",
                        border: isSelected ? "none" : "2px solid #A8A29E",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700, color: "#fff",
                      }}>
                        {isSelected && "✓"}
                      </div>
                      {/* Zone label */}
                      <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0,
                        background: "rgba(0,0,0,0.6)", padding: "2px 6px",
                        fontSize: 10, color: "#fff", fontWeight: 600, textAlign: "center",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {photo.zone || "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Action buttons */}
          <button
            disabled={selected.size === 0}
            onClick={handleValidateSelection}
            style={{
              ...S.btnPrimary(col.hex),
              opacity: selected.size > 0 ? 1 : 0.5,
            }}
          >
            ✓ Utiliser {selected.size} photo{selected.size !== 1 ? "s" : ""} sélectionnée{selected.size !== 1 ? "s" : ""}
          </button>
          <button onClick={() => setMode("setup")} style={{ ...S.btnSecondary, marginTop: 8 }}>← Retour au protocole</button>
        </div>
      </div>
    );
  }

  // ── Setup mode (default — configure zones then capture) ──
  return (
    <div style={{ ...S.shell, height: "100dvh", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, width: "90%", maxWidth: 380 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#1C1917" }}>Protocole photo</h3>
        <p style={{ color: "#78716C", fontSize: 13, margin: "0 0 16px" }}>
          {percu.nom} — {piece.titre}<br />
          <span style={{ color: "#2563EB" }}>Toujours de Jardin → Cour</span>
        </p>

        {/* Existing photos button — only if photos exist */}
        {availablePhotos.length > 0 && (
          <button
            onClick={() => setMode("select")}
            style={{
              width: "100%", padding: "10px 14px", marginBottom: 14, borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "#F0F9FF", border: `2px solid #2563EB44`, color: "#2563EB",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            🖼️ Choisir parmi {availablePhotos.length} photo{availablePhotos.length !== 1 ? "s" : ""} existante{availablePhotos.length !== 1 ? "s" : ""}
          </button>
        )}

        {zones.map((z, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ ...S.badge, background: "#E7E5E4", color: "#57534E", minWidth: 20, textAlign: "center" }}>{i + 1}</span>
            <span style={{ flex: 1, color: "#1C1917", fontSize: 14 }}>{z}</span>
            <button style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 18 }} onClick={() => setZones(zones.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, margin: "10px 0 16px" }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ajouter zone..."
            onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) { setZones([...zones, custom.trim()]); setCustom(""); } }}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #D6D3D1", borderRadius: 8, fontSize: 14, outline: "none" }} />
          <button onClick={() => { if (custom.trim()) { setZones([...zones, custom.trim()]); setCustom(""); } }}
            style={{ padding: "8px 14px", border: "1px solid #D6D3D1", borderRadius: 8, background: "none", cursor: "pointer" }}>+</button>
        </div>
        <button disabled={!zones.length} onClick={() => onStart(zones)}
          style={{ ...S.btnPrimary(col.hex), opacity: zones.length ? 1 : 0.5 }}>
          📸 Nouvelles photos ({zones.length} zone{zones.length > 1 ? "s" : ""})
        </button>
        <button onClick={onBack} style={{ ...S.btnSecondary, marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}

function CaptureView({ capture, pieces, onPhoto, onNext, onDone, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [preview, setPreview] = useState(null); // { dataUrl, photoData }

  const piece = pieces.find((p) => p.id === capture.pieceId);
  const percu = piece?.percus.find((r) => r.id === capture.percuId);
  const col = BARNIER[capture.couleur];
  const zone = capture.zones[capture.currentZone];

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (mounted && videoRef.current) {
          streamRef.current = stream;
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        alert("Impossible d'accéder à la caméra. Vérifiez les permissions. (" + e.message + ")");
      }
    }
    if (!preview) startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [preview]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function buildWatermarkOpts() {
    return {
      titre: piece?.titre || "",
      percuNom: percu?.nom || "",
      zone,
      num: capture.currentZone + 1,
      total: capture.zones.length,
      couleur: col,
    };
  }

  function buildPhotoData(dataUrl) {
    return {
      id: uid(),
      dataUrl,
      pieceId: capture.pieceId,
      percuId: capture.percuId,
      zone,
      num: capture.currentZone + 1,
      total: capture.zones.length,
      couleur: capture.couleur,
    };
  }

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    ctx.drawImage(video, 0, 0);

    // Store raw image without baked watermark
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    stopCamera();
    setPreview({ dataUrl, photoData: buildPhotoData(dataUrl) });
  }

  async function handleImportFile() {
    const dataUrl = await importImageFile();
    if (dataUrl) {
      stopCamera();
      setPreview({ dataUrl, photoData: buildPhotoData(dataUrl) });
    }
  }

  function handleValidate() {
    if (!preview) return;
    onPhoto(preview.photoData);
    if (capture.currentZone < capture.zones.length - 1) {
      setPreview(null);
      onNext({ ...capture, currentZone: capture.currentZone + 1 });
    } else {
      onDone();
    }
  }

  function handleRetake() {
    setPreview(null);
  }

  function handleCancel() {
    stopCamera();
    onCancel();
  }

  // Preview mode — show captured/imported photo with options
  if (preview) {
    const isLast = capture.currentZone >= capture.zones.length - 1;
    const captureTextColor = getContrastColor(col.hex);
    return (
      <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
        <div style={{ background: col.hex, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", color: captureTextColor, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{piece?.titre} — {percu?.nom}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Aperçu — {zone}</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{capture.currentZone + 1}/{capture.zones.length}</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, minHeight: 0, overflow: "hidden" }}>
          <img src={preview.dataUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          <button onClick={handleValidate} style={{ background: col.hex, color: captureTextColor, border: "none", borderRadius: 10, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            {isLast ? "✓ Valider et terminer" : `✓ Valider → Zone suivante (${capture.currentZone + 2}/${capture.zones.length})`}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleRetake} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              ↻ Reprendre
            </button>
            <button onClick={handleCancel} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Camera live view
  const captureLiveTextColor = getContrastColor(col.hex);
  return (
    <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
      <div style={{ background: col.hex, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", color: captureLiveTextColor, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{piece?.titre} — {percu?.nom}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{zone}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 800 }}>{capture.currentZone + 1}/{capture.zones.length}</div>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: col.hex + "55", padding: "8px", textAlign: "center" }}>
          <span style={{ color: captureLiveTextColor, fontSize: 14, fontWeight: 600 }}>📸 Photo {capture.currentZone + 1}/{capture.zones.length} — {zone}</span>
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexShrink: 0 }}>
        <button onClick={handleCancel} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>Annuler</button>
        <button onClick={takePhoto} style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", border: `4px solid ${col.hex}`, cursor: "pointer" }} />
        <button onClick={handleImportFile} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 14px", fontSize: 12, cursor: "pointer" }}>📁</button>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
