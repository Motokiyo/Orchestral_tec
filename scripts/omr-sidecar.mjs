import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

const PORT = Number(process.env.OMR_PORT || 8766);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const STEP_TO_SOLFEGE = {
  C: "do",
  D: "re",
  E: "mi",
  F: "fa",
  G: "sol",
  A: "la",
  B: "si",
};

function findAudiveris() {
  const candidates = [
    process.env.AUDIVERIS_BIN,
    "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
    "/Applications/Audiveris 5.10.2.app/Contents/MacOS/Audiveris",
    "audiveris",
  ].filter(Boolean);
  return candidates[0];
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(dataUrl || "");
  if (!match) throw new Error("Image invalide");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Image trop lourde");
  const ext = match[1].includes("png") ? "png" : "jpg";
  return { buffer, ext };
}

async function findGeneratedMxl(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const mxl = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mxl"));
  if (!mxl) return null;
  return path.join(mxl.parentPath || dir, mxl.name);
}

async function readMusicXmlFromMxl(file) {
  const zip = await JSZip.loadAsync(await readFile(file));
  const container = zip.file("META-INF/container.xml");
  if (container) {
    const xml = await container.async("string");
    const rootFile = /full-path="([^"]+)"/.exec(xml)?.[1];
    if (rootFile && zip.file(rootFile)) return zip.file(rootFile).async("string");
  }
  const firstXml = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith(".xml") && !name.startsWith("META-INF/"));
  if (!firstXml) throw new Error("MusicXML introuvable dans le fichier MXL");
  return zip.file(firstXml).async("string");
}

function textOf(xml, tag) {
  return new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml)?.[1]?.trim() || "";
}

