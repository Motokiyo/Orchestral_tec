// Petit générateur de PDF, sans aucune dépendance (lot 8, dossier d'archive).
// Rôle unique : écrire un PDF A4 valide à partir de blocs simples (titres, paragraphes, listes, lignes
// « clé : valeur », images JPEG). Polices standard Helvetica et Helvetica-Bold, encodage WinAnsi (les accents
// français sont corrects). Les caractères hors WinAnsi sont remplacés proprement (voir cleanText) ; le tiret
// cadratin n'est jamais écrit. Aucun navigateur requis : fonctionne tel quel dans Node (tests).
// Les JPEG sont intégrés tels quels (DCTDecode). La conversion d'une image PNG ou autre en JPEG se fait ailleurs
// (canvas, src/archiveImages.js).

// ── Texte : nettoyage et encodage WinAnsi ───────────────────────────────────────────────
const WIN_ANSI_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e,
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Remplacements propres avant l'encodage. Le tiret cadratin (—) et le demi-cadratin (–) deviennent un trait d'union.
const REMPLACEMENTS = [
  [/[–—―−‐‑‒]/g, "-"],
  [/[        ]/g, " "],
  [/[​‌‍⁠﻿­]/g, ""],
  [/[‛ʼ′]/g, "’"],
  [/[‟″]/g, "”"],
  [/[●○▪▫‣⁃∙·]/g, "•"],
  [/→/g, "->"], [/←/g, "<-"], [/≥/g, ">="], [/≤/g, "<="], [/≈/g, "~"], [/≠/g, "!="],
  [/[✓✔✅]/g, "ok"], [/[✗✘❌]/g, "non"],
  [/┄|─|═|━/g, "-"],
  [/\u0141/g, "L"], [/\u0142/g, "l"], [/\u0110/g, "D"], [/\u0111/g, "d"], [/\u0131/g, "i"],
  [/\t/g, " "],
  [/\r\n?/g, "\n"],
];

/** Texte propre pour un PDF ou un TXT : sans cadratin, sans emoji, sans caractère hors WinAnsi. Les retours à la ligne sont gardés. */
export function cleanText(value) {
  let s = value === null || value === undefined ? "" : String(value);
  for (const [re, by] of REMPLACEMENTS) s = s.replace(re, by);
  s = s.normalize("NFC");
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === "\n") { out += ch; continue; }
    if (cp < 0x20 || cp === 0x7f) continue;
    if (cp < 0x7f || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_HIGH[cp] !== undefined) { out += ch; continue; }
    // Lettre accentuée hors WinAnsi (ex. ő, ł) : on garde la lettre de base si on la connaît.
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (base !== ch && base.length === 1 && base.charCodeAt(0) < 0x7f) { out += base; continue; }
    // Emoji, symboles, pictogrammes : supprimés (aucun « ? » bruyant). Le reste hors WinAnsi devient « ? ».
    if (cp >= 0x1f000 || (cp >= 0x2190 && cp <= 0x2bff) || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    out += "?";
  }
  return out.replace(/ {2,}/g, " ").replace(/^ | $/gm, "");
}

function winAnsiCode(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x100 && !(cp >= 0x80 && cp <= 0x9f)) return cp;
  return WIN_ANSI_HIGH[cp] ?? 0x3f;
}

// ── Largeurs des polices (millièmes d'em), tables Helvetica et Helvetica-Bold de l'Adobe Core 14 ──
const H_ASCII = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const B_ASCII = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// Autres caractères : largeur Helvetica / Helvetica-Bold.
const EXTRA = {
  "«": [556, 556], "»": [556, 556], "’": [222, 278], "‘": [222, 278], "“": [333, 500], "”": [333, 500],
  "…": [1000, 1000], "•": [350, 350], "°": [400, 400], "œ": [944, 944], "Œ": [1000, 1000],
  "æ": [889, 889], "Æ": [1000, 1000], "ß": [611, 611], "Ø": [778, 778], "ø": [611, 611],
  "€": [556, 556], "©": [737, 737], "®": [737, 737], "™": [1000, 1000], "×": [584, 584],
  "÷": [584, 584], "±": [584, 584], "½": [834, 834], "¼": [834, 834], "¾": [834, 834],
  "§": [556, 556], "£": [556, 556], "µ": [556, 556], "¿": [611, 611], "¡": [333, 333],
};

