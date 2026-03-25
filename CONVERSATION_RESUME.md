# PlateauMap — Résumé de la conversation de conception

## Date : 26 mars 2026

## Qui

- **Alexandre** — garçon d'orchestre / régisseur technique, travaille avec l'EIC (Ensemble Intercontemporain) et Radio France
- **Claude** — conception de l'architecture, du prototype, et de la documentation technique

## Objectif

Créer une app mobile-first pour gérer les installations de percussions sur un plateau de concert. L'app doit être présentée en démo à l'EIC et Radio France.

---

## Décisions prises au fil de la conversation

### 1. Le besoin fondamental
Les garçons d'orchestre photographient les installations de percussions au plateau. Chaque pièce du programme a sa couleur de **barnier** (gaffer coloré). Les photos seules prêtent à confusion : angles trompeurs, éléments mal identifiés. Il faut un outil fiable pour organiser photos, listes de matos, et plans de dessus.

### 2. Priorités (classées par l'utilisateur)
1. **Plan SVG de dessus** — importé depuis PDF AutoCAD, avec annotations
2. **Liste inventaire du matos** — par percussionniste (pôle), par pièce, par catégorie
3. **Photos classées par pièce/couleur** — avec filigrane automatique
4. **Partage entre l'équipe** — chacun sa session, export possible

### 3. Plateforme
- **Téléphone** (photo directe) — mobile-first
- **App web React** (Vite) ouverte dans le navigateur du téléphone
- Déploiement sur **Vercel** pour avoir HTTPS (nécessaire pour la caméra)

### 4. Plan SVG
- Les PDF AutoCAD sont **un plan par pièce** avec le placement percu
- On veut **extraire les formes en vrai SVG éditable** (pas juste une image de fond)
- Conversion **côté client** dans le navigateur (pdf.js)
- **Double couche** : plan SVG statique + couche d'annotations draggables par-dessus

### 5. Structure des données
- **Production** → plusieurs **Pièces** → chaque pièce a plusieurs **Pôles** (percussionnistes)
- **Pôle = un percussionniste** (Percu 1, Percu 2, Percu 3...)
- Le nombre de percussionnistes **varie** (souvent 3-5)
- Le **setup change d'une pièce à l'autre** pour un même percu
- Les **photos sont liées aux pièces** mais **accessibles depuis partout** (galerie globale)
- La **liste TXT** est **par pièce par percu** (pas globale)

### 6. Catégories de matériel (6)
- Timbales & Peaux
- Claviers (xylo, marimba, vibra, glocken, célesta...)
- Accessoires (triangle, wood-block, claves...)
- Grosses pièces (gong, tam-tam, grosse caisse...)
- Stands & supports (pieds de cymbale, racks, tables...)
- Baguettes & spécial (mailloches, archets, objets contemporains, électronique, ampli)

### 7. Alimentation des données — 3 modes
1. **Saisie manuelle** (gratuit, toujours dispo) — l'utilisateur tape tout
2. **API Daniels'** (optionnel, 70$/an) — recherche par œuvre/compositeur, pré-remplissage de l'effectif et du matos percu. API confirmée existante avec API ID + Token.
3. **Serveur PlateauMap** (v2) — base communautaire construite par les utilisateurs, données privées par défaut + partage opt-in

### 8. Protocole photo
- Les zones varient selon la taille du pôle (pas toujours 3)
- L'utilisateur choisit combien de photos mais il y a un **protocole** : toujours de **Jardin → Cour**
- Avant chaque prise de photo, l'app annonce la zone
- Le **filigrane** s'inscrit automatiquement : titre, n° percu, zone, couleur barnier, numéro de photo
- Ce protocole constant permet à l'IA (v2+) de savoir d'où chaque photo est prise

### 9. Bug photo critique
- `navigator.mediaDevices.getUserMedia()` ne marche pas bien sur mobile
- **Solution** : `<input type="file" accept="image/*" capture="environment">` qui ouvre la caméra native du téléphone
- Le `<input>` et le `<canvas>` doivent être **toujours dans le DOM** (pas conditionnels)

