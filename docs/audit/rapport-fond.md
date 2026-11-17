# OrkMap / PlateauMap : audit fonctionnel (le fond)

Dépôt lu : `/Users/alexandre/Territoire/Galaad-Motokiyo-Ferran/1 Projets/Orchestral-tec`, HEAD `e6892c8`. Lecture seule : rien n'a été écrit dans le dépôt, aucun appel réseau, aucun `.env` ouvert.
Tests : `/private/tmp/claude-501/-Users-alexandre/1754c331-e049-4db4-a159-ca47e7505e44/scratchpad/fond-tests/fond-tests.mjs` (résultat dans `fond-tests.out` : 57 constats vérifiés, 0 infirmé).

Légende : **[REPRODUIT]** exécuté sur le vrai code du dépôt (import ou tranche `vm`, `fetch` simulé, secrets factices) ; **[LU]** lu dans le code, non exécuté.

---

## 0. Ce que `e6892c8` a changé

Rien dans le code. Le commit ne touche que `.gitignore` et `AGENTS.md` (renommage CLAUDE.md vers AGENTS.md). Tous les numéros de ligne d'Aristote et de l'audit Claude restent valables. À noter : le dossier de travail contient des modifications non commitées dans des fichiers de doc (`INDEX.md`, `README.md`, `docs/EXTRACTION_IA_REFERENCE.md`, `docs/PLAN_remise-a-plat.md`, `test-infra/CHANGELOG.md`) et un fichier non suivi (`docs/REFERENCE_DB_construction_mars2026.md`). Je n'ai pas regardé ce qu'elles contiennent.

## 1. Les points d'Aristote, confirmés sur le code actuel

| Point | Verdict | Preuve | Précision ou correction |
|---|---|---|---|
| « 4 Timbales » en dur | Confirmé [REPRODUIT] | `src/pdfParser.js:1820` | Ne se déclenche que si aucun pôle percu n'a été trouvé plus haut (`existingPercuCount === 0`, `result.percus.length === 0`, lignes 1795-1815), donc surtout sur les listes texte pauvres. Contredit le prompt serveur (« Chaque timbale = 1 item séparé », `api/extract-ai.js:80`). |
| `enrichWithAi` remplace une réponse IA vide par la liste locale | Confirmé [REPRODUIT] | `src/App.jsx:2007-2008` | Idem pour `orchestre` (ligne 2007). Un échec complet de l'IA est avalé par `console.warn` (`:2010-2012`) : même effet, aucun message. |
| `calculateMobilier` déduit les chaises de l'effectif | Confirmé [REPRODUIT] | `src/utils.js:94-161` | Voir §3 : aucune chaise n'est lue, et le calcul s'écarte de `docs/LOOKUP_MOBILIER.json`. |
| Quantité inconnue devient 1 | Confirmé [REPRODUIT] | `src/utils.js:46-50` | « Flûte », « 4Flûtes » (sans espace) et « Violons I : 16 » donnent tous 1. |
| Pages au-delà de 8 perdues | Confirmé [REPRODUIT] | `api/extract-ai.js:41` | Sur 12 pages : 8 envoyées + la légende, aucun champ `meta` renvoyé. Autre perte côté client : `handleAddPlan` d'un PDF ne garde que la page 1 (`App.jsx:1923-1925`) [REPRODUIT par motif sur le source]. |
| Mobilier perdu dans l'adaptateur | Confirmé [REPRODUIT] | `api/extract-ai.js:178-195` | Le schéma de sortie n'a aucun champ mobilier, ni quantité, position, confiance ou source (item = `{cat, nom}`). `STATE.md` affirme « mobilier explicite lu sur fiche » : c'est faux dans le code actuel. |
| Base R&S/Kolberg jamais branchée | Confirmé [REPRODUIT] | grep sur `src/`, `api/`, `vite.config.js` | Aucune occurrence de `LOOKUP_`, `RS_CATALOGUE`, `KOLBERG_CAT`, `RS_KOLBERG`. Le plan `PLAN_remise-a-plat.md` (étape 2.4) prévoyait d'injecter les LOOKUP dans le prompt : non fait. |

Deux corrections à l'audit Claude :

1. « JSON tronqué réparé et renvoyé en 200 » n'est vrai que pour une coupure en queue d'objet (E4b : `compositeur: "Mah"` passe en 200, sans drapeau). Dans le cas le plus courant, un tableau imbriqué coupé, la réparation ferme tous les `]` puis tous les `}` dans le mauvais ordre : l'appel finit en 500 « Réponse IA invalide » (E4a, `api/extract-ai.js:158-173`). Les deux sont mauvais, mais pas de la même façon.
2. Le « double comptage métier non prouvé » d'Aristote est maintenant prouvé (A4, §3).