function charWidth(ch, bold) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x20 && cp <= 0x7e) return (bold ? B_ASCII : H_ASCII)[cp - 0x20];
  if (EXTRA[ch]) return EXTRA[ch][bold ? 1 : 0];
  // Lettre accentuée : même largeur que sa lettre de base (é = e, ç = c, ô = o...).
  const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (base !== ch && base.length === 1 && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) <= 0x7e) {
    return (bold ? B_ASCII : H_ASCII)[base.charCodeAt(0) - 0x20];
  }
  return bold ? 611 : 556;
}

/** Largeur d'un texte en points pour une taille donnée. */
export function textWidth(text, size, bold = false) {
  let w = 0;
  for (const ch of cleanText(text).replace(/\n/g, " ")) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** Retour à la ligne automatique : des lignes qui tiennent dans `maxWidth` points. Un mot trop long est coupé. */
export function wrapText(text, size, maxWidth, bold = false) {
  const out = [];
  for (const para of cleanText(text).split("\n")) {
    if (para.trim() === "") { out.push(""); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      if (word === "") continue;
      const essai = line ? line + " " + word : word;
      if (textWidth(essai, size, bold) <= maxWidth) { line = essai; continue; }
      if (line) { out.push(line); line = ""; }
      if (textWidth(word, size, bold) <= maxWidth) { line = word; continue; }
      let morceau = "";
      for (const ch of word) {
        if (textWidth(morceau + ch, size, bold) > maxWidth && morceau) { out.push(morceau); morceau = ""; }
        morceau += ch;
      }
      line = morceau;
    }
    out.push(line);
  }
  return out;
}

// ── JPEG : lecture de l'en-tête ────────────────────────────────────────────────────────
/** { width, height, components } d'un JPEG, ou null si ce n'en est pas un (ou s'il est illisible). */
export function jpegInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (!width || !height) return null;
      return { width, height, components, progressive: marker === 0xc2 };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// ── Construction du PDF ─────────────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const FOOTER_H = 36;

const fmt = (n) => (Math.round(n * 100) / 100).toString();
const hex = (text) => {
  let s = "<";
  for (const ch of text) s += winAnsiCode(ch).toString(16).padStart(2, "0");
  return s + ">";
};
const utf16Hex = (text) => {
  let s = "<FEFF";
  for (let i = 0; i < text.length; i++) s += text.charCodeAt(i).toString(16).padStart(4, "0");
  return s + ">";
};
const latin1 = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
};

export class PdfDocument {
  constructor({ title = "", author = "OrkMap", subject = "", keywords = "", creator = "OrkMap", footer = "" } = {}) {
    this.title = cleanText(title);
    this.author = cleanText(author);
    this.subject = cleanText(subject);
    this.keywords = cleanText(keywords).replace(/\n/g, " ");
    this.creator = cleanText(creator);
    this.footer = cleanText(footer);
    this.bookmarks = []; // { title, page (index), y }
    this.pages = [];
    this.images = []; // { bytes, width, height, components }
    this.usedImagesByPage = [];
    this.newPage();
  }

  newPage() {
    this.pages.push({ ops: [], images: [] });
    this.y = PAGE_H - MARGIN;
    return this;
  }

  get page() { return this.pages[this.pages.length - 1]; }
  get contentWidth() { return PAGE_W - 2 * MARGIN; }
  get bottom() { return MARGIN + FOOTER_H / 2; }
  get remaining() { return this.y - this.bottom; }

  // Saute de page si l'espace restant est inférieur à `needed` points (et si la page n'est pas déjà vide).
  ensure(needed) {
    if (this.remaining >= needed) return;
    if (this.y >= PAGE_H - MARGIN - 1) return; // page vide : inutile d'en ouvrir une autre
    this.newPage();
  }

  /** Signet PDF (panneau latéral des lecteurs) vers la position courante. Renvoie l'index de la page (à partir de 0). */
  bookmark(title) {
    this.bookmarks.push({ title: cleanText(title).replace(/\n/g, " "), page: this.pages.length - 1, y: Math.min(PAGE_H - 20, this.y + 24) });
    return this.pages.length - 1;
  }

  pageBreak() { if (this.y < PAGE_H - MARGIN - 1) this.newPage(); return this; }
  gap(points = 8) { this.y -= points; return this; }

  _text(x, y, text, size, bold, gray = 0) {
    this.page.ops.push(`BT /${bold ? "F2" : "F1"} ${fmt(size)} Tf ${fmt(gray)} g ${fmt(x)} ${fmt(y)} Td ${hex(cleanText(text))} Tj ET`);
  }

