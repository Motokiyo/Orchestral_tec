// LOT 7 et 8 : photos dans Téléchargements, dossier d'archive d'un concert pour les salles.
// Tout en Node, sans réseau : contenu et arborescence du zip, fiches TXT, PDF (valide, lisible par pdftotext,
// accents, plusieurs pages, image), total du mobilier, noms de fichiers sûrs. Lancer : node --test tests/lot7-8-archive.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";
import { PdfDocument, cleanText, wrapText, textWidth, jpegInfo } from "../src/pdfWriter.js";
import { nomSur, nomDossierPiece, nomZipDossier, nomPhoto, plansDeLaPiece, totalMobilierConcert, elementsMobilier, blocsFichePiece, blocsFicheConcert, blocsEnTxt, blocsEnPdf, PLAN_ABSENT } from "../src/archive.js";
import { construireDossier } from "../src/archiveBuilder.js";
import { construireZipPhotos, compterPhotos, nomUnique } from "../src/photoExport.js";
import { octetsDeDataUrl } from "../src/archiveImages.js";

const JPG_B64 = "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";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAABRElEQVR4nNWYzY3EIAyFH1bqmJMrSDEpkkrmlApcCafVDlrERvOTDAbsd4iCBI6/PDsRhJQS8y6ywqfC7XYvA48YIaUEgHl3yhAyQM3gCyMUAAA784aY7yO23s9eRdqD0GFc8t4QC4wnB/CnOvtObqg4sLwKLVVjbIiKXVG/Jv0SOqjkzbzXXW5H9HGGyGoZg07OO2DAHUCWQSvo6gJrVtB3y+xYQV+vNNLc1Lh+ekWRSpSJVpBWoFlWkG648VaQesTBzU2d4g6rKOoXekxFLeiszJCzz9foyIGnFaW70VswUCJr2SH9DuHHgSKRtWxQVbpiNEBWzcBtGHMAMoPKN+rlqcQAlVOJlnPBaQ7UkgYrTACg4c/9r4QsiC8e0ZoDuIphFOB8c5sGwAkrrAN8xPAB8KaiPAHgmRXOAPBQbYVLgNqKH2ig0uE8KKG6AAAAAElFTkSuQmCC";
const JPG = "data:image/jpeg;base64," + JPG_B64;
const PNG = "data:image/png;base64," + PNG_B64;
const PDFTOTEXT = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext"].find((p) => fs.existsSync(p));
const PDFINFO = ["/opt/homebrew/bin/pdfinfo", "/usr/local/bin/pdfinfo"].find((p) => fs.existsSync(p));
const PDFIMAGES = ["/opt/homebrew/bin/pdfimages", "/usr/local/bin/pdfimages"].find((p) => fs.existsSync(p));
const GS = ["/opt/homebrew/bin/gs", "/usr/local/bin/gs"].find((p) => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lot78-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const ecrire = (nom, bytes) => { const f = path.join(tmp, nom); fs.writeFileSync(f, bytes); return f; };
const texte = (bytes, nom = "t.pdf", args = ["-layout"]) => execFileSync(PDFTOTEXT, [...args, ecrire(nom, bytes), "-"], { encoding: "utf8" });

// ── Un concert d'essai ──
const piece1 = {
  id: "p1", titre: "Symphonie n° 5 : Allegro/Final", compositeur: "Ludwig van Beethoven", duree: "30'", couleur: "bleu",
  effectif: "2.2.2.2 / 4.2.3.1 / T+2 / 1hp / 12.10.8.6.4", notes: "Prévoir l'estrade « haute » … côté jardin — merci.",
  orchestre: { bois: ["2 Flûtes", "2 Hautbois"], cuivres: ["4 Cors"], cordes: ["12 Violons I", "4 Contrebasses"], autres: ["1 Harpe"] },
  percus: [{ id: "q1", nom: "Percu 1", items: [{ cat: "Claviers", nom: "Vibraphone" }, { cat: "Grosses pièces", nom: "Tam-tam" }] }],
  plans: [JPG, "orkimg:" + "a".repeat(64), PNG], sansChef: false,
  mobilierObserve: [{ type: "Pupitres", qte: 99, source: "plan" }],
};
const piece2 = {
  id: "p2", titre: "Œuvre courte", compositeur: "Élise Çelik", couleur: "rouge", effectif: "1.1.1.1", notes: "",
  orchestre: { bois: ["1 Flûte"], cuivres: [], cordes: ["2 Violoncelles"], autres: [] }, percus: [], plans: [], sansChef: true,
};
const piece3 = { id: "p3", titre: "Sans orchestre", couleur: "blanc", percus: [], plans: [] };
const concert = { id: "c1", titre: "Concert d'automne : 2/3", date: "20 novembre 2026", lieu: "Salle Pleyel", chef: "Jean Dupont", orchestre: "Orchestre test", notes: "Répétition à 14 h.", pieces: [piece1, piece2, piece3] };
const photos = {
  p1: [{ dataUrl: JPG, percuId: "q1", zone: "Avant/Gauche", num: 1, total: 2 }, { dataUrl: PNG, percuId: "q1", zone: "Fond: haut" }],
  p2: [{ dataUrl: JPG, zone: "" }],
};
const deps = {
  chargerPlan: async (v) => (v === JPG || v === PNG ? v : null), // « orkimg:aaa... » : absent du téléphone
  filigrane: async (d) => d,
  enJpeg: async (d) => (d === JPG ? { bytes: octetsDeDataUrl(JPG).bytes, ...jpegInfo(octetsDeDataUrl(JPG).bytes) } : { bytes: octetsDeDataUrl(JPG).bytes, ...jpegInfo(octetsDeDataUrl(JPG).bytes) }),
};
const noms = (zip) => Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
const lire = async (zip, n) => zip.file(n).async("string");

// ───────────────────────── PDF ─────────────────────────
test("cleanText : jamais de tiret cadratin, emoji retirés, accents français gardés", () => {
  assert.equal(cleanText("a \u2014 b \u2013 c"), "a - b - c");
  assert.equal(cleanText("🎻 Cordes ✓"), "Cordes ok");
  assert.equal(cleanText("é è à ç ô œ « » ’ …"), "é è à ç ô œ « » ’ …");
  assert.equal(cleanText("Łódź"), "Lódz");
  assert.ok(!/\u2014/.test(cleanText("x\u2014y")));
});

test("wrapText : retour à la ligne et mot trop long coupé", () => {
  const l = wrapText("un deux trois quatre cinq six sept huit neuf dix onze douze", 10, 80);
  assert.ok(l.length > 2);
  for (const x of l) assert.ok(textWidth(x, 10) <= 80.01, x);
  const long = wrapText("Anticonstitutionnellement".repeat(3), 10, 100);
  for (const x of long) assert.ok(textWidth(x, 10) <= 100.01);
});

test("PDF : structure valide, xref exact, accents, plusieurs pages, image JPEG", { skip: !PDFTOTEXT }, () => {
  const doc = new PdfDocument({ title: "Essai é", footer: "OrkMap" });
  doc.title_("Titre de l'œuvre : « Été » …");
  doc.subtitle("Sous-titre");
  doc.heading("Mobilier");
  doc.keyValues([["Date", "20 novembre 2026"], ["Clé très longue pour vérifier le retour à la ligne dans la colonne", "valeur " + "mot ".repeat(60)]]);
  for (let i = 0; i < 120; i++) doc.bullet(`Ligne ${i} : éèàçôœ « guillemets » ’ apostrophe … fin`);
  const bytes = octetsDeDataUrl(JPG).bytes;
  doc.image({ bytes }, { fullWidth: true });
  doc.paragraph("Dernière page : ça va très bien.");
  const pdf = doc.build();
  // xref : chaque entrée pointe exactement sur « N 0 obj »
  const s = Buffer.from(pdf).toString("latin1");
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1]);
  assert.ok(s.slice(start).startsWith("xref\n"));
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(start));
  const entries = [...s.slice(start).matchAll(/^(\d{10}) (\d{5}) ([nf]) $/gm)];
  assert.equal(entries.length, Number(count));
  entries.slice(1).forEach((m, i) => assert.ok(s.slice(Number(m[1])).startsWith(`${i + 1} 0 obj`), `objet ${i + 1}`));
  const out = texte(pdf);
  for (const mot of ["Titre de l'œuvre", "« Été »", "éèàçôœ « guillemets » ’ apostrophe … fin", "Dernière page : ça va très bien.", "Page 1 sur", "OrkMap"]) assert.ok(out.includes(mot), "manque : " + mot);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync(PDFINFO, [ecrire("p.pdf", pdf)], { encoding: "utf8" }))[1]);
  assert.ok(pages >= 3, "plusieurs pages : " + pages);
  assert.ok(/Page 3 sur/.test(out) || pages > 3);
  if (PDFIMAGES) assert.match(execFileSync(PDFIMAGES, ["-list", ecrire("i.pdf", pdf)], { encoding: "utf8" }), /\bjpeg\b|\bimage\b/);
  if (GS) execFileSync(GS, ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=nullpage", ecrire("g.pdf", pdf)], { encoding: "utf8" });
  assert.ok(!out.includes("\u2014"));
});

