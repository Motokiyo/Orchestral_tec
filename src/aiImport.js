// Lecture IA d'un plan : tout ce qui décide ce qu'on garde, ce qu'on rejette et ce qu'on montre.
//
// Principe (LOT 2, « OrkMap arrête d'inventer ») : on ne complète jamais la scène avec ce qui n'a pas
// été observé ; « inconnu » vaut mieux qu'une fausse certitude ; aucun échec n'est silencieux.
// Ce fichier ne dépend ni de React ni du navigateur : il est testé en Node (tests/lot2-*.mjs).

// ── Limites et valeurs « inconnu » (les deux dernières doivent rester identiques à api/extract-ai.js) ──
export const MAX_AI_PAGES = 8;
// La plateforme (Vercel) refuse un corps de requête de plus de 4,5 Mo. On reste en dessous, avec
// de la marge pour l'enveloppe JSON. Aucune compression : une image dégradée ne se lirait plus.
export const MAX_AI_BODY_BYTES = 4_300_000;
const BODY_OVERHEAD_BYTES = 2_000;
// Un peu plus que le délai du serveur (50 s) et moins que son maxDuration (60 s) + marge réseau.
export const AI_CLIENT_TIMEOUT_MS = 70_000;
export const UNKNOWN_POLE_NAME = "Poste sans nom (à vérifier)";
export const UNKNOWN_CAT = "Non classé";

const MIME_OK = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export class AiExtractionError extends Error {
  constructor(message, { kind = "technical", status = null, code = null, warnings = [], pages = null } = {}) {
    super(message);
    this.name = "AiExtractionError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.warnings = warnings;
    this.pages = pages;
  }
}

export function formatMo(bytes) {
  return (bytes / 1_000_000).toFixed(1).replace(".", ",") + " Mo";
}

export function pagesSummary(total, analysed) {
  return `${analysed} page${analysed > 1 ? "s" : ""} sur ${total} analysée${analysed > 1 ? "s" : ""}`;
}

const isInt = (n) => Number.isInteger(n) && n > 0;

/**
 * Prépare les pages à envoyer à l'IA : contrôle de format, de nombre et de taille AVANT l'envoi.
 * Toute page non envoyée est listée avec sa raison. Aucune image n'est modifiée ni compressée.
 * @param {string[]} pages  images (data URL) dans l'ordre
 * @param {{pageNumbers?: number[], totalPages?: number, failedPages?: number[]}} opts
 *   pageNumbers : numéro d'origine de chaque image (si certaines pages n'ont pas pu être rendues)
 *   failedPages : pages du document qui n'ont pas pu être transformées en image
 */
export function planAiPages(pages, opts = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const numbers = Array.isArray(opts.pageNumbers) && opts.pageNumbers.length === list.length && opts.pageNumbers.every(isInt)
    ? opts.pageNumbers
    : list.map((_, i) => i + 1);
  const failed = (Array.isArray(opts.failedPages) ? opts.failedPages : []).filter(isInt);
  const skipped = failed.map((page) => ({ page, reason: "page illisible : sa transformation en image a échoué" }));
  const images = [];
  const pageNumbers = [];
  let bytes = BODY_OVERHEAD_BYTES;
  list.forEach((url, i) => {
    const page = numbers[i];
    if (typeof url !== "string" || !MIME_OK.test(url)) {
      skipped.push({ page, reason: "format d'image non pris en charge (JPEG, PNG ou WebP attendus)" });
      return;
    }
    if (images.length >= MAX_AI_PAGES) {
      skipped.push({ page, reason: `au-delà de la limite de ${MAX_AI_PAGES} pages par lecture` });
      return;
    }
    const size = url.length + 4;
    if (bytes + size > MAX_AI_BODY_BYTES) {
      skipped.push({
        page,
        reason: `page trop lourde pour l'envoi (${formatMo(size)} ; il reste ${formatMo(Math.max(0, MAX_AI_BODY_BYTES - bytes))} sur ${formatMo(MAX_AI_BODY_BYTES)} par envoi). Elle n'est pas compressée pour rester lisible`,
      });
      return;
    }
    images.push(url);
    pageNumbers.push(page);
    bytes += size;
  });
  skipped.sort((a, b) => a.page - b.page);
  const total = Math.max(isInt(opts.totalPages) ? opts.totalPages : 0, list.length + failed.length);
  return { images, pageNumbers, total, sent: images.length, skipped, bytes };
}

