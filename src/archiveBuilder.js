// Assemblage du zip « dossier pour la salle » (lot 8). Rôle : parcourir les pièces une à une, charger les plans,
// écrire les fiches (TXT et PDF), ajouter les photos, et rendre le zip. Tout ce qui touche au téléphone
// (magasin des plans, canvas) est passé en `deps` : le même code tourne dans l'app et dans les tests Node.
//
// Arborescence :
//   00_Fiche_concert.pdf / .txt (sommaire, puis une section par œuvre), 00_Sommaire.json (pour retrouver chaque œuvre)
//   01_Titre/Fiche.pdf, Fiche.txt, Plans/Plan_1.jpg ..., Photos/Photo_01_Percu_Zone.jpg ...
// Un plan absent du téléphone (et sans réseau) n'a PAS de fichier : la fiche écrit « plan non disponible sur ce téléphone ».
import JSZip from "jszip";
import { blocsFichePiece, blocsFicheConcert, blocsEnTxt, blocsEnPdf, blocsEnPdfDetail, infoPdfConcert, infoPdfPiece, sommaireJson, nomDossierPiece, nomZipDossier, plansDeLaPiece } from "./archive.js";
import { ecrirePhotosPiece } from "./photoExport.js";
import { octetsDeDataUrl, extensionDeMime } from "./archiveImages.js";

const TEXTE = { compression: "DEFLATE" };
const IMAGE = { compression: "STORE" };
const respirer = () => new Promise((r) => setTimeout(r, 0));

/**
 * deps : { chargerPlan(valeur) -> dataUrl | null, filigrane(dataUrl, opts) -> dataUrl, enJpeg(dataUrl) -> { bytes, width, height, components } | null }
 * Renvoie { blob, nom, stats } ; stats : { pieces, plans, plansAbsents, photos }.
 */
export async function construireDossier({ concert, pieceIds = null, avecPhotos = true, photos = {}, deps, onProgress = () => {} }) {
  const toutes = concert.pieces || [];
  const pieces = toutes.filter((p) => !pieceIds || pieceIds.includes(p.id));
  const nbPhotosPiece = (p) => (avecPhotos ? (photos[p.id] || []).length : 0);
  const etapes = 1 + pieces.reduce((s, p) => s + 1 + nbPhotosPiece(p), 0);
  let fait = 0;
  const avance = (texte, n = 1) => { fait += n; onProgress({ texte, fait, total: etapes, pct: Math.min(100, Math.round((fait / etapes) * 100)) }); };

  const zip = new JSZip();
  const stats = { pieces: pieces.length, plans: 0, plansAbsents: 0, photos: 0 };

  // Fiche du concert en tête.
  const blocsConcert = blocsFicheConcert({ concert, pieces, nbTotal: toutes.length });
  zip.file("00_Fiche_concert.txt", blocsEnTxt(blocsConcert), TEXTE);
  const pdfConcert = blocsEnPdfDetail(blocsConcert, { info: infoPdfConcert(concert, pieces) });
  zip.file("00_Fiche_concert.pdf", pdfConcert.bytes, TEXTE);
  const details = [];
  avance("Fiche du concert");
  await respirer();

  for (let r = 0; r < pieces.length; r++) {
    const piece = pieces[r];
    const rang = r + 1;
    const dossier = zip.folder(nomDossierPiece(rang, piece));
    const nomAffiche = piece.titre || "Sans titre";

    // Plans : un à la fois, jamais plusieurs images décodées ensemble.
    const plans = [];
    const images = {};
    const valeurs = plansDeLaPiece(piece);
    for (let k = 0; k < valeurs.length; k++) {
      onProgress({ texte: `${nomAffiche} : plan ${k + 1} sur ${valeurs.length}`, fait, total: etapes, pct: Math.round((fait / etapes) * 100) });
      let dataUrl = null;
      try { dataUrl = await deps.chargerPlan(valeurs[k]); } catch { dataUrl = null; }
      const brut = octetsDeDataUrl(dataUrl);
      if (!brut) { plans.push({ present: false }); stats.plansAbsents++; continue; }
      const fichier = `Plans/Plan_${k + 1}.${extensionDeMime(brut.mime)}`;
      dossier.file(fichier, brut.bytes, IMAGE);
      plans.push({ present: true, fichier });
      stats.plans++;
      if (!images.plan1) {
        try { const jpg = await deps.enJpeg(dataUrl); if (jpg) images.plan1 = jpg; } catch { /* le plan reste dans Plans/ */ }
      }
    }

    const nbPhotos = avecPhotos ? (photos[piece.id] || []).length : null;
    const blocs = blocsFichePiece({ piece, concert, rang, plans, nbPhotos, imagePlan: images.plan1 ? "plan1" : null });
    dossier.file("Fiche.txt", blocsEnTxt(blocs), TEXTE);
    dossier.file("Fiche.pdf", blocsEnPdf(blocs, { info: infoPdfPiece(concert, piece, rang), images }), TEXTE);
    avance(`${nomAffiche} : fiche`);
    await respirer();

    details.push({ nbPlans: plans.filter((x) => x.present).length, nbPhotos: nbPhotos || 0 });
    if (avecPhotos && nbPhotos > 0) {
      const base = fait;
      stats.photos += await ecrirePhotosPiece(dossier.folder("Photos"), piece, photos[piece.id] || [], {
        bake: deps.filigrane,
        onPhoto: (n) => { fait = base + n - 1; avance(`${nomAffiche} : photo ${n} sur ${nbPhotos}`); },
      });
    }
  }

  zip.file("00_Sommaire.json", sommaireJson({ concert, pieces, details, pagesFiche: pdfConcert.pages, nbTotal: toutes.length }), TEXTE);
  onProgress({ texte: "Assemblage du fichier zip", fait, total: etapes, pct: 100 });
  const blob = await zip.generateAsync({ type: "blob", streamFiles: true });
  onProgress({ texte: "Dossier prêt", fait: etapes, total: etapes, pct: 100 });
  return { blob, nom: nomZipDossier(concert), stats };
}