test("PDF : une image non JPEG est refusée par le générateur (la conversion se fait avant)", () => {
  const doc = new PdfDocument();
  assert.throws(() => doc.image({ bytes: octetsDeDataUrl(PNG).bytes }), /JPEG/);
});

// ───────────────────────── noms de fichiers ─────────────────────────
test("noms de fichiers sûrs : ni / \\ : * ? \" < > | ni point en tête", () => {
  for (const mauvais of ["a/b\\c:d*e?f\"g<h>i|j", "../../etc/passwd", "...", "   ", "Concert d'automne : 2/3", "\u2014\u2014"]) {
    const n = nomSur(mauvais);
    assert.ok(!/[\/\\:*?"<>|]/.test(n), n);
    assert.ok(!n.startsWith("."), n);
    assert.ok(n.length > 0 && n.length <= 60);
  }
  assert.equal(nomSur("Œuvre d'été"), "Œuvre_d_été");
  assert.equal(nomZipDossier(concert), "Concert_d_automne_2_3_20_novembre_2026_dossier.zip");
  assert.match(nomDossierPiece(1, piece1), /^01_Symphonie_n°_5_Allegro_Final$/);
  assert.equal(nomPhoto(2, { zone: "Fond: haut" }, "Percu 1"), "Photo_02_Percu_1_Fond_haut.jpg");
  assert.equal(nomUnique("A", new Set(["a"])), "A_2");
});

// ───────────────────────── total du mobilier ─────────────────────────
test("total du mobilier : somme ET maximum par élément, quantités inconnues signalées", () => {
  const a = { general: { pupitres: 10, chaisesNormales: 20, chaisesHautes: 2, banquettes: 0, chaisesSpeciales: [{ type: "Chaise timbalier", qty: 1 }] }, stands: { cordes: [{ type: "Stands de contrebasse", qty: 4 }], bois: [], cuivres: [], percus: [], autres: [{ type: "Podium chef", qty: 1 }], speciaux: [] }, infos: [] };
  const b = { general: { pupitres: 6, chaisesNormales: 30, chaisesHautes: 0, banquettes: 1, chaisesSpeciales: [] }, stands: { cordes: [{ type: "Stands de contrebasse", qty: null }], bois: [], cuivres: [], percus: [], autres: [{ type: "Podium chef", qty: 1 }], speciaux: [] }, infos: [] };
  const t = totalMobilierConcert([{ id: "a", mobilier: a }, { id: "b", mobilier: b }, { id: "c" }], {});
  const ligne = (l) => t.lignes.find((x) => x.label === l);
  assert.deepEqual([ligne("Pupitres de musiciens").somme, ligne("Pupitres de musiciens").max], [16, 10]);
  assert.deepEqual([ligne("Chaises normales").somme, ligne("Chaises normales").max], [50, 30]);
  assert.deepEqual([ligne("Podium chef").somme, ligne("Podium chef").max], [2, 1]);
  assert.deepEqual([ligne("Stands de contrebasse").somme, ligne("Stands de contrebasse").max], [4, 4]);
  assert.equal(t.inconnues, 1);
  assert.equal(t.sansMobilier, 1);
  assert.equal(elementsMobilier(null).length, 0);
});

test("fiche du concert : les deux totaux sont présentés clairement", () => {
  const txt = blocsEnTxt(blocsFicheConcert({ concert, pieces: concert.pieces, nbTotal: 3 }));
  assert.match(txt, /TOTAL DES PIÈCES ADDITIONNÉES/);
  assert.match(txt, /MAXIMUM PAR ÉLÉMENT/);
  assert.match(txt, /1\. Symphonie n° 5 : Allegro\/Final \(Ludwig van Beethoven\) : Daniels 2\.2\.2\.2/);
  assert.match(txt, /Répétition à 14 h\./);
  assert.match(txt, /Pupitres de musiciens : \d+/);
  assert.ok(!txt.includes("\u2014"));
});

// ───────────────────────── le dossier ─────────────────────────
test("dossier complet : arborescence, fiches, plan absent sans fichier cassé", async () => {
  const r = await construireDossier({ concert, photos, deps });
  assert.equal(r.nom, "Concert_d_automne_2_3_20_novembre_2026_dossier.zip");
  const zip = await JSZip.loadAsync(Buffer.from(await r.blob.arrayBuffer()));
  const liste = noms(zip);
  assert.deepEqual(liste, [
    "00_Fiche_concert.pdf", "00_Fiche_concert.txt",
    "01_Symphonie_n°_5_Allegro_Final/Fiche.pdf", "01_Symphonie_n°_5_Allegro_Final/Fiche.txt",
    "01_Symphonie_n°_5_Allegro_Final/Photos/Photo_01_Percu_1_Avant_Gauche.jpg",
    "01_Symphonie_n°_5_Allegro_Final/Photos/Photo_02_Percu_1_Fond_haut.png",
    "01_Symphonie_n°_5_Allegro_Final/Plans/Plan_1.jpg", "01_Symphonie_n°_5_Allegro_Final/Plans/Plan_3.png",
    "02_Œuvre_courte/Fiche.pdf", "02_Œuvre_courte/Fiche.txt", "02_Œuvre_courte/Photos/Photo_01.jpg",
    "03_Sans_orchestre/Fiche.pdf", "03_Sans_orchestre/Fiche.txt",
  ]);
  assert.deepEqual(r.stats, { pieces: 3, plans: 2, plansAbsents: 1, photos: 3 });
  for (const n of liste) {
    assert.ok(!/[:*?"<>|\\]/.test(n) && !n.startsWith("/") && !n.includes(".."), n);
    assert.ok((await zip.file(n).async("uint8array")).length > 0, "fichier vide : " + n);
  }
  const fiche = await lire(zip, "01_Symphonie_n°_5_Allegro_Final/Fiche.txt");
  assert.match(fiche, /Plan 1 : fichier Plans\/Plan_1\.jpg/);
  assert.match(fiche, new RegExp("Plan 2 : " + PLAN_ABSENT));
  assert.match(fiche, /Effectif \(Daniels\) : 2\.2\.2\.2/);
  assert.match(fiche, /MOBILIER CALCULÉ/);
  assert.match(fiche, /Pupitres : 99/); // mobilier observé
  assert.match(fiche, /ÉCARTS ENTRE LE PLAN ET LE CALCUL/);
  assert.match(fiche, /Pôle 1 : Percu 1/);
  assert.match(fiche, /Vibraphone/);
  assert.match(fiche, /Prévoir l'estrade « haute » … côté jardin - merci\./); // cadratin remplacé
  assert.ok(!fiche.includes("\u2014") && !fiche.includes("🎻"));
  const sans = await lire(zip, "03_Sans_orchestre/Fiche.txt");
  assert.match(sans, /Aucun mobilier/);
  assert.match(sans, /Aucun plan enregistré/);
  assert.match(sans, /Aucune note\./);
  const fc = await lire(zip, "00_Fiche_concert.txt");
  assert.match(fc, /Salle Pleyel/);
  assert.match(fc, /Jean Dupont/);
  assert.match(fc, /Orchestre test/);
});

test("dossier : PDF lisibles par pdftotext (accents), image de plan en pleine largeur", { skip: !PDFTOTEXT }, async () => {
  const r = await construireDossier({ concert, photos, deps });
  const zip = await JSZip.loadAsync(Buffer.from(await r.blob.arrayBuffer()));
  const pdf1 = await zip.file("01_Symphonie_n°_5_Allegro_Final/Fiche.pdf").async("uint8array");
  assert.equal(Buffer.from(pdf1.slice(0, 5)).toString(), "%PDF-");
  const t1 = texte(pdf1, "f1.pdf");
  for (const m of ["Symphonie n° 5 : Allegro/Final", "Ludwig van Beethoven", "MOBILIER CALCULÉ".toLowerCase() === "" ? "" : "Mobilier calculé", "Pôle 1", plan_absent()]) assert.ok(t1.includes(m), "manque : " + m);
  assert.ok(t1.includes("côté jardin"));
  assert.ok(!t1.includes("\u2014"));
  if (PDFIMAGES) {
    const l = execFileSync(PDFIMAGES, ["-list", ecrire("f1i.pdf", pdf1)], { encoding: "utf8" }).split("\n").filter((x) => /\d+\s+\d+\s+image/.test(x));
    assert.equal(l.length, 1, "une image de plan");
  }
  const pdfc = await zip.file("00_Fiche_concert.pdf").async("uint8array");
  const tc = texte(pdfc, "fc.pdf");
  assert.ok(tc.includes("Concert d'automne : 2/3") && tc.includes("Salle Pleyel"));
  assert.ok(tc.includes("Mobilier du concert"));
  // pièce sans plan : PDF valide sans image
  const pdf2 = await zip.file("02_Œuvre_courte/Fiche.pdf").async("uint8array");
  assert.ok(texte(pdf2, "f2.pdf").includes("Œuvre courte"));
  assert.ok(texte(pdf2, "f2b.pdf").includes("Élise Çelik"));
});
function plan_absent() { return "plan non disponible sur ce téléphone"; }

test("dossier : pièces cochées seulement, et option « sans photos »", async () => {
  const r = await construireDossier({ concert, pieceIds: ["p2"], avecPhotos: false, photos, deps });
  const zip = await JSZip.loadAsync(Buffer.from(await r.blob.arrayBuffer()));
  assert.deepEqual(noms(zip), ["00_Fiche_concert.pdf", "00_Fiche_concert.txt", "01_Œuvre_courte/Fiche.pdf", "01_Œuvre_courte/Fiche.txt"]);
  assert.match(await lire(zip, "01_Œuvre_courte/Fiche.txt"), /Photos : non incluses dans ce dossier/);
  assert.match(await lire(zip, "00_Fiche_concert.txt"), /Pièces dans ce dossier : 1 sur 3/);
  assert.equal(r.stats.photos, 0);
});

test("dossier : un plan qui échoue au chargement ne casse rien", async () => {
  const mauvais = { ...deps, chargerPlan: async () => { throw new Error("boum"); }, enJpeg: async () => { throw new Error("canvas"); } };
  const r = await construireDossier({ concert, pieceIds: ["p1"], avecPhotos: false, photos, deps: mauvais });
  assert.equal(r.stats.plans, 0);
  assert.equal(r.stats.plansAbsents, 3);
  const zip = await JSZip.loadAsync(Buffer.from(await r.blob.arrayBuffer()));
  assert.ok(!noms(zip).some((n) => n.includes("Plans/")));
});

test("dossier : la progression va de 0 à 100 et ne recule pas", async () => {
  const pct = [];
  await construireDossier({ concert, photos, deps, onProgress: (p) => pct.push(p.pct) });
  assert.equal(pct[pct.length - 1], 100);
  for (let i = 1; i < pct.length; i++) assert.ok(pct[i] >= pct[i - 1], pct.join(","));
});

test("dossier : une seule photo décodée à la fois (le filigrane est appelé photo par photo)", async () => {
  let enCours = 0; let pic = 0;
  const d = { ...deps, filigrane: async (x) => { enCours++; pic = Math.max(pic, enCours); await new Promise((r) => setTimeout(r, 2)); enCours--; return x; } };
  await construireDossier({ concert, photos, deps: d });
  assert.equal(pic, 1);
});

// ───────────────────────── lot 7 : photos seules ─────────────────────────
test("lot 7 : zip de photos d'un concert, un dossier par pièce", async () => {
  assert.equal(compterPhotos([{ concert }], photos), 3);
  const vus = [];
  const { blob, count } = await construireZipPhotos({ groupes: [{ concert }], photos, sansDossierConcert: true, bake: async (d) => d, onProgress: (f, t) => vus.push([f, t]) });
  assert.equal(count, 3);
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  assert.deepEqual(noms(zip), ["01_Symphonie_n°_5_Allegro_Final/Photo_01_Percu_1_Avant_Gauche.jpg", "01_Symphonie_n°_5_Allegro_Final/Photo_02_Percu_1_Fond_haut.png", "02_Œuvre_courte/Photo_01.jpg"]);
  assert.deepEqual(vus[vus.length - 1], [3, 3]);
});

test("lot 7 : tout sur l'accueil, un dossier par concert puis par pièce ; deux concerts du même nom restent distincts", async () => {
  const c2 = { ...concert, id: "c2", pieces: [{ ...piece2, id: "p9" }] };
  const { blob } = await construireZipPhotos({ groupes: [{ concert }, { concert: c2 }], photos: { ...photos, p9: [{ dataUrl: JPG }] }, bake: async (d) => d });
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const l = noms(zip);
  assert.ok(l.every((n) => n.startsWith("Concert_d_automne_2_3_20_novembre_2026/") || n.startsWith("Concert_d_automne_2_3_20_novembre_2026_2/")), l.join("\n"));
  assert.equal(l.length, 4);
});

test("lot 7 : aucune photo, aucun zip", async () => {
  const r = await construireZipPhotos({ groupes: [{ concert }], photos: {}, bake: async (d) => d });
  assert.deepEqual(r, { blob: null, count: 0 });
});

test("plans de la pièce : liste, sinon ancien champ", () => {
  assert.deepEqual(plansDeLaPiece({ plans: ["a"], planDataUrl: "b" }), ["a"]);
  assert.deepEqual(plansDeLaPiece({ planDataUrl: "b" }), ["b"]);
  assert.deepEqual(plansDeLaPiece({}), []);
});

test("aucun tiret cadratin dans les fichiers sources produisant du texte du lot", () => {
  for (const f of ["archive.js", "archiveBuilder.js", "archiveImages.js", "ArchiveUi.jsx", "photoExport.js"]) {
    const src = fs.readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
    assert.ok(!/\u2014/.test(src), f + " contient un tiret cadratin");
  }
});
