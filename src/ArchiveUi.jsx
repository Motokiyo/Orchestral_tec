// Écrans du lot 7 et du lot 8 : « Enregistrer mes photos dans Téléchargements » et « Préparer le dossier pour la salle ».
// Rôle : l'affichage et les boutons. Le contenu est dans archive.js, l'assemblage dans archiveBuilder.js et
// photoExport.js, les images dans archiveImages.js. Rien n'est envoyé sur le réseau : tout marche hors ligne.
import { useRef, useState } from "react";
import { S } from "./styles.js";
import { BARNIER } from "./data.js";
import { loadPlanImage } from "./useStorage.js";
import { bakeWatermark, compterPhotos, construireZipPhotos, saveBlob, peutPartager, partagerFichier } from "./photoExport.js";
import { jpegPourPdf } from "./archiveImages.js";
import { construireDossier } from "./archiveBuilder.js";
import { nomZipPhotosConcert, nomZipPhotosTout } from "./archive.js";

const DEPS = { chargerPlan: (valeur) => loadPlanImage(valeur), filigrane: bakeWatermark, enJpeg: (dataUrl) => jpegPourPdf(dataUrl) };

const unite = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

function Barre({ pct, couleur = "#1C1917" }) {
  return (
    <div style={{ width: "100%", height: 8, background: "#E7E5E4", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: couleur, borderRadius: 4, transition: "width .2s" }} />
    </div>
  );
}

// ── Lot 7 : un zip des photos, filigrane compris, enregistré dans Téléchargements ──
// `concerts` : les concerts à mettre dans le zip (tous sur l'accueil, un seul sur l'écran d'un concert).
export function SavePhotosButton({ concerts, photos, concertSeul = false, style, noteStyle }) {
  const [etat, setEtat] = useState({ busy: false, fait: 0, total: 0 });
  const [note, setNote] = useState("");
  async function lancer(e) {
    e.stopPropagation();
    if (etat.busy) return;
    const groupes = (concerts || []).map((concert) => ({ concert }));
    const total = compterPhotos(groupes, photos || {});
    if (total === 0) { setNote("Il n'y a aucune photo à enregistrer."); return; }
    setNote("");
    setEtat({ busy: true, fait: 0, total });
    try {
      const { blob, count } = await construireZipPhotos({
        groupes, photos, sansDossierConcert: concertSeul,
        onProgress: (fait) => setEtat({ busy: true, fait, total }),
      });
      const nom = concertSeul ? nomZipPhotosConcert(concerts[0]) : nomZipPhotosTout();
      saveBlob(blob, nom);
      setNote(`${unite(count, "photo enregistrée", "photos enregistrées")} dans Téléchargements : ${nom}. Les photos restent aussi dans l'application.`);
    } catch (err) {
      setNote(`L'enregistrement a échoué : ${err?.message || err}. Rien n'a été changé sur le téléphone.`);
    } finally {
      setEtat({ busy: false, fait: 0, total: 0 });
    }
  }
  return (
    <>
      <button onClick={lancer} disabled={etat.busy} style={{ ...(style || S.exportBtn), opacity: etat.busy ? 0.6 : 1 }}>
        {etat.busy ? `Préparation des photos… ${etat.fait} sur ${etat.total}` : "📥 Enregistrer mes photos dans Téléchargements"}
      </button>
      {etat.busy && <div style={{ marginTop: 8 }}><Barre pct={etat.total ? Math.round((etat.fait / etat.total) * 100) : 0} /></div>}
      {note && <div role="status" style={noteStyle || S.exportNote}>{note}</div>}
    </>
  );
}

