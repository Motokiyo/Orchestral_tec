# Audit technique OrkMap (PlateauMap) : robustesse, hors ligne, performance, architecture, déploiement

Date : 17/11/2026. Branche auditée : `feature/omr-family-access` (HEAD local `e6892c8`, origine `07f3f56`). Audit en lecture seule : aucune écriture dans le dépôt source, aucun appel à Supabase, Vercel (hors lecture de la documentation publique), ni DeepSeek, aucun fichier `.env` ouvert (le `.env.local` n'a pas été copié dans la copie de travail). Copie de travail : `/private/tmp/claude-501/-Users-alexandre/1754c331-e049-4db4-a159-ca47e7505e44/scratchpad/orkmap-tech/`. Scripts de reproduction : `/private/tmp/claude-501/-Users-alexandre/1754c331-e049-4db4-a159-ca47e7505e44/scratchpad/repro/` (`s3.mjs`, `offline.cjs`, `update.cjs`).

Légende : **[REPRODUIT]** = exécuté ici et observé. **[LU]** = constaté dans le code, non exécuté. **[DOC]** = confirmé par la documentation officielle. **[NON VÉRIFIABLE]** = dépend de la prod ou de Supabase, que je n'ai pas le droit d'interroger.

---

## 1. Verdict en cinq phrases

1. Le chemin de sauvegarde ordinaire est bien conçu (suppression chirurgicale, file d'attente persistante, garde 409), mais **trois chemins contournent ces protections** : le bouton « Recharger depuis le compte » (S1), le repli sur la copie de secours périmée (S5) et la fusion « le local gagne » (S14).
2. **La synchro est probablement déjà cassée pour les gros comptes** : Vercel limite le corps d'une requête ET d'une réponse à 4,5 Mo [DOC], alors que le code déclare 25 Mo, que les plans sont stockés deux fois dans le JSON et que les photos sont gardées en pleine résolution. Cela concerne aussi la **lecture** (GET), pas seulement l'écriture : un nouvel appareil ne pourrait pas récupérer ses données.
3. Le hors ligne fonctionne **[REPRODUIT]** : app servie depuis le cache en mode avion, 121 ms. Mais une mise à jour n'arrive qu'à la **deuxième** ouverture, même avec du réseau **[REPRODUIT]**, et l'OCR (Tesseract) et les polices ne marchent pas hors ligne.
4. Le filet de sécurité de tests est quasi nul : les 4 scripts `verify_*.cjs` testent une version d'avant l'authentification (démo sur `localhost:5199`), le scénario « 21 contrôles hors ligne » cité dans STATE.md **n'est pas dans le dépôt**, et `test-multiformat.mjs` n'exécute aucun code de l'app.
5. Les dépendances de production sont saines (`npm audit --omit=dev` : 0 vulnérabilité) ; les 19 alertes sont dans les outils de développement (vite 6.4.3, puppeteer).

---

## 2. Vérification de S1 à S14 du rapport d'Aristote

| S | Verdict | Preuve (copie de travail = dépôt actuel) | Statut de la preuve |
|---|---|---|---|
| S1 Recharger depuis le compte supprime les concerts locaux | **CONFIRMÉ, et plus grave que décrit** | `src/App.jsx:1301-1310` appelle `setConcerts(() => d.data)`, c'est `setConcertsAndSave` (`useStorage.js:625-640`) : tout id local absent de la réponse entre dans `removedIds` (`:629`), est supprimé tout de suite d'IndexedDB (`deleteLocalNow`, `:636`) et mis en file (`:634`). Trois aggravants : (a) `Array.isArray([])` est vrai (`App.jsx:1307`), donc un compte serveur vide efface **tous** les concerts locaux après un simple « OK » ; (b) la copie de secours est écrasée par la liste serveur au premier `save` (`useStorage.js:601`), donc le « seul filet » cité par Aristote disparaît aussi ; (c) les concerts communs aux deux côtés perdent leurs modifications locales non encore envoyées. | LU (logique de `setConcertsAndSave` relue ligne à ligne ; non rejoué dans un navigateur) |
| S2 `/api/recovery-dump` sans session | **CONFIRMÉ** | `api/recovery-dump.js:55-64` : aucun `requireSession`. Seul contrôle : l'e-mail du corps est dans la liste autorisée (`:63-64`) et l'`Origin`, qui est **ignoré s'il est absent** (`:60-61`) et qui peut être fourni par le corps lui-même (`req.body?.sourceOrigin`). Écrit avec la clé `service_role`. | LU |
| S3 OTP rejouable / compteur dans le cookie | **CONFIRMÉ et REPRODUIT** | `api/auth-utils.js:82-97`, le compteur `attempts` vit dans le cookie signé. Test local (`repro/s3.mjs`, secret factice) : avec le même cookie, 50 mauvais codes sont tous « refus simple » (jamais « épuisé »), puis le bon code passe ; et le **même couple cookie+code est accepté une deuxième fois** (pas d'usage unique). `api/request-code.js` n'a aucune limite de débit. Comparaison HMAC non constante (`auth-utils.js:51`, mineur). | **REPRODUIT** (code local, aucun réseau) |
| S4 limite 4,5 Mo | **CONFIRMÉ par la doc, étendu à la lecture** | Doc Vercel (page « Functions limits », mise à jour 24/08/2026) : « The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB » (erreur 413 `FUNCTION_PAYLOAD_TOO_LARGE`). `api/sync.js:7-13` et `api/recovery-dump.js:11-17` déclarent `sizeLimit: "25mb"` : syntaxe Next.js sans effet contre la limite de la plateforme. **Nouveau** : `GET /api/sync` renvoie tout le JSON (`sync.js:127-131`), donc la même limite s'applique en réponse ; un compte dépassant 4,5 Mo ne peut plus être rechargé sur un nouvel appareil, ni via « Recharger ». Taille réelle des données : voir §5.1. | DOC pour la limite ; taille réelle NON VÉRIFIABLE |
| S5 copie de secours périmée | **CONFIRMÉ comme risque plausible** | `useStorage.js:53-60` : un dépassement du quota localStorage (5 à 10 Mo selon le navigateur, avec des plans en base64 c'est quasi certain) est avalé par `console.warn`, la copie reste ancienne. `:10` + `:505-528` : si IndexedDB répond en plus de 4 s (la lecture n'est pas annulée, seule l'attente l'est), le `catch` (`:540-554`) charge la copie, met `canSeedRemoteFromLocal = true` et l'app devient éditable (`:570-572`). Ensuite `absorbRemote` (`:580-586`) fait gagner le local, écrit dans IndexedDB et `markPending` pousse. | LU ; déclenchement réel NON VÉRIFIÉ |
| S6 RLS absente (tables 002 et 003) | **CONFIRMÉ dans les migrations** | Seule `001_orkmap_user_data.sql:10` contient `enable row level security`. `002` et `003` ne l'ont pas. Que la clé `anon` puisse réellement lire ces tables dépend des droits du projet Supabase, que je ne peux pas consulter. Correctif sans risque pour l'app (elle n'utilise que `service_role`, qui contourne la RLS). | LU ; exposition NON VÉRIFIABLE |
| S7 échec IA silencieux | **CONFIRMÉ** | `src/App.jsx:2010-2013` : tout échec (413, 401, 500, délai) = `console.warn` puis retour du résultat local, sans message. Avec la limite 4,5 Mo, un PDF de plusieurs pages (JPEG échelle 2, `pdfParser.js:205-211`, toutes pages `:214-225`) peut échouer en 413 et passer pour « importé normalement ». | LU |
| S8 pages perdues | **CONFIRMÉ** | `App.jsx:1923-1925` (`handleAddPlan` ne garde que `planDataUrl`) ; `api/extract-ai.js:41` (8 pages max), `:45` (formats), `:46` (12 Mo) : tout ignoré sans signal. | LU |
| S9 pas de provenance IA | **CONFIRMÉ** | Liste blanche `extract-ai.js:178-195` : aucun champ source ou confiance. | LU |
| S10 JSON « réparé » accepté | **CONFIRMÉ** | `extract-ai.js:147-175`, renvoi en 200 sans indicateur. | LU |
| S11 mobilier explicite non lu | **CONFIRMÉ** | Le prompt cite le mobilier (`:114`) mais la liste blanche `:178-195` n'a pas de champ mobilier. STATE.md:32 est faux sur ce point. | LU |
| S12 mobilier divergent de la référence | Hors de mon périmètre technique | Non revérifié ; à valider par Alexandre. | - |
| S13 aucune gestion des cotes/échelles | Hors périmètre | Non revérifié. | - |
| S14 concurrence entre appareils | **CONFIRMÉ** | Fusion `{...remote, ...local}` (`useStorage.js:82`) : le dernier appareil qui écrit gagne, concert entier. Le serveur ne compare que les ids (`sync.js:73-98`). Lecture puis écriture non atomiques (`sync.js:142-162`). L'écriture de l'historique précède l'écriture principale : si l'historique échoue (`:150-151`), la sauvegarde entière échoue en 500 (sûr pour les données, fragile pour la disponibilité). | LU |

Autres points de la revue vérifiés au passage : S17 (rollback lent) **[REPRODUIT]** (§4), S19 (Tesseract et CDN) **[LU dans node_modules]** (§4), S18 (sidecar OMR sur 0.0.0.0) non revérifié.

### Constat supplémentaire sur la branche `main`
`git show origin/main:api/extract-ai.js` : pas de `requireSession`, et ligne 19 un champ `debug` qui renvoie les **noms** des variables d'environnement. `main` n'a ni authentification, ni synchro, ni plugin de précache, et son service worker utilise un nom de cache fixe `orkmap-v3`. Toute promotion accidentelle de `main` en production serait une régression de sécurité et de hors ligne (§6).

---

## 3. Risques classés

### CRITIQUE

**C1. « Recharger depuis le compte » peut détruire des concerts non synchronisés** (S1). Même schéma que l'incident du 17/06.
- Correction : ne jamais passer par `setConcerts(() => liste serveur)`. Écrire une fonction dédiée dans `useStorage.js` qui, pour chaque id serveur, remplace la version locale **seulement après avoir mis la version locale de côté** (export JSON téléchargeable), conserve tous les concerts locaux absents du serveur, ne calcule aucun `removedIds`, et refuse si la réponse serveur est vide ou si des marques `orkmap-pending` existent. Test à écrire avant : concert créé hors ligne puis « Recharger » = concert toujours là.

**C2. Limite 4,5 Mo : la synchro peut être bloquée en silence, en écriture comme en lecture** (S4 étendu).
- Preuve : doc Vercel ; `sync.js:127-131` (GET entier), `useStorage.js:136-158` (POST entier), `:258-261` (échec = `console.warn` puis réessai toutes les 60 s sans fin).
- Conséquence : les données ne vivent plus que sur un appareil, exactement le scénario de l'incident ; un appareil neuf ne récupère rien.
- Correction rapide (sans changer le format) : (1) mesurer `JSON.stringify(payload).length` avant envoi, afficher un état « trop volumineux » au lieu d'un faux « Envoi en cours » ; (2) ne plus stocker le plan deux fois (voir P1) ; (3) réduire les images (voir P2). Correction de fond : médias hors du JSON (Supabase Storage, un objet par fichier), ou un enregistrement par concert (`updated_at` par ligne). Avant tout, **mesurer en lecture seule** la taille réelle de chaque ligne `orkmap_user_data` (`pg_column_size(data)`).

**C3. Rejeu du code de connexion et absence de limite de débit** (S3, REPRODUIT) : prise de compte possible par force brute en ligne sur 10 minutes, avec envoi de courriels en rafale. Correction : défi stocké côté serveur (table `orkmap_login_challenges`), tentatives comptées côté serveur, code à usage unique, 1 demande par minute et 5 par heure et par adresse ; à défaut, limite par IP côté Vercel (pare-feu) en attendant. Comparaison HMAC avec `crypto.timingSafeEqual`.

**C4. `/api/recovery-dump` sans session** (S2) : correction triviale (`requireSession` et `email === session.email`), ou désactivation par drapeau d'environnement.

### IMPORTANT

**I1. Repli sur copie de secours périmée et édition possible en mode dégradé** (S5). Correction : dans le `catch` de chargement (`useStorage.js:540-554`) ne pas appeler `markPending`, ne pas rendre `getPayload` non nul tant qu'IndexedDB n'a pas été relu correctement ; remplacer le délai fixe de 4 s par une nouvelle tentative (15 à 30 s). Dans `writeConcertsBackup`, détecter l'échec de quota et le signaler (bandeau) au lieu d'un `console.warn`.

**I2. Fusion « le local gagne » au niveau du concert entier** (S14 ; STATE.md « Problèmes connus »). Correction progressive : `updatedAt` par concert et par pièce, marqueurs de suppression, écriture conditionnelle côté serveur (`PATCH ... &updated_at=eq.<lu>`, 0 ligne modifiée = 409). Ne pas faire en urgence (décision d'Aristote : ne pas toucher à la synchro dans l'urgence, je la confirme), mais écrire les tests d'abord.

**I3. Échec IA silencieux, pages perdues** (S7, S8) : exactitude métier. Message visible « lecture IA échouée, données à vérifier », avertissement « 8 pages sur 10 analysées », `handleAddPlan` qui garde toutes les pages.

**I4. RLS absente sur `orkmap_sync_history` et `orkmap_recovery_dumps`** (S6) : migration `004` additive (`alter table ... enable row level security`). Réversible. L'historique contient une copie complète des concerts, donc des noms de musiciens.

**I5. Mise à jour en deux ouvertures et retour arrière lent** (S17 REPRODUIT). Voir §4 : `skipWaiting` + `claim` sans signal à l'utilisateur ; la nouvelle version n'est servie qu'à la 2e ouverture. Un retour arrière a le même délai. Correction : message « nouvelle version prête, relancer » (événement `controllerchange`) ; ne jamais recharger automatiquement en pleine saisie.

**I6. Hooks React après un `return` conditionnel** (`App.jsx:1169-1171` puis `useState` en `:1173`). Fonctionne parce que le paramètre d'URL est constant pour une page, mais contraire aux règles de React et fragile au moindre refactor. À corriger lors du premier découpage (sortir `RecoveryExportScreen` en composant racine choisi dans `main.jsx`).

**I7. Dépôt de code dans un dossier synchronisé par Syncthing.** `.git/`, `node_modules/` (223 Mo), `.vercel/` et `.env.local` vivent dans un dossier Syncthing : deux écritures concurrentes sur `.git/index` ou les objets peuvent corrompre le dépôt, et la copie du `.env.local` sur d'autres machines est un risque de fuite. Recommandation : sortir le dépôt du dossier synchronisé (le code se synchronise par git, selon la règle « code = git »), ou exclure `.git`, `node_modules`, `.vercel`, `.env*` de Syncthing (`.stignore`). Aucune action menée ici.

**I8. Clé API payante exposée par un déploiement ancien** (voir constat `main` plus haut) : à vérifier dans Vercel, quels déploiements `main` sont encore joignables.

### MINEUR

- **M1.** Données de développement dans le build : `VITE_OWNER_EMAIL` est injecté dans le bundle (`useStorage.js:19`, `App.jsx:199`), donc une adresse e-mail en clair dans le JS public. Sans cette variable au build, les données locales sans `ownerEmail` deviennent invisibles (`belongsToUser`, `:37-39`) : **un build lancé sur une machine sans la variable fait croire à une perte de données**. À documenter dans STATE.md ; vérifier la variable côté Vercel.
- **M2.** Concert de démonstration réinjecté si IndexedDB est vide ou en échec (`useStorage.js:519-527`, `:547-553`) : c'est le mécanisme de l'incident de juin ; il est aujourd'hui neutralisé par la suppression chirurgicale et le 409, mais il vaudrait mieux le supprimer pour les comptes réels.
- **M3.** `service worker` : l'installation avale chaque échec de `cache.add` (`public/sw.js:29-31`), donc une installation partielle réussit et l'ancien cache est purgé à l'activation ; le choix du « cache précédent » repose sur l'ordre de `caches.keys()` (`:44-47`), ordre garanti en pratique mais non par la norme. Le précache `/` et `/index.html` ne sont pas versionnés par le hash (ils le sont via le hash global, correct).
- **M4.** Polices Google chargées par `@import` bloquant dans `index.html:14` : hors ligne et avant première visite, rendu retardé, puis police système. Le cache des polices (`sw.js:56-59`) ne marche qu'après un premier chargement réussi.
- **M5.** Aucun délai maximal côté client sur `/api/extract-ai` (`pdfParser.js:1918`) ni sur l'appel DeepSeek (`extract-ai.js:133`) ; `maxDuration` est de 60 s (`:15`) alors que le plafond Vercel est à 300 s.
- **M6.** `README`/`INDEX`/`STATE` partiellement périmés (section « Dernier déploiement » = 17/06, mentions de Grok/Gemini).
- **M7.** Sidecar OMR en `0.0.0.0` sans authentification (S18, non revérifié), hors production.

---

## 4. Hors ligne : ce qui a été testé

Méthode : build de la copie, `vite preview` sur le port 5290 (local), Chromium via puppeteer de la copie, polices Google bloquées, aucune requête externe.

| Scénario | Résultat |
|---|---|
| Première visite avec réseau | **[REPRODUIT]** Le service worker s'installe, contrôle la page, et le cache `orkmap-<hash 12 car.>` contient les 11 fichiers : `/`, `/index.html`, `/manifest.json`, 4 fichiers `assets/` (dont `pdf.worker.min` de 1,4 Mo et le chunk Tesseract), 2 icônes, 2 logos. |
| Mode avion puis rechargement | **[REPRODUIT]** L'app se charge en 121 ms depuis le cache, sans erreur JS ; écran de connexion si aucun compte mémorisé (comportement voulu, `DECISIONS.md` du 23/09). Le cas « compte déjà mémorisé » n'a pas été joué (il demande une session factice) : à couvrir par le test E2E du §8. |
| Déploiement d'une v2 (une ligne ajoutée) | **[REPRODUIT]** Page ouverte sur v1, v2 déployée, 1er rechargement avec réseau : **toujours v1** servie (`index-DNUjyjgy.js`), un cache `orkmap-bca80fc34a5c` est créé ; 2e rechargement : v2. Deux caches coexistent (courant + précédent), ce qui évite de casser une page ouverte pendant la mise à jour. |
| Tesseract (OCR d'une photo) | **[LU]** `node_modules/tesseract.js/src/worker/browser/defaultOptions.js:11` : `workerPath` par défaut = `https://cdn.jsdelivr.net/...`. Le noyau et les données de langue (`fra+eng`) viennent aussi d'un CDN (bibliothèque 7.0.0, comportement par défaut ; `pdfParser.js:1438-1439` ne fournit aucun chemin local). Le service worker laisse passer les requêtes d'autres origines (`sw.js:61` : `if (url.origin !== self.location.origin) return;`). Conséquence : OCR impossible hors ligne la première fois (l'erreur est attrapée, `pdfParser.js:1451`) ; le code tente donc une lecture sans texte. |
| Mise à jour quand la prod est l'ancienne `main` | **[LU]** `main` a un cache `orkmap-v3` fixe : une SW ancienne peut servir un build périmé tant qu'elle n'est pas remplacée. |
| IndexedDB | **[LU]** Une base `orkmap-db` v4 avec trois magasins ; la clé `all-photos:<email>` contient **toutes les photos du compte dans une seule valeur** (`useStorage.js:663-667`) : à chaque photo ajoutée, toute la valeur est réécrite. `requestPersistentStorage` est appelé (`:378-384`), bien, mais Brave/iOS peuvent refuser : à vérifier sur appareil (STATE.md l'a déjà noté). |
| `navigator.onLine` | **[LU]** Utilisé pour éviter les envois (`useStorage.js:219-221`), fiable en mode avion mais trompeur sur un Wi-Fi de salle sans accès Internet : les `fetch` échouent alors (attrapés, réessai toutes les 60 s) ; correct, mais le bandeau peut afficher « en ligne ». |

Corrections hors ligne, par ordre de rapport utilité/risque : (1) bandeau « mise à jour prête » (événement `controllerchange`) ; (2) copier les polices (DM Sans) dans `public/` et supprimer le `@import` ; (3) héberger les fichiers Tesseract (`worker`, `core`, `fra.traineddata`) sur le même domaine et les ajouter au précache, ou accepter explicitement l'OCR « réseau obligatoire » ; (4) rendre l'installation du service worker atomique (échec d'un fichier = pas d'activation).

---

## 5. Build et performance

### 5.1 Poids et chargement (build Vite 6.4.3, 1,2 s)

| Fichier | Taille | gzip | Contenu (source maps) |
|---|---|---|---|
| `assets/index-DNUjyjgy.js` | 445 Ko | 133 Ko | react-dom 128 Ko, **App.jsx 128 Ko**, **jszip 96 Ko**, pdfParser 35 Ko, useStorage 14 Ko, utils 9 Ko |
| `assets/pdfjs-DQl15R3w.js` | 364 Ko | 107 Ko | pdfjs-dist (chunk manuel) |
| `assets/pdf.worker.min-*.mjs` | 1 376 Ko | non précisé | chargé uniquement à l'ouverture d'un PDF |
| `assets/index-BRFDG0ZB.js` | 16 Ko | 7 Ko | tesseract.js (déjà chargé en différé par `import()`) |

Au démarrage : environ **810 Ko bruts, soit environ 240 Ko compressés** (index + pdfjs), JS à analyser sur le téléphone avant le premier affichage. Le chunk pdfjs est préchargé (`<link rel="modulepreload">` dans `dist/index.html`) parce que `App.jsx:4` importe statiquement `pdfParser.js:7`.

### 5.2 Gains possibles, chiffrés

| Gain | Estimation | Effort / risque |
|---|---|---|
| Charger `pdfParser` (donc pdfjs) à la demande : `await import("./pdfParser.js")` aux 6 points d'appel (`App.jsx:1591, 1869, 1924, 1928, 1993, import OMR`) | -364 Ko bruts (-107 Ko gzip) au démarrage, soit -45 % de JS initial | faible : le chunk est déjà précaché par le service worker, donc disponible hors ligne ; ajouter un état « chargement » aux boutons d'import |
| Charger `jszip` à la demande (utilisé seulement à `App.jsx:769` et `:802`, exports ZIP) | -96 Ko bruts (-30 Ko gzip environ) | très faible |
| Découper les écrans lourds (`React.lazy` : OMR, galerie, photoSetup) | -30 à -60 Ko estimés sur `App.jsx` | moyen, après découpage du fichier |
| Retirer la **duplication des plans** : `planDataUrl` et `plans[]` contiennent la même image encodée (`App.jsx:1889-1890`, `:1961-1962`) | environ **-50 % de la taille JSON des concerts** en base, en mémoire, dans la copie localStorage et dans chaque POST | moyen : ne plus écrire `planDataUrl` (le lire en repli pour les anciens concerts), migration douce, test préalable |
| Réduire les images : photos stockées à résolution caméra (`App.jsx:4471-4482`, `:73`, `:93`), plans PDF rendus à l'échelle 2 en JPEG 0,85 (`pdfParser.js:205-211`) | une photo 12 Mpx ≈ 3 à 5 Mo en base64 : **une ou deux photos suffisent à dépasser 4,5 Mo** de `photos` ; passer à 1600 px de côté (la fonction `downscaleImageDataUrl` existe déjà, `App.jsx:461`) réduit à 150-300 Ko | faible à moyen ; décision d'Alexandre sur la qualité des photos de plateau |
| Sauvegarde locale incrémentale : chaque sauvegarde relit **tous** les concerts depuis IndexedDB (`useStorage.js:469-476`), écrit une copie JSON complète dans localStorage **deux fois** (`:476`, `:601`) et réécrit tous les concerts (`:481-483`) | sur un téléphone avec plusieurs Mo, blocage du fil principal de plusieurs centaines de ms à chaque modification (500 ms de délai) ; les écritures peuvent être limitées aux concerts modifiés | moyen ; à faire après les tests de non-régression |
| Comparaisons `JSON.stringify` complètes à chaque ouverture (`useStorage.js:560`, `:705`, `:843`) et téléchargement des trois jeux de données entiers à chaque ouverture | économie de plusieurs Mo de réseau et de CPU par ouverture ; remplacer par une comparaison de `updatedAt` (la colonne existe déjà et le GET la renvoie, `sync.js:131`) | moyen |
| Temps d'affichage téléphone moyen | non mesuré sur appareil réel (Lighthouse mobile non lancé : pas de réseau externe). Ordre de grandeur : parse de 810 Ko de JS sur un Fairphone moyen = 150 à 300 ms hors réseau, plus le chargement IndexedDB (jusqu'à 4 s toléré) : **le facteur dominant n'est pas le JS mais la lecture des concerts avec images en base64** | à mesurer |

### 5.3 Dépendances (dans la copie, sans rien installer dans le dépôt)

`npm audit` : 19 alertes (1 faible, 1 modérée, 17 élevées), **toutes dans les dépendances de développement** ; `npm audit --omit=dev` : **0 vulnérabilité**.
- `vite` 6.4.3 (direct) : 5 avis (serveur de développement : middleware, `server.fs`, `launch-editor`) ; correctif dans 6.4.6 (même série, sans changement incompatible). Le serveur de dev n'est pas déployé ; risque limité à la machine du développeur.
- `puppeteer` 24.40.0 (direct) et sa chaîne (`zod`, `basic-ftp`, `ip-address`, `extract-zip`, `proxy-agent`...) ; la version 24.43.1 suffit probablement, la 25 est incompatible.
- `postcss`, `source-map-js`, `nanoid`, `js-yaml`, `browserslist` : mises à jour transitives par `npm audit fix` (sans `--force`).

`npm outdated` : react et react-dom 18.3.1 (dernière 19.3.1, **ne pas migrer maintenant**), `@vitejs/plugin-react` 4.7.0 (6.3.0), `pdfjs-dist` 4.10.38 (6.5.438), `idb` 8.0.3 (8.0.4), `jszip` 3.10.1 (3.10.2), `puppeteer` 24.40.0 (24.43.1). `pdfjs-dist` 4.10.38 est postérieur au correctif de la faille d'exécution de code (4.2.67) ; l'application charge des PDF de tiers, donc ne pas rester indéfiniment sur la 4.x : mise à jour majeure à planifier, avec test sur les plans réels. Recommandation : appliquer seulement `vite` 6.4.6, `idb`, `jszip` et les mises à jour des outils de test, après les tests du §8. La règle d'AGENTS.md « pas de dépendance supplémentaire sans accord » reste valable pour tout nouvel outil.

---

## 6. Déploiement, branches, retour arrière

État des branches (lecture de l'historique git de la copie, aucune connexion au dépôt distant) :
- `origin/feature/omr-family-access` (`07f3f56`, 22/10/2026) = la version de travail : authentification, synchro Supabase, hors ligne, DeepSeek. 34 à 35 commits d'avance sur `main`, 32 fichiers, +4 148 -220 lignes.
- `origin/main` (`6dc9123`) = ancien : pas d'authentification, pas de synchro, pas de précache, route IA ouverte (voir §2).
- `main` local (`e3a7e6f`) a un commit non poussé (réécriture des chemins du vault). `feature/omr-family-access` local (`e6892c8`) a un commit non poussé (renommage CLAUDE.md vers AGENTS.md). Le dossier de travail a 5 fichiers `.md` modifiés et 1 non suivi (dont `INDEX.md`, `README.md`, `docs/`).
- Le dépôt distant affiché par git est `Motokiyo/Orchestral_tec`, alors qu'AGENTS.md cite `Motokiyo/Applications/Galaad/Orchestral-tec` : **deux dépôts possibles, à clarifier**.
- STATE.md est contradictoire sur la baseline de production : promotion du preview `ea95c5b` le 23/09 (ligne 7) contre « Dernier déploiement = `13ff48e` du 17/06 » (lignes 34-40), et la bascule DeepSeek du 22/10 (`07f3f56`) n'a **aucune trace de déploiement**. Le dossier a un `.vercel/project.json` (projet `orkmap`) : un `vercel --prod` depuis ce dossier déploierait **le contenu du répertoire, y compris les modifications non commitées**, sans correspondre à un commit.

Risques d'un push :
1. **Un push sur la branche de production déclenche un déploiement en production.** Aucun `vercel.json` n'est dans le dépôt : la « Production Branch » est un réglage du tableau de bord Vercel (inconnu, non lu). DECISIONS.md du 24/05 dit que l'auto-déploiement est lié à `main`, ce qui est probablement encore le cas. **Ne rien pousser sur `main` tant que ce réglage n'a pas été lu.**
2. Un push sur `feature/omr-family-access` crée au minimum un **déploiement de prévisualisation** (si l'intégration GitHub est active). Si les variables d'environnement de prévisualisation pointent sur le projet Supabase de production (variables `SUPABASE_*` à portée « Preview »), un test sur la prévisualisation **écrit dans les vraies données**. Vérifier la portée de chaque variable (noms seulement).
3. Un déploiement par la CLI (`vercel --prod`) contourne git : à proscrire sans commit propre.

Procédure de retour arrière recommandée :
1. Avant tout déploiement : noter l'identifiant du déploiement actuellement servi par `orkmap.eiffelai.io` (tableau de bord Vercel, Deployments) et son SHA ; c'est le point de retour.
2. Retour : « Promote » (ou « Instant Rollback ») de ce déploiement dans Vercel, sans reconstruction. Aucune migration destructive n'est prévue, donc la base n'a pas à revenir.
3. Côté appareils : la nouvelle version n'arrive qu'à la 2e ouverture avec réseau **[REPRODUIT]** ; prévenir les utilisateurs de rouvrir l'app deux fois, réseau actif, avant un concert.
4. Données : `orkmap_sync_history` garde l'état « précédent » de chaque sauvegarde (`sync.js:150-151`) ; il n'existe **aucun outil de restauration** : prévoir un script en lecture seule qui liste les versions d'un compte et en exporte une, à écrire et tester avant d'en avoir besoin.
5. Après retour, vérifier le nombre de concerts avant/après sur chaque appareil.

Recommandations : une branche de production unique et protégée ; déploiement uniquement depuis un commit ; archiver ou supprimer les déploiements de `main` encore joignables (après décision d'Alexandre) ; un tag git par mise en production (`prod-AAAA-MM-JJ`).

---

## 7. Architecture : découper App.jsx (4 916 lignes) sans réécriture

### 7.1 Cartographie de l'existant
- Lignes 14-130 : fonctions pures (dédoublonnage d'ids, dates, filigrane, import d'image, conversions).
- 124-446 : connexion, bandeau de synchro, écran de récupération (déjà des composants isolés).
- 448-1167 : fonctions OMR (image, lecture à voix haute, audio), pures ou presque.
- **1168-3950 : un seul composant `App()` d'environ 2 800 lignes**, 55 `useState`, 7 parties : (a) état et authentification (1168-1290), (b) mutations de concerts, pièces, percussions, orchestre (1314-1550), (c) OMR : import, lecture, audio (1564-1857), (d) import de fichiers et IA (1858-2098), (e) 7 écrans rendus en ligne par `if (screen === ...)` (start 2377, omr 2440, concerts 2687, home 2818, **piece 2948-3774, soit 830 lignes**, photoSetup 3778, gallery 3813, txt 3883).
- 3953-4916 : composants déjà séparés dans le même fichier (visionneuse, capture photo, zones, etc.).
- Autres gros fichiers : `pdfParser.js` (1 968 lignes), `useStorage.js` (917 lignes, trois hooks quasi identiques).

### 7.2 Règles
- **Aucune modification de comportement pendant un déplacement.** Un lot = un déplacement mécanique + test vert avant/après. Pas de nettoyage mêlé.
- AGENTS.md interdit de créer de nouveaux fichiers `.jsx/.js` sans nécessité : **cette règle devra être levée explicitement par Alexandre** pour ce chantier, sinon rien ne peut être découpé.
- Ne pas toucher à `useStorage.js` avant que les correctifs C1, C2, I1 soient livrés et testés (c'est le fichier qui protège les données).
- `App.jsx` reste le propriétaire de l'état ; les composants extraits reçoivent des props au début, aucun contexte React ni gestionnaire d'état nouveau (pas de nouvelle dépendance).

### 7.3 Ordre des lots (du moins risqué au plus risqué)

| Lot | À sortir | Pourquoi dans cet ordre | Test avant de déplacer |
|---|---|---|---|
| 0 | Rien : poser le filet (§8) et lever la règle d'AGENTS.md | Aucun déplacement sans filet | - |
| 1 | Fonctions pures de `App.jsx` 14-130 vers `src/lib/` (`dedupePieceIds`, `parseConcertDate`, `sanitize`, `dataUrlToBlob`) | Pas d'état, pas de React ; `dedupePieceIds` protège les photos | Tests unitaires `node --test` (cas : ids dupliqués, dates FR) |
| 2 | Auth et synchro : `LoginScreen`, `SyncBanner`, `RecoveryExportScreen`, `fetchSession`, `postJson` (124-446) vers `src/auth/` | Composants déjà autonomes ; sortir `RecoveryExportScreen` règle I6 (hooks après `return`) | E2E : écran de connexion, bandeau hors ligne, `?orkmap_recovery=1` |
| 3 | Composants déjà séparés du bas de fichier (3953-4916) vers `src/components/` | Déplacement pur, aucun lien avec l'état global | Test visuel de non-régression (captures avant/après, téléphone et ordinateur) |
| 4 | **OMR** : helpers 448-1167, lecture/audio 1564-1857, écran 2440-2683 vers `src/omr/` (hook `useOmrReader`) | Fonctionnalité en feuille : ne touche pas aux concerts ni à la synchro ; plus de 1 000 lignes d'un coup | Tests unitaires de `parseOmrNotes` et `buildOmrReadingEvents` ; E2E « ouvrir un score » |
| 5 | Écrans simples : `start`, `gallery`, `txt`, `photoSetup`, `concerts` | Lecture seule ou peu de mutations ; props explicites | E2E de navigation (existe en partie dans `verify_full.cjs`, à réparer) |
| 6 | Import et IA : `handlePdfImportNew`, `handleAddPlan`, `enrichWithAi`, `handleAiExtract` (1858-2098) vers `src/import/` avec une fonction pure `mergeAiResult(piece, aiData)` | C'est là que vivent S7 et S8 ; extraire en pur permet de les corriger ensuite avec des tests | Fixtures JSON de réponses IA (sans appel réseau) ; cas « IA en échec », « 10 pages » |
| 7 | Mutations de concerts/pièces/percussions (1314-1550) vers `src/state/concertOps.js` en fonctions pures `(concert) => concert` | Rend testable ce qui modifie les données ; `recalcDaniels`, `applyCordesAutoComplete` | Tests unitaires + invariant « le nombre de concerts ne diminue que sur suppression explicite » |
| 8 | Écrans `home` et `piece` (830 lignes) vers `src/screens/` ; sous-composants (percussions, mobilier, plans) | Dernier : les plus gros et les plus liés à l'état | E2E complet + captures pleine page |
| 9 | `useStorage.js` : `db.js` (IndexedDB), `merge.js` (fusions), `pending.js` (file d'attente), puis les trois hooks | Mécanique, mais risqué ; seulement après C1, C2, I1 et les tests de la file d'attente | Tests de non-régression de la synchro (§8, niveau 3) |

Gain attendu : `App.jsx` sous 1 000 lignes après le lot 8, plus de chargement différé possible (OMR, galerie, import/pdfjs) donc gain de performance (§5.2).

---

## 8. Filet de tests minimal avant de toucher au code

### 8.1 Ce qui existe réellement
| Fichier | Ce qu'il vérifie | Valeur actuelle |
|---|---|---|
| `verify-puppeteer.cjs`, `verify_full.cjs`, `verify_orkmap.cjs`, `verify_orkmap_final.cjs` | Ouverture de `http://localhost:5199`, présence de « Mes concerts », concert de démo, navigation, bouton IA, rechargement | **Obsolètes** : datent d'avant l'authentification (écran de connexion), supposent un serveur local sur le port 5199 et la démo ; aucun ne s'arrête sur un code de sortie non nul fiable (ils ne couvrent ni la synchro ni le hors ligne). Je ne les ai pas exécutés (échec certain à l'étape connexion). Trois captures d'échec versionnées (`verify-fail-*.png`) montrent qu'ils échouaient déjà. |
| `test-multiformat.mjs` | Écrit deux fichiers texte dans `/tmp` puis affiche des coches | **Ne teste aucun code de l'app** (aucun import de `src/`) : coches affichées sans condition (« App.jsx imports extractFromFile » imprimé sans vérification). Valeur nulle. |
| `test-infra/` | Un `CHANGELOG.md` et un prompt Gemini | Pas de test (c'est de la documentation de prompt). |
| Scénario Puppeteer « 21 contrôles hors ligne » (STATE.md:7) | Ouverture hors ligne, fermeture/réouverture, conflit 409, session expirée, suppression puis fermeture | **Introuvable** dans les fichiers suivis par git ni dans le dossier de travail (`git ls-files`). À retrouver (serveur, ancienne session) avant tout. |
| Contrôles d'usage (`npm run build`, `node --check api/*.js`) | Compilation | Seul garde-fou réel, non automatisé (pas d'intégration continue, pas de `npm test`, STATE.md le dit). |

### 8.2 Filet proposé (trois niveaux, petit budget)
1. **Niveau 1, sans nouvelle dépendance, quelques heures : `node --test` (intégré à Node 24).**
   - Un script `npm test` qui lance : `vite build`, `node --check api/*.js` et les tests ci-dessous.
   - Tests de fonctions pures déjà exportées ou exportables : `validateNonDestructiveSync` (`sync.js:73`, déjà exportée : cas id manquant refusé, `removedIds` accepté, photos par groupe) ; `calculateMobilier`, `decodeEffectif`, `orchestreFromEffectif` sur les exemples de `docs/` ; les fonctions de fusion de `useStorage.js` (à exporter, sans changer le comportement) ; la logique d'authentification (reprendre `repro/s3.mjs` : ce test **échoue aujourd'hui** par conception, il documente C3).
2. **Niveau 2 : test hors ligne automatisé** à partir de `repro/offline.cjs` et `repro/update.cjs` (déjà écrits) : installation, avion, mise à jour en deux ouvertures. Ajouter le cas « compte mémorisé » (en préremplissant `orkmap-last-email` et en interceptant `/api/session` et `/api/sync`).
3. **Niveau 3 : invariants de conservation des données** en E2E avec puppeteer (déjà en devDependency) et un faux serveur par interception de `/api/*`. À écrire **avant tout correctif de synchro** :
   - créer 3 concerts hors ligne, rouvrir, retour réseau : les 3 sont sur le faux serveur ;
   - « Recharger depuis le compte » avec un concert local absent du serveur : il reste (échoue aujourd'hui, c'est C1) ; avec serveur vide : rien n'est supprimé ;
   - réponse 409 : fusion puis renvoi, aucun concert perdu ;
   - réponse 413 : un état visible, rien supprimé, la marque `pending` reste ;
   - IndexedDB lent (retardé artificiellement de 5 s) : aucun envoi pendant le mode dégradé ;
   - suppression explicite puis fermeture immédiate : la suppression est bien envoyée ;
   - deux appareils (deux contextes de navigateur) modifient le même concert : le résultat est connu et documenté (aujourd'hui le dernier gagne).
4. **Fixtures IA** : 3 à 5 réponses JSON réelles (anonymisées) stockées dans le dépôt, rejouées contre `mergeAiResult` et `calculateMobilier` en test d'instantané. Aucun appel DeepSeek automatique ; le corpus réel reste en déclenchement manuel avec accord d'Alexandre (les plans contiennent des noms de musiciens).
5. **Intégration continue** (GitHub Actions) sur chaque poussée de branche : build + niveau 1. Elle ne déploie rien.

Condition de passage : un lot de découpage (§7) ne se commence que si le niveau 1 est vert et si les tests du niveau 3 couvrant la zone touchée existent.

---

## 9. Priorités et ordre d'exécution suggéré

Aucune de ces actions n'a été lancée.

1. **Lecture seule, sans toucher au code** : relever le déploiement de production actuel et la « Production Branch » (§6) ; mesurer la taille réelle des lignes `orkmap_user_data` ; lister les déploiements de `main` encore joignables.
2. **Exports de sécurité** : demander à chaque appareil d'exporter ses données (la fonction `exportLocalDataForRecovery` existe, `useStorage.js:402-442`, mais n'est atteinte que par `?orkmap_recovery=1` et envoie sur le serveur : ajouter un export local sans envoi).
3. **Retrouver ou réécrire le scénario hors ligne de 21 contrôles** et poser le filet de niveaux 1 à 3 (§8).
4. **Correctifs minimaux sans refonte** : C4 (session sur `recovery-dump`), I4 (RLS, migration additive), C3 (défi OTP serveur, avec repli : seulement limite de débit), C1 (rechargement non destructif), I3 (échec IA visible), garde de taille de payload avec état visible (C2, étape 1).
5. **Gains de performance à faible risque** : chargement différé de `pdfjs`/`jszip`, polices locales, réduction des images à l'import.
6. **Puis seulement** le découpage de `App.jsx` (§7), la fusion par horodatage (I2) et les médias hors du JSON (C2, étape de fond).

---

## 10. Limites de cet audit

- Aucune donnée de production, aucune taille réelle de payload, aucun réglage Vercel/Supabase consulté : C2, S5, S6 et la section déploiement reposent sur le code et la documentation publique.
- Les scénarios S1, S5, S14 n'ont pas été rejoués dans un navigateur : ils sont établis par lecture du code, c'est précisément pourquoi le niveau 3 du §8 doit précéder tout correctif.
- Le temps d'affichage sur téléphone n'a pas été mesuré (pas d'appareil réel, pas de Lighthouse).
- Tests jouables ici : S3 (code d'authentification), installation et mode avion du service worker, mise à jour en deux ouvertures. Résultats ci-dessus.
- Un fichier `src/main.jsx` de la copie a été modifié pour simuler une v2 puis restauré (`git checkout`) ; la copie a été reconstruite proprement ensuite.
