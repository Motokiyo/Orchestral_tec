// Lot 6 : affichage d'un plan dont l'image est rangée à part (magasin local « images »).
// La valeur de plans[] est soit l'image elle-même (data URL, plan tout juste importé), soit une référence
// « orkimg:<empreinte> ». L'image est chargée au moment où le plan s'affiche : cache mémoire limité, sinon
// magasin du téléphone (hors ligne compris), sinon téléchargée du compte si le réseau est là, sinon un
// cadre avec message. Plein écran, filigrane et lecture IA reçoivent la vraie image.
// Relecture : quand la valeur change (image rangée → sa référence), l'image déjà affichée reste à l'écran
// jusqu'à ce que la nouvelle soit prête (pas de cadre transitoire) ; le chargement a un délai
// (loadPlanImage), après quoi un cadre explique pourquoi, et l'arrivée de l'image le remplace.
import { useEffect, useState } from "react";
import { isAnyImageRef, isUnsentRef, hashOfRef } from "./planImages.js";
import { loadPlanImage, onPlanImageStored } from "./useStorage.js";

// { src, state } ; state : "ready" | "loading" | "missing".
export function usePlanImage(value) {
  const isRef = isAnyImageRef(value);
  const [result, setResult] = useState(() => (isRef ? { src: null, state: "loading", value } : { src: value || null, state: value ? "ready" : "missing", value }));
  useEffect(() => {
    if (!isAnyImageRef(value)) {
      setResult({ src: value || null, state: value ? "ready" : "missing", value });
      return undefined;
    }
    let alive = true;
    const hash = hashOfRef(value);
    const load = () => {
      loadPlanImage(value).then((src) => {
        if (!alive) return;
        // Échec d'un nouvel essai alors qu'une image est déjà affichée : on la garde.
        setResult((prev) => (src ? { src, state: "ready", value } : prev.value === value && prev.src ? prev : { src: null, state: "missing", value }));
      });
    };
    load();
    // Image arrivée entre-temps (téléchargement en arrière-plan) ou retour du réseau : on réessaie.
    const stopStored = onPlanImageStored((stored) => { if (!stored || stored === hash) load(); });
    const onOnline = () => load();
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      stopStored();
      window.removeEventListener("online", onOnline);
    };
  }, [value]);
  if (result.value === value) return result;
  // Valeur nouvelle pas encore chargée. Image → sa référence (le plan vient d'être rangé à part) : l'image
  // reste affichée. Autre référence (autre plan) : « Chargement… », jamais l'image d'un autre plan.
  if (!isRef) return { src: value || null, state: value ? "ready" : "missing", value };
  const justStored = result.src && !isAnyImageRef(result.value);
  return justStored ? { ...result, value } : { src: null, state: "loading", value };
}

// Un plan à l'écran. `onOpen(dataUrl)` : plein écran (reçoit la vraie image).
export function PlanImage({ value, alt, onOpen, style }) {
  const { src, state } = usePlanImage(value);
  if (state === "ready" && src) {
    return (
      <img
        src={src}
        onClick={onOpen ? () => onOpen(src) : undefined}
        style={{ width: "100%", display: "block", cursor: onOpen ? "pointer" : "default", ...style }}
        alt={alt}
      />
    );
  }
  const frame = { padding: "28px 12px", textAlign: "center", background: "#F5F5F4", color: "#78716C", fontSize: 13, fontWeight: 600 };
  if (state === "loading") {
    return <div data-testid="plan-chargement" style={frame}>Chargement du plan…</div>;
  }
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  // « orkimg-local: » : plan trop lourd pour le compte, resté sur le téléphone qui l'a importé.
  const text = isUnsentRef(value) ? "Plan resté sur un autre téléphone (trop lourd pour le compte)"
    : offline ? "Plan non disponible hors ligne"
      : "Plan pas encore téléchargé (connexion lente ?) · il s'affichera dès son arrivée";
  return <div data-testid="plan-indisponible" style={frame}>{text}</div>;
}
