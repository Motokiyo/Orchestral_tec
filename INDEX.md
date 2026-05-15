# INDEX.md — Catalogue wiki OrkMap

> Lis ceci EN PREMIER. Ouvre les fichiers SEULEMENT pour les sections liees a ta tache.
> Mis a jour : 08/04/2026

## CLAUDE.md — instructions dev

- App de gestion concerts/repertoire pour regisseurs d'orchestre
- Stack : React 18 (Vite 6), IndexedDB via idb, pdfjs-dist v4, JSZip, Gemini 2.5 Flash Vision
- Deploy : Vercel (auto-deploy GitHub), repo github.com/Motokiyo/Applications/Galaad/Orchestral-tec
- Regles : mobile-first (375px), pas de nouveau fichier .jsx sans accord, IndexedDB pour tout
- Toujours `git pull` avant modification (travail multi-machine)

## Source — src/

- `App.jsx` — composant principal, ecrans, state, navigation
- `useStorage.js` — hooks useConcerts() + usePhotos(), IndexedDB
- `pdfParser.js` — import PDF multi-format + decodeur Daniels + extractWithGemini
- `data.js` — constantes (BARNIER, CATEGORIES, demo data)
- `utils.js` — generation TXT, watermark photo, clipboard
- `styles.js` — tokens design
- `main.jsx` — point d'entree React

## Config racine

- `index.html` — page HTML Vite
- `package.json` — dependances (react, idb, pdfjs-dist, jszip)
- `.env.local` — cle API Gemini (gitignored)

## API serverless — api/

- Fonctions Vercel pour proxy API

## Documentation

- `BENCHMARK_IA_ENGINES.md` — comparatif moteurs IA pour extraction PDF
- `PROMPT_MISE_A_JOUR_V1.md` — prompt de mise a jour
- `README.md` — presentation projet
- `OrkMap_Roadmap_BusinessModel.docx` — roadmap + modele economique

## Anti-patterns documentes

- Ne pas stocker en useState ephemere -> IndexedDB
- Ne pas hardcoder cles API -> .env.local
- Decodeur Daniels : gerer tirets, slashs, format mixte, points trainants
- Plans PDF AutoCAD : texte fragmente, mal ordonne, parfois tourne 90°
