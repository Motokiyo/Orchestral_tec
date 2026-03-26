# OrkMap — Contexte projet

## Le probleme

Les garcons d'orchestre (stage crew / regisseurs de plateau) gerent les installations d'instruments sur scene pour chaque concert. Aujourd'hui ils :
- Photographient les installations pour documenter le placement
- Notent les listes de materiel sur papier ou dans des notes de telephone
- Recoivent des plans PDF AutoCAD differents selon chaque orchestre
- Perdent ces infos d'un concert a l'autre
- N'ont aucun moyen de partager entre equipes ou de reutiliser un setup deja fait

Chaque piece du programme a sa couleur de barnier (ruban adhesif colore au sol). Mais les photos seules pretent a confusion — angles trompeurs, elements difficiles a identifier, pas de vue d'ensemble fiable.

## La solution : OrkMap

Une PWA mobile-first qui centralise tout le workflow du plateau :
- **Import PDF** des plans d'orchestre (AutoCAD, tous formats)
- **Decodage automatique** de la nomenclature Daniels (effectif orchestral)
- **Gestion des poles** : Timbalier, Percu 1-N, avec liste d'instruments par categorie
- **Orchestre editable** : bois, cuivres, cordes, autres — avec effectif detaille
- **Checkbox d'installation** : cocher ce qui est installe, le reste remonte en haut
- **Plans multiples** (PDF + photos) par piece
- **Export TXT** complet ou par pole
- **Couleurs barnier** reelles (11 couleurs standard Advance AT7)

## Clients cibles

### Premiers utilisateurs (beta)
- **Ensemble Intercontemporain (EIC)** — musique contemporaine, Paris
- **Radio France** (Orchestre Philharmonique, Orchestre National) — classique + contemporain
- **Orchestre de Paris** — Philharmonie
- **CNSM de Paris** — Conservatoire, formations orchestrales

### Marche potentiel
- Tous les orchestres professionnels en France (~30 orchestres permanents)
- Orchestres europeens (Berlin, Vienne, Londres, Amsterdam...)
- Maisons d'opera
- Festivals (Aix, Salzburg, Lucerne, Donaueschingen...)
- Ensembles specialises (musique contemporaine, baroque)
- Societes de production evenementielle (concerts pop/rock avec orchestre)

## Architecture actuelle (v0.4)

```
Frontend:    React 18 + Vite 6 (SPA, PWA)
Stockage:    En memoire React (pas de persistance — Phase 1)
PDF:         pdfjs-dist v4 (client-side)
Deploy:      Vercel (auto-deploy GitHub)
Repo:        github.com/Motokiyo/Orchestral_tec
```

### Modele de donnees
```
Concert
  └─ Piece (titre, compositeur, duree, effectif Daniels, couleur barnier)
       ├─ Orchestre (bois, cuivres, cordes, autres)
       ├─ Timbalier(s) → items avec checkbox
       ├─ Percu 1-N → items avec checkbox
       ├─ Plans (images PDF rendues + photos)
       └─ Notes
```

## Vision serveur (v2)

### Base communautaire OrkMap
Un serveur central qui :
1. **Archive tous les concerts** de chaque orchestre (plans, photos, listes, notes)
2. **Partage les pieces** entre orchestres : quand l'EIC entre "ETYMO" de Francesconi avec toute l'installation, un autre orchestre qui programme la meme piece peut y acceder
3. **Sync temps reel** entre membres de l'equipe sur le meme concert
4. **Historique** : retrouver comment on avait installe une piece il y a 3 ans

### Modele economique

**Gratuit** :
- App OrkMap en mode local (sans serveur)
- Stockage local sur l'appareil
- Import/export .orkmap (fichier JSON)

**Abonnement Production** (~XX€/mois par orchestre) :
- Archivage cloud illimite
- Acces a la base communautaire des pieces
- Sync equipe temps reel
- Historique complet des concerts
- Export PDF/rapports
- Support prioritaire

