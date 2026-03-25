import { useState, useRef, useEffect } from "react";
import { BARNIER, CATEGORIES, DEMO_PIECES } from "./data.js";
import { uid, generateTxt, downloadTxt, applyWatermark, copyToClipboard } from "./utils.js";
import { extractFromPdf } from "./pdfParser.js";
import { S } from "./styles.js";

export default function App() {
  const [pieces, setPieces] = useState(DEMO_PIECES);
  const [screen, setScreen] = useState("home");
  const [pieceId, setPieceId] = useState(null);
  const [percuId, setPercuId] = useState(null);
  const [photos, setPhotos] = useState({});
  const [capture, setCapture] = useState(null);
  const [fullPhoto, setFullPhoto] = useState(null);
  const [galleryFilter, setGalleryFilter] = useState("all");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [cameraMode, setCameraMode] = useState(null); // standalone camera

  const piece = pieces.find((p) => p.id === pieceId);
  const percu = piece ? piece.percus.find((r) => r.id === percuId) : null;

  // ── Navigation ──
  function goHome() { setScreen("home"); setPieceId(null); setPercuId(null); }
  function goPiece(id) { setPieceId(id); setPercuId(null); setScreen("piece"); }
  function goTxt(id) { if (id) setPieceId(id); setScreen("txt"); }
  function goGallery(id) { if (id !== undefined) setPieceId(id); setScreen("gallery"); }

  // ── Mutations ──
  function updatePiece(id, fn) {
    setPieces((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
  }
  function addItem(pId, rId, cat, nom) {
    updatePiece(pId, (p) => ({
      ...p,
      percus: p.percus.map((r) =>
        r.id === rId ? { ...r, items: [...r.items, { cat, nom }] } : r
      ),
    }));
  }
  function deleteItem(pId, rId, idx) {
    updatePiece(pId, (p) => ({
      ...p,
      percus: p.percus.map((r) =>
        r.id === rId ? { ...r, items: r.items.filter((_, i) => i !== idx) } : r
      ),
    }));
  }
  function renameItem(pId, rId, idx, newName) {
    updatePiece(pId, (p) => ({
      ...p,
      percus: p.percus.map((r) =>
        r.id === rId
          ? { ...r, items: r.items.map((it, i) => (i === idx ? { ...it, nom: newName } : it)) }
          : r
      ),
    }));
  }
  function addPhoto(pieceKey, photoData) {
    setPhotos((prev) => ({
      ...prev,
      [pieceKey]: [...(prev[pieceKey] || []), photoData],
    }));
  }

  // ── PDF Import ──
  async function handlePdfImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setPdfLoading(true);
      try {
        const data = await extractFromPdf(file);
        // Create a new piece from extracted data
        const newPiece = {
          id: uid(),
          titre: data.titre || file.name.replace(".pdf", ""),
          compositeur: data.compositeur || "Inconnu",
          duree: data.duree || "",
          salle: data.salle || "",
          chef: data.chef || "",
          date: data.date || "",
          couleur: pickNextColor(pieces),
          percus: data.percus.length > 0
            ? data.percus.map((p, i) => ({
                id: `p${i + 1}`,
                nom: p.nom,
                items: p.items,
              }))
            : [{ id: "p1", nom: "Percu 1", items: [] }],
        };
        setPieces((prev) => [...prev, newPiece]);
        setPieceId(newPiece.id);
        setScreen("piece");
      } catch (err) {
        alert("Erreur lors de l'import PDF : " + err.message);
      } finally {
        setPdfLoading(false);
      }
    };
    input.click();
  }

  // Pick next unused barnier color
  function pickNextColor(existingPieces) {
    const usedColors = existingPieces.map((p) => p.couleur);
    const allColors = Object.keys(BARNIER);
    const available = allColors.filter((c) => !usedColors.includes(c));
    return available.length > 0 ? available[0] : allColors[existingPieces.length % allColors.length];
  }

  // ════════════════════════════════
  // STANDALONE CAMERA
  // ════════════════════════════════
  if (cameraMode) {
    return (
      <StandaloneCamera
        onCapture={(dataUrl) => {
          // Store standalone photo
          const photoData = {
            id: uid(),
            dataUrl,
            pieceId: cameraMode.pieceId || "standalone",
            percuId: null,
            zone: "Photo libre",
            num: 1,
            total: 1,
            couleur: cameraMode.couleur || "blanc",
          };
          if (cameraMode.pieceId) {
            addPhoto(cameraMode.pieceId, photoData);
          }
          setCameraMode(null);
        }}
        onCancel={() => setCameraMode(null)}
        couleur={cameraMode.couleur || "blanc"}
      />
    );
  }

  // ════════════════════════════════
  // CAPTURE SCREEN (protocol photo)
  // ════════════════════════════════
  if (capture) {
    return (
      <CaptureView
        capture={capture}
        pieces={pieces}
        onPhoto={(data) => addPhoto(capture.pieceId, data)}
        onNext={(c) => setCapture(c)}
        onDone={() => { setCapture(null); setScreen("gallery"); }}
        onCancel={() => { setCapture(null); setScreen("piece"); }}
      />
    );
  }

  // ════════════════════════════════
  // HOME
  // ════════════════════════════════
  if (screen === "home") {
    const totalPhotos = Object.values(photos).flat().length;
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>
            PlateauMap
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 2 }}>
            Programme Francesconi — EIC
          </div>
        </div>
        <div style={S.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 14, color: "#78716C", fontWeight: 600 }}>{pieces.length} pièces</span>
          </div>

          {/* Action buttons: Import PDF + Camera */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={handlePdfImport}
              disabled={pdfLoading}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px", opacity: pdfLoading ? 0.6 : 1 }}
            >
              {pdfLoading ? "⏳ Import..." : "📄 Importer PDF"}
            </button>
            <button
              onClick={() => setCameraMode({ pieceId: null, couleur: "blanc" })}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px" }}
            >
              📸 Prendre une photo
            </button>
          </div>

          {pieces.map((p) => {
            const col = BARNIER[p.couleur];
            const itemCount = p.percus.reduce((s, r) => s + r.items.length, 0);
            const photoCount = (photos[p.id] || []).length;
            return (
              <div key={p.id} onClick={() => goPiece(p.id)} style={S.card(col.hex)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1917" }}>{p.titre}</div>
                    <div style={{ fontSize: 12, color: "#78716C", marginTop: 1 }}>{p.compositeur}</div>
                  </div>
                  <span style={{ ...S.badge, background: col.bg, color: col.hex }}>{col.name}</span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={S.tag}>{p.duree}</span>
                  <span style={S.tag}>{p.percus.length} percu{p.percus.length > 1 ? "s" : ""}</span>
                  <span style={S.tag}>{itemCount} instr.</span>
                  {photoCount > 0 && <span style={S.tag}>{photoCount} photo{photoCount > 1 ? "s" : ""}</span>}
                </div>
              </div>
            );
          })}

          {totalPhotos > 0 && (
            <button onClick={() => goGallery(null)} style={{ ...S.btnSecondary, marginTop: 8 }}>
              📷 Toutes les photos ({totalPhotos})
            </button>
          )}
        </div>
        <NavBar active="pieces" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => goTxt(pieces[0]?.id)} />
      </div>
    );
  }

  // ════════════════════════════════
  // PIECE DETAIL
  // ════════════════════════════════
  if (screen === "piece" && piece) {
    const col = BARNIER[piece.couleur];
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, borderBottom: `3px solid ${col.hex}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={goHome} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>{piece.compositeur}</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{piece.titre}</div>
            </div>
            <span style={{ ...S.badge, background: col.bg, color: col.hex }}>{col.name}</span>
          </div>
        </div>
        <div style={S.body}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            <span style={S.tag}>{piece.duree}</span>
            <span style={S.tag}>{piece.salle}</span>
            <span style={S.tag}>{piece.chef}</span>
            <span style={S.tag}>{piece.date}</span>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={handlePdfImport}
              disabled={pdfLoading}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 12, padding: "8px 10px" }}
            >
              📄 Importer PDF
            </button>
            <button
              onClick={() => setCameraMode({ pieceId: piece.id, couleur: piece.couleur })}
              style={{ ...S.btnSecondary, flex: 1, fontSize: 12, padding: "8px 10px" }}
            >
              📸 Photo libre
            </button>
          </div>

          {piece.percus.map((r) => {
            const isOpen = percuId === r.id;
            const rPhotos = (photos[piece.id] || []).filter((ph) => ph.percuId === r.id);
            const byCat = {};
            r.items.forEach((it, idx) => {
              if (!byCat[it.cat]) byCat[it.cat] = [];
              byCat[it.cat].push({ ...it, _i: idx });
            });

            return (
              <div key={r.id} style={{ marginBottom: 10 }}>
                <div
                  onClick={() => setPercuId(isOpen ? null : r.id)}
                  style={{
                    background: isOpen ? col.bg : "#FAFAF9",
                    border: `1px solid ${isOpen ? col.hex + "44" : "#E7E5E4"}`,
                    borderRadius: 10, padding: "12px 14px", cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917" }}>{r.nom}</div>
                      <div style={{ fontSize: 12, color: "#78716C" }}>
                        {r.items.length} instruments{rPhotos.length > 0 ? ` · ${rPhotos.length} photos` : ""}
                      </div>
                    </div>
                    <span style={{ color: "#A8A29E" }}>{isOpen ? "▾" : "▸"}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ padding: "8px 4px 0" }}>
                    {Object.entries(byCat).map(([cat, items]) => (
                      <div key={cat}>
                        <div style={S.catLabel(col.hex)}>{cat}</div>
                        {items.map((it) => (
                          <EditableItem
                            key={it._i}
                            nom={it.nom}
                            color={col.hex}
                            onRename={(v) => renameItem(piece.id, r.id, it._i, v)}
                            onDelete={() => deleteItem(piece.id, r.id, it._i)}
                          />
                        ))}
                      </div>
                    ))}

                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button
                        onClick={() => {
                          setPieceId(piece.id);
                          setPercuId(r.id);
                          setScreen("photoSetup");
                        }}
                        style={{ ...S.btnPrimary(col.hex), flex: 1, fontSize: 13, padding: "10px 12px" }}
                      >
                        📸 Photos
                      </button>
                      <button
                        onClick={() => {
                          const nom = prompt("Nom de l'instrument :");
                          if (nom && nom.trim()) addItem(piece.id, r.id, "Accessoires", nom.trim());
                        }}
                        style={{ ...S.btnSecondary, flex: 1, fontSize: 13, padding: "10px 12px" }}
                      >
                        + Ajouter
                      </button>
                    </div>

                    {rPhotos.length > 0 && (
                      <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
                        {rPhotos.map((ph) => (
                          <img key={ph.id} src={ph.dataUrl} onClick={() => setFullPhoto(ph)}
                            style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 6, border: `2px solid ${col.hex}`, cursor: "pointer", flexShrink: 0 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={() => goTxt(piece.id)} style={{ ...S.btnSecondary, marginTop: 10 }}>☰ Liste TXT</button>
          <button onClick={() => downloadTxt(piece)} style={{ ...S.btnSecondary, marginTop: 6 }}>↓ Télécharger TXT</button>
        </div>
        <NavBar active="pieces" onPieces={goHome} onPhotos={() => goGallery(pieceId)} onTxt={() => goTxt(pieceId)} />
        {fullPhoto && <Lightbox photo={fullPhoto} onClose={() => setFullPhoto(null)} />}
      </div>
    );
  }

  // ════════════════════════════════
  // PHOTO SETUP
  // ════════════════════════════════
  if (screen === "photoSetup" && piece && percu) {
    const col = BARNIER[piece.couleur];
    return (
      <PhotoSetupView
        piece={piece}
        percu={percu}
        col={col}
        onStart={(zones) => {
          setCapture({ pieceId: piece.id, percuId: percu.id, zones, currentZone: 0, couleur: piece.couleur });
        }}
        onBack={() => setScreen("piece")}
      />
    );
  }

  // ════════════════════════════════
  // GALLERY
  // ════════════════════════════════
  if (screen === "gallery") {
    const allPhotos = pieceId ? (photos[pieceId] || []) : Object.values(photos).flat();
    return (
      <div style={S.shell}>
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => (pieceId ? goPiece(pieceId) : goHome())} style={S.backBtn}>←</button>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Galerie</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>
                {pieceId ? piece?.titre : "Toutes les pièces"} · {allPhotos.length} photo{allPhotos.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
        <div style={S.body}>
          {!pieceId && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
              <FilterBtn label="Toutes" active={galleryFilter === "all"} onClick={() => setGalleryFilter("all")} />
              {pieces.map((p) => (
                <FilterBtn key={p.id} label={p.titre} color={BARNIER[p.couleur].hex} active={galleryFilter === p.id} onClick={() => setGalleryFilter(p.id)} />
              ))}
            </div>
          )}
          {allPhotos.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#A8A29E" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 14 }}>Aucune photo</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Ouvrez un pôle percu et lancez le mode photo</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {allPhotos.filter((ph) => galleryFilter === "all" || ph.pieceId === galleryFilter || pieceId).map((ph) => {
                const col = BARNIER[ph.couleur];
                return (
                  <div key={ph.id} onClick={() => setFullPhoto(ph)} style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `2px solid ${col.hex}`, cursor: "pointer", aspectRatio: "4/3" }}>
                    <img src={ph.dataUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,.7))", padding: "12px 8px 6px" }}>
                      <div style={{ fontSize: 10, color: col.hex, fontWeight: 700 }}>{pieces.find((x) => x.id === ph.pieceId)?.titre}</div>
                      <div style={{ fontSize: 11, color: "#E7E5E4" }}>{ph.zone} · {ph.num}/{ph.total}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <NavBar active="photos" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => goTxt(pieces[0]?.id)} />
        {fullPhoto && <Lightbox photo={fullPhoto} onClose={() => setFullPhoto(null)} />}
      </div>
    );
  }

  // ════════════════════════════════
  // TXT (ÉDITABLE)
  // ════════════════════════════════
  if (screen === "txt") {
    const tp = piece || pieces[0];
    if (!tp) return null;
    const col = BARNIER[tp.couleur];
    return (
      <div style={S.shell}>
        <div style={{ ...S.header, borderBottom: `3px solid ${col.hex}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => (pieceId ? goPiece(pieceId) : goHome())} style={S.backBtn}>←</button>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#78716C", textTransform: "uppercase" }}>Liste matériel</div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#1C1917", marginTop: 1 }}>{tp.titre}</div>
            </div>
            <span style={{ ...S.badge, background: col.bg, color: col.hex }}>{col.name}</span>
          </div>
        </div>
        <div style={S.body}>
          {/* Piece selector */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
            {pieces.map((p) => {
              const c = BARNIER[p.couleur];
              return <FilterBtn key={p.id} label={p.titre} color={c.hex} active={p.id === tp.id} onClick={() => setPieceId(p.id)} />;
            })}
          </div>

          {/* Info block */}
          <div style={{ background: "#FAFAF9", border: "1px solid #E7E5E4", borderLeft: `4px solid ${col.hex}`, borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: "#57534E", lineHeight: 1.6 }}>
            <strong style={{ color: "#1C1917" }}>{tp.compositeur}</strong> — {tp.duree}<br />
            {tp.salle} — {tp.date} — Chef : {tp.chef}
          </div>

          {/* Editable items per percu */}
          {tp.percus.map((r, ri) => {
            const byCat = {};
            r.items.forEach((it, idx) => {
              if (!byCat[it.cat]) byCat[it.cat] = [];
              byCat[it.cat].push({ ...it, _i: idx });
            });
            return (
              <div key={r.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1C1917" }}>{r.nom}</div>
                  <span style={{ fontSize: 11, color: "#A8A29E" }}>{r.items.length} items</span>
                </div>
                {Object.entries(byCat).map(([cat, items]) => (
                  <div key={cat}>
                    <div style={S.catLabel(col.hex)}>{cat}</div>
                    {items.map((it) => (
                      <EditableItem
                        key={it._i}
                        nom={it.nom}
                        color={col.hex}
                        onRename={(v) => renameItem(tp.id, r.id, it._i, v)}
                        onDelete={() => deleteItem(tp.id, r.id, it._i)}
                      />
                    ))}
                  </div>
                ))}
                <button
                  onClick={() => {
                    const nom = prompt("Nom de l'instrument :");
                    if (nom && nom.trim()) addItem(tp.id, r.id, "Accessoires", nom.trim());
                  }}
                  style={{ ...S.btnSecondary, marginTop: 4, fontSize: 12, padding: "8px 12px" }}
                >
                  + Ajouter un instrument
                </button>
                {ri < tp.percus.length - 1 && <hr style={{ border: "none", borderTop: "1px solid #E7E5E4", margin: "12px 0" }} />}
              </div>
            );
          })}

          <div style={{ borderTop: "1px solid #E7E5E4", paddingTop: 14, marginTop: 10 }}>
            <button onClick={() => downloadTxt(tp)} style={{ ...S.btnPrimary(col.hex), marginBottom: 6 }}>↓ Télécharger TXT</button>
            <button onClick={() => copyToClipboard(generateTxt(tp))} style={S.btnSecondary}>Copier dans le presse-papier</button>
          </div>
        </div>
        <NavBar active="txt" onPieces={goHome} onPhotos={() => goGallery(null)} onTxt={() => goTxt(tp.id)} />
      </div>
    );
  }

  return <div style={{ padding: 40, textAlign: "center", color: "#999" }}>Chargement...</div>;
}

