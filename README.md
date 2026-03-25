# 🎵 PlateauMap

**Application mobile-first de gestion des installations de percussions sur plateau.**

Développée pour l'Ensemble Intercontemporain (EIC) et Radio France.

---

## Le problème

Les garçons d'orchestre photographient les installations de percussions pour documenter le placement du matériel. Chaque pièce du programme a sa couleur de **barnier** (ruban adhésif coloré). Mais les photos seules prêtent à confusion : angles trompeurs, éléments difficiles à identifier, pas de vue d'ensemble fiable.

## La solution

PlateauMap combine trois outils pour chaque pièce d'une production :

- **Plan de dessus SVG** interactif, converti depuis les PDF AutoCAD existants
- **Inventaire du matériel** par pôle (percussionniste), éditable et exportable en TXT
- **Galerie photo guidée** avec filigrane automatique (titre, percu, zone, couleur barnier)

## Démo

Le proto est pré-rempli avec 4 pièces de Luca Francesconi (programme EIC, 26 mars 2026, dir. Pascal Rophé) :

| Pièce | Couleur | Percus | Instruments |
|-------|---------|--------|-------------|
| ETYMO | 🔴 Rouge | 2 | 13 |
| Unexpected End of Formula | 🔵 Bleu | 2 | 19 |
| Daedalus II | 🟢 Vert | 2 | 6 |
| Moskow Run | 🟡 Jaune | 1 | 2 |

## Fonctionnalités (v1)

### Écrans
- **Accueil** — liste des pièces avec couleurs barnier, nombre de percus et instruments
- **Détail pièce** — percussionnistes dépliables, matos classé par catégorie, ajout/suppression
- **Liste TXT éditable** — inventaire par percu, édition inline, téléchargement TXT, copie presse-papier
- **Galerie photos** — toutes les photos avec filtres par pièce, bordures couleur barnier
- **Mode photo guidé** — protocole Jardin → Milieu → Cour, filigrane automatique sur chaque photo

### Protocole photo
1. Sélectionner un pôle (Percu 1, Percu 2...)
2. Configurer les zones (par défaut : Jardin, Milieu, Cour)
3. Prendre les photos dans l'ordre (toujours de Jardin vers Cour)
4. Le filigrane s'applique automatiquement : titre, n° percu, zone, couleur barnier

### Couleurs barnier
| Couleur | Hex |
|---------|-----|
| Rouge | `#E53935` |
| Bleu | `#1E88E5` |
| Vert | `#43A047` |
| Jaune | `#FDD835` |
| Orange | `#FB8C00` |
| Violet | `#8E24AA` |
| Rose | `#D81B60` |
| Blanc | `#9E9E9E` |

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Framework | React 18 (Vite) |
| Rendu | SPA mobile-first |
| Caméra | MediaDevices API (navigateur) |
| Filigrane | Canvas API |
| Déploiement | Vercel |

## Installation

```bash
npm install
npm run dev
```

## Déploiement

```bash
npm run build
npx vercel
```

Ou connecter le repo à Vercel pour un déploiement automatique à chaque push.

> ⚠️ **HTTPS obligatoire** pour l'accès caméra sur mobile.

## Structure du projet

```
├── index.html              # Entry HTML (PWA-ready)
├── package.json
├── vite.config.js
├── CLAUDE.md               # Spec complète pour Claude Code (v2+)
├── public/
│   └── manifest.json       # PWA manifest
└── src/
    ├── main.jsx            # Entry React
    ├── App.jsx             # Composant principal + toutes les vues
    ├── data.js             # Couleurs barnier, catégories, données démo
    ├── utils.js            # Génération TXT, watermark, clipboard
    └── styles.js           # Tokens design centralisés
```

## Roadmap

### v1 — Proto ✅
- Navigation complète
- Inventaire éditable par percu/catégorie
- Photos guidées avec filigrane
- Export TXT

### v2 — Serveur
- Import PDF AutoCAD → extraction auto des données
- API Daniels' Orchestral Music (optionnelle)
- Serveur PlateauMap : espace privé + base communautaire opt-in
- Sync temps réel entre membres de l'équipe
- Plan SVG interactif double couche

### v3 — Intelligence
- IA Vision : analyse photo → détection matos → mise à jour plan
- Suggestions de setup basées sur l'historique communautaire

## Licence

Propriétaire — EIC / Radio France

---

*Conçu par des garçons d'orchestre, pour des garçons d'orchestre.*