**Abonnement API** (pour editeurs, salles, festivals) :
- API REST pour integrer les donnees OrkMap dans d'autres systemes
- Webhooks pour notifications de changement
- Bulk export

### Base de donnees des oeuvres

Le vrai avantage concurrentiel : une **base communautaire d'instrumentations** construite par les utilisateurs.

**Sources de donnees** :
1. **Saisie utilisateur** : chaque orchestre qui entre une piece enrichit la base
2. **Import PDF** : extraction automatique depuis les plans de plateau
3. **API Daniels (DOMO)** : pour le repertoire classique (payant, negocier un partenariat)
4. **IMSLP** : parsing des pages wiki pour le repertoire public domain
5. **IA Vision** : Gemini Flash gratuit pour extraire les donnees des PDF complexes

**Avantage musique contemporaine** : Daniels ne couvre pas bien les oeuvres recentes. Les premiers utilisateurs (EIC, Radio France) jouent principalement de la musique contemporaine. OrkMap deviendrait LA reference pour les instrumentations contemporaines — une niche que personne ne couvre.

### Stack serveur envisage
```
Backend:     Supabase (PostgreSQL + Auth + Storage + Realtime)
Auth:        Code de production + comptes utilisateurs
Storage:     Supabase Storage (photos, plans PDF)
CDN:         Vercel Edge
Mobile:      PWA (meme app, + sync)
```

## Roadmap

### Phase 1 : Persistance (PRIORITE)
- IndexedDB via `idb` pour stockage local
- Photos en Blob (pas base64)
- Auto-save debounce

### Phase 2 : Archive + Export
- Flag `archived` sur les concerts
- Export/import .orkmap (JSON + photos)

### Phase 3 : PDF par IA
- Gemini 2.5 Flash (gratuit 1000 pages/jour)
- Envoyer l'image du PDF → JSON structure
- Fonctionne pour TOUS les formats de plans

### Phase 4 : Bibliotheque locale
- Autocomplete depuis les pieces deja saisies
- "Importer depuis un ancien concert"

### Phase 5 : PWA offline durci
- Service worker avec precaching (vite-plugin-pwa)
- 100% offline apres premier chargement

### Phase 6 : Serveur OrkMap
- Supabase
- Auth, sync, base communautaire
- Abonnements

## APIs et ressources

| Ressource | Usage | Cout |
|-----------|-------|------|
| Gemini 2.5 Flash | Extraction PDF par IA | Gratuit (1000/jour) |
| OpenRouter Qwen VL | Fallback extraction PDF | Gratuit |
| OpenOpus | Autocomplete compositeurs classiques | Gratuit |
| IMSLP | Instrumentation repertoire classique | Gratuit |
| Daniels DOMO | Instrumentation reference | Payant (partenariat a negocier) |
| Supabase | Backend v2 | Gratuit jusqu'a 500MB, puis ~25$/mois |

## Ce qui est fait (26 mars 2026)

- [x] Hierarchie Concert > Pieces > Poles
- [x] **Persistance IndexedDB** (donnees survivent au rechargement)
- [x] Import PDF multi-format (EIC, Radio France, Lamoureux, generique)
- [x] Decodeur effectif Daniels complet
- [x] Timbaliers auto avec 4 timbales par defaut
- [x] Orchestre editable (4 sections)
- [x] Plans multiples (PDF + images)
- [x] **Pinch-to-zoom + pan** sur plans et photos (x0.5 a x8, double-tap)
- [x] 11 couleurs barnier reelles (Advance AT7)
- [x] Champs editables (auto-remplis + correction manuelle)
- [x] Reorder poles et pieces (DragHandle)
- [x] TXT complet concert ou par piece/percu
- [x] Notes libres (concert + piece)
- [x] **Checkbox installation** avec tri auto (non-coches en haut)
- [x] Compteur N/M installes par pole
- [x] Logo OrkMap + branding
- [x] PWA installable
- [x] Deploy Vercel continu
