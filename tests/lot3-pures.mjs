// LOT 3 : défauts de la relecture hostile qui se testent sur des fonctions pures.
// C3 bandeau, C4 chef inconnu, M2 annotation [Cel/Pno], M3 import hors ligne.
// Lancer : node --test tests/lot3-pures.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { imp } from "./support/lot3-env.mjs";

const { bannerInfo } = await imp("src/syncUi.js");
const U = await imp("src/utils.js");
const P = await imp("src/pdfParser.js");
const AI = await imp("src/aiImport.js");

// ───────────── C3 : le bandeau ne cache ni « Session expirée » ni « Hors ligne » ─────────────
const ok = { online: true, pending: 0, sessionExpired: false, oversize: [], backupFailed: false, degraded: false };

test("C3 : une alerte de stockage n'efface pas « Session expirée »", () => {
  for (const flag of [{ degraded: true }, { oversize: [{ bytes: 5e6 }] }]) {
    const i = bannerInfo({ ...ok, pending: 1, sessionExpired: true, ...flag });
    assert.ok(i.also, "second état présent : " + JSON.stringify(flag));
    assert.equal(i.also.kind, "sessionExpired");
    assert.equal(i.also.action, "reconnect");
    assert.match(i.also.text, /Session expirée/);
  }
});

test("C3 : une alerte de stockage n'efface pas « Hors ligne »", () => {
  const i = bannerInfo({ ...ok, online: false, pending: 1, degraded: true });
  assert.equal(i.kind, "degraded");
  assert.equal(i.also.kind, "offline");
  // copie de secours impossible : discrète, « Hors ligne » reste affiché
  assert.equal(bannerInfo({ ...ok, online: false, pending: 1, backupFailed: true }).kind, "offline");
  assert.match(i.also.text, /^Hors ligne/);
});

test("C3 : hors ligne prime sur session expirée (sans réseau, on ne peut pas se reconnecter)", () => {
  assert.equal(bannerInfo({ ...ok, online: false, sessionExpired: true, degraded: true }).also.kind, "offline");
});

test("C3 : sans alerte de stockage, l'état du réseau reste seul et inchangé ; jamais de faux « Envoi en cours »", () => {
  assert.equal(bannerInfo({ ...ok, sessionExpired: true, pending: 1 }).kind, "sessionExpired");
  assert.equal(bannerInfo({ ...ok, sessionExpired: true }).also, undefined);
  assert.equal(bannerInfo({ ...ok, backupFailed: true, pending: 3 }).also, undefined, "l'envoi en cours reste masqué par l'alerte");
  assert.equal(bannerInfo(ok), null);
});

// ───────────── C4 : chef inconnu ─────────────
const orch = { bois: ["2 Flûtes"], cuivres: ["2 Cors"], cordes: ["6 Violons I", "4 Violons II", "2 Contrebasses"], autres: [] };
const calc = (sansChef) => U.calculateMobilier(orch, [], U.chefOptions(sansChef));
const types = (m) => m.stands.autres.map((s) => s.type);

test("C4 : chef présent = son mobilier ; chef absent = aucun ; chef inconnu = non compté et signalé", () => {
  const present = calc(false); const absent = calc(true); const inconnu = calc(null);
  assert.deepEqual(types(present), ["Podium chef", "Pupitre chef"]);
  assert.equal(present.general.chaisesHautes, absent.general.chaisesHautes + 1);
  assert.equal(present.general.pupitres, absent.general.pupitres + 1);
  assert.deepEqual(types(absent), []);
  assert.equal(absent.general.chefAConfirmer, undefined);
  assert.deepEqual(types(inconnu), [], "pas de podium ni de pupitre de chef inventés");
  assert.equal(inconnu.general.pupitres, absent.general.pupitres);
  assert.equal(inconnu.general.chaisesHautes, absent.general.chaisesHautes);
  assert.equal(inconnu.general.chefAConfirmer, true);
  // 17/11/2026 : champ absent = pièce ANCIENNE, qui gardait son chef : elle le garde (rien ne disparaît au recalcul).
  assert.equal(calc(undefined).general.chefAConfirmer, undefined, "ancienne pièce : chef gardé");
  assert.deepEqual(types(calc(undefined)), types(present), "ancienne pièce : même mobilier qu'un chef présent");
});