---

## 2. Inventaire des fonctionnalités

| Fonction | État | Détail et preuve |
|---|---|---|
| Concerts : créer, trier, rechercher, archiver, supprimer | Marche, rustique | Création par 4 `prompt()` successifs (`App.jsx:2709-2721`). Tri par date avec parseur FR (`:36-49`). La recherche ne porte que sur titre, orchestre, lieu, chef, date (`:2691`) : pas de recherche par pièce, compositeur ou instrument, alors que `EXTRACTION_IA_REFERENCE.md:337` la promet. Supprimer un concert ne supprime pas ses photos (F3). |
| Pièces : créer, importer, déplacer, colorier (Barnier) | Marche | Import PDF/image/TXT (`App.jsx:1860-1900`). Une pièce créée à la main a `orchestre: null`, donc pas de section mobilier. |
| Import de plan par IA (DeepSeek) | Marche, peu fiable | Voir §1 et §4. Échec silencieux, 8 pages, valeurs par défaut inventées. |
| Bouton « Extraire par IA » sur pièce existante | Partiel | `handleAiExtract` (`App.jsx:2021-2090`) remplit les champs vides, mais ne recalcule ni effectif ni mobilier, et ne renseigne jamais `sansChef` (D5, D6). Les boutons « Garder » et « Ignorer » du panneau de fusion sont `disabled` en dur (`:2302`, `:2359`) : mort. |
| Plan « SVG » du plateau | N'existe pas | Aucun `<svg>` dans `src/` (0 occurrence). Le « plan » est l'image JPEG du PDF, rendue à l'échelle 2 (`pdfParser.js:205`). Aucune position, coordonnée, échelle ni cote n'est stockée. |
| Inventaire par percussionniste (pôles + instruments) | Marche, pauvre | Pôle = `{id, nom, items}` ; item = `{cat, nom, notes?, checked?}`. Case « installé » (`toggleItemCheck`) OK. Ajout manuel : catégorie toujours « Accessoires » (`App.jsx:3144`), `CATEGORIES` de `data.js` importé mais jamais utilisé. Éditeur de notes absent : `updateItemNotes` (`:1355`) n'est appelée nulle part alors que le TXT affiche `[notes]`. Pas de quantité (elle vit dans le nom : « 4 Timbales »). |
| Nomenclature Daniels (décodage et recalcul) | Marche pour le cas simple, faux pour d'autres | Voir §3 (C3b, C8, C10, B1-B3). |
| Mobilier : calcul, affichage, édition manuelle, « Recalculer » | Partiel | Édition manuelle OK (`_edited`). « Recalculer » (`App.jsx:3700-3708`) efface les chaises spéciales saisies à la main, alors que `recalcDaniels` (`:1483`) les préserve : incohérence. `chaisesSpeciales` est du texte libre. |
| Photos : appareil, zones, filigrane, galerie, lightbox | Marche | Photos stockées en base64 dans le JSON (`dataUrl`). Photo supprimée en local : elle revient du serveur (F2). Photos orphelines après suppression de concert ou de pièce (F3). `buildWatermarkOpts` (`:4790`) : fonction jamais appelée. |
| Exports : TXT pièce, TXT mobilier, copie TXT par pôle, ZIP de photos filigranées | Marche | Pas de PDF, pas de tableur, pas d'export concert complet. Le gabarit Numbers de `docs alex regie/` n'est pas repris. |
| Partitions / OMR (`scripts/omr-sidecar.mjs`) | Mort en production, local seulement | Le client appelle `${protocole}//${hôte}:8766/omr` (`pdfParser.js:1947`) : impossible depuis le site HTTPS déployé. Il faut lancer `npm run omr` et Audiveris sur la machine. Et la fonction produit de la lecture solfégique (notes parlées, lecture audio, `App.jsx:620-750`), pas la vérification de percussions et de tessitures prévue par la « Phase 4 ». Aucun lien avec les pièces ou concerts. |
| Tessitures | Mort | Documentées (`TESSITURE_PERCUSSION.md`), jamais lues par le code (H4). |
| Authentification par code e-mail, session 90 jours | Marche | Failles déjà détaillées dans l'audit Claude (S2, S3), non refaites ici. |
| « Partage familial » | N'est pas un partage | Les données sont cloisonnées par e-mail (`api/sync.js:128`, clé `(email, type)`). La liste d'adresses autorisées donne accès à l'appli, pas aux données de l'autre. Deux régisseurs ne peuvent pas partager un concert. |
| Synchro Supabase + file d'attente hors ligne | Marche | Fusion au niveau du concert entier : voir §4 (F1). |
| Écran de récupération (`?orkmap_recovery=1`) | Marche, sensible | Hors périmètre, voir S2. |

