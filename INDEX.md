# INDEX.md — Catalogue wiki OrkMap

> Lis ceci EN PREMIER. Ouvre les fichiers SEULEMENT pour les sections liées a ta tâche.
> Mis à jour : 17/11/2026

## AGENTS.md — instructions dev

- App de gestion concerts/répertoire pour régisseurs d'orchestre
- Stack : React 18 (Vite 6), IndexedDB via idb, Supabase OrkMap séparé pour synchro compte, pdfjs-dist v4, JSZip, **DeepSeek deepseek-flash** (V4.1 Flash, recopie du cartouche ; décodage local), Audiveris sidecar pour OMR
- Deploy : Vercel, domaine `https://orkmap.eiffelai.io`, repo github.com/Motokiyo/Orchestral_tec
- Règles : mobile-first, téléphone d'Alexandre = Android (Fairphone, Brave) ; nouveaux fichiers .js/.jsx autorisés depuis le 17/11/2026 ; IndexedDB pour tout
- Déploiement par `vercel deploy --prod` depuis le worktree, JAMAIS par push sur `main` (voir STATE.md « Reprise »)

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
- `utils.js` — génération TXT, clipboard ; ré-exporte `calculateMobilier`
- `mobilier.js` — calcul du mobilier (règles du régisseur), `reglagesParDefaut`, `comparerMobilier`
- `mobilierUi.js`, `MobilierBlocs.jsx` — réglages et affichage du mobilier
- `aiImport.js` — fusion lecture locale / IA, priorité de l'effectif
- `planImages.js` — envoi des images de plans une par une (références `orkimg:<sha256>`)
- `localImages.js`, `PlanImage.jsx` — magasin local `images` et affichage d'un plan à la demande
- `syncUi.js` — textes du bandeau et `noteStockage`
- `archive.js`, `archiveBuilder.js`, `archiveImages.js`, `pdfWriter.js`, `ArchiveUi.jsx` — dossier pour la salle (zip, fiches PDF/TXT, signets)
- `photoExport.js` — filigrane, zips de photos, enregistrer/partager
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
- `supabase/migrations/004` à `007` — défis de connexion, RLS historique/dumps, demande de code atomique, images de plans (toutes appliquées le 17/11/2026)
- `.vercelignore` — ce qui ne part jamais en ligne
- `tests/` — `node --test tests/*.mjs` (403 tests au 17/11/2026, sans dépendance)

## API serverless — api/

- `extract-ai.js` — reconnaissance documents via **DeepSeek** `deepseek-flash` (clé `DEEPSEEK_API_KEY`), envoie la légende `nomenclature-legend.js` (image 1) + toutes les pages ; renvoie effectif/orchestre(noms)/percus/sansChef
- `nomenclature-legend.js` — légende visuelle des symboles d'Alexandre (base64), embarquée et envoyée à l'IA
- Auth familiale par code email : `request-code`, `verify-code`, session cookie signée
- Envoi email production via Gmail OAuth ; pas de `AUTH_FALLBACK_CODE`
- `plan-image.js` — envoi, demande « lesquelles as-tu ? » et téléchargement des images de plans
- `sync.js` — API de synchro protégée par session, reliée au Supabase OrkMap séparé (`yxkktarojpnktsfrvjhb`)
- `recovery-dump.js` — API de dump de récupération, table séparée `orkmap_recovery_dumps`

## Documentation

- `docs/audit/` — audits du 17/11/2026 et `lot4-regles-mobilier.md` (règles du régisseur)
- `BENCHMARK_IA_ENGINES.md` — comparatif moteurs IA pour [[4 Ressources/Outils-IA|extraction PDF]]
- `PROMPT_MISE_A_JOUR_V1.md` — prompt de mise à jour
- `README.md` — présentation projet
- `OrkMap_Roadmap_BusinessModel.docx` — roadmap + modèle économique

## Anti-patterns documentés

- Ne pas stocker en useState éphémère → IndexedDB
- Ne pas hardcoder clés API → .env.local
- Ne jamais remplacer des données serveur par un payload local plus petit : fusion + historique + refus `409`.
- Images de plans : jamais dans le JSON envoyé (référence + envoi à part) ; une référence ne remplace jamais une image locale.
- Avant toute migration/synchro : export JSON complet + snapshot serveur + vérification sur deux appareils.
- Décodeur Daniels : gérer tirets, slashs, format mixte, points traînants
- Plans PDF AutoCAD : texte fragmenté, mal ordonné, parfois tourné 90°

## Reliés
- [[2 Casquettes/Régisseur/_context]] — OrkMap naît directement du métier de régisseur d'orchestre d'Alexandre : gestion concerts, répertoire, plans de scène, décodeur Daniels
- [[2 Casquettes/Entrepreneur/_context]] — app outillée d'une roadmap et d'un modèle économique, dans la continuité de l'activité produit d'Alexandre