test("C4 : l'export TXT ne compte pas le chef inconnu et le dit « à confirmer »", () => {
  const piece = (sansChef) => ({ titre: "T", orchestre: orch, percus: [], couleur: "bleu", sansChef });
  const inconnu = U.generateMobilierStandaloneText(piece(null));
  assert.doesNotMatch(inconnu, /Podium chef|Pupitre chef|\(chef\)/);
  assert.match(inconnu, /Chef : présence non lue, à confirmer/);
  for (const texte of [U.generateTxt(piece(null)), U.generatePieceText(piece(null))]) {
    assert.doesNotMatch(texte, /Podium chef|Pupitre chef|\(chef\)/);
    assert.match(texte, /à confirmer/);
  }
  const present = U.generateMobilierStandaloneText(piece(false));
  assert.match(present, /Podium chef/);
  assert.doesNotMatch(present, /à confirmer/);
  const absent = U.generateMobilierStandaloneText(piece(true));
  assert.doesNotMatch(absent, /Podium chef|à confirmer/);
});

test("C4 : plus aucun appel ne déduit le chef par « !sansChef »", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { ROOT } = await import("./support/lot3-env.mjs");
  for (const f of ["src/App.jsx", "src/utils.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /hasChef:\s*!\w+\.sansChef/, f);
  }
});

// ───────────── M2 : « [Cel/Pno] » ne fait plus afficher « + ? » ─────────────
test("M2 : effectif standard avec [Cel/Pno] : tout est lu, aucune ligne « sans quantité »", () => {
  const o = P.orchestreFromEffectif(P.decodeEffectif("3.3.3.3 - 4.3.3.1 - 2.4.0.1 [Cel/Pno] - 14.12.10.8.6"));
  const t = U.countOrchestreMusicians(o);
  assert.equal(t.unknown, 0, JSON.stringify(o.autres));
  assert.equal(U.formatMusicianTotal(t), String(t.total));
  assert.ok(o.autres.some((x) => /Cel\/Pno/.test(x)), "l'annotation reste visible");
  assert.equal(U.calculateMobilier(o, [], { hasChef: true }).general.quantitesInconnues, undefined);
});

test("M2 : une vraie ligne sans quantité (« Célesta ») reste signalée", () => {
  assert.equal(U.countOrchestreMusicians({ bois: [], cuivres: [], cordes: [], autres: ["Célesta", "[Cel/Pno]"] }).unknown, 1);
  assert.equal(U.extractNumberFromItem("Célesta"), null);
});

// ───────────── M3 : import hors ligne ─────────────
test("M3 : hors ligne, les percussions locales sont gardées mais marquées « non vérifiées »", () => {
  const local = { titre: "T", percus: [{ nom: "Timbalier", items: [{ nom: "Timbales" }] }, { nom: "Percu 2", items: [] }], sansChef: null };
  const r = AI.offlineAiLocal(local);
  assert.equal(r.percus.length, 2, "rien n'est jeté");
  assert.ok(r.percus.every((p) => p.nonVerifie === true));
  assert.equal(local.percus[0].nonVerifie, undefined, "l'objet d'origine n'est pas modifié");
  assert.equal(r.aiStatus.state, "skipped");
  assert.equal(r.aiStatus.percusNonVerifiees, 2);
  const banner = AI.aiBannerInfo(r);
  assert.ok(banner.lines.some((l) => /2 poste\(s\) de percussion/.test(l) && /NON vérifiés/.test(l)), JSON.stringify(banner.lines));
  const txt = U.generatePercusGlobalText(r.percus);
  assert.match(txt, /Pôle 1 : Timbalier \(NON VÉRIFIÉ/);
  assert.match(txt, /Pôle 2 : Percu 2 \(NON VÉRIFIÉ/);
});

test("M3 : sans percussion locale, aucun message parasite ; une pièce lue par l'IA n'est pas marquée", () => {
  const r = AI.offlineAiLocal({ titre: "T", percus: [] });
  assert.equal(r.aiStatus.percusNonVerifiees, 0);
  assert.ok(!AI.aiBannerInfo(r).lines.some((l) => /percussion/.test(l)));
  assert.doesNotMatch(U.generatePercusGlobalText([{ nom: "Timbalier", items: [] }]), /NON VÉRIFIÉ/);
});