/** Message clair quand aucune page ne peut partir (rien n'est envoyé). */
export function noPageError(plan) {
  const heavy = plan.skipped.some((s) => /trop lourde/.test(s.reason));
  const detail = plan.skipped.slice(0, 4).map((s) => `page ${s.page} : ${s.reason}`).join(" ; ");
  const message = heavy
    ? `Aucune page n'a pu être envoyée à l'IA (${detail}). L'envoi est limité à ${formatMo(MAX_AI_BODY_BYTES)} (la plateforme refuse plus de 4,5 Mo par requête). Les pages ne sont pas compressées pour que le plan reste lisible : réduisez le PDF (moins de pages ou résolution plus faible) puis réessayez.`
    : `Aucune page exploitable pour l'IA${detail ? ` (${detail})` : ""}.`;
  return new AiExtractionError(message, { kind: heavy ? "too_large" : "no_page", pages: { total: plan.total, analysed: 0, skipped: plan.skipped } });
}

// ───────────────────────── États de la lecture IA ─────────────────────────
// aiStatus (stocké sur la pièce, additif : absent sur les anciens concerts)
//   state        : "ok" | "partial" | "failed" | "skipped"
//   percusState  : "lues" | "absence_confirmee" | "vide_ou_illisible" | "non_lues" | "locale"
//   message      : raison (échec technique)
//   warnings     : avertissements du serveur et de l'IA
//   pages        : { total, analysed, skipped: [{ page, reason }] } | null
//   localPercusIgnored : nombre de postes lus localement qui n'ont PAS été repris
//   percusNonVerifiees : (état « skipped ») nombre de postes locaux gardés mais marqués nonVerifie
//   dismissed    : le bandeau a été fermé par l'utilisateur

function makeStatus(state, over = {}) {
  return {
    state, percusState: null, message: "", warnings: [], pages: null,
    localPercusIgnored: 0, at: new Date().toISOString(), dismissed: false, ...over,
  };
}

const SECTIONS = ["bois", "cuivres", "cordes", "autres"];
const hasOrchestre = (o) => !!o && typeof o === "object" && SECTIONS.some((k) => Array.isArray(o[k]) && o[k].length > 0);
const triSansChef = (...vals) => { for (const v of vals) if (typeof v === "boolean") return v; return null; };

/**
 * Fusionne la lecture IA et la lecture locale d'une pièce SANS jamais compléter la scène :
 *  - des percussions lues par l'IA remplacent le local ;
 *  - une liste vide avec absence confirmée reste vide ;
 *  - une liste vide ou illisible reste vide ET est signalée (le local erroné ne revient pas).
 */
