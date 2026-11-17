// Blocs d'écran du mobilier (lot 4C) : lignes de détail, informations, écarts plan / calcul, réglages.
// La logique (calculs, choix des réglages) est dans mobilierUi.js ; ici, seulement l'affichage.
import { useState } from "react";
import { instrumentsPartageables, reglagesEffectifs, origineReglages, ecartsPourAffichage } from "./mobilierUi.js";

/** Lignes en plus du mobilier général : banquettes (détail) et modèle des chaises hautes. */
export function LignesMobilierPlus({ general }) {
  const g = general || {};
  const banq = (Array.isArray(g.banquettesDetail) ? g.banquettesDetail : []).filter((b) => b.qty > 0 || b.qty === null);
  const kolberg = [];
  if (g.chaisesHautesModele) {
    if (g.chaisesHautesModele.contrebasses === "Kolberg") kolberg.push("contrebasses");
    if (g.chaisesHautesModele.percussions === "Kolberg") kolberg.push("percussions");
  }
  return (
    <>
      {(g.banquettes > 0 || banq.length > 0) && (
        <div>• Banquettes : <strong>{g.banquettes || 0}</strong>
          {banq.length > 0 && (
            <span style={{ color: "#78716C" }}> ({banq.map((b) => `${b.type.replace(/^Banquette /, "")} ${b.qty === null ? "?" : b.qty}`).join(", ")})</span>
          )}
        </div>
      )}
      {kolberg.length > 0 && (
        <div style={{ fontSize: 12, color: "#78716C" }}>• Chaises tournantes Kolberg à la place des chaises hautes R&S pour : {kolberg.join(" et ")}</div>
      )}
    </>
  );
}

