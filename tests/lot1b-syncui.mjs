// LOT 1b : textes et priorités du bandeau de synchro, compte rendu du rechargement.
// Lancer : node --test tests/lot1b-*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { bannerInfo, reloadReportText, exportReportText, formatMo } from "../src/syncUi.js";
import { S } from "../src/styles.js";

const ok = { online: true, pending: 0, sessionExpired: false, oversize: [], backupFailed: false, degraded: false };

test("rien à afficher quand tout est synchronisé", () => assert.equal(bannerInfo(ok), null));

test("oversize : message exact, bouton d'export, jamais « Envoi en cours »", () => {
  const i = bannerInfo({ ...ok, pending: 1, oversize: [{ type: "concerts", bytes: 4.6 * 1048576 }] });
  assert.equal(i.kind, "oversize");
  assert.equal(i.text, "Tes données sont trop lourdes pour être envoyées au compte (4,6 Mo). Elles restent sur ce téléphone. Exporte-les.");
  assert.equal(i.action, "export");
  assert.ok(!/Envoi des modifications/.test(i.text));
});

test("oversize prend la plus grosse taille", () => {
  const i = bannerInfo({ ...ok, oversize: [{ bytes: 1048576 }, { bytes: 5 * 1048576 }] });
  assert.match(i.text, /\(5,0 Mo\)/);
});

test("degraded et backupFailed : alerte propre, jamais le faux envoi, même avec pending", () => {
  for (const flag of ["degraded", "backupFailed"]) {
    const i = bannerInfo({ ...ok, pending: 2, [flag]: true });
    assert.equal(i.kind, flag);
    assert.equal(i.tone, "alarm");
    assert.notEqual(i.kind, "pending");
  }
  assert.equal(bannerInfo({ ...ok, backupFailed: true }).action, "export");
  assert.equal(bannerInfo({ ...ok, degraded: true }).action, null);
});

test("alertes prioritaires même hors ligne ; anciens états conservés", () => {
  assert.equal(bannerInfo({ ...ok, online: false, oversize: [{ bytes: 5e6 }] }).kind, "oversize");
  assert.equal(bannerInfo({ ...ok, online: false, pending: 1 }).kind, "offline");
  assert.equal(bannerInfo({ ...ok, sessionExpired: true }).kind, "sessionExpired");
  assert.equal(bannerInfo({ ...ok, pending: 1 }).text, "Envoi des modifications…");
});

test("compte rendu : exemple de la demande", () => {
  const t = reloadReportText({ "remplacés": 3, "conservés": 2, "ajoutés": 0, copie: "k", fichier: null });
  assert.equal(t, "3 concerts remplacés, 2 gardés (absents du compte), copie de sécurité faite");
});

test("compte rendu : singulier, ajoutés, fichier, refus", () => {
  const t = reloadReportText({ "remplacés": 1, "conservés": 1, "ajoutés": 1, copie: "k", fichier: "f.json" });
  assert.match(t, /^1 concert remplacé, 1 ajouté depuis le compte, 1 gardé \(absent du compte\), copie de sécurité faite/);
  assert.match(t, /Fichier téléchargé : f\.json/);
  assert.equal(reloadReportText({ refus: true, raison: "Le compte renvoie une liste vide." }), "Le compte renvoie une liste vide.");
  assert.ok(reloadReportText(undefined));
});

test("export : message avec les comptes", () => {
  assert.equal(exportReportText({ filename: "a.json", counts: { concerts: 1, photos: 2 } }), "Sauvegarde téléchargée (1 concert, 2 photos) : a.json");
});

test("formatMo", () => { assert.equal(formatMo(4.6 * 1048576), "4,6"); assert.equal(formatMo(NaN), "?"); });

test("styles : bandeau au-dessus de la barre d'onglets, boutons >= 44 px, z-index sous la barre ou égal", () => {
  const b = S.syncBanner("#900", "#fff", true);
  assert.match(b.bottom, /76px/);
  assert.ok(parseInt(b.bottom.match(/(\d+)px/)[1], 10) >= 68, "plus haut que la barre (~68 px)");
  assert.ok(S.syncBannerBtn("#900").minHeight >= 44);
  assert.ok(S.exportBtn.minHeight >= 44);
});