// ── Lot 8 : le dossier pour la salle ──
export function ArchiveModal({ concert, photos, onClose }) {
  const pieces = concert.pieces || [];
  const [coches, setCoches] = useState(() => new Set(pieces.map((p) => p.id)));
  const [sansPhotos, setSansPhotos] = useState(false);
  const [phase, setPhase] = useState("choix"); // choix | travail | pret | erreur
  const [progres, setProgres] = useState({ texte: "", pct: 0 });
  const [resultat, setResultat] = useState(null);
  const [message, setMessage] = useState("");
  const [partageable, setPartageable] = useState(false);
  const vivant = useRef(true);

  const ids = pieces.filter((p) => coches.has(p.id)).map((p) => p.id);
  const nbPhotos = pieces.filter((p) => coches.has(p.id)).reduce((s, p) => s + (photos[p.id] || []).length, 0);
  const occupe = phase === "travail";

  function basculer(id) {
    setCoches((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function preparer() {
    if (ids.length === 0 || occupe) return;
    setPhase("travail"); setMessage(""); setProgres({ texte: "Début", pct: 0 });
    vivant.current = true;
    try {
      const r = await construireDossier({
        concert, pieceIds: ids, avecPhotos: !sansPhotos, photos, deps: DEPS,
        onProgress: (p) => { if (vivant.current) setProgres({ texte: p.texte, pct: p.pct }); },
      });
      if (!vivant.current) return;
      setResultat(r);
      setPartageable(peutPartager(r.blob, r.nom));
      setPhase("pret");
    } catch (err) {
      if (!vivant.current) return;
      setMessage(`La préparation a échoué : ${err?.message || err}. Rien n'a été changé sur le téléphone.`);
      setPhase("erreur");
    }
  }

  async function partager() {
    try {
      const ok = await partagerFichier(resultat.blob, resultat.nom, concert.titre || "Dossier");
      if (ok) setMessage("Partage envoyé.");
    } catch (err) {
      setMessage(`Le partage n'a pas marché : ${err?.message || err}. Tu peux enregistrer le fichier dans Téléchargements.`);
    }
  }

  function enregistrer() {
    saveBlob(resultat.blob, resultat.nom);
    setMessage(`Fichier enregistré dans Téléchargements : ${resultat.nom}`);
  }

  function fermer() {
    if (occupe) return;
    vivant.current = false;
    onClose();
  }

  const st = resultat && resultat.stats;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={fermer}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "90vh", overflow: "auto", padding: 18, boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1C1917" }}>📁 Dossier pour la salle</div>
          <button onClick={fermer} disabled={occupe} aria-label="Fermer" style={{ background: "none", border: "none", fontSize: 22, color: "#A8A29E", cursor: "pointer", minWidth: 44, minHeight: 44 }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: "#78716C", marginBottom: 12 }}>
          {concert.titre}. Un seul fichier zip : la fiche du concert, puis un dossier par pièce avec sa fiche (PDF et texte), ses plans et ses photos. Tout est préparé sur ce téléphone, sans réseau.
        </div>

        {phase === "choix" || phase === "erreur" ? (
          <>
            {pieces.length === 0 ? (
              <div style={{ fontSize: 14, color: "#A8A29E", padding: "12px 0" }}>Ce concert n'a pas encore de pièce.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#57534E", marginBottom: 6 }}>Pièces à mettre dans le dossier</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  {pieces.map((p) => {
                    const col = BARNIER[p.couleur] || BARNIER.blanc;
                    const on = coches.has(p.id);
                    const n = (photos[p.id] || []).length;
                    return (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "6px 10px", borderRadius: 10, cursor: "pointer", border: on ? `2px solid ${col.hex}` : "2px solid #E7E5E4", background: on ? col.bg : "#FAFAF9" }}>
                        <input type="checkbox" checked={on} onChange={() => basculer(p.id)} style={{ width: 22, height: 22, accentColor: "#1C1917" }} />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1C1917" }}>{p.titre || "Sans titre"}</span>
                        <span style={{ fontSize: 11, color: "#78716C" }}>{unite(n, "photo", "photos")}</span>
                      </label>
                    );
                  })}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={sansPhotos} onChange={(e) => setSansPhotos(e.target.checked)} style={{ width: 22, height: 22, accentColor: "#1C1917" }} />
                  <span style={{ fontSize: 14, color: "#1C1917" }}>Sans photos (fichier plus léger){!sansPhotos && nbPhotos > 0 ? ` : ${unite(nbPhotos, "photo sera incluse", "photos seront incluses")}` : ""}</span>
                </label>
              </>
            )}
            {message && <div role="alert" style={{ fontSize: 13, color: "#B91C1C", marginBottom: 10 }}>{message}</div>}
            <button onClick={preparer} disabled={ids.length === 0} style={{ ...S.btnPrimary("#1C1917"), fontSize: 14, padding: "12px 16px", width: "100%", minHeight: 48, opacity: ids.length === 0 ? 0.4 : 1 }}>
              Préparer le dossier ({unite(ids.length, "pièce", "pièces")})
            </button>
          </>
        ) : phase === "travail" ? (
          <div style={{ padding: "8px 0" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1C1917", marginBottom: 8 }}>Préparation en cours…</div>
            <Barre pct={progres.pct} />
            <div style={{ fontSize: 12, color: "#78716C", marginTop: 6 }}>{progres.pct} % : {progres.texte}</div>
            <div style={{ fontSize: 12, color: "#A8A29E", marginTop: 6 }}>Garde l'application ouverte jusqu'à la fin.</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginBottom: 6 }}>Le dossier est prêt</div>
            <div style={{ fontSize: 13, color: "#44403C", lineHeight: 1.5, marginBottom: 6, wordBreak: "break-all" }}>{resultat.nom}</div>
            <div style={{ fontSize: 13, color: "#44403C", lineHeight: 1.5, marginBottom: 12 }}>
              {unite(st.pieces, "pièce", "pièces")}, {unite(st.plans, "plan", "plans")}, {unite(st.photos, "photo", "photos")}, {Math.max(1, Math.round(resultat.blob.size / 1024))} Ko.
              {st.plansAbsents > 0 && <span style={{ color: "#92400E" }}> {unite(st.plansAbsents, "plan n'est pas disponible", "plans ne sont pas disponibles")} sur ce téléphone : c'est écrit dans la fiche.</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {partageable && <button onClick={partager} style={{ ...S.btnPrimary("#1C1917"), fontSize: 14, padding: "12px 16px", minHeight: 48 }}>📤 Partager (mail, WhatsApp, Drive…)</button>}
              <button onClick={enregistrer} style={{ ...(partageable ? S.btnSecondary : S.btnPrimary("#1C1917")), fontSize: 14, padding: "12px 16px", minHeight: 48 }}>📥 Enregistrer dans Téléchargements</button>
              <button onClick={fermer} style={{ ...S.btnSecondary, fontSize: 13, padding: "10px 16px", minHeight: 44 }}>Fermer</button>
            </div>
            {message && <div role="status" style={{ fontSize: 13, color: "#44403C", marginTop: 10 }}>{message}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