Code mort ou doublons repérés : `getLiveMob` (`App.jsx:3327`), `buildWatermarkOpts` (`:4790`), `updateItemNotes` (`:1355`), état `archiveModal` (`:1204`), import `CATEGORIES` ; champ `effectifDetail` écrit en 4 endroits (`:1886`, `:1937`, `:2006`, `:2872`) et lu nulle part ; `planDataUrl` doublon de `plans[]` ; `percusGlobalText` (texte dérivé stocké, régénéré à la main à chaque mutation) ; quatre champs répétés entre concert et pièce (`chef`, `date`, `salle`/`lieu`, `orchestre`).

---

## 3. Défauts métier classés

### Bloquants (le plateau produit est faux, sans que l'utilisateur le voie)

**M1. Des données inventées ou substituées entrent dans la pièce.** [REPRODUIT]
- `App.jsx:2007-2008` : une abstention de l'IA (`percus: []`) est remplacée par la lecture locale.
- `pdfParser.js:1820` : « 4 Timbales » en dur.
- `api/extract-ai.js:185-191` : pôle sans nom devient « Percu », objet sans catégorie devient « Accessoires », absence de mention du chef devient `sansChef = true`, toute valeur de `chef` vide déclenche le même cas. Aucune de ces valeurs n'est marquée comme déduite.
- `App.jsx:2010-2012` : en cas d'échec de l'IA, on garde le local sans le dire.
- Correction : un tableau vide de l'IA reste vide ; les champs inconnus valent `null` avec un statut `inconnu` ; le serveur renvoie `meta` (pages reçues, analysées, ignorées, réparation, troncature) ; le client affiche un bandeau « lecture IA échouée, données locales à vérifier » et marque la pièce `aiStatus: "failed"`.

**M2. Le mobilier calculé s'écarte des règles écrites et est présenté comme un fait.** [REPRODUIT, A1-A11]
Règles de référence : `docs/LOOKUP_MOBILIER.json` et `EXTRACTION_IA_REFERENCE.md:108-135`. Écarts mesurés sur un orchestre `3.3.3.3 - 4.3.3.1 - 2 harpes + piano - 16.14.12.10.8` avec chef :

| Quantité | Code | Règle | Écart |
|---|---|---|---|
| Pupitres | 35 (`utils.js:135-137`) | 57 (bois et cuivres 1 par musicien, solistes 1 chacun, cordes ceil(n/2)) | -22 |
| Pupitres percus | 1 par pôle (`:137`) | 0 (tablettes à la place) | + n |
| Stands bois/cuivres | qty = nombre de musiciens (`:81`, `:90`) | 1 par famille | surcomptage (3 flûtes : 3 stands au lieu de 1) |
| Chaises hautes | CB + chef + pôles percu (`:146`) | CB et chef au mobilier ; chaises percu et timbalier dans la page PERCU | les chaises percu sont comptées deux fois : 12 au général (8 CB, 1 chef, 3 percu) **et** 3 dans `stands.percus` (A4) |
| Chaise chef | seulement si `hasChef` (`:56`) | 1 toujours (répétition) | 0 au lieu de 1 sans chef |
| Harpistes, pianiste, célesta | 0 siège, 0 pupitre | banquette ou tabouret, pupitre | oubliés (A3) |
| Poste « T » ou « Timbales » | chaise haute standard | chaise timbalier | seul un nom contenant « timbalier » est reconnu (A10) |
| Cordes inconnues (violes, théorbes) | `other = num` : le dernier écrase (`:72`) | addition | « 5 violes + 2 théorbes » = 2 sièges (A6) |
| « Violons 1 », « Violon » seul | classés `other` | V1, V2 | 1 siège pour 11 musiciens dans l'exemple A7 |
| Tablettes percu, râteau, pare-sons, mallette harpe, supports implicites (triangle, cymbale...) | jamais calculés | listés par la référence | fonctionnalité absente (0 occurrence de « tablette », « pied de », « portique » dans le code) |

Le code ne produit **aucun type de chaise** : `chaisesNormales` et `chaisesHautes` sont des nombres. Les types (R&S haute, Kolberg percu, australienne, spécifique Vlc, banquette) n'existent que dans le texte libre de `chaisesSpeciales`, toujours `[]` au calcul (`utils.js:161`, A9).
Correction : réécrire `calculateMobilier` en table de règles lisible (voir §6), retirer les chaises percu du général, étiqueter le résultat « estimation », avec un compteur « non lu sur le plan ».