export function mergeAiIntoLocal(local, ai, deps = {}) {
  const decode = typeof deps.decodeEffectif === "function" ? deps.decodeEffectif : () => null;
  const meta = (ai && ai.aiMeta) || {};
  const warnings = Array.isArray(meta.warnings) ? [...meta.warnings] : [];
  const aiPercus = Array.isArray(ai.percus) ? ai.percus : [];
  const localPercusCount = Array.isArray(local.percus) ? local.percus.length : 0;

  let percus; let percusState;
  if (aiPercus.length > 0) { percus = aiPercus; percusState = "lues"; }
  else if (meta.percusStatut === "aucune") { percus = []; percusState = "absence_confirmee"; }
  else { percus = []; percusState = "vide_ou_illisible"; }

  let orchestre;
  if (hasOrchestre(ai.orchestre)) orchestre = ai.orchestre;
  else {
    orchestre = local.orchestre || null;
    warnings.push(orchestre
      ? "Effectif non lu par l'IA : l'orchestre vient de la lecture locale du fichier, à vérifier."
      : "Effectif non lu par l'IA : aucun orchestre n'a pu être lu.");
  }

  const effectif = ai.effectif || local.effectif || "";
  const effectifDetail = ai.effectif ? decode(ai.effectif) : local.effectifDetail;
  if (ai.effectif && !effectifDetail) warnings.push(`Nomenclature « ${ai.effectif} » non reconnue : décompte de l'effectif à vérifier.`);

  const pages = meta.pages || null;
  const skippedCount = pages && Array.isArray(pages.skipped) ? pages.skipped.length : 0;
  const needsLook = percusState === "vide_ou_illisible" || warnings.length > 0 || skippedCount > 0;
  const aiStatus = makeStatus(needsLook ? "partial" : "ok", {
    percusState, warnings, pages,
    localPercusIgnored: percusState === "lues" ? 0 : localPercusCount,
  });

  const fusion = {
    ...local,
    titre: ai.titre || local.titre || "",
    compositeur: ai.compositeur || local.compositeur || "",
    duree: ai.duree || local.duree || "",
    salle: ai.salle || local.salle || "",
    chef: ai.chef || local.chef || "",
    date: ai.date || local.date || "",
    sansChef: triSansChef(ai.sansChef, local.sansChef),
    effectif,
    effectifDetail: effectifDetail || null,
    // Effectif remis en ordre Daniels : on garde la ligne écrite sur le plan qui correspond à l'effectif retenu
    effectifBrut: ai.effectif ? ai.effectifBrut : local.effectifBrut,
    effectifPercus: ai.effectifPercus || (ai.effectif ? null : local.effectifPercus) || null,
    // Plan de détail percussion seul (un poste dessiné à part) : à proposer en ajout à une pièce existante
    detailPercussion: ai.detailPercussion === true,
    orchestre,
    percus,
    mobilierObserve: Array.isArray(ai.mobilierObserve) ? ai.mobilierObserve : [],
    aiStatus,
  };
  if (!fusion.effectifBrut) delete fusion.effectifBrut;
  return fusion;
}

/** État « échec technique » (sans toucher aux données de la pièce). */
export function aiFailedStatus(err, localPercusIgnored = 0) {
  const message = (err && err.message) ? String(err.message) : "Erreur inconnue";
  return makeStatus("failed", {
    percusState: "non_lues",
    message,
    warnings: Array.isArray(err && err.warnings) ? err.warnings : [],
    pages: (err && err.pages) || null,
    localPercusIgnored,
  });
}

/** Échec technique : on garde ce qui est du texte lu localement, JAMAIS les percussions devinées. */
export function failedAiLocal(local, err) {
  return {
    ...local,
    percus: [],
    sansChef: triSansChef(local.sansChef),
    mobilierObserve: [],
    aiStatus: aiFailedStatus(err, Array.isArray(local.percus) ? local.percus.length : 0),
  };
}

/** Hors ligne : l'IA n'a pas été interrogée (décision du 23/09 : lecture locale seule), c'est dit et visible. */
export function offlineAiLocal(local) {
  // Les percussions lues localement sont GARDÉES (rien n'est jeté sans réseau), mais marquées « non
  // vérifiées » : sur un plan image, cette lecture n'est pas fiable. Elles ne sont pas présentées comme lues.
  const localPercus = Array.isArray(local.percus) ? local.percus : [];
  return {
    ...local,
    percus: localPercus.map((pole) => (pole && typeof pole === "object" ? { ...pole, nonVerifie: true } : pole)),
    sansChef: triSansChef(local.sansChef),
    mobilierObserve: [],
    aiStatus: makeStatus("skipped", { percusState: "locale", message: "Pas de réseau", percusNonVerifiees: localPercus.length }),
  };
}