  _lines(lines, { x, size, bold, lead, gray = 0, bullet = null }) {
    lines.forEach((ln, i) => {
      this.ensure(lead);
      this.y -= lead;
      if (bullet && i === 0) this._text(x - 12, this.y + lead * 0.22, bullet, size, false, gray);
      if (ln) this._text(x, this.y + lead * 0.22, ln, size, bold, gray);
    });
  }

  /** Titre principal (grand, gras). */
  title_(text) {
    const size = 20;
    this.ensure(size * 3);
    this._lines(wrapText(text, size, this.contentWidth, true), { x: MARGIN, size, bold: true, lead: size * 1.25 });
    return this.gap(4);
  }

  /** Ligne discrète sous le titre (gris). */
  subtitle(text) {
    const size = 10.5;
    this._lines(wrapText(text, size, this.contentWidth), { x: MARGIN, size, bold: false, lead: size * 1.4, gray: 0.35 });
    return this.gap(4);
  }

  /** Titre de section, avec un filet dessous. */
  heading(text) {
    const size = 13;
    this.gap(8);
    this.ensure(size * 1.4 + 60);
    this._lines(wrapText(text, size, this.contentWidth, true), { x: MARGIN, size, bold: true, lead: size * 1.35 });
    this.page.ops.push(`0.6 G 0.5 w ${fmt(MARGIN)} ${fmt(this.y - 2)} m ${fmt(PAGE_W - MARGIN)} ${fmt(this.y - 2)} l S`);
    return this.gap(5);
  }

  /** Sous-titre (gras, plus petit). */
  subheading(text) {
    const size = 10.5;
    this.gap(4);
    this.ensure(size * 1.4 + 40);
    this._lines(wrapText(text, size, this.contentWidth, true), { x: MARGIN, size, bold: true, lead: size * 1.4 });
    return this;
  }

  paragraph(text, { size = 10, bold = false, indent = 0, gray = 0 } = {}) {
    const lead = size * 1.4;
    this._lines(wrapText(text, size, this.contentWidth - indent, bold), { x: MARGIN + indent, size, bold, lead, gray });
    return this.gap(2);
  }

  bullet(text, { size = 10, indent = 14 } = {}) {
    const lead = size * 1.4;
    this._lines(wrapText(text, size, this.contentWidth - indent, false), { x: MARGIN + indent, size, bold: false, lead, bullet: "•" });
    return this;
  }

  /** Lignes « clé : valeur » : la clé en gras à gauche, la valeur à droite, chacune avec retour à la ligne. */
  keyValues(rows, { size = 10, keyWidth = 150 } = {}) {
    const lead = size * 1.4;
    const valueX = MARGIN + keyWidth + 8;
    for (const [k, v] of rows) {
      const kl = wrapText(k, size, keyWidth, true);
      const vl = wrapText(v === "" || v === null || v === undefined ? "-" : v, size, PAGE_W - MARGIN - valueX);
      const n = Math.max(kl.length, vl.length);
      this.ensure(lead * Math.min(n, 3));
      for (let i = 0; i < n; i++) {
        this.ensure(lead);
        this.y -= lead;
        if (kl[i]) this._text(MARGIN, this.y + lead * 0.22, kl[i], size, true);
        if (vl[i]) this._text(valueX, this.y + lead * 0.22, vl[i], size, false);
      }
      this.y -= 1.5;
    }
    return this.gap(2);
  }

