# PlateauMap — Spécification technique pour Claude Code

## Contexte

PlateauMap est une application web mobile-first (PWA) destinée aux garçons d'orchestre (stage crew) pour gérer les installations de percussions sur un plateau de concert. L'app est développée pour l'Ensemble Intercontemporain (EIC) et Radio France.

Le problème : les garçons d'orchestre photographient les installations de percussions pour documenter le placement du matériel. Chaque pièce du programme a sa couleur de barnier (ruban adhésif coloré). Mais les photos seules prêtent à confusion — angles trompeurs, éléments difficiles à identifier, pas de vue d'ensemble fiable.

La solution : une app qui combine plan SVG interactif, inventaire de matériel par pôle (percussionniste), galerie photo guidée avec filigrane automatique, et export TXT.

---

## Stack technique

```
Framework:       React 18+ (Vite)
Rendu:           SPA mobile-first, PWA installable
Stockage proto:  En mémoire React (pas de localStorage dans le proto artifact)
Stockage v1:     IndexedDB pour photos, localStorage pour métadonnées
Conversion PDF:  pdf.js (Mozilla) côté client
Plan interactif: SVG natif + couche React pour annotations
Gestes tactiles: Touch events natifs (pinch-to-zoom, drag)
Base d'œuvres:   API Daniels' (optionnel) + saisie manuelle
Déploiement:     Vercel ou Netlify
Évolution v2:    Serveur PlateauMap + Supabase + IA Vision
```

---

## Modèle de données

### Hiérarchie

```
Production  (ex: "Programme Francesconi — EIC")
  └─ Pièce  (ex: "ETYMO", couleur barnier: rouge)
       └─ Pôle / Percussionniste  (ex: "Percu 1")
            ├─ Matos assigné  (liste d'instruments par catégorie)
            ├─ Position sur le plan  (coordonnées SVG)
            └─ Photos  (liées à la pièce + pôle)
```

Le setup d'un percussionniste change d'une pièce à l'autre. L'entité Setup est indexée par le couple (pièce, pôle).

### TypeScript Interfaces

```typescript
interface Production {
  id: string;
  nom: string;
  salle: string;
  dates: string;
  poles: Pole[];
  pieces: Piece[];
}

interface Pole {
  id: string;
  nom: string;       // "Percu 1", "Percu 2", etc.
  ordre: number;
}

interface Piece {
  id: string;
  nom: string;
  compositeur: string;
  danielsId?: string;         // Référence Daniels' si importé
  couleurBarnier: BarnierColor;
  effectifComplet?: Effectif;
  plan?: Plan;
  setups: Setup[];
  photos: Photo[];
  duree?: string;
  salle?: string;
  chef?: string;
  date?: string;
}

type BarnierColor = 'rouge' | 'bleu' | 'vert' | 'jaune' | 'orange' | 'violet' | 'rose' | 'blanc';

interface BarnierDef {
  hex: string;    // Couleur principale
  bg: string;     // Couleur de fond léger
  name: string;   // Nom français
}

// Palette fixe
const BARNIER: Record<BarnierColor, BarnierDef> = {
  rouge:  { hex: "#E53935", bg: "#FFCDD2", name: "Rouge" },
  bleu:   { hex: "#1E88E5", bg: "#BBDEFB", name: "Bleu" },
  vert:   { hex: "#43A047", bg: "#C8E6C9", name: "Vert" },
  jaune:  { hex: "#FDD835", bg: "#FFF9C4", name: "Jaune" },
  orange: { hex: "#FB8C00", bg: "#FFE0B2", name: "Orange" },
  violet: { hex: "#8E24AA", bg: "#E1BEE7", name: "Violet" },
  rose:   { hex: "#D81B60", bg: "#F8BBD0", name: "Rose" },
  blanc:  { hex: "#9E9E9E", bg: "#F5F5F5", name: "Blanc" },
};

interface Effectif {
  cordes?: string;
  bois?: string;
  cuivres?: string;
  percussions: PercuEffectif;
  autres?: string;
  duree?: number;
  editeur?: string;
  source: 'daniels' | 'manuel' | 'serveur';
}

interface PercuEffectif {
  nombreJoueurs: number;
  instruments: string[];
}

interface Setup {
  poleId: string;
  items: Item[];
  annotations: Annotation[];
  valideTerrain: boolean;
}

interface Item {
  id: string;
  nom: string;
  categorie: ItemCategory;
  quantite: number;
  notes?: string;
}

type ItemCategory =
  | 'Timbales & Peaux'
  | 'Claviers'
  | 'Accessoires'
  | 'Grosses pièces'
  | 'Stands & supports'
  | 'Baguettes & spécial';

interface Plan {
  svgData: string;
  viewBox: string;
}

interface Annotation {
  id: string;
  type: 'icone_matos' | 'texte' | 'zone';
  x: number;
  y: number;
  rotation: number;
  label: string;
  itemId?: string;
}

interface Photo {
  id: string;
  dataUrl: string;     // base64 JPEG
  pieceId: string;
  percuId?: string;
  zone: string;        // "Jardin", "Milieu", "Cour"
  num: number;         // 1, 2, 3...
  total: number;       // nombre total de zones
  couleur: BarnierColor;
  timestamp: string;
  legende?: string;
  analyseIA?: object;  // v2
}
```

