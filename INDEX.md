# INDEX.md — Catalogue wiki OrkMap

> Lis ceci EN PREMIER. Ouvre les fichiers SEULEMENT pour les sections liées a ta tâche.
> Mis à jour : 17/06/2026

## CLAUDE.md — instructions dev

- App de gestion concerts/répertoire pour régisseurs d'orchestre
- Stack : React 18 (Vite 6), IndexedDB via idb, Supabase OrkMap séparé pour synchro compte, pdfjs-dist v4, JSZip, **xAI Grok vision** (reconnaissance documents, ex-Gemini), Audiveris sidecar pour OMR
- Deploy : Vercel, domaine `https://orkmap.eiffelai.io`, repo github.com/Motokiyo/Orchestral_tec
- Règles : mobile-first (375px), pas de nouveau fichier .jsx sans accord, IndexedDB pour tout
- Toujours `git pull` avant modification (travail multi-machine)

## Fichiers wiki

- `INDEX.md` — ce fichier, catalogue
- `STATE.md` — snapshot projet (P0, déploiement, problèmes)
- `DECISIONS.md` — décisions validées/abandonnées
- `memory/project_timeline.md` — historique chronologique des actions

## Source — src/

- `App.jsx` — composant principal, écrans, state, navigation
- `useStorage.js` — hooks useConcerts() + usePhotos() + useOmrScores(), IndexedDB cache + synchro `/api/sync`; fusion non destructive local+serveur.
- `pdfParser.js` — import PDF multi-format + décodeur Daniels + extractWithGemini + parseDcm (Radio France) + parseFreeForm
- `data.js` — constantes (BARNIER, CATEGORIES, demo data)
- `utils.js` — génération TXT, watermark photo, clipboard
- `styles.js` — tokens design
- `main.jsx` — point d'entrée React

## Config racine

- `index.html` — page HTML Vite
- `package.json` — dépendances (react, idb, pdfjs-dist, jszip)
- `.env.local` — clé API Gemini (gitignored)
- `vite.config.js` — config Vite
- `supabase/migrations/001_orkmap_user_data.sql` — table de synchro compte OrkMap (`concerts`, `photos`, `omr-scores`)
- `supabase/migrations/002_orkmap_recovery_dumps.sql` — dumps de récupération séparés, sans modifier les données actives
- `supabase/migrations/003_orkmap_sync_history.sql` — historique obligatoire des sauvegardes Supabase OrkMap

## API serverless — api/

- `extract-ai.js` — reconnaissance documents via **xAI Grok** (clé `XAI_API_KEY`), envoie la légende `nomenclature-legend.js` (image 1) + toutes les pages ; renvoie effectif/orchestre(noms)/percus/sansChef
- `nomenclature-legend.js` — légende visuelle des symboles d'Alexandre (base64), embarquée et envoyée à l'IA
- Auth familiale par code email : `request-code`, `verify-code`, session cookie signée
- Envoi email production via Gmail OAuth ; pas de `AUTH_FALLBACK_CODE`
- `sync.js` — API de synchro protégée par session, reliée au Supabase OrkMap séparé (`yxkktarojpnktsfrvjhb`)
- `recovery-dump.js` — API de dump de récupération, table séparée `orkmap_recovery_dumps`

## Documentation

- `BENCHMARK_IA_ENGINES.md` — comparatif moteurs IA pour [[4 Ressources/Outils-IA|extraction PDF]]
- `PROMPT_MISE_A_JOUR_V1.md` — prompt de mise à jour
- `README.md` — présentation projet
- `OrkMap_Roadmap_BusinessModel.docx` — roadmap + modèle économique

## Anti-patterns documentés

- Ne pas stocker en useState éphémère → IndexedDB
- Ne pas hardcoder clés API → .env.local
- Ne jamais remplacer des données serveur par un payload local plus petit : fusion + historique + refus `409`.
- Ne jamais retirer médias/plans des concerts envoyés au serveur sans alternative explicite.
- Avant toute migration/synchro : export JSON complet + snapshot serveur + vérification sur deux appareils.
- Décodeur Daniels : gérer tirets, slashs, format mixte, points traînants
- Plans PDF AutoCAD : texte fragmenté, mal ordonné, parfois tourné 90°

## Reliés
- [[2 Casquettes/Régisseur/_context]] — OrkMap naît directement du métier de régisseur d'orchestre d'Alexandre : gestion concerts, répertoire, plans de scène, décodeur Daniels
- [[2 Casquettes/Entrepreneur/_context]] — app outillée d'une roadmap et d'un modèle économique, dans la continuité de l'activité produit d'Alexandre