/** Informations utiles données par le calcul (piccolo sur la tablette, chaise timbalier ajoutée...). */
export function InfosMobilier({ infos }) {
  const liste = Array.isArray(infos) ? infos.filter((t) => typeof t === "string" && t.trim()) : [];
  if (liste.length === 0) return null;
  return (
    <div style={{ marginBottom: 8, fontSize: 12, color: "#57534E", background: "#F5F5F4", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>À savoir</div>
      {liste.map((t, i) => <div key={i}>• {t}</div>)}
    </div>
  );
}

/** Écarts entre le mobilier lu sur le plan et le calcul. Montre, ne corrige rien. */
export function EcartsPlan({ mobilier, observe }) {
  const ecarts = ecartsPourAffichage(mobilier, observe);
  if (ecarts.length === 0) return null;
  return (
    <div role="status" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #BAE6FD" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 2 }}>Écarts entre le plan et le calcul</div>
      {ecarts.map((e, i) => (
        <div key={i} style={{ fontSize: 13, color: "#92400E", lineHeight: 1.6 }}>• {e.texte}</div>
      ))}
      <div style={{ fontSize: 11, color: "#78716C", marginTop: 2 }}>Rien n'est corrigé tout seul : c'est à toi de trancher.</div>
    </div>
  );
}

const caseStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1C1917", padding: "6px 0", minHeight: 32 };

/**
 * Petit bloc repliable de réglages du mobilier (et présence du chef). onSave({ standPourDeux, chaisesHautes }, pourTout, sansChef).
 */
export function ReglagesMobilier({ piece, concert, onSave }) {
  const [ouvert, setOuvert] = useState(false);
  const [stand, setStand] = useState([]);
  const [cb, setCb] = useState("R&S");
  const [perc, setPerc] = useState("R&S");
  const [pourTout, setPourTout] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [chef, setChef] = useState("present");

  const origine = origineReglages(piece, concert);
  const instruments = instrumentsPartageables(piece.orchestre);

  function ouvrir() {
    if (!ouvert) {
      const r = reglagesEffectifs(piece, concert);
      setStand(r.standPourDeux);
      setCb(r.chaisesHautes.contrebasses);
      setPerc(r.chaisesHautes.percussions);
      setPourTout(origine === "concert");
      setChef(piece.sansChef === true ? "absent" : piece.sansChef === null ? "inconnu" : "present");
      setEnregistre(false);
    }
    setOuvert(!ouvert);
  }
  const bascule = (key) => setStand((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  const sel = { fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid #D6D3D1", background: "#fff", color: "#1C1917", minHeight: 32 };

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={(e) => { e.stopPropagation(); ouvrir(); }}
        aria-expanded={ouvert}
        style={{ width: "100%", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#1C1917", background: "#F5F5F4", border: "1px solid #D6D3D1", borderRadius: 8, padding: "10px 12px", minHeight: 40, cursor: "pointer" }}
      >
        {ouvert ? "▾" : "▸"} Réglages du mobilier
        <span style={{ fontWeight: 400, color: "#78716C" }}>
          {origine === "piece" ? " (propres à cette pièce)" : origine === "concert" ? " (pour tout le concert)" : " (réglages habituels)"}
        </span>
      </button>
      {ouvert && (
        <div style={{ borderWidth: "0 1px 1px 1px", borderStyle: "solid", borderColor: "#D6D3D1", borderRadius: "0 0 8px 8px", padding: "10px 12px", background: "#fff" }}>
          <label style={{ ...caseStyle, justifyContent: "space-between", marginBottom: 8 }}>
            <span>Chef</span>
            <select value={chef} onChange={(e) => setChef(e.target.value)} style={sel}>
              <option value="present">Présent</option>
              <option value="absent">Sans chef</option>
              <option value="inconnu">À confirmer</option>
            </select>
          </label>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>Un stand pour deux</div>
          <div style={{ fontSize: 11, color: "#78716C", marginBottom: 4 }}>Par défaut, un stand par musicien. Coche les instruments qui se partagent un stand à deux.</div>
          {instruments.length === 0 && <div style={{ fontSize: 12, color: "#A8A29E", fontStyle: "italic" }}>Aucun instrument à vent dans l'effectif.</div>}
          {instruments.map((inst) => (
            <label key={inst.key} style={caseStyle}>
              <input type="checkbox" checked={stand.includes(inst.key)} onChange={() => bascule(inst.key)} style={{ width: 20, height: 20 }} />
              <span>{inst.label}</span>
            </label>
          ))}

          <div style={{ fontSize: 11, fontWeight: 700, color: "#A8A29E", textTransform: "uppercase", letterSpacing: 1, margin: "12px 0 4px" }}>Chaises hautes</div>
          <label style={{ ...caseStyle, justifyContent: "space-between" }}>
            <span>Contrebasses</span>
            <select value={cb} onChange={(e) => setCb(e.target.value)} style={sel}>
              <option value="R&S">R&S</option>
              <option value="Kolberg">Kolberg</option>
            </select>
          </label>
          <label style={{ ...caseStyle, justifyContent: "space-between" }}>
            <span>Percussions</span>
            <select value={perc} onChange={(e) => setPerc(e.target.value)} style={sel}>
              <option value="R&S">R&S</option>
              <option value="Kolberg">Kolberg</option>
            </select>
          </label>

          <label style={{ ...caseStyle, marginTop: 8, borderTop: "1px solid #F5F5F4", paddingTop: 10 }}>
            <input type="checkbox" checked={pourTout} onChange={(e) => setPourTout(e.target.checked)} style={{ width: 20, height: 20 }} />
            <span>Valable pour tout le concert</span>
          </label>
          {pourTout && <div style={{ fontSize: 11, color: "#78716C", marginBottom: 4 }}>Les autres pièces qui ont leurs propres réglages les gardent.</div>}

          <button
            onClick={() => {
              onSave({ standPourDeux: stand, chaisesHautes: { contrebasses: cb, percussions: perc } }, pourTout, chef === "absent" ? true : chef === "inconnu" ? null : false);
              setEnregistre(true);
            }}
            style={{ width: "100%", marginTop: 8, fontSize: 13, fontWeight: 700, color: "#fff", background: "#1C1917", border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer", minHeight: 40 }}
          >
            Enregistrer et recalculer le mobilier
          </button>
          {enregistre && (
            <div role="status" style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>
              {piece.mobilier && piece.mobilier._edited
                ? "Réglages enregistrés. Le mobilier de cette pièce a été modifié à la main : il n'est pas recalculé (bouton Recalculer pour le refaire)."
                : "Réglages enregistrés, mobilier recalculé."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
