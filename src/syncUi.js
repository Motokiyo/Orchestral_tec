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

export function bannerInfo({ online, pending, sessionExpired, oversize, backupFailed, degraded } = {}) {
  const network = networkInfo({ online, pending, sessionExpired });
  const withNetwork = (info) => (network ? { ...info, also: network } : info);
  const tooBig = Array.isArray(oversize) && oversize.length > 0;
  if (tooBig) {
    const bytes = oversize.reduce((max, o) => Math.max(max, Number(o?.bytes) || 0), 0);
    return withNetwork({
      kind: "oversize", tone: "alarm", action: "export", card: true,
      text: `Tes données sont trop lourdes pour être envoyées au compte (${formatMo(bytes)} Mo). Elles restent sur ce téléphone. Exporte-les.`,
    });
  }
  if (degraded) {
    return withNetwork({
      kind: "degraded", tone: "alarm", action: null, card: true,
      text: "La mémoire du téléphone répond très lentement. Tes modifications sont gardées, mais rien n'est envoyé au compte pour l'instant.",
    });
  }
  if (backupFailed) {
    return withNetwork({
      kind: "backupFailed", tone: "alarm", action: "export", card: true,
      text: "La mémoire de secours du téléphone est pleine. Exporte tes données en fichier pour ne rien perdre.",
    });
  }
  if (network) return network;
  if (pending) return { kind: "pending", tone: "neutral", action: "retry", card: false, text: "Envoi des modifications…" };
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
  parts.push(r.copie ? "copie de sécurité faite" : "pas de copie nécessaire (rien en local)");
  let text = parts.join(", ");
  if (r.fichier) text += `.\nFichier téléchargé : ${r.fichier}`;
  return text;
}

export function exportReportText(info) {
  const c = info?.counts || {};
  const n = (x) => (Number.isFinite(x) ? x : 0);
  return `Sauvegarde téléchargée (${plural(n(c.concerts), "concert", "concerts")}, ${plural(n(c.photos), "photo", "photos")}) : ${info?.filename || "fichier"}`;
}
