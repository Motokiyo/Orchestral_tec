// Textes et choix d'affichage du bandeau de synchro et du rechargement depuis le compte.
// Fonctions pures (sans React) pour pouvoir les tester : tests/lot1b-*.mjs.

export function formatMo(bytes) {
  const mo = Number(bytes) / 1048576;
  if (!Number.isFinite(mo)) return "?";
  return mo.toFixed(1).replace(".", ",");
}

const plural = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

// Renvoie null (rien à afficher) ou { kind, text, tone, action, card, also }.
// action : "export" | "reconnect" | "retry" | null. card : vrai = encart avec bouton, faux = pastille.
// Ordre de priorité : un état d'alerte masque toujours « Envoi en cours » (qui serait faux).
// `also` : quand une alerte de stockage (encart) est affichée, l'état du réseau qui demande
// une action ou une attention (« Hors ligne », « Session expirée ») n'est jamais caché : il est
// donné ici, et l'écran l'affiche dans le même encart.
function networkInfo({ online, pending, sessionExpired }) {
  if (!online) {
    return {
      kind: "offline", tone: "warn", action: "retry", card: false,
      text: pending ? "Hors ligne · modifications gardées, envoi au retour du réseau" : "Hors ligne · tes données restent sur le téléphone",
    };
  }
  if (sessionExpired) {
    return { kind: "sessionExpired", tone: "alarm", action: "reconnect", card: false, text: "Session expirée · touche pour te reconnecter" };
  }
  return null;
}

// Texte « trop lourd » selon ce qui bloque : concerts, une image de plan, partitions (ou inconnu).
function oversizeText(list) {
  const biggest = list.reduce((best, o) => ((Number(o?.bytes) || 0) > (Number(best?.bytes) || 0) ? o : best), list[0]);
  const mo = formatMo(Number(biggest?.bytes) || 0);
  if (biggest?.what === "plan") {
    return `Un plan est trop lourd pour être envoyé au compte (${mo} Mo). Tes concerts restent sur ce téléphone et ne partent pas tant que ce plan est là. Exporte-les.`;
  }
  if (biggest?.type === "concerts") {
    return `Tes concerts sont trop lourds pour être envoyés au compte (${mo} Mo). Ils restent sur ce téléphone. Exporte-les.`;
  }
  if (biggest?.type === "omr-scores") {
    return `Tes partitions sont trop lourdes pour être envoyées au compte (${mo} Mo). Elles restent sur ce téléphone. Exporte-les.`;
  }
  return `Tes données sont trop lourdes pour être envoyées au compte (${mo} Mo). Elles restent sur ce téléphone. Exporte-les.`;
}

export function bannerInfo({ online, pending, sessionExpired, oversize, backupFailed, degraded, imageRetry, unsentPlans, upgradeBlocked } = {}) {
  const network = networkInfo({ online, pending, sessionExpired });
  const withNetwork = (info) => (network ? { ...info, also: network } : info);
  // Lot 6 : la base du téléphone passe en version 5 ; une autre fenêtre OrkMap (ancienne version) la retient.
  if (upgradeBlocked) {
    return withNetwork({
      kind: "upgradeBlocked", tone: "alarm", action: null, card: true,
      text: "Ferme les autres fenêtres OrkMap pour terminer la mise à jour. Tes données sont gardées.",
    });
  }
  const list = Array.isArray(oversize) ? oversize.filter(Boolean) : [];
  // Les photos n'ont jamais été envoyées au compte (chantier séparé) : un avis discret, pas une alarme.
  const photosBig = list.filter((o) => o.type === "photos");
  const dataBig = list.filter((o) => o.type !== "photos");
  if (dataBig.length > 0) {
    return withNetwork({ kind: "oversize", tone: "alarm", action: "export", card: true, text: oversizeText(dataBig) });
  }
  if (degraded) {
    return withNetwork({
      kind: "degraded", tone: "alarm", action: null, card: true,
      text: "La mémoire du téléphone répond très lentement. Tes modifications sont gardées, mais rien n'est envoyé au compte pour l'instant.",
    });
  }
  if (network) return network;
  // Une image de plan a été refusée pour une raison passagère : les concerts attendent son nouvel essai
  // (1, 5, 15, puis 60 min). On le dit, au lieu d'un « Envoi des modifications… » qui ne finit jamais.
  if (pending && imageRetry) {
    return { kind: "imageRetry", tone: "warn", action: "retry", card: false, text: "Sauvegarde en ligne en échec, nouvel essai plus tard" };
  }
  if (pending) return { kind: "pending", tone: "neutral", action: "retry", card: false, text: "Envoi des modifications…" };
  // Plans non sauvegardés en ligne, photos gardées sur le téléphone et copie de secours impossible : JAMAIS de pastille permanente
  // (17/11/2026, elle gênait l'usage). L'information est donnée sous le bouton d'export (noteStockage).
  return null;
}