**M3. Le décodeur Daniels perd les cordes sur plusieurs notations.** [REPRODUIT, C3b, C4b, C8, C10]
`decodeEffectif` (`pdfParser.js:1248`). La première branche (ligne 1258) attrape toute notation contenant à la fois « / » et un tiret entre chiffres, puis coupe le dernier segment au premier tiret (`:1262`).
- `1-1-1-2sax/2-2-2-1/1-0-1-0/6-4-2-2-1` (l'exemple même du commentaire du code) : cordes = `{Violon I: 6}` seulement.
- `0-1-0-1 / 0-2-0-0 / 1-0-0-2` (exemple 1 du prompt serveur) : cordes = `{Alto: 2}`, percussions = `{Timbales: 1}`.
- `3.3.3.3/4.3.3.1 - 14.12.10.8.6` (exemple « mixte » du commentaire) : les cordes sont lues comme timbales, percussions, harpes, claviers (14, 12, 10, 8).
- `2.2.2.2 / 4.2.3.1 / 1.3.2.1 [Cel/Pno] / 16.14.12.10.8` (exemple 2 du prompt) : le « / » à l'intérieur des crochets casse le découpage, cordes = `{}`.
Cette fonction est appelée sur la ligne effectif lue par l'IA (`App.jsx:1995`) puis sur la sortie du parseur local. Le prompt demande de normaliser en points et tirets, ce qui passe bien (C1, C9) ; mais le modèle suit ses propres exemples, qui sont justement les formes cassées. Correction : découper d'abord en protégeant les crochets, puis choisir le séparateur de groupe (« / » ou « - » entouré d'espaces) avant de découper l'intérieur ; refuser (renvoyer `null`) quand le nombre de groupes n'est pas 4 (ou 3 pour un ensemble baroque explicitement déclaré) plutôt que de deviner.

**M4. Des pages de plan sont perdues sans avertissement.** [REPRODUIT]
`handleAddPlan` ne garde que la page 1 d'un PDF (`App.jsx:1923-1925`) ; le serveur coupe à 8 pages (`api/extract-ai.js:41`) et ignore en silence les images de plus de 12 Mo ou d'un format non reconnu (`:45-46`). Correction : ajouter toutes les pages ; refuser explicitement au-delà de la limite avec message ; renvoyer `meta.skipped`.

**M5. Le modèle ne sait pas représenter ce que le métier demande.** [LU]
Pas de type de chaise, pas de position, pas de provenance (voir §5). Tant que ce modèle n'existe pas, aucune amélioration de l'IA ne peut distinguer une chaise Kolberg d'une chaise R&S.

### Gênants

| # | Défaut | Preuve | Correction |
|---|---|---|---|
| G1 | `recalcDaniels` remplace la nomenclature lue sur le plan par une version recalculée, sans doublures ni crochets : `3.3.3.3 - 4.3.3.1 - 1.7.2.1 [Cel/Pno] - 16.14.12.10.8` devient `3.3.3.3 / 4.3.3.1 / 1.7.2.1 / 16.14.12.10.8`. Déclenché à chaque ajout de pôle ou d'instrument. | `App.jsx:1472-1477` [REPRODUIT, B1] | Conserver `effectifLu` (texte source) à côté de `effectifCalcule` ; n'écraser jamais le premier. |
| G2 | Un timbalier déclaré dans `orchestre.autres` est mis à 0 dès qu'il existe un pôle percu sans « timbal » dans son nom. | `App.jsx:1134-1135` [REPRODUIT, B2] | Ne remplacer que si au moins un pôle est reconnu pour cette ligne. |
| G3 | Renommer ou saisir le V1 recalcule V2, alto, violoncelles et CB avec un décalage fixe de -2, en écrasant les valeurs déjà saisies : `8.6.4.3.2` devient `8.6.4.2.1`. | `App.jsx:1455-1470` [REPRODUIT, B3] | Ne compléter que les lignes absentes ; demander confirmation sinon. |
| G4 | « Nombre de musiciens » (TXT et écran) exclut timbalier et percussionnistes : 86 affichés pour 88 réels dans l'exemple. | `App.jsx:1155`, `utils.js:338-346` et `:390-398` [REPRODUIT, A11] | Ajouter le nombre de pôles. |
| G5 | `sansChef` n'a aucun réglage dans l'interface : seul l'import le fixe, jamais `handleAiExtract`. Une pièce créée à la main compte toujours un chef. | `App.jsx:1480`, `:2004` [REPRODUIT, D6, D7] | Interrupteur « avec chef » sur la fiche pièce. |
| G6 | « Recalculer » le mobilier efface les chaises spéciales saisies. | `App.jsx:3700-3708` contre `:1483-1486` [LU] | Même préservation que `recalcDaniels`. |
| G7 | Le mobilier n'est calculé à l'import que si `data.orchestre` existe ; une pièce sans orchestre n'a pas de section mobilier. | `App.jsx:1888`, `:3309` [REPRODUIT, D4] | Section toujours présente, vide au besoin. |
| G8 | Fusion de synchro au niveau du concert : si le local est en retard, une pièce ajoutée sur un autre appareil disparaît de la vue ; mais un champ présent seulement côté serveur (`archived`) survit. | `useStorage.js:74-85` [REPRODUIT, F1] | Fusion par pièce (id) avec horodatage `updatedAt` par pièce ; voir S14 de l'audit Claude. |
| G9 | Photos : suppression non propagée ; photos orphelines à la suppression d'un pôle (`percuId` pendant), d'une pièce ou d'un concert. | `useStorage.js:102-115`, `App.jsx:1551-1562` [REPRODUIT, F2, F3] | Marqueur de suppression ; nettoyage en cascade à la suppression. |
| G10 | Les catégories d'items du prompt (6 : Timbales & Peaux, Claviers, Accessoires, Grosses pièces, Stands & supports, Baguettes & spécial) ne sont pas celles de la référence (Peaux, Claviers, Métaux/Cymbales, Bois/Divers, Effets/Spéciaux). | `extract-ai.js:111` contre `EXTRACTION_IA_REFERENCE.md:156-183` [LU] | Choisir une taxonomie unique, la fixer dans un fichier partagé client/serveur. |
| G11 | « continuo » demandé par le prompt (`extract-ai.js:83`), renvoyé tel quel (E6), jamais affiché ni compté. Clavecin et orgue d'un ensemble baroque ne reçoivent ni banquette ni pupitre. | [REPRODUIT, E6] | Ajouter la section `continuo` au modèle. |
| G12 | Pas de validation de la réponse IA : `percus` non tableau, `null` dans la liste, `items` en chaîne : erreur 500 avec message technique renvoyé au client. | `extract-ai.js:187-195` [REPRODUIT, E5 et dbg] | Valider le schéma, renvoyer 422 lisible. |
| G13 | Le bloc de percussions importé de l'IA porte « Percu » ou le nom que le modèle a choisi : la pièce suppose un poste par musicien, mais l'IA peut renvoyer un pôle par instrument. Rien ne garantit `nombre de pôles = X de W.X.Y.Z`. | `App.jsx:1870-1875` [LU] | Contrôle croisé : afficher un avertissement si le nombre de pôles ≠ percussionnistes de la ligne Daniels. |

### Mineurs

- Création de concert par 4 `prompt()` (annuler une boîte donne `""` sans avertir).
- Dates en texte libre (`parseConcertDate` devine) : stocker aussi `dateISO`.
- Données de démonstration injectées pour une adresse (celle de `VITE_OWNER_EMAIL`), incluses dans le bundle client (`useStorage.js:19`) : adresse visible dans le JS livré.
- Docs périmées : `EXTRACTION_IA_REFERENCE.md` cite Gemini et Kimi, `INDEX.md` cite Grok, `vite.config.js:62` injecte encore `GOOGLE_API_KEY`.
- Incohérences de tessitures entre deux documents, voir ci-dessous.

### Tessitures et référence (H1-H4)

- Glockenspiel à pédale 3 octaves : `EXTRACTION_IA_REFERENCE.md` donne C5-C8, `TESSITURE_PERCUSSION.md` donne F5-E8 (Concert) [REPRODUIT, H1]. À trancher avec le poster Kolberg (non lu ici).
- Timbales 28" et 29" : même plage F2-C3 dans les deux fichiers [REPRODUIT, H2] : probablement une recopie.
- Les 24 lignes à nombre d'octaves annoncé sont cohérentes avec leurs plages (écart < 0,35 oct) [REPRODUIT, H3].
- Non vérifiable hors ligne : savoir si chaque plage est « écrite » ou « sonnante » (xylophone, glockenspiel, célesta sont dits « sonne 1 ou 2 octaves au-dessus »). Il faut deux colonnes explicites.
- Aucune tessiture n'est utilisée par le code (H4) ; l'OMR en place ne les vérifie pas.

---

## 4. Modèle de données actuel

Structure réelle [LU] :
- **Concert** : `{id, titre, date, lieu, orchestre, chef, pieces[], archived?, ownerEmail}`.
- **Pièce** : `{id, titre, compositeur, duree, salle, chef, date, effectif, effectifDetail, orchestre{bois,cuivres,cordes,autres: string[]}, sansChef, mobilier{general{pupitres,chaisesNormales,chaisesHautes,chaisesHautesDetail,chaisesSpeciales[]}, stands{cordes,bois,cuivres,percus,autres,autresCustom}, _edited}, plans[], planDataUrl, couleur, percus[], percusGlobalText}`.
- **Pôle** : `{id, nom, items[]}` ; **item** : `{cat, nom, notes?, checked?}`.
- **Photo** (magasin séparé, clé = id de pièce) : `{id, dataUrl, pieceId, percuId, zone, num, total, couleur}`.
- **Partition OMR** : magasin séparé.

Problèmes de cohérence :
1. **Effectif stocké en chaînes** (`"14 Violons I"`) ; le nombre est réextrait par regex à chaque calcul (`extractNumberFromItem`), d'où « inconnu devient 1 ». Il n'y a pas de valeur typée.
2. **Pas de provenance** : un champ lu par l'IA, calculé, saisi à la main ou déduit est indiscernable. `_edited` est le seul indicateur, et il est global à tout le mobilier.
3. **Champs écrits, jamais lus** : `effectifDetail` ; `planDataUrl` (doublon) ; `percusGlobalText` (dérivé, peut diverger).
4. **Pas de quantité sur l'item** ni de marque, référence, taille, position.
5. **Pas de position** : le métier raisonne en jardin, centre, cour, rangée, côté ; la seule trace est la `zone` d'une photo.
6. **Pas de version de schéma** (F4). La seule migration existante est un test de type ad hoc (`typeof chaisesSpeciales === 'number'`, `utils.js:231`).
7. **Doublons concert/pièce** : chef, date, lieu.
8. **Mobilier = nombres** : impossible d'y brancher des types, des références ni une provenance.

### Proposition : évoluer sans casser les concerts déjà enregistrés

Principe : ajouter, ne jamais retirer ni renommer. Les concerts enregistrés sont des objets entiers copiés tels quels par la synchro (`{...remote, ...local}`, `useStorage.js:82`) ; les champs inconnus survivent aux anciennes versions du client, **sauf** quand une fonction reconstruit un objet complet. Or `recalcDaniels` remplace entièrement `mobilier` (`App.jsx:1480-1490`). D'où la règle : **le nouveau mobilier vit sous une clé neuve** (`mobilierV2`), l'ancien `mobilier` reste en place, lisible par les anciens clients, et sert de repli.

1. `schemaVersion: 2` au niveau du concert, absent = version 1. Une fonction `normalizeConcert()` idempotente à l'ouverture, qui ajoute les champs manquants sans rien retirer. L'`DB_VERSION` d'IndexedDB (4) ne change pas : les magasins sont inchangés, seul le JSON évolue.
2. Avant la première migration : export local automatique d'un fichier JSON (la fonction `exportLocalDataForRecovery` existe déjà, `useStorage.js:402`), puis écriture sur le serveur seulement après acceptation locale.
3. Nouveaux champs, tous optionnels :
   - `piece.provenance` : table `{ champ: {source: "plan|texte|photo|calcule|manuel", page, confiance, valide}}`.
   - `piece.effectifLu` (texte source, jamais recalculé) et `piece.effectifCalcule`.
   - `piece.effectifTyped` : `{bois:{flute:{n, doublures[]},...}, ...}` ; les chaînes actuelles restent la source d'affichage tant que la migration n'est pas terminée.
   - `pole.position` (`jardin|centre|cour`), `pole.musicien?`.
   - `item.qte` (nombre ou `null`), `item.marque`, `item.ref` (id du catalogue), `item.details`, `item.statut` (`propose|valide|inconnu`).
   - `mobilierV2.assises[]` : `{id, role, typeId|null, typeLibre, qte, source, valide, zone?}` avec `role` dans `standard, cb, vlc, percu, timbalier, chef, banquette, harpe, autre`.
   - `mobilierV2.accessoires[]` : tablettes, pupitres, podiums, pare-sons, planches à pic, avec le même gabarit.
   - `mobilierV2.parametresOrchestre` : profil (quel fabricant pour quel rôle) mémorisé par orchestre.
4. Lecture : `getMobilier(piece)` renvoie `mobilierV2` s'il existe, sinon convertit l'ancien à la volée (chaque nombre devient une assise de type `null`, source `calcule`).
5. Un test de non-régression : charger chaque concert du compte de test avant et après `normalizeConcert()` ; vérifier que tous les champs d'origine sont intacts (comparaison profonde sur l'ancien objet).
6. Plans et positions en pixels : seulement avec une source. Une coordonnée en pourcentage de la page est admise (« où est cet objet sur l'image »), jamais une dimension en mètres déduite de pixels. Le prévoir : `objet.surPlan = {page, bbox}`.

---

## 5. Brancher la base R&S / Kolberg pour proposer des candidats, sans inventer

État de la base [REPRODUIT, G1-G5 et contrôles Python] :
- `RS_CATALOGUE_COMPLET.csv` : 2093 lignes dont **527 ont une fausse référence** (`SMAP-…`, source « sitemap-only », nom dérivé de l'URL). À exclure.
- 38 chaises R&S de référence `SIE …` exploitables, avec sous-catégorie (Percussionnistes, Timbalier, Contrebassiste, Chef orchestre, Régisseur, Banquettes, Pliantes, 4 pieds).
- Deux taxonomies parallèles pour les mêmes chaises (`Chaises` et `Chaises-Musiciens`, 15 couples).
- Kolberg : 4 références portent deux produits différents (`134-1`, `136-1`, `1325K`, `2110KS`) : la référence seule n'est pas une clé.
- Les 65 références R&S et toutes les références Kolberg de `RS_KOLBERG_ESSENTIELS.json` existent bien dans les catalogues ; les 4 références R&S de `LOOKUP_MOBILIER.json` aussi. Seule `230 (40×40cm)` est du texte, pas une référence.

Principe : le catalogue **propose, l'humain tranche**. Il ne produit jamais de référence que l'IA aurait écrite.

1. **Fabriquer un petit catalogue embarqué** par un script hors ligne (pas à l'exécution) : environ 150 lignes utiles (assises, pupitres, podiums, tablettes et stands courants), id stable `rs:SIE 5510NTI` ou `kolberg:3110` (fabricant plus référence ; si doublon, ajouter un suffixe de nom), champs `famille`, `roles[]` (`timbalier, percu, cb, vlc, chef, standard, banquette`), `hauteurCm`, `specs`. 30 Ko environ, mis en cache par le service worker.
2. **Saisie assistée** : quand l'utilisateur ajoute ou corrige une assise, la liste est filtrée par rôle (une chaise timbalier propose les `SIE 5510NTI`, `SIE 5520NTI`, Kolberg `3110`, `3110TR`) ; le choix s'enregistre avec `source: "manuel"`.
3. **Prompt fermé, vérifié côté serveur** : on donne au modèle la liste courte (identifiants et noms, environ 1,7 ko pour `RS_KOLBERG_ESSENTIELS.json`) en lui demandant `candidats: [ids]` par objet observé, avec « inconnu » toujours permis. Le serveur supprime tout identifiant absent du catalogue. Une marque lue en toutes lettres sur le plan (« Kolberg ») ou une référence lue (« SIE 5510 ») est rapprochée par exact puis flou ; un seul résultat exact est proposé, plusieurs sont listés, aucun n'est validé.
4. **Profil d'orchestre** : l'inversion R&S/Kolberg selon l'orchestre (`EXTRACTION_IA_REFERENCE.md:122-128`) est une donnée à mémoriser par orchestre, pas une constante : une fois un type validé pour un rôle dans une salle, il devient la proposition par défaut (étiquetée « habituel de cet orchestre »), jamais appliquée en silence.
5. **Séparer ce qui est lu de ce qui est estimé** : affichage en trois couches (lu sur plan ou photo, calculé, validé), le chiffre officiel d'export étant la couche validée.
6. **Nettoyage de la base avant branchement** : exclure `SMAP-`, unifier la taxonomie, ajouter une clé composite pour Kolberg, corriger `LOOKUP_MOBILIER.json` (référence « 230 (40×40cm) »). Compléter par un fichier structuré de tessitures (deux colonnes écrit et sonnant).

---

## 6. Calculs métier : règles à écrire dans une table

Réécrire `calculateMobilier` en trois blocs, chacun lisible par Alexandre :

1. **Comptage des musiciens** : une fonction unique `compterMusiciens(piece)` (orchestre + pôles), utilisée partout (TXT, écran, mobilier).
2. **Règles** en table de données (reprise de `LOOKUP_MOBILIER.json`) : pupitres harmonie 1:1, cordes 1:2 par section, solistes 1:1, percussions 0 ; stands : 1 par famille présente ; chaise chef : 1 ; planches à pic = contrebasses ; mallette harpe ; chaises percu et timbalier rangées dans la page PERCU uniquement.
3. **Types** : le résultat est une liste d'assises avec `typeId: null` tant que personne n'a choisi.
Chaque règle porte un `source: "LOOKUP_MOBILIER.json#regles_pupitres"` pour que l'écart avec le terrain se discute règle par règle. Les règles qui dépendent de l'orchestre (chaises hautes CB ou percu, Vlc spécifiques, Kolberg ou R&S) deviennent des paramètres de profil, avec « inconnu » par défaut.

Point à trancher par Alexandre : « Stands pour flûtes » = un par musicien (code actuel) ou un par famille (`LOOKUP_MOBILIER.json`, `regles_stands_instruments`) ? Je n'ai pas d'élément terrain pour décider.

---

## 7. Ce qu'il faut supprimer pour simplifier

| À supprimer | Pourquoi |
|---|---|
| `pdfParser.js:1815-1820` (« 4 Timbales ») et le repli `App.jsx:2007-2008` | Données inventées (M1). |
| `effectifDetail` (4 écritures, 0 lecture) | Doublon mort. Garder `effectifLu`. |
| `planDataUrl` | Doublon de `plans[]`. |
| `percusGlobalText` stocké | Dérivé : le recalculer à l'affichage et à l'export. |
| Fonctions mortes : `getLiveMob`, `buildWatermarkOpts`, `updateItemNotes` (ou lui donner une interface), état `archiveModal`, import `CATEGORIES` (ou l'utiliser pour la saisie) | Bruit. |
| Boutons « Garder » et « Ignorer » désactivés (`App.jsx:2302`, `:2359`) | Ne font rien. Les brancher ou les retirer. |
| Parseurs locaux de plans (`parseDcm`, `parseEic`, `parseCnsm`, `parseGeneric`, `parsePercuSections*`, `parsePercuReversed`, `buildPercuFromEffectif` no-op : environ 1 300 des 1 968 lignes de `pdfParser.js` : lignes 283-1170, 1412-1910) | La décision du 17/06 fait de l'IA l'autorité pour les plans ; ces parseurs ne servent plus que de repli silencieux (M1). À garder seulement pour les listes texte propres, derrière un indicateur « lecture locale à vérifier ». |
| Tesseract (`tesseract.js`, `pdfParser.js:1439`) | OCR d'images alors que l'IA lit l'image. À confirmer avant retrait. |
| OMR (`scripts/omr-sidecar.mjs`, écran partitions, lecture solfège) | Mort en production, sans lien avec le métier des plateaux. Soit une application séparée, soit une phase 4 réécrite autour des tessitures. |
| Fichiers à la racine : `verify*.cjs`, `verify-fail-*.png`, `test-multiformat.mjs`, `PROMPT_MISE_A_JOUR_V1.md`, `BENCHMARK_IA_ENGINES.md` (prix non vérifiés), `OrkMap_Roadmap_BusinessModel.docx` | Anciens artefacts de test et documents périmés. |
| Fichiers de doc du catalogue en double : `RS_REFS_*.tsv`, `RS_SITEMAP_COMPLET.tsv`, `RS_CATALOGUE_REFERENCE.csv` après fabrication du catalogue embarqué | Ne garder que la source `RS_CATALOGUE_COMPLET.csv` nettoyée et le script. |

---

## 8. Ce qui est reproduit et ce qui est seulement lu

**Reproduit** (script `fond-tests.mjs`, sans réseau) :
- A1-A11 : `calculateMobilier`, `extractNumberFromItem`, `generatePieceText`, importés tels quels depuis `src/utils.js`.
- B1-B3 : `recalcDaniels`, `calculateDanielsNotation`, `applyCordesAutoComplete`, extraits d'`App.jsx` par tranche `vm`.
- C1-C10 : `decodeEffectif`, `orchestreFromEffectif`, extraits de `pdfParser.js`.
- D1-D2 : `enrichWithAi` avec IA simulée ; D3-D8 : contrôles de motifs sur le source (donc présence du code, pas son exécution dans un navigateur).
- E1-E7 : le gestionnaire réel `api/extract-ai.js`, avec `fetch` remplacé par un simulacre, secrets factices (`AUTH_SECRET`, `DEEPSEEK_API_KEY` factices, adresse en `.invalid`) ; le prompt n'est pas testé contre un vrai modèle.
- F1-F4 : `mergeConcerts`, `mergePhotoGroups` (tranches de `useStorage.js`), grep.
- G1-G5, H1-H4 : lecture des fichiers de `docs/`.

**Seulement lu** (non exécuté, nécessite un navigateur ou un service externe) : les écrans (rendu React), le flux photo et filigrane, le service worker, l'OMR et Audiveris, la synchro Supabase réelle, la qualité de lecture du modèle sur un plan, `scripts/omr-sidecar.mjs` hors des lignes citées, l'exactitude des tessitures contre le poster Kolberg.

**Non fait** : aucune lecture de plan réel ; aucun test avec DeepSeek ; les failles de sécurité (S2, S3, S6) ne sont pas réexaminées, voir l'audit Claude.