### 10. Serveur communautaire (v2)
- **Espace privé** par défaut (seule l'équipe y a accès)
- **Base partagée opt-in** (l'utilisateur choisit de partager)
- Données anonymisées, photos sélectionnées manuellement
- Architecture : Supabase (PostgreSQL + Auth + Storage + Realtime)

### 11. IA Vision (v2+)
- Analyser les photos pour détecter le matos automatiquement
- Comparer avec l'inventaire attendu → signaler les écarts
- **Si la photo diffère du plan, le plan se met à jour** (le terrain prime)
- Faisabilité haute pour timbales/claviers/grosses pièces, basse pour accessoires/baguettes
- Validation humaine obligatoire

---

## Documents produits

### 1. PlateauMap-Architecture-v1.1.docx
Document Word complet de spécification technique, 14 sections :
1. Vision et contexte
2. Stack technique
3. Modèle de données (avec toutes les entités)
4. Alimentation des données (3 modes)
5. Conversion PDF → SVG
6. Plan SVG interactif
7. Navigation et écrans
8. Exports et listes TXT
9. Palette couleurs barnier
10. Serveur PlateauMap (v2)
11. IA Vision (v2+)
12. Stockage et persistance
13. Risques techniques
14. Roadmap (v1/v2/v3)

### 2. CLAUDE.md
Spécification technique complète pour Claude Code — 776 lignes, contient :
- Interfaces TypeScript
- Structure de fichiers
- Code de référence (watermark, parsing PDF, génération TXT)
- Exemples de texte extrait des PDF EIC réels
- Données de test pré-remplies
- Instructions phase par phase
- Contraintes techniques
- Checklist de vérification

### 3. CLAUDE_CODE_PROMPT.md
Instructions ciblées pour Claude Code, focus sur :
- Bug critique photo (remplacer getUserMedia par input file natif)
- Code de référence pour la capture photo
- Améliorations TXT éditable
- Contraintes (pas de localStorage, pas de roundRect, clipboard en try/catch)

### 4. README.md
README GitHub avec démo, fonctionnalités, stack, structure, roadmap.

### 5. Code source (prototype)
Projet Vite/React complet pushé sur https://github.com/Motokiyo/Orchestral_tec :
- `src/App.jsx` — composant principal avec toutes les vues
- `src/data.js` — couleurs barnier, catégories, 4 pièces Francesconi pré-remplies
- `src/utils.js` — génération TXT, watermark, clipboard, téléchargement
- `src/styles.js` — tokens design centralisés
- `index.html` — PWA-ready avec DM Sans

---

## Données de test

4 pièces réelles du programme Francesconi (EIC, 26 mars 2026, dir. Pascal Rophé) extraites des PDF AutoCAD fournis :

| Pièce | Couleur | Percus | Durée |
|-------|---------|--------|-------|
| ETYMO | Rouge | 2 (P1: vibra, xylo, glock, marimba, tam-tam. P2: marimba, xylo, glock valise, bongos, tam-tam grave, grelots, roto-toms, cymbale) | ~25' |
| Unexpected End of Formula | Bleu | 2 (P1: vibra, glock, tam-tam. P2: 16 instruments dont timbales, cloches tubes, crotales, bodhran, springdrum, gong opéra, tôle tonnerre) | 18' |
| Daedalus II | Vert | 2 (P1: vibra, glock valise, tam-tam, bassine d'eau. P2 ad lib: glock, bassine d'eau) | 22' |
| Moskow Run | Jaune | 1 (P1: vibra 3 oct, marimba 5 oct) | 11' |

---

## Prochaines étapes

1. **Claude Code** corrige le bug photo (input file natif au lieu de getUserMedia)
2. **Déployer sur Vercel** pour avoir une URL HTTPS fonctionnelle
3. **Tester sur le téléphone** au plateau avec de vraies photos
4. **Démo** à l'EIC et Radio France
5. Itérer selon les retours terrain