// Compte rendu du rechargement depuis le compte, en français simple.
export function reloadReportText(r) {
  if (!r) return "Le rechargement n'a rien renvoyé : rien n'a été changé.";
  if (r.refus) return r.raison || "Rechargement refusé : rien n'a été changé.";
  const remplaces = r["remplacés"] || 0;
  const gardes = r["conservés"] || 0;
  const ajoutes = r["ajoutés"] || 0;
  const parts = [`${plural(remplaces, "concert remplacé", "concerts remplacés")}`];
  if (ajoutes > 0) parts.push(`${plural(ajoutes, "ajouté", "ajoutés")} depuis le compte`);
  if (gardes > 0) parts.push(`${plural(gardes, "gardé", "gardés")} (${gardes > 1 ? "absents" : "absent"} du compte)`);
  const manquants = r.plansManquants || 0;
  if (manquants > 0) parts.push(`${plural(manquants, "gardé", "gardés")} en version du téléphone (plans du compte non téléchargés, réessaie plus tard)`);
  parts.push(r.copie ? "copie de sécurité faite" : "pas de copie nécessaire (rien en local)");
  let text = parts.join(", ");
  if (r.fichier) text += `.\nFichier téléchargé : ${r.fichier}`;
  return text;
}

export function exportReportText(info) {
  const c = info?.counts || {};
  const n = (x) => (Number.isFinite(x) ? x : 0);
  const absents = n(info?.plansNonInclus);
  const note = absents > 0 ? `\n${plural(absents, "plan n'est pas", "plans ne sont pas")} sur ce téléphone (jamais téléchargé${absents > 1 ? "s" : ""} du compte) : ${absents > 1 ? "ils restent" : "il reste"} sur le compte, pas dans ce fichier.` : "";
  return `Sauvegarde téléchargée (${plural(n(c.concerts), "concert", "concerts")}, ${plural(n(c.photos), "photo", "photos")}) : ${info?.filename || "fichier"}${note}`;
}

// Information de stockage montrée sous « Exporter toutes mes données » (accueil), jamais en pastille.
export function noteStockage({ oversize, backupFailed, unsentPlans } = {}) {
  const list = Array.isArray(oversize) ? oversize : [];
  const photos = list.filter((o) => o && o.type === "photos");
  const parts = [];
  if (photos.length > 0) {
    const bytes = photos.reduce((max, o) => Math.max(max, Number(o?.bytes) || 0), 0);
    parts.push(`Tes photos (${formatMo(bytes)} Mo) restent sur ce téléphone, sans copie en ligne : exporte-les de temps en temps.`);
  }
  if (unsentPlans > 0) parts.push(`${plural(unsentPlans, "plan reste", "plans restent")} sur ce téléphone seulement (trop lourd${unsentPlans > 1 ? "s" : ""} pour le compte).`);
  if (backupFailed) parts.push("La copie de secours interne du téléphone n'a pas pu être faite (place) ; tes données restent gardées.");
  return parts.join(" ");
}