### Catégories de matériel

| Catégorie | Icône | Exemples |
|-----------|-------|----------|
| Timbales & Peaux | ⊙ | Timbales, caisse claire, toms, bongos, congas, tambourin |
| Claviers | ▬ | Xylophone, marimba, vibraphone, glockenspiel, célesta, cloches tubulaires |
| Accessoires | △ | Triangle, wood-block, claves, fouet, castagnettes, maracas, guiro |
| Grosses pièces | ◯ | Gong, tam-tam, grosse caisse, steel drum, enclume |
| Stands & supports | ⊤ | Pieds de cymbale, racks, tables accessoires, tréteaux, pupitres |
| Baguettes & spécial | ✦ | Mailloches, archets, baguettes spéciales, objets contemporains, électro, ampli |

---

## Architecture de l'application

### Structure des fichiers

```
plateaumap/
├── public/
│   ├── manifest.json          # PWA manifest
│   └── icons/                 # App icons
├── src/
│   ├── main.tsx               # Entry point
│   ├── App.tsx                # Router principal
│   ├── types.ts               # Interfaces TypeScript (voir ci-dessus)
│   ├── constants.ts           # BARNIER, CATEGORIES, etc.
│   ├── utils/
│   │   ├── generateTxt.ts     # Génération TXT par pôle par pièce
│   │   ├── uid.ts             # Générateur d'IDs
│   │   ├── pdfToSvg.ts        # Conversion PDF → SVG via pdf.js
│   │   └── watermark.ts       # Application du filigrane photo
│   ├── stores/
│   │   ├── useProduction.ts   # Store React (useState ou zustand)
│   │   └── usePhotos.ts       # Store photos (IndexedDB wrapper)
│   ├── components/
│   │   ├── Shell.tsx           # Layout principal (header + body + nav)
│   │   ├── NavBar.tsx          # Barre navigation bas (Pièces/Photos/TXT)
│   │   ├── FilterBtn.tsx       # Bouton filtre coloré
│   │   ├── EditableItem.tsx    # Item éditable inline (tap=edit, ×=delete)
│   │   └── PhotoSetup.tsx      # Modal setup zones photo
│   ├── screens/
│   │   ├── HomeScreen.tsx      # Liste des pièces
│   │   ├── PieceScreen.tsx     # Détail pièce (percus, items, photos)
│   │   ├── TxtScreen.tsx       # Liste matériel éditable
│   │   ├── GalleryScreen.tsx   # Galerie photos avec filtres
│   │   ├── CaptureScreen.tsx   # Prise de photo avec caméra + filigrane
│   │   └── PlanScreen.tsx      # Plan SVG interactif (v1.1)
│   └── styles/
│       └── theme.ts            # Tokens design
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Navigation

```
[Home: Liste pièces]
    │
    ├──▶ [Piece: Détail pièce]
    │     ├── Percus dépliables avec liste items
    │     ├── Bouton Photos → PhotoSetup → Capture
    │     └── Bouton TXT → TxtScreen
    │
    ├──▶ [Gallery: Galerie photos]
    │     ├── Filtres par pièce (couleur barnier)
    │     └── Tap = plein écran
    │
    └──▶ [TXT: Liste matériel éditable]
          ├── Sélecteur de pièce (tabs couleur)
          ├── Items éditables par percu par catégorie
          └── Export TXT / copier