// ════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════

function NavBar({ active, onPieces, onPhotos, onTxt }) {
  return (
    <div style={S.nav}>
      <button style={S.navBtn(active === "pieces")} onClick={onPieces}><span style={{ fontSize: 18 }}>♫</span>Pièces</button>
      <button style={S.navBtn(active === "photos")} onClick={onPhotos}><span style={{ fontSize: 18 }}>📷</span>Photos</button>
      <button style={S.navBtn(active === "txt")} onClick={onTxt}><span style={{ fontSize: 18 }}>☰</span>TXT</button>
    </div>
  );
}

function FilterBtn({ label, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: active ? (color || "#2563EB") : "#E7E5E4",
      color: active ? "#fff" : "#78716C",
      border: "none", cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  );
}

function EditableItem({ nom, color, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nom);

  useEffect(() => {
    setValue(nom);
  }, [nom]);

  if (editing) {
    return (
      <div style={S.itemRow}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim()) onRename(value.trim()); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (value.trim()) onRename(value.trim()); setEditing(false); }
            if (e.key === "Escape") { setValue(nom); setEditing(false); }
          }}
          style={S.itemInput(color)} />
        <button onClick={onDelete} style={S.deleteBtn}>×</button>
      </div>
    );
  }
  return (
    <div style={S.itemRow}>
      <div style={S.itemText(color)} onClick={() => setEditing(true)}>{nom}</div>
      <button onClick={onDelete} style={S.deleteBtn}>×</button>
    </div>
  );
}