  /**
   * Image JPEG intégrée telle quelle. `fullWidth` : toute la largeur du texte. Sinon `maxWidth` (points).
   * L'image est réduite si elle ne tient pas sur une page, et passe à la page suivante si la place manque.
   */
  image(img, { fullWidth = true, maxWidth = 0, caption = "" } = {}) {
    if (!img || !img.bytes || !jpegInfo(img.bytes)) throw new Error("pdfWriter : image JPEG attendue");
    const info = jpegInfo(img.bytes);
    const maxPageH = PAGE_H - 2 * MARGIN - FOOTER_H - 20;
    let w = fullWidth ? this.contentWidth : Math.min(maxWidth || this.contentWidth, this.contentWidth);
    let h = (w * info.height) / info.width;
    if (h > maxPageH) { h = maxPageH; w = (h * info.width) / info.height; }
    if (h > this.remaining) this.pageBreak();
    const idx = this.images.push({ bytes: img.bytes, width: info.width, height: info.height, components: info.components }) - 1;
    const page = this.page;
    if (!page.images.includes(idx)) page.images.push(idx);
    const x = MARGIN + (this.contentWidth - w) / 2;
    this.y -= h;
    page.ops.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(x)} ${fmt(this.y)} cm /Im${idx} Do Q`);
    this.y -= 4;
    if (caption) this.paragraph(caption, { size: 8.5, gray: 0.4 });
    return this.gap(4);
  }

  /** Les octets du fichier PDF (Uint8Array). */
  build() {
    const chunks = [];
    const offsets = [];
    let size = 0;
    const push = (data) => { const b = typeof data === "string" ? latin1(data) : data; chunks.push(b); size += b.length; };
    const begin = () => { offsets.push(size); };

    // Numérotation : 1 catalogue, 2 pages, 3 et 4 polices, 5 infos, puis images, puis (page, contenu) par page.
    const nbPages = this.pages.length;
    const firstImage = 6;
    const firstPage = firstImage + this.images.length;
    const pageObj = (i) => firstPage + i * 2;
    const pagesEnd = firstPage + nbPages * 2 - 1;
    const total = pagesEnd + (this.bookmarks.length ? this.bookmarks.length + 1 : 0);

    push("%PDF-1.4\n%âãÏÓ\n");
    const nbMarks = this.bookmarks.length;
    const outlinesObj = pagesEnd + 1; // racine des signets, suivie d'un objet par signet
    begin(); push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R${nbMarks ? ` /Outlines ${outlinesObj} 0 R /PageMode /UseOutlines` : ""} >>\nendobj\n`);
    begin(); push(`2 0 obj\n<< /Type /Pages /Kids [${this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${nbPages} >>\nendobj\n`);
    begin(); push("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");
    begin(); push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");
    const d = new Date();
    const pdfDate = `D:${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
    begin(); push(`5 0 obj\n<< /Title ${utf16Hex(this.title)} /Author ${utf16Hex(this.author)} /Subject ${utf16Hex(this.subject)} /Keywords ${utf16Hex(this.keywords)} /Creator ${utf16Hex(this.creator)} /Producer (OrkMap) /CreationDate (${pdfDate}) >>\nendobj\n`);

    this.images.forEach((img, i) => {
      begin();
      const cs = img.components === 1 ? "/DeviceGray" : img.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      const decode = img.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      push(`${firstImage + i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${img.bytes.length} >>\nstream\n`);
      push(img.bytes);
      push("\nendstream\nendobj\n");
    });

    this.pages.forEach((pg, i) => {
      const footerOps = [];
      const label = `Page ${i + 1} sur ${nbPages}`;
      if (this.footer) footerOps.push(`BT /F1 8 Tf 0.4 g ${fmt(MARGIN)} ${fmt(MARGIN - 6)} Td ${hex(this.footer)} Tj ET`);
      footerOps.push(`BT /F1 8 Tf 0.4 g ${fmt(PAGE_W - MARGIN - textWidth(label, 8))} ${fmt(MARGIN - 6)} Td ${hex(label)} Tj ET`);
      const content = ["0 g", ...pg.ops, ...footerOps].join("\n");
      const xobjects = pg.images.map((idx) => `/Im${idx} ${firstImage + idx} 0 R`).join(" ");
      begin();
      push(`${pageObj(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE_W)} ${fmt(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${pageObj(i) + 1} 0 R >>\nendobj\n`);
      begin();
      push(`${pageObj(i) + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    });

    if (nbMarks) {
      begin();
      push(`${outlinesObj} 0 obj\n<< /Type /Outlines /First ${outlinesObj + 1} 0 R /Last ${outlinesObj + nbMarks} 0 R /Count ${nbMarks} >>\nendobj\n`);
      this.bookmarks.forEach((m, i) => {
        const me = outlinesObj + 1 + i;
        begin();
        push(`${me} 0 obj\n<< /Title ${utf16Hex(m.title)} /Parent ${outlinesObj} 0 R${i > 0 ? ` /Prev ${me - 1} 0 R` : ""}${i < nbMarks - 1 ? ` /Next ${me + 1} 0 R` : ""} /Dest [${pageObj(m.page)} 0 R /XYZ 0 ${fmt(m.y)} null] >>\nendobj\n`);
      });
    }

    const xrefAt = size;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
    push(xref);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(size);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }
}
