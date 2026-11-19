// Volet d'édition d'un instrument de percussion (ou d'une ligne « Autres » de l'orchestre) :
// nom, percussionniste, catégorie, support. Gros boutons, pensé pour le pouce, sur le plateau.
import { useState } from "react";
import { CATEGORIES } from "./data.js";
import { getContrastColor } from "./utils.js";
import { VERS_AUTRES, SUPPORTS_RAPIDES, devinerCategorie } from "./percuEdit.js";
import { supportOblige, standDe } from "./utils.js";

const puce = (actif, color) => ({
  minHeight: 40, padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
  border: `1.5px solid ${actif ? color : "#D6D3D1"}`, background: actif ? color : "#fff", color: actif ? getContrastColor(color) : "#1C1917",
});
const titreBloc = { fontSize: 11, fontWeight: 700, color: "#78716C", textTransform: "uppercase", letterSpacing: 0.8, margin: "14px 0 6px" };
const rangee = { display: "flex", flexWrap: "wrap", gap: 6 };

/**
 * mode « item » : instrument d'un poste (tout est modifiable, destination comprise).
 * mode « ajout » : nouvel instrument dans un poste (raccourcis tablettes et pieds).
 * mode « autres » : ligne « Autres » de l'orchestre, à envoyer dans un poste.
 */
export function PercuItemSheet({ mode, color, poles, poleId, initial, onValider, onSupprimer, onFermer }) {
  const [nom, setNom] = useState(initial?.nom || "");
  const [cat, setCat] = useState(initial?.cat || "");
  const [catTouchee, setCatTouchee] = useState(!!initial?.cat);
  // Support : choisi par le régisseur, sinon celui que l'instrument a d'office (cymbale suspendue → pied…).
  const [support, setSupportChoisi] = useState(initial ? (initial.support || "") : null);
  const setSupport = (v) => setSupportChoisi(v);
  const supportAffiche = support === null ? supportOblige(nom) : support;
  const [vers, setVers] = useState(mode === "autres" ? (poles[0]?.id || "") : poleId);
  const catAffichee = catTouchee ? cat : devinerCategorie(nom);
  const versAutres = vers === VERS_AUTRES;
  const ok = mode === "autres" ? !!vers : !!nom.trim();

  const valider = () => {
    if (!ok) return;
    onValider({ nom: nom.trim(), cat: catAffichee, support: supportAffiche, vers });
  };

  return (
    <div onClick={onFermer} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Modifier l'instrument"
        style={{ background: "#fff", width: "100%", maxWidth: 430, maxHeight: "88dvh", overflowY: "auto", borderRadius: "16px 16px 0 0", padding: "14px 16px calc(16px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {mode === "ajout" ? "Ajouter un instrument" : mode === "autres" ? `Mettre « ${nom} » dans les percus` : "Modifier l'instrument"}
          </div>
          <button onClick={onFermer} aria-label="Fermer" style={{ border: "none", background: "none", fontSize: 22, minWidth: 44, minHeight: 44, cursor: "pointer", color: "#78716C" }}>×</button>
        </div>

        {mode !== "autres" && (
          <>
            <input autoFocus={mode === "ajout"} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom de l'instrument"
              onKeyDown={(e) => { if (e.key === "Enter") valider(); }}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: "12px", fontSize: 16, borderRadius: 10, border: `1.5px solid ${color}` }} />
            {mode === "ajout" && (
              <>
                <div style={titreBloc}>Tout prêt</div>
                <div style={rangee}>
                  {SUPPORTS_RAPIDES.map((s) => (
                    <button key={s} onClick={() => onValider({ nom: s, cat: "Stands & supports", support: "", vers })} style={puce(false, color)}>+ {s}</button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <div style={titreBloc}>{mode === "autres" ? "Dans quel poste ?" : "Joué par"}</div>
        <div style={rangee}>
          {poles.map((p) => <button key={p.id} onClick={() => setVers(p.id)} style={puce(vers === p.id, color)}>{p.nom}</button>)}
          {mode === "item" && <button onClick={() => setVers(VERS_AUTRES)} style={puce(versAutres, color)}>Autres musiciens (pas une percu)</button>}
        </div>

        {mode !== "autres" && !versAutres && (
          <>
            <div style={titreBloc}>Catégorie</div>
            <div style={rangee}>
              {CATEGORIES.map((c) => <button key={c} onClick={() => { setCat(c); setCatTouchee(true); }} style={puce(catAffichee === c, color)}>{c}</button>)}
            </div>
            <div style={titreBloc}>Posé sur</div>
            {supportOblige(nom) && (
              <div style={{ fontSize: 12, color: "#57534E", marginBottom: 6 }}>D'office avec cet instrument : <b>{standDe({ nom }).toLowerCase()}</b> (il le suit si tu le déplaces ; « Rien de spécial » le retire).</div>
            )}
            <div style={rangee}>
              {[["", "Rien de spécial"], ["pied", "Pied"], ["support", "Support"], ["grande", "Grande tablette"], ["petite", "Petite tablette"]].map(([v, l]) => (
                <button key={v || "rien"} onClick={() => setSupport(v)} style={puce(supportAffiche === v, color)}>{l}</button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {onSupprimer && (
            <button onClick={onSupprimer} style={{ minHeight: 48, padding: "10px 14px", borderRadius: 10, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Supprimer</button>
          )}
          <button onClick={valider} disabled={!ok} style={{ flex: 1, minHeight: 48, borderRadius: 10, border: "none", background: ok ? color : "#D6D3D1", color: ok ? getContrastColor(color) : "#fff", fontSize: 15, fontWeight: 700, cursor: ok ? "pointer" : "default" }}>
            {mode === "ajout" ? "Ajouter" : "Valider"}
          </button>
        </div>
      </div>
    </div>
  );
}