function Lightbox({ photo, onClose }) {
  // Allow download
  function handleDownload(e) {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = photo.dataUrl;
    a.download = `photo_${photo.zone || "libre"}_${photo.id}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <img src={photo.dataUrl} style={{ maxWidth: "95vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 8 }} />
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
          <button onClick={handleDownload} style={{ background: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            ↓ Télécharger
          </button>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "10px 20px", fontSize: 14, color: "#fff", cursor: "pointer" }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════
// STANDALONE CAMERA
// ════════════════════════════════
function StandaloneCamera({ onCapture, onCancel, couleur }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const col = BARNIER[couleur] || BARNIER.blanc;

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (mounted && videoRef.current) {
          streamRef.current = stream;
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        alert("Impossible d'accéder à la caméra. Vérifiez les permissions. (" + e.message + ")");
      }
    }
    startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(dataUrl);
  }

  function handleValidate() {
    stopCamera();
    onCapture(preview);
  }

  function handleDownload() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview;
    a.download = `photo_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleRetake() {
    setPreview(null);
  }

  function handleCancel() {
    stopCamera();
    onCancel();
  }

  // Preview mode — show captured photo with options
  if (preview) {
    return (
      <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
        <div style={{ background: col.hex, padding: "12px 16px", color: "#fff", textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Aperçu photo</div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8, minHeight: 0, overflow: "hidden" }}>
          <img src={preview} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }} />
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
          <button onClick={handleValidate} style={{ background: col.hex, color: "#fff", border: "none", borderRadius: 10, padding: "14px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            ✓ Valider la photo
          </button>
          <button onClick={handleDownload} style={{ background: "#fff", color: "#1C1917", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            ↓ Télécharger la photo
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleRetake} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              ↻ Reprendre
            </button>
            <button onClick={handleCancel} style={{ flex: 1, background: "none", border: "1px solid #555", color: "#aaa", borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Camera live view
  return (
    <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
      <div style={{ background: col.hex, padding: "12px 16px", color: "#fff", textAlign: "center", flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>📸 Prendre une photo</div>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexShrink: 0 }}>
        <button onClick={handleCancel} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>
          Annuler
        </button>
        <button onClick={takePhoto} style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", border: `4px solid ${col.hex}`, cursor: "pointer" }} />
        <div style={{ width: 70 }} />
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

function PhotoSetupView({ piece, percu, col, onStart, onBack }) {
  const [zones, setZones] = useState(["Jardin", "Milieu", "Cour"]);
  const [custom, setCustom] = useState("");

  return (
    <div style={{ ...S.shell, height: "100dvh", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)", overflow: "hidden" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, width: "90%", maxWidth: 380 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#1C1917" }}>Protocole photo</h3>
        <p style={{ color: "#78716C", fontSize: 13, margin: "0 0 16px" }}>
          {percu.nom} — {piece.titre}<br />
          <span style={{ color: "#2563EB" }}>Toujours de Jardin → Cour</span>
        </p>
        {zones.map((z, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ ...S.badge, background: "#E7E5E4", color: "#57534E", minWidth: 20, textAlign: "center" }}>{i + 1}</span>
            <span style={{ flex: 1, color: "#1C1917", fontSize: 14 }}>{z}</span>
            <button style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 18 }} onClick={() => setZones(zones.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6, margin: "10px 0 16px" }}>
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Ajouter zone..."
            onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) { setZones([...zones, custom.trim()]); setCustom(""); } }}
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #D6D3D1", borderRadius: 8, fontSize: 14, outline: "none" }} />
          <button onClick={() => { if (custom.trim()) { setZones([...zones, custom.trim()]); setCustom(""); } }}
            style={{ padding: "8px 14px", border: "1px solid #D6D3D1", borderRadius: 8, background: "none", cursor: "pointer" }}>+</button>
        </div>
        <button disabled={!zones.length} onClick={() => onStart(zones)}
          style={{ ...S.btnPrimary(col.hex), opacity: zones.length ? 1 : 0.5 }}>
          Commencer ({zones.length} photo{zones.length > 1 ? "s" : ""})
        </button>
        <button onClick={onBack} style={{ ...S.btnSecondary, marginTop: 8 }}>Annuler</button>
      </div>
    </div>
  );
}

function CaptureView({ capture, pieces, onPhoto, onNext, onDone, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const piece = pieces.find((p) => p.id === capture.pieceId);
  const percu = piece?.percus.find((r) => r.id === capture.percuId);
  const col = BARNIER[capture.couleur];
  const zone = capture.zones[capture.currentZone];

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (mounted && videoRef.current) {
          streamRef.current = stream;
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        alert("Impossible d'accéder à la caméra. Vérifiez les permissions. (" + e.message + ")");
      }
    }
    startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    ctx.drawImage(video, 0, 0);

    applyWatermark(canvas, ctx, {
      titre: piece?.titre || "",
      percuNom: percu?.nom || "",
      zone,
      num: capture.currentZone + 1,
      total: capture.zones.length,
      couleur: col,
    });

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onPhoto({
      id: uid(),
      dataUrl,
      pieceId: capture.pieceId,
      percuId: capture.percuId,
      zone,
      num: capture.currentZone + 1,
      total: capture.zones.length,
      couleur: capture.couleur,
    });

    if (capture.currentZone < capture.zones.length - 1) {
      onNext({ ...capture, currentZone: capture.currentZone + 1 });
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      onDone();
    }
  }

  return (
    <div style={{ background: "#000", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 430, margin: "0 auto", overflow: "hidden" }}>
      <div style={{ background: col.hex, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#fff", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{piece?.titre} — {percu?.nom}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{zone}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 800 }}>{capture.currentZone + 1}/{capture.zones.length}</div>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0, overflow: "hidden" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: col.hex + "55", padding: "8px", textAlign: "center" }}>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>📸 Photo {capture.currentZone + 1}/{capture.zones.length} — {zone}</span>
        </div>
      </div>
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center", gap: 24, flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: "none", border: "1px solid #555", color: "#888", borderRadius: 10, padding: "10px 20px", fontSize: 14, cursor: "pointer" }}>Annuler</button>
        <button onClick={takePhoto} style={{ width: 68, height: 68, borderRadius: "50%", background: "#fff", border: `4px solid ${col.hex}`, cursor: "pointer" }} />
        <div style={{ width: 70 }} />
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