function attrTextOf(xml, tag, attrName, attrValue) {
  const re = new RegExp(`<${tag}\\b(?=[^>]*\\b${attrName}="${attrValue}")[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return re.exec(xml)?.[1]?.trim() || "";
}

function firstMatch(xml, patterns) {
  for (const pattern of patterns) {
    const value = pattern.exec(xml)?.[1]?.trim();
    if (value) return value.replace(/\s+/g, " ");
  }
  return "";
}

function parseMetadata(xml) {
  const title = firstMatch(xml, [
    /<work-title[^>]*>([\s\S]*?)<\/work-title>/i,
    /<movement-title[^>]*>([\s\S]*?)<\/movement-title>/i,
    /<credit-type[^>]*>\s*title\s*<\/credit-type>[\s\S]*?<credit-words[^>]*>([\s\S]*?)<\/credit-words>/i,
  ]);
  const composer = attrTextOf(xml, "creator", "type", "composer") || firstMatch(xml, [
    /<credit-type[^>]*>\s*composer\s*<\/credit-type>[\s\S]*?<credit-words[^>]*>([\s\S]*?)<\/credit-words>/i,
  ]);
  const year = firstMatch(xml, [
    /<rights[^>]*>[\s\S]*?((?:18|19|20)\d{2})[\s\S]*?<\/rights>/i,
    /<encoding-date[^>]*>((?:18|19|20)\d{2})-\d{2}-\d{2}<\/encoding-date>/i,
    /<credit-words[^>]*>[\s\S]*?((?:18|19|20)\d{2})[\s\S]*?<\/credit-words>/i,
  ]);
  const bpm = Number(firstMatch(xml, [
    /<sound\b[^>]*\btempo="([0-9.]+)"/i,
    /<per-minute[^>]*>([0-9.]+)<\/per-minute>/i,
  ]));
  return {
    title,
    composer,
    year,
    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm) : null,
  };
}

function parseMusicXml(xml) {
  const part = /<part\b[^>]*>([\s\S]*?)<\/part>/i.exec(xml)?.[1];
  if (!part) throw new Error("Aucune partie musicale trouvée");
  const metadata = parseMetadata(xml);

  let divisions = 1;
  let timeSignature = null;
  const notes = [];
  const measureDurations = [];
  const measures = part.match(/<measure\b[\s\S]*?<\/measure>/gi) || [part];

  for (const measureXml of measures) {
    const localDivisions = Number(textOf(measureXml, "divisions"));
    if (localDivisions > 0) divisions = localDivisions;
    const beats = Number(textOf(measureXml, "beats"));
    const beatType = Number(textOf(measureXml, "beat-type"));
    if (beats > 0 && beatType > 0) timeSignature = { beats, beatType };

    const noteBlocks = measureXml.match(/<note\b[\s\S]*?<\/note>/gi) || [];
    let measureDuration = 0;
    for (const noteXml of noteBlocks) {
      const rawDuration = Number(textOf(noteXml, "duration") || 0);
      const quarterDuration = rawDuration > 0 ? rawDuration / divisions : durationFromType(textOf(noteXml, "type"));
      const duration = Math.max(0.125, Math.round(quarterDuration * 1000) / 1000);
      measureDuration += duration;

      if (/<rest\b/i.test(noteXml)) {
        notes.push({ note: "silence", duration, rest: true });
        continue;
      }

      const pitch = /<pitch\b[^>]*>([\s\S]*?)<\/pitch>/i.exec(noteXml)?.[1];
      if (!pitch) continue;

      const step = textOf(pitch, "step").toUpperCase();
      const solfege = STEP_TO_SOLFEGE[step];
      if (!solfege) continue;

      const alter = Number(textOf(pitch, "alter") || 0);
      const suffix = alter === 1 ? "#" : alter === -1 ? "b" : "";
      notes.push({ note: `${solfege}${suffix}`, duration, rest: false });
    }
    if (measureDuration > 0) measureDurations.push(Math.round(measureDuration * 1000) / 1000);
  }

  const notesText = notes.map(({ note, duration }) => {
    if (Math.abs(duration - 1) < 0.01) return note;
    return `${note}:${duration}`;
  }).join(" ");
  const warnings = [];
  if (timeSignature) {
    const expected = timeSignature.beats * (4 / timeSignature.beatType);
    measureDurations.forEach((duration, index) => {
      if (Math.abs(duration - expected) > 0.125) {
        warnings.push(`Mesure ${index + 1}: ${duration} temps lus au lieu de ${expected}.`);
      }
    });
  }

  return {
    title: metadata.title,
    composer: metadata.composer,
    year: metadata.year,
    notesText,
    bpm: metadata.bpm || 60,
    timeSignature,
    confidence: notes.length > 0 ? 0.8 : 0,
    warnings: notes.length > 0 ? warnings : ["Audiveris n'a trouvé aucune note exploitable."],
  };
}

function durationFromType(type) {
  if (type === "whole") return 4;
  if (type === "half") return 2;
  if (type === "quarter") return 1;
  if (type === "eighth") return 0.5;
  if (type === "16th") return 0.25;
  return 1;
}

async function handleOmr(image) {
  const audiveris = findAudiveris();
  const workdir = await mkdtemp(path.join(tmpdir(), "orkmap-omr-"));
  try {
    const { buffer, ext } = dataUrlToBuffer(image);
    const input = path.join(workdir, `score.${ext}`);
    const output = path.join(workdir, "out");
    await writeFile(input, buffer);

    try {
      await execFileAsync(audiveris, ["-batch", "-transcribe", "-export", "-output", output, input], { cwd: workdir });
    } catch (err) {
      console.error("[orkmap-omr] Audiveris failed:", (err.stderr || err.stdout || err.message).slice(0, 2000));
      throw new Error("Audiveris n'a pas réussi à détecter les portées. Essaie de relancer avec la page bien droite et les deux lignes de musique visibles.");
    }
    const mxl = await findGeneratedMxl(output);
    if (!mxl) throw new Error("Audiveris n'a pas produit de fichier MusicXML");
    const xml = await readMusicXmlFromMxl(mxl);
    return parseMusicXml(xml);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  if (req.method !== "POST" || req.url !== "/omr") {
    json(res, 404, { error: "Not found" });
    return;
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > MAX_IMAGE_BYTES * 2) req.destroy();
  });
  req.on("end", async () => {
    try {
      const body = JSON.parse(raw || "{}");
      if (!body.image) throw new Error("Image manquante");
      json(res, 200, await handleOmr(body.image));
    } catch (err) {
      json(res, 500, { error: err.message });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[orkmap-omr] listening on http://0.0.0.0:${PORT}/omr`);
  console.log(`[orkmap-omr] Audiveris: ${findAudiveris()}`);
});