Navigation par tabs en bas : Pièces | Photos | TXT
```

---

## Fonctionnalités détaillées

### 1. Import PDF AutoCAD → extraction des données

**Objectif** : L'utilisateur uploade un PDF de plan AutoCAD. L'app extrait automatiquement les infos textuelles (œuvre, compositeur, durée, salle, liste instruments par percu).

**Implémentation** :

```typescript
// src/utils/pdfToSvg.ts
import * as pdfjsLib from 'pdfjs-dist';

interface ExtractedData {
  titre: string;
  compositeur: string;
  duree: string;
  salle: string;
  date: string;
  chef: string;
  percus: { nom: string; items: { cat: string; nom: string }[] }[];
  svgData: string;   // SVG reconstruit depuis les paths vectoriels
}

async function extractFromPdf(file: File): Promise<ExtractedData> {
  // 1. Charger le PDF avec pdf.js
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
  const page = await pdf.getPage(1);

  // 2. Extraire le texte
  const textContent = await page.getTextContent();
  const fullText = textContent.items.map(item => item.str).join(' ');

  // 3. Parser le texte pour extraire les données structurées
  // Patterns EIC typiques (voir exemples PDF ci-dessous)
  const data = parseEicPlanText(fullText);

  // 4. Extraire les paths vectoriels pour reconstruire le SVG
  const viewport = page.getViewport({ scale: 1 });
  const svgData = await renderPageToSvg(page, viewport);

  return { ...data, svgData };
}
```

**Exemples de texte extrait des PDF EIC** (à utiliser comme patterns de parsing) :

```
// ETYMO
"Luca FRANCESCONI ETYMO Durée Dir : Pascal ROPHÉ CMPP Jeudi 26 mars 2026
Percu 2 : 1 marimba 1 xylo 1 glock valise 1 paire de bongos 1 tamtam grave
grelots susp 2 rototoms grave 1 cymbale susp
Vibraphone 3 oct Glockenspiel Xylophone Marimba 4,5 Glock valise Tam 100Wh"