/** État IA d'une pièce déjà existante (bouton « Extraire par IA »), sans toucher à ses données. */
export function aiStatusFromResult(ai, localPercusCount = 0) {
  const meta = (ai && ai.aiMeta) || {};
  const warnings = Array.isArray(meta.warnings) ? [...meta.warnings] : [];
  const n = Array.isArray(ai && ai.percus) ? ai.percus.length : 0;
  const percusState = n > 0 ? "lues" : meta.percusStatut === "aucune" ? "absence_confirmee" : "vide_ou_illisible";
  const pages = meta.pages || null;
  const skippedCount = pages && Array.isArray(pages.skipped) ? pages.skipped.length : 0;
  const needsLook = percusState === "vide_ou_illisible" || warnings.length > 0 || skippedCount > 0;
  return makeStatus(needsLook ? "partial" : "ok", { percusState, warnings, pages, localPercusIgnored: 0 });
}

export function dismissAiStatus(status) {
  return { ...(status || {}), dismissed: true };
}

const MAX_LISTED = 5;
/**
 * Contenu du bandeau « Lecture IA … » pour une pièce, ou null s'il n'y a rien à montrer
 * (ancien concert, lecture sans réserve, bandeau fermé). Tolère tout état incomplet.
 */
export function aiBannerInfo(piece) {
  const st = piece && piece.aiStatus;
  if (!st || typeof st !== "object" || typeof st.state !== "string" || st.dismissed) return null;
  if (st.state === "ok") return null;
  const lines = [];
  let title;
  if (st.state === "failed") {
    title = "Lecture IA échouée, données à vérifier";
    lines.push(`Raison : ${st.message || "erreur inconnue"}`);
  } else if (st.state === "skipped") {
    title = "Lecture IA non faite (hors ligne), données à vérifier";
    lines.push("Import fait avec la lecture locale seulement. Relance « Extraire les données par IA » quand le réseau revient.");
    if (st.percusNonVerifiees > 0) {
      lines.push(`${st.percusNonVerifiees} poste(s) de percussion viennent de la lecture locale du fichier : NON vérifiés, ils n'ont pas été lus par l'IA.`);
    }
  } else if (st.state === "partial") {
    title = "Lecture IA incomplète, données à vérifier";
  } else return null;

  const pages = st.pages && typeof st.pages === "object" ? st.pages : null;
  const skipped = pages && Array.isArray(pages.skipped) ? pages.skipped : [];
  if (pages && typeof pages.total === "number" && (skipped.length > 0 || (st.state === "partial" && pages.total > 1))) {
    lines.push(pagesSummary(pages.total, typeof pages.analysed === "number" ? pages.analysed : pages.total - skipped.length));
    skipped.slice(0, MAX_LISTED).forEach((s) => lines.push(`page ${s.page} non analysée : ${s.reason}`));
    if (skipped.length > MAX_LISTED) lines.push(`… et ${skipped.length - MAX_LISTED} autre(s) page(s) non analysée(s).`);
  }
  if (st.state === "partial" && st.percusState === "vide_ou_illisible") {
    lines.push("Liste de percussions vide ou illisible : l'IA n'a confirmé ni leur présence ni leur absence.");
  }
  if ((st.state === "partial" || st.state === "failed") && st.localPercusIgnored > 0) {
    lines.push(`${st.localPercusIgnored} poste(s) de percussion lu(s) localement n'ont pas été repris : cette lecture n'est pas fiable sur un plan.`);
  }
  if (st.state === "failed") lines.push("Relance « Extraire les données par IA » ou saisis les percussions à la main.");
  (Array.isArray(st.warnings) ? st.warnings : []).slice(0, 8).forEach((w) => lines.push(String(w)));
  return { title, lines, tone: st.state === "failed" ? "error" : "warning" };
}
