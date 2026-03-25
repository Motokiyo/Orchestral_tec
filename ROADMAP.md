# PlateauMap — Roadmap

## Etat actuel (v0.3)

### Ce qui marche
- Hierarchie Concert > Pieces > Poles (Timbalier, Percu 1-N) > Instruments
- Import PDF multi-format (EIC, Radio France, Lamoureux, generique)
- Decodeur effectif Daniels (bois/cuivres/perc/cordes, doublings, brackets)
- Creation auto Timbalier(s) + Percu(s) depuis effectif
- Orchestre editable (bois/cuivres/cordes/autres)
- Plans multiples (PDF + images JPG/PNG)
- Couleur barnier manuelle
- Reorder poles et pieces (DragHandle)
- TXT complet concert ou par piece
- Notes libres (concert + piece)
- PWA installable

### Ce qui ne marche PAS encore
- Aucune persistance (tout perdu au rechargement)
- Pas d'archive
- Pas d'export/import
- PDF parsing fragile (text spatially scattered, pas d'IA)
- Pas de recherche/autocomplete oeuvres
- Pas de mode offline durci

---

## Phase 1 : Persistance (CRITIQUE)

**Objectif** : Ne plus perdre les donnees au rechargement.

**Tech** : IndexedDB via lib `idb` (2KB gzip)

**Architecture** :
```
IndexedDB "plateaumap-db"
  |-- concerts   (keyPath: id) — tout sauf photos
  |-- photos     (keyPath: id) — Blobs (pas base64)
```

**Taches** :
- [ ] Installer `idb`
- [ ] Creer `src/hooks/useStorage.js` (load au demarrage, auto-save debounce 300ms)
- [ ] Creer `src/hooks/usePhotoDB.js` (photos en Blob, lazy-load avec objectURL)
- [ ] Migrer App.jsx : `useState` → `useStorage`
- [ ] Supprimer DEMO_PIECES/DEMO_CONCERT (premier lancement = vide)

---

## Phase 2 : Archive + Export

### 2a. Archive concerts
- Flag `archived` + `archivedAt` sur chaque concert
- Ecran "Archives (N)" accessible depuis la liste concerts
- Actions : Archiver / Restaurer / Supprimer definitivement

### 2b. Export/Import .plateaumap
- Export JSON avec photos en base64
- Import avec gestion conflits (Remplacer / Garder les deux)
- Progress indicator pour gros fichiers

---

## Phase 3 : PDF Extraction par IA

**Probleme** : pdf.js extrait le texte mais pas dans le bon ordre spatial. Les plans AutoCAD ont du texte scattered + dessins vectoriels. Le parsing regex est fragile.

**Solution envisagee** : Envoyer l'image rendue du PDF a un LLM vision (Gemini Flash gratuit, ou Qwen-VL via OpenRouter) avec un prompt structure :

```
"Extrais de ce plan d'orchestre : titre, compositeur, duree, chef,
lieu, date, effectif (notation Daniels), et pour chaque percussionniste
la liste des instruments. Reponds en JSON."
```

**Avantages** :
- Marche pour TOUS les formats de PDF
- Comprend les dessins (peut compter les timbales sur le plan)
- Pas de regex a maintenir

**Options API** (recherche en cours) :
- Google Gemini Flash (gratuit, 15 req/min)
- Qwen-VL via OpenRouter
- Groq (si vision dispo)
- DeepSeek-VL

---

## Phase 4 : Bibliotheque locale

**Objectif** : Reutiliser les pieces deja saisies.

- Chaque piece sauvegardee est indexee par compositeur+titre dans IndexedDB
- "Importer depuis un ancien concert" : autocomplete fuzzy
- Recupere tout l'effectif + percussions d'une saisie precedente

---

## Phase 5 : PWA Offline

- `vite-plugin-pwa` avec Workbox
- Precache tous les assets
- Fonctionne 100% sans reseau (plateau, sous-sol, backstage)

---

## Phase 6 : Serveur PlateauMap (v2)

- API Supabase ou equivalent
- Comptes utilisateurs (auth par code production)
- Sync temps reel entre membres de l'equipe
- Base communautaire opt-in
- Archivage automatique

---

## APIs disponibles (reference)

| API | Gratuit | Musique contemporaine | Effectif | Usage |
|-----|---------|----------------------|----------|-------|
| OpenOpus | Oui | Non | Non | Autocomplete classique seulement |
| IMSLP | Oui | Non (copyright) | Oui (wikitext) | Fallback repertoire classique |
| Wikidata | Oui | Partiel | Tres sparse | Non viable |
| Daniels DOMO | Payant | Oui | Oui (reference) | Inaccessible sans abo |

**Conclusion** : Pas d'API gratuite pour la musique contemporaine. La bibliotheque locale + PDF import sont les meilleures sources.