// Unexpected End of Formula
"Luca FRANCESCONI Unexpected End of Formula 18' Dir : Pascal ROPHE Salle des concerts, PP2
Perc 2 : 1 Flûte à coulisse 4 Timbales n°1>4 1 Xylo 1 Vibra 1 Cymb.
1 Wood board 1 Cymb. Chinoise 8\" 1 Cymb. Chinoise crash 1 Triangle
3 Cloches tubes Do3 + Ré3 + Fa4 2 octaves de Crotales 2 Bodhran (17\"+20\")
1 SpringDrum (Thunder Tongue) 1 Gong opéra chinois Sand Blocks 1 Tôle Tonnerre"

// Daedalus II
"Luca FRANCESCONI Daedalus II 22' Dir : Pascal ROPHÉ CMPP
percu 1 : Vibra Glock Tam (very low) Bassine d'eau en métal + brosse métallique
percu 2 ad lib (non obligatoire) Glock Bassine d'eau en métal"

// Moskow Run
"Luca Francesconi Moskow Run 11' Lieu SdC
Vibraphone 3 oct Marimba 5"
```

**Règles de parsing** :
- Le compositeur est toujours en haut, format "Prénom NOM" ou "NOM"
- Le titre suit le compositeur
- La durée est au format "XX'" ou "~XX'"
- "Dir :" ou "Dir:" précède le chef d'orchestre
- "CMPP", "SdC", "PP2", "Salle des concerts" = salle
- "Perc N :" ou "percu N :" introduit la liste d'un pôle
- Les instruments sont listés avec des quantités optionnelles ("1 Xylo", "4 Timbales")

### 2. Plan SVG interactif (v1.1)

**Architecture double couche** :

```
┌────────────────────────────────────────┐
│  Couche 2 : ANNOTATIONS               │  ← draggable, éditable
│  (icônes matos, labels, zones)         │    piloté par React state
├────────────────────────────────────────┤
│  Couche 1 : PLAN SVG                  │  ← statique après import
│  (formes extraites du PDF AutoCAD)     │    zoom/pan uniquement
└────────────────────────────────────────┘
```

Les deux couches vivent dans un même élément `<svg>` avec deux groupes `<g>` superposés.

**Interactions tactiles — deux modes** :

Mode Navigation (défaut) :
- Pinch-to-zoom : zoom fluide centré sur le point de contact
- Drag 1 doigt : pan/déplacement
- Tap sur élément : popup d'info

Mode Édition (bouton toggle) :
- Tap sur plan : pose l'élément sélectionné dans la palette
- Drag sur élément posé : repositionnement
- Long press : menu (supprimer/dupliquer/rotation)

### 3. Protocole photo guidé

**Flux** :

1. L'utilisateur sélectionne un pôle (ex: "Percu 2") dans une pièce
2. L'app affiche l'écran PhotoSetup avec les zones par défaut : Jardin, Milieu, Cour
3. L'utilisateur peut ajouter/supprimer des zones, réorganiser
4. Tap "Commencer" → la caméra s'ouvre
5. Écran CaptureScreen : bandeau coloré en haut avec titre/percu/zone/numéro
6. L'utilisateur prend la photo (gros bouton rond)
7. Le filigrane s'applique automatiquement via Canvas :
   - Bandeau en bas avec couleur barnier semi-transparente
   - Texte : "Titre — Percu N — Zone"
   - Numéro : "1/3"
   - Badge couleur en haut à gauche
8. Passage automatique à la zone suivante
9. Quand toutes les zones sont faites → retour à la galerie

**Code de référence pour le watermark** :

```typescript
// src/utils/watermark.ts
function applyWatermark(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  options: {
    titre: string;
    percuNom: string;
    zone: string;
    num: number;
    total: number;
    couleur: BarnierDef;
  }
) {
  const { titre, percuNom, zone, num, total, couleur } = options;

  // Bandeau en bas
  const bandH = canvas.height * 0.08;
  ctx.fillStyle = couleur.hex + "CC";
  ctx.fillRect(0, canvas.height - bandH, canvas.width, bandH);

  // Texte principal
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  const y = canvas.height - bandH / 2;
  ctx.font = `bold ${Math.round(bandH * 0.4)}px -apple-system, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(`${titre} — ${percuNom} — ${zone}`, 16, y);

  // Numéro
  ctx.font = `bold ${Math.round(bandH * 0.5)}px -apple-system, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(`${num}/${total}`, canvas.width - 16, y);

  // Badge couleur en haut
  ctx.textAlign = "left";
  ctx.fillStyle = couleur.hex + "AA";
  ctx.fillRect(10, 10, 140, 28);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px -apple-system, sans-serif";
  ctx.fillText(couleur.name.toUpperCase(), 18, 28);
}
```

### 4. Liste TXT éditable

**Vue TxtScreen** :
- Sélecteur de pièce en haut (tabs avec couleur barnier)
- Bloc info : compositeur, durée, salle, chef
- Pour chaque percu : liste items par catégorie
- Chaque item est éditable (tap = édition inline, × = supprimer)
- Bouton "Ajouter un instrument" par percu
- Export : télécharger TXT, copier presse-papier

**Format de sortie TXT** :

```
=============================================
  ETYMO
  Luca FRANCESCONI — ~25'
  CMPP — 26 mars 2026
  Chef : Pascal ROPHÉ
  Barnier : Rouge
=============================================

----------------------------------------
  PERCU 1
----------------------------------------

  CLAVIERS
    - Vibraphone 3 oct
    - Xylophone
    - Glockenspiel
    - Marimba 4,5 oct

  GROSSES PIÈCES
    - Tam-tam 100cm

----------------------------------------
  PERCU 2
----------------------------------------

  CLAVIERS
    - Marimba
    - Xylophone
    - Glockenspiel valise

  TIMBALES & PEAUX
    - Paire de bongos
    - 2 Roto-toms graves

  GROSSES PIÈCES
    - Tam-tam grave

  ACCESSOIRES
    - Grelots suspendus
    - Cymbale suspendue
```

### 5. Alimentation des données — trois modes

**Mode 1 : Saisie manuelle (toujours disponible, gratuit)**
- L'utilisateur tape le nom de l'œuvre, le compositeur, crée les pôles, ajoute le matos
- Autocomplétion depuis une bibliothèque locale d'instruments prédéfinis

**Mode 2 : API Daniels' (optionnel)**
- Abonnement à Daniels' Orchestral Music Online (DOMO) requis — 70$/an + option API
- Auth : API ID + API Token dans les réglages
- Recherche par titre/compositeur → retour effectif complet + matos percu
- Les données importées sont toujours modifiables localement (le terrain prime)

**Mode 3 : Serveur PlateauMap (v2)**
- Base communautaire construite par les utilisateurs
- Données privées par défaut + base partagée opt-in
- Recherche : "Symphonie Fantastique" → voir les installations d'autres orchestres

### 6. Galerie photos

- Accessible depuis partout (tab permanente)
- Photos liées aux pièces mais visibles globalement
- Filtres : par pièce (couleur barnier), par pôle
- Bordure colorée selon la couleur barnier de la pièce
- Tap = vue plein écran
- Infos en filigrane sur chaque photo pour identification immédiate

---

## Design & UX

### Direction esthétique

**Industriel / Utilitaire** — c'est un outil de plateau, pas un site marketing.

- Fond clair chaleureux (pierre, crème)
- Couleurs barnier comme accents dominants (pas de bleu générique)
- Typographie lisible sur téléphone en condition de plateau (luminosité variable)
- Composants tactiles larges (doigts, pas souris)
- Pas d'animations inutiles — vitesse d'utilisation prime

### Palette

```css
--bg:        #F5F5F4;    /* Stone 100 */
--surface:   #FAFAF9;    /* Stone 50 */
--border:    #E7E5E4;    /* Stone 200 */
--text:      #1C1917;    /* Stone 900 */
--text-2:    #57534E;    /* Stone 600 */
--text-3:    #A8A29E;    /* Stone 400 */
/* + couleurs BARNIER dynamiques selon la pièce active */
```

### Typographie

```css
font-family: 'DM Sans', -apple-system, system-ui, sans-serif;
```

Titres en 17px bold, corps en 13-14px, tags en 11px.

---

## Données de test

Les données ci-dessous proviennent de vrais PDF de plans AutoCAD de l'EIC pour un programme Francesconi dirigé par Pascal Rophé, le 26 mars 2026.

```typescript
const DEMO_PIECES: Piece[] = [
  {
    id: "etymo",
    titre: "ETYMO",
    compositeur: "Luca FRANCESCONI",
    duree: "~25'",
    salle: "CMPP",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleurBarnier: "rouge",
    setups: [
      {
        poleId: "p1",  // Percu 1
        items: [
          { id: "1", nom: "Vibraphone 3 oct", categorie: "Claviers", quantite: 1 },
          { id: "2", nom: "Xylophone", categorie: "Claviers", quantite: 1 },
          { id: "3", nom: "Glockenspiel", categorie: "Claviers", quantite: 1 },
          { id: "4", nom: "Marimba 4,5 oct", categorie: "Claviers", quantite: 1 },
          { id: "5", nom: "Tam-tam 100cm", categorie: "Grosses pièces", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
      {
        poleId: "p2",  // Percu 2
        items: [
          { id: "6", nom: "Marimba", categorie: "Claviers", quantite: 1 },
          { id: "7", nom: "Xylophone", categorie: "Claviers", quantite: 1 },
          { id: "8", nom: "Glockenspiel valise", categorie: "Claviers", quantite: 1 },
          { id: "9", nom: "Paire de bongos", categorie: "Timbales & Peaux", quantite: 1 },
          { id: "10", nom: "Tam-tam grave", categorie: "Grosses pièces", quantite: 1 },
          { id: "11", nom: "Grelots suspendus", categorie: "Accessoires", quantite: 1 },
          { id: "12", nom: "2 Roto-toms graves", categorie: "Timbales & Peaux", quantite: 2 },
          { id: "13", nom: "Cymbale suspendue", categorie: "Accessoires", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
    ],
    photos: [],
  },
  {
    id: "ueof",
    titre: "Unexpected End of Formula",
    compositeur: "Luca FRANCESCONI",
    duree: "18'",
    salle: "SdC, PP2",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleurBarnier: "bleu",
    setups: [
      {
        poleId: "p1",
        items: [
          { id: "14", nom: "Vibraphone", categorie: "Claviers", quantite: 1 },
          { id: "15", nom: "Glockenspiel", categorie: "Claviers", quantite: 1 },
          { id: "16", nom: "Tam-tam 100cm", categorie: "Grosses pièces", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
      {
        poleId: "p2",
        items: [
          { id: "17", nom: "Flûte à coulisse", categorie: "Accessoires", quantite: 1 },
          { id: "18", nom: "4 Timbales n°1 à 4", categorie: "Timbales & Peaux", quantite: 4 },
          { id: "19", nom: "Xylophone", categorie: "Claviers", quantite: 1 },
          { id: "20", nom: "Vibraphone", categorie: "Claviers", quantite: 1 },
          { id: "21", nom: "Cymbale", categorie: "Accessoires", quantite: 1 },
          { id: "22", nom: "Wood board", categorie: "Accessoires", quantite: 1 },
          { id: "23", nom: "Cymbale chinoise 8\"", categorie: "Accessoires", quantite: 1 },
          { id: "24", nom: "Cymbale chinoise crash", categorie: "Accessoires", quantite: 1 },
          { id: "25", nom: "Triangle", categorie: "Accessoires", quantite: 1 },
          { id: "26", nom: "3 Cloches tubes (Do3+Ré3+Fa4)", categorie: "Claviers", quantite: 3 },
          { id: "27", nom: "2 oct. de Crotales", categorie: "Accessoires", quantite: 1 },
          { id: "28", nom: "2 Bodhran (17\"+20\")", categorie: "Timbales & Peaux", quantite: 2 },
          { id: "29", nom: "SpringDrum (Thunder Tongue)", categorie: "Accessoires", quantite: 1 },
          { id: "30", nom: "Gong opéra chinois", categorie: "Grosses pièces", quantite: 1 },
          { id: "31", nom: "Sand Blocks", categorie: "Accessoires", quantite: 1 },
          { id: "32", nom: "Tôle Tonnerre", categorie: "Grosses pièces", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
    ],
    photos: [],
  },
  {
    id: "daed",
    titre: "Daedalus II",
    compositeur: "Luca FRANCESCONI",
    duree: "22'",
    salle: "CMPP",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleurBarnier: "vert",
    setups: [
      {
        poleId: "p1",
        items: [
          { id: "33", nom: "Vibraphone 3 oct", categorie: "Claviers", quantite: 1 },
          { id: "34", nom: "Glockenspiel valise", categorie: "Claviers", quantite: 1 },
          { id: "35", nom: "Tam-tam (very low)", categorie: "Grosses pièces", quantite: 1 },
          { id: "36", nom: "Bassine d'eau en métal + brosse métallique", categorie: "Accessoires", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
      {
        poleId: "p2",
        items: [
          { id: "37", nom: "Glockenspiel", categorie: "Claviers", quantite: 1 },
          { id: "38", nom: "Bassine d'eau en métal", categorie: "Accessoires", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
    ],
    photos: [],
  },
  {
    id: "mosk",
    titre: "Moskow Run",
    compositeur: "Luca Francesconi",
    duree: "11'",
    salle: "SdC",
    chef: "Pascal ROPHÉ",
    date: "26 mars 2026",
    couleurBarnier: "jaune",
    setups: [
      {
        poleId: "p1",
        items: [
          { id: "39", nom: "Vibraphone 3 oct", categorie: "Claviers", quantite: 1 },
          { id: "40", nom: "Marimba 5 oct", categorie: "Claviers", quantite: 1 },
        ],
        annotations: [],
        valideTerrain: false,
      },
    ],
    photos: [],
  },
];
```

---

## Instructions pour Claude Code

### Phase 1 : Scaffold (immédiat)

```bash
npm create vite@latest plateaumap -- --template react-ts
cd plateaumap
npm install pdfjs-dist zustand
npm install -D tailwindcss @tailwindcss/vite
```

1. Créer la structure de fichiers décrite ci-dessus
2. Implémenter les types TypeScript
3. Créer le store avec zustand (ou useState simple)
4. Pré-remplir avec les données de test DEMO_PIECES

### Phase 2 : Écrans de base

1. **HomeScreen** : liste des pièces avec cards colorées
2. **PieceScreen** : détail avec percus dépliables, items par catégorie
3. **TxtScreen** : liste éditable avec EditableItem, export TXT
4. **GalleryScreen** : grille photos avec filtres par pièce
5. **NavBar** : navigation fixe en bas

### Phase 3 : Caméra & Photos

1. **PhotoSetup** : modal de configuration des zones
2. **CaptureScreen** : accès caméra, filigrane Canvas, progression zone par zone
3. Stockage photos en mémoire (proto) puis IndexedDB (v1)

### Phase 4 : Import PDF

1. Intégrer pdf.js pour la lecture des PDF
2. Parser le texte extrait pour identifier titre, compositeur, durée, percus, instruments
3. Reconstruire un SVG depuis les paths vectoriels du PDF
4. Fallback : rendu bitmap si le PDF est rasterisé

### Phase 5 : Plan SVG interactif

1. Double couche SVG (plan + annotations)
2. Zoom/pan tactile
3. Palette matos avec drag & drop
4. Modes Navigation / Édition

### Contraintes techniques

- **Mobile-first** : tout doit fonctionner sur un iPhone en mode portrait
- **Offline** : l'app doit fonctionner sans connexion (PWA + service worker)
- **Performance** : les photos compressées en JPEG 85%, lazy loading
- **Pas de serveur** pour le proto : tout côté client
- **Camera** : `facingMode: "environment"` pour la caméra arrière
- **HTTPS obligatoire** pour la caméra et le clipboard (ou localhost en dev)

### Vérifications à faire

Avant chaque livraison, vérifier :

1. **Parse** : le code JSX/TSX se parse sans erreur
2. **Hooks** : pas de useState/useEffect dans des conditionnels
3. **Composants** : tous les composants JSX sont définis
4. **Pas de localStorage** dans un artifact Claude (interdit)
5. **roundRect** : ne pas utiliser (pas supporté partout), utiliser fillRect
6. **clipboard** : toujours dans un try/catch
7. **Camera cleanup** : le stream est stoppé dans le return du useEffect

---

## Roadmap

### v1 — Proto (immédiat)
- Navigation complète
- Saisie manuelle des œuvres et effectifs
- Plan SVG : import PDF, double couche, zoom/pan, annotations
- Inventaire : par pôle par pièce, 6 catégories, éditable
- Photos : protocole guidé, filigrane auto, galerie globale
- Export : TXT par pôle par pièce, export .plateaumap

### v2 — Serveur (après validation terrain)
- Serveur PlateauMap : espace privé + base communautaire opt-in
- Auth par code de production + comptes utilisateurs
- Sync temps réel entre membres de l'équipe
- Intégration API Daniels' (optionnelle)
- Archivage automatique de chaque concert

### v3 — Intelligence (innovation)
- IA Vision : analyse photo → détection matos → mise à jour plan
- Le terrain prime : si la photo diffère du plan, le plan se met à jour
- Suggestions automatiques de setup basées sur l'historique communautaire
- Modèle fine-tuné sur les photos de la communauté
