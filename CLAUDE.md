# OrkMap — Specification technique

## Contexte

OrkMap (ex-PlateauMap) est une PWA mobile-first pour les garcons d'orchestre (stage crew / regisseurs de plateau). Elle gere les installations d'instruments sur scene : import de plans PDF, inventaire materiel par pole, checkbox d'installation, photos, export TXT.

Clients cibles : Ensemble Intercontemporain (EIC), Radio France, Orchestre de Paris, CNSM.

## Stack technique

```
Framework:       React 18 (Vite 6)
Stockage:        IndexedDB via idb (persistance complete)
PDF:             pdfjs-dist v4 (client-side)
Gestes:          Touch events natifs (pinch-to-zoom, drag, long-press)
Deploy:          Vercel (auto-deploy GitHub)
Repo:            github.com/Motokiyo/Orchestral_tec
```

## Structure fichiers

```
src/
  App.jsx           # Composant principal — ecrans, state, navigation
  useStorage.js     # Hook useConcerts() — IndexedDB persistence (idb)
  pdfParser.js      # Import PDF multi-format + decodeur Daniels
  data.js           # Constantes (BARNIER 11 couleurs, CATEGORIES, demo data)
  utils.js          # Generation TXT, watermark photo, clipboard
  styles.js         # Tokens design
  main.jsx          # Entry point
public/
  orkmap-logo.png       # Logo carre
  orkmap-logo-long.png  # Logo horizontal
  manifest.json         # PWA manifest (OrkMap)
  sw.js                 # Service worker
  icons/                # Icones PWA
```

## Modele de donnees

```
Concert
  id, titre, date, lieu, orchestre, chef, notes, archived?
  pieces: Piece[]

Piece
  id, titre, compositeur, duree, salle, chef, date
  effectif           # string Daniels "3.3.3.3 - 4.3.3.1 - ..."
  effectifDetail     # objet decode {bois, cuivres, percussions, cordes}
  orchestre          # {bois: [], cuivres: [], cordes: [], autres: []}
  couleur            # cle barnier (rouge, bleu, noir, etc.)
  plans              # string[] (dataUrl images des plans)
  notes              # texte libre
  percus: Pole[]

Pole (Timbalier, Percu 1, Percu 2...)
  id, nom
  items: Item[]

Item
  cat                # "Claviers", "Timbales & Peaux", "Accessoires", etc.
  nom                # "4 Timbales", "Vibraphone 3 oct"
  notes?             # texte libre
  checked?           # boolean — installe sur le plateau
```

## Couleurs barnier (11 standard Advance AT7)

rouge, bleu, vert, jaune, orange, violet, blanc, noir, gris, marron, vertjaune

## PDF Parser — Formats supportes

| Format | Detection | Source |
|--------|-----------|--------|
| EIC | `Perc N :` dans le texte | Plans AutoCAD EIC |
| Radio France | `Objet :` + `Nomenclature :` | Plans Orchestre Philharmonique |
| Lamoureux | `Effectif :` + notation slash | Plans Orchestre Lamoureux |
| Generique | Fallback patterns | Tout autre format |

### Decodeur Daniels

```
Bois / Cuivres / Percussions / Cordes
Fl.Hb.Cl.Bn — Cor.Tp.Trb.Tuba — Timb.Perc.Hp.Clav [extras] — Vl1.Vl2.Alt.Vlc.Cb

Separateurs groupes: "/" ou " - "
Separateurs intra: "." ou "-"
Brackets: [Cel/Pno] = claviers supplementaires (strip avant detection separateur)
Suffixes: (pic), +eh, *3, 2sax = doublings
```

## Navigation

```
[Concerts] → [Concert (pieces)] → [Piece (poles)] → [Capture/Photos]
                                       |
                                       ↓
                                     [TXT]
```

- NavBar fixe en bas : Pieces | Photos | TXT
- TXT depuis concert = toutes les pieces
- TXT depuis piece = cette piece seule
- Lightbox: pinch-to-zoom (x0.5-x8), drag, double-tap

## Fonctionnalites implementees

- [x] Hierarchie Concert > Pieces > Poles (Timbalier, Percu 1-N)
- [x] Persistance IndexedDB (survit au rechargement)
- [x] Import PDF multi-format avec extraction auto
- [x] Decodeur effectif Daniels complet (bois/cuivres/perc/cordes)
- [x] Timbaliers auto depuis effectif (4 timbales par defaut)
- [x] Orchestre editable (bois/cuivres/cordes/autres)
- [x] Champs piece editables (auto-remplis depuis PDF + correction manuelle)
- [x] 11 couleurs barnier reelles (Advance AT7)
- [x] Plans multiples (PDF + images) avec suppression
- [x] Pinch-to-zoom + pan sur plans et photos
- [x] Checkbox installation (coche = installe, barre, descend)
- [x] Compteur N/M installes par pole
- [x] Reorder poles et pieces (DragHandle)
- [x] TXT complet concert ou par piece/percu
- [x] Notes libres (concert + piece)
- [x] Logo OrkMap + branding
- [x] PWA installable
- [x] Camera standalone + watermark

## Contraintes techniques

- **Mobile-first** : tout fonctionne sur iPhone portrait
- **Offline** : IndexedDB = pas de serveur necessaire
- **Performance** : plans en JPEG 85%, debounce save 500ms
- **Camera** : `facingMode: "environment"` pour camera arriere
- **HTTPS** obligatoire pour camera et clipboard (ou localhost)

## Prochaines etapes

1. Archive concerts (flag archived, liste separee, restaurer/supprimer)
2. Export/Import .orkmap (JSON backup)
3. PDF extraction par IA (Gemini 2.5 Flash gratuit, 1000 pages/jour)
4. Bibliotheque locale pieces (autocomplete depuis anciens concerts)
5. PWA offline durci (vite-plugin-pwa + Workbox)
6. Serveur OrkMap (Supabase, auth, sync, base communautaire)
