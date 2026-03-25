# PlateauMap — Architecture technique

## Stack

```
Frontend:    React 18 + Vite 6
Stockage:    IndexedDB (prevu) — actuellement en memoire
PDF:         pdfjs-dist v4 (client-side)
Deploy:      Vercel (auto-deploy depuis GitHub)
PWA:         manifest.json + service worker basique
```

## Structure fichiers

```
src/
  App.jsx           # Composant principal, state, navigation, tous les ecrans
  data.js           # Constantes (BARNIER, CATEGORIES) + demo data
  pdfParser.js      # Import PDF multi-format + decodeur Daniels
  utils.js          # Generation TXT, watermark photo, clipboard
  styles.js         # Tokens design, styles inline
  main.jsx          # Point d'entree React
public/
  manifest.json     # PWA manifest
  sw.js             # Service worker
  icons/            # Icones app
```

## Modele de donnees

```
Concert
  id, titre, date, lieu, orchestre, chef, notes, archived?
  pieces: Piece[]

Piece
  id, titre, compositeur, duree, salle, chef, date
  effectif          # string Daniels "3.3.3.3 - 4.3.3.1 - ..."
  effectifDetail    # objet decode {bois, cuivres, percussions, cordes}
  orchestre         # {bois: [], cuivres: [], cordes: [], autres: []}
  couleur           # barnier color key
  plans             # string[] (dataUrl images)
  notes             # texte libre
  percus: Pole[]

Pole (= Timbalier, Percu 1, Percu 2...)
  id, nom
  items: Item[]

Item
  cat               # "Claviers", "Timbales & Peaux", "Accessoires", etc.
  nom               # "4 Timbales", "Vibraphone 3 oct", etc.
  notes?            # texte libre
```

## PDF Parser — Formats supportes

| Format | Detection | Particularites |
|--------|-----------|----------------|
| EIC | `Perc N :` dans le texte | Cartouche en bas, instruments avant ou apres le header |
| Radio France | `Objet :` + `Nomenclature :` | Cartouche 2 colonnes, P1:-P4: en fin de ligne |
| Lamoureux | `Effectif :` + notation slash | Pas de liste instruments en texte |
| Generique | Fallback | Tente Perc/P patterns |

## Effectif Daniels — Decodage

```
Format:  Bois / Cuivres / Percussions / Cordes

Bois:    Fl . Hb . Cl . Bn     (suffixes: pic, eh, bcl, cbn, sax)
Cuivres: Cor . Tp . Trb . Tuba
Percu:   Timb . Perc . Hp . Clav   [Cel/Pno]
Cordes:  Vl1 . Vl2 . Alt . Vlc . Cb

Separateurs groupes: "/" ou " - "
Separateurs intra:   "." ou "-"
Brackets:            [Cel/Pno] = claviers supplementaires
```

## Navigation

```
[Concerts] ←→ [Concert (pieces)] ←→ [Piece (poles)] ←→ [Capture/Photos]
                                        |
                                        ↓
                                      [TXT]
```

NavBar fixe en bas : Pieces | Photos | TXT
- TXT depuis concert = toutes les pieces
- TXT depuis piece = cette piece seule
