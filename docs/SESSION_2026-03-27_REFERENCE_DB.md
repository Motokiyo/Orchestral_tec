# Session 27 mars 2026 — Construction de la base de données de référence

## Résumé

Session de nuit consacrée à la construction complète de la base de données de référence constructeurs pour le pipeline d'extraction IA d'OrkMap. Deux axes : scraping exhaustif du catalogue Rythmes & Sons (r-sons.com) et compilation du catalogue Kolberg depuis leurs PDFs.

## Travail réalisé

### 1. Scraping R&S (r-sons.com)

Le site R&S est un PrestaShop. Pas d'API publique, donc scraping via Chrome DevTools :

- **Découverte du sitemap.xml** → 4379 URLs dont 2617 produits percu+mobilier
- **Extraction par lots** via JavaScript injecté dans la console (batches de 20 pour éviter les timeouts)
- **Catégories scrapées** : claviers (265), timbales (259), métaux (370), peaux (443), bois (86), effets (64), mobilier (chaises, pupitres, portiques, attaches…)
- **Total : 2093 produits avec références exactes**

Fichiers produits :
| Fichier | Contenu | Taille |
|---------|---------|--------|
| `RS_SITEMAP_COMPLET.tsv` | Dump complet sitemap (2617 URLs) | 215 Ko |
| `RS_REFS_CLAVIERS.tsv` | Célesta, glock, marimba, vibra, xylo (265) | 50 Ko |
| `RS_REFS_TIMBALES.tsv` | Timbales + accessoires (259) | 23 Ko |
| `RS_REFS_METAUX_BOIS_PEAUX.tsv` | Métaux, bois, peaux, effets (963) | 87 Ko |
| `RS_CATALOGUE_COMPLET.csv` | **Master unifié** (2093 produits) | 201 Ko |
| `RS_CATALOGUE_REFERENCE.csv` | Ancien fichier curé mobilier (~120) | 12 Ko |

### 2. Compilation Kolberg

À partir de 3 PDFs Kolberg (catalogue chaises, Kombiständer, Tonumfangtabelle) :

| Fichier | Contenu | Taille |
|---------|---------|--------|
| `KOLBERG_CATALOGUE_REFERENCE.csv` | Catalogue complet (~170 lignes) | 18 Ko |

Inclut : 32 modèles de chaises, 100+ pièces Kombiständer, 25 entrées tessitures.

### 3. Fichiers JSON optimisés pour l'agent IA

Stratégie 3 niveaux pour minimiser la consommation de tokens :

| Niveau | Fichier | Usage | Tokens |
|--------|---------|-------|--------|
| **1 — System prompt** | `LOOKUP_INSTRUMENTS.json` | Tessiture + support par instrument | ~2.3k |
| **1 — System prompt** | `LOOKUP_MOBILIER.json` | Règles de comptage mobilier | ~1.2k |
| **2 — RAG on demand** | `RS_KOLBERG_ESSENTIELS.json` | ~200 refs les plus courantes | ~1.7k |
| **3 — Disk only** | `RS_CATALOGUE_COMPLET.csv` | 2093 produits (jamais en prompt) | — |
| **3 — Disk only** | `KOLBERG_CATALOGUE_REFERENCE.csv` | Catalogue complet (jamais en prompt) | — |

**Économie** : ~5k tokens en prompt au lieu de ~60k si tout était injecté. Facteur 12×.

### 4. Mise à jour TESSITURE_PERCUSSION.md

Ajout de la Tonumfangtabelle Kolberg comme source primaire mondiale. Instruments ajoutés :
- Cloches : église (C2–C7), cup bell (F5–F9), cowbell, Swiss bell (F4–C9), Handglocke (C6–C9), bell plate, enclume (D5–C9)
- Divers : log drum, slit drum, Flaschenspiel, Autohupe, Angklung, Mokusho, Poly Block, Wood Block, Temple Block, Lithophon, Steelpan, Boobam, gongs birmans

### 5. Mise à jour EXTRACTION_IA_REFERENCE.md

Ajout des sections :
- Table des fichiers de référence (12 entrées)
- Catalogue Kolberg chaises (32 modèles)
- Kombiständer organisé par type
- Système de préfixes R&S (22 préfixes)
- Liste des 21 marques distribuées par R&S

## Problèmes rencontrés et solutions

| Problème | Solution |
|----------|----------|
| Timeout JS sur batches > 45 produits | Réduction à 20 par batch |
| Tab Chrome détachée après scraping intensif | Re-navigation vers la page |
| Noms produits vides (images sans texte) | Extraction depuis les slugs d'URL PrestaShop |
| `Promise.all().then()` retourne undefined | Pattern `async/await` IIFE |
| Premier scrape incomplet (~120/2600) | Découverte sitemap.xml → extraction exhaustive |

## Architecture résultante

```
docs/
  ├── LOOKUP_INSTRUMENTS.json      ← Niveau 1 (system prompt, ~2.3k tokens)
  ├── LOOKUP_MOBILIER.json         ← Niveau 1 (system prompt, ~1.2k tokens)
  ├── RS_KOLBERG_ESSENTIELS.json   ← Niveau 2 (RAG on demand, ~1.7k tokens)
  ├── RS_CATALOGUE_COMPLET.csv     ← Niveau 3 (disk only, 2093 produits)
  ├── KOLBERG_CATALOGUE_REFERENCE.csv ← Niveau 3 (disk only, ~170 lignes)
  ├── RS_SITEMAP_COMPLET.tsv       ← Archive scraping
  ├── RS_REFS_CLAVIERS.tsv         ← Archive scraping
  ├── RS_REFS_TIMBALES.tsv         ← Archive scraping
  ├── RS_REFS_METAUX_BOIS_PEAUX.tsv ← Archive scraping
  ├── RS_CATALOGUE_REFERENCE.csv   ← Ancien fichier (conservé)
  ├── TESSITURE_PERCUSSION.md      ← Base tessitures (Kolberg source primaire)
  └── EXTRACTION_IA_REFERENCE.md   ← Doc maître extraction IA
```
