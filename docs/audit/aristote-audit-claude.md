# Audit OrkMap : branche `feature/omr-family-access` @ `07f3f56`, avec plan P0 pour cette nuit

## 0. Périmètre et limites

- **Lu** : INDEX, STATE, DECISIONS, `memory/project_timeline.md`, `docs/PLAN_remise-a-plat.md`, `docs/EXTRACTION_IA_REFERENCE.md` (partiel), BENCHMARK (passage rapide), tout `api/*`, `src/useStorage.js`, les parties critiques de `src/App.jsx`, `src/pdfParser.js` et `src/utils.js`, `public/sw.js`, `vite.config.js`, les 3 migrations, `.gitignore`, `.claude/*`, le sidecar OMR, et `api/extract-ai.js` + `STATE.md` du clone `main` (`/root/orkmap-audit/repo`).
- **Non lu ou non fait** :
  - **Le docx de roadmap n'a pas été lu.** L'outil Read refuse le binaire et je n'avais pas Bash. À extraire par l'orchestrateur avec `python3 -I` + zipfile, dans un répertoire isolé.
  - **Pas de `git log` ni de `git diff` entre mai et octobre.** Les objets sont packés. L'historique ci-dessous est reconstitué à partir de la documentation du dépôt.
  - Aucun accès à la prod, à Vercel ou à Supabase. Aucun test exécuté.
- **Légende des constats** :
  - **[PREUVE]** : lu dans le code.
  - **[RISQUE]** : conséquence plausible déduite du code.
  - **[HYPOTHÈSE]** : dépend d'une configuration ou d'une plateforme non observée.
  - **[À TESTER]** : scénario à exécuter par l'orchestrateur, non exécuté ici.

---

## 1. Baseline production : elle n'est pas établie, c'est le pré-requis n°1

Ce que dit le dépôt est contradictoire :

| Source | Affirmation |
|---|---|
| `STATE.md:7` | Prod = promotion Vercel du preview **`ea95c5b`** le 23/09, déploiement `orkmap-h53ro2nz3` |
| `STATE.md:34-40` | « Dernier déploiement » = **`13ff48e`** le 17/06 (section périmée) |
| `DECISIONS.md:5`, `STATE.md:30` | Bascule DeepSeek le 22/10 = **`07f3f56`**. **Aucune mention d'un déploiement de ce commit.** |
| `DECISIONS.md:21` | Auto-deploy Vercel **sur push vers `main`** (24/05) |
| `memory/project_timeline.md:56` | Déploiements prod via **Vercel CLI** depuis la branche feature |
| `/root/orkmap-audit/repo/STATE.md:22` | URL de `main` : `galaadmf.fr/apps/orkmap/` |

Conséquences :

- **[RISQUE] Un déploiement CLI peut ne correspondre à aucun commit.** La CLI envoie le répertoire de travail local, modifications non commitées comprises. La prod peut donc être `ea95c5b`, `07f3f56`, ou un état intermédiaire.
- **[RISQUE, critique pour cette nuit] Un push ou un merge sur `main` peut écraser la prod.** Si la « Production Branch » de Vercel est encore `main`, le merge déclenche un déploiement automatique. Et `main` (`6dc9123`) n'a ni auth, ni sync, ni hors ligne.
- **[PREUVE] `main` expose une clé IA payante sans protection.** Son `api/extract-ai.js:10-21` n'a pas d'authentification. Il renvoie aussi les **noms** des variables d'environnement contenant « KEY » (`debug`). Ligne 87, la clé Gemini passe dans l'URL. Si un déploiement de `main` est encore joignable (alias `*.vercel.app`, `galaadmf.fr`), c'est un relais Gemini ouvert. → [HYPOTHÈSE] à vérifier.

**Checklist baseline (lecture seule, par Alexandre ou un opérateur autorisé, avant toute fusion)** :

1. Dans Vercel, pour le déploiement aliasé sur `orkmap.eiffelai.io` : ID, source (Git ou CLI), SHA, date. Le noter comme **point de rollback**.
2. Réglage « Production Branch » (Settings → Git). Si c'est `main` : **interdiction de pousser sur `main` cette nuit.**
3. Lister **les noms seulement** des variables d'env prod : `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `GOOGLE_API_KEY`, `AUTH_SECRET`, `ALLOWED_EMAILS`, `SUPABASE_*`, `GMAIL_*`.
4. Lister tous les déploiements encore joignables (previews, `orchestral-tec.vercel.app`, `galaadmf.fr/apps/orkmap`) et vérifier si `/api/extract-ai` répond sans session.
5. Côté Supabase, taille de chaque ligne `orkmap_user_data` (`pg_column_size(data)` par `email,type`) et nombre de lignes de `orkmap_sync_history`, en lecture seule.
6. Sur chaque appareil réel : présence de clés `orkmap-pending:*` dans le localStorage. Une marque vieille de plusieurs jours signifie que la synchro est bloquée.

---

## 2. Constats par sévérité

### P0 : risque de perte de données ou de faille exploitable

**S1. Le bouton « Recharger depuis le compte » supprime les concerts qui n'existent qu'en local.** [PREUVE] Critique.
- Où : `src/App.jsx:1301-1310` → `setConcerts(() => d.data)`, qui est `setConcertsAndSave` (`useStorage.js:625-640`).
- Mécanisme :
  - Tout id local absent du serveur entre dans `removedIds`, puis est passé à `deleteLocalNow`. Il est aussi mis dans la file d'attente de suppressions.
  - Cela vise exactement les concerts créés hors ligne, ou jamais synchronisés à cause d'un échec de synchro (voir S4).
  - Le message de confirmation dit « versions remplacées », pas « concerts supprimés ».
- Seul filet : la copie `orkmap-concerts-backup` en localStorage (`useStorage.js:476`). Elle-même peut être périmée (voir S5).
- **C'est le même schéma que l'incident du 17/06.**

**S2. `/api/recovery-dump` ne vérifie aucune session.** [PREUVE] Haute.
- Où : `api/recovery-dump.js:55-64`.
- Il suffit de connaître une adresse autorisée. Le contrôle d'`Origin` est contournable : en-tête absent = accepté (ligne 61). Corps jusqu'à 25 Mo, écrit avec la clé `service_role`.
- Effets possibles : remplissage de la base, empoisonnement des dumps forensic.
- Côté client (`App.jsx:197-316`, déclenché par `?orkmap_recovery=1`, `App.jsx:1169`), l'écran envoie **tout le localStorage et toutes les photos** sans session.

**S3. Le code de connexion à 6 chiffres peut être forcé par rejeu du cookie.** [PREUVE] Haute.
- Où : `api/auth-utils.js:82-104`. Le compteur `attempts` vit **dans le cookie signé**, côté client.
- Un attaquant demande un code pour une adresse autorisée et reçoit le cookie `attempts:0`. Il peut ensuite rejouer ce cookie à volonté pendant 10 minutes : la limite `MAX_ATTEMPTS` ne s'applique jamais.
- `api/request-code.js` n'a aucune limite de débit. On peut donc enchaîner les fenêtres de 10 minutes et spammer la boîte mail.
- Enjeu : prise de compte, avec lecture et écriture de toutes les données de régie.
- Mineur : comparaison HMAC non constante, `auth-utils.js:51`.

**S4. La synchro bloque définitivement au-delà de la limite de corps Vercel.** [HYPOTHÈSE forte] Haute.
- `api/sync.js:7-13` déclare `bodyParser.sizeLimit: "25mb"`. C'est une syntaxe Next.js. **À vérifier dans la doc officielle Vercel** : les fonctions ont une limite de corps de requête documentée d'environ 4,5 Mo, qui ne se relève pas.
- `concerts` est envoyé **en entier en un seul POST, plans compris en base64** (`useStorage.js:87-89`, `STATE.md:53`).
- `photos` est envoyé **en un seul objet** contenant toutes les photos du compte (`useStorage.js:729-733`).
- Au-delà du seuil, on obtient un 413 permanent. `pushPending` journalise et réessaie toutes les 60 s (`useStorage.js:258-261`). Le bandeau affiche « Envoi des modifications… » indéfiniment.
- **Les données ne vivent alors que sur un seul appareil**, scénario de l'incident de juin. → [À TESTER] mesurer `JSON.stringify` des payloads réels sur l'appareil d'Alexandre.

**S5. Une copie de secours périmée peut écraser des données plus récentes.** [RISQUE] Haute.
- `writeConcertsBackup` (`useStorage.js:53-60`) met tous les concerts, plans compris, dans le localStorage (≈ 5 Mo selon le navigateur). En cas de dépassement de quota : simple `console.warn`, la copie reste ancienne.
- Si l'ouverture d'IndexedDB dépasse `LOCAL_LOAD_TIMEOUT_MS = 4000` (gros plans, téléphone lent), on passe dans le `catch` (`useStorage.js:540-546`). L'app prend alors la copie périmée et met `canSeedRemoteFromLocal = true`.
- Ensuite `absorbRemote` fusionne **en faisant gagner le local** (`useStorage.js:74-85`), écrit le résultat dans IndexedDB (`:585`) et le marque à envoyer (`:560-565`).
- Résultat : des versions anciennes écrasent les plus récentes, en local comme sur le serveur. L'historique serveur (`sync.js:150-151`) permet seulement de récupérer à la main.

**S6. Deux tables Supabase n'ont pas de Row Level Security.** [PREUVE] / [HYPOTHÈSE] sur l'exposition. Haute.
- `001` active la RLS (`001_orkmap_user_data.sql:10`). **`002` (recovery_dumps) et `003` (sync_history) ne l'activent pas.**
- Selon les droits par défaut du projet, la clé `anon`, publique par nature, pourrait lire tout l'historique et tous les dumps via PostgREST.
- Correctif sans risque pour l'app : `enable row level security`. La clé `service_role` contourne la RLS, donc le comportement de l'app ne change pas.

**S7. L'import par IA échoue en silence.** [PREUVE] Haute pour l'exactitude.
- `enrichWithAi` (`App.jsx:1992-2013`) attrape toutes les erreurs : 413, 401, 500, DeepSeek indisponible, JSON invalide. Il renvoie alors le résultat du parseur local, avec un simple `console.warn`.
- Or le parseur local est justement celui qui « fabrique des effectifs à partir des cotes » (`PLAN_remise-a-plat.md:11-14`).
- Côté régisseur, la pièce importée paraît normale alors qu'elle est fausse. Le mobilier est même calculé dans la foulée (`App.jsx:1888`).

**S8. Des pages de plan sont perdues sans avertissement.** [PREUVE] Haute.
- `handleAddPlan` sur un PDF n'ajoute que **la page 1** (`App.jsx:1923-1925`, `planDataUrl` au lieu de `planDataUrls`).
- Le serveur coupe à **8 pages** sans prévenir (`api/extract-ai.js:41`). Il ignore aussi sans prévenir les images de plus de 12 Mo en base64 (`:46`) ou au format non JPEG/PNG/WebP (`:45`).
- Le client rend **toutes** les pages à l'échelle 2 en JPEG 0,85 (`pdfParser.js:203-224`), sans plafond. Cela pose un risque mémoire mobile et alourdit le corps de requête (voir S4).

### P1 : exactitude métier et robustesse

**S9. Aucune provenance, confiance ni abstention structurée dans la réponse IA.** [PREUVE]
- Le schéma de sortie (`extract-ai.js:96-111`, liste blanche `:178-195`) ne contient ni page source, ni extrait verbatim, ni zone, ni statut « à valider ».
- Les champs inconnus deviennent `""`, impossibles à distinguer d'un « vide confirmé ».
- `handleAiExtract` remplit les champs vides **sans relecture** (`App.jsx:2036-2082`). La fusion ne demande un choix qu'en cas de conflit.
- Les boutons « Garder » et « Ignorer » sont désactivés et ne font rien (`App.jsx:2302`, `:2359`).

**S10. La réponse JSON « réparée » est acceptée comme complète.** [PREUVE]
- `extract-ai.js:147-175` ferme les accolades d'une réponse tronquée. Le résultat partiel, par exemple des percussions coupées, est renvoyé avec un 200 et sans indicateur.

**S11. Le mobilier explicite n'est pas réellement lu.** [PREUVE] Contradiction avec la documentation.
- `STATE.md:32` affirme « mobilier explicite lu sur fiche ». Or le schéma de sortie n'a **pas de champ mobilier**. Le prompt dit « combine (effectif, percussions, mobilier) » (`extract-ai.js:114`), mais le serveur jette ce que le modèle renverrait.
- Le mobilier est toujours **calculé** par `calculateMobilier`.

**S12. `calculateMobilier` diverge du référentiel métier.** [PREUVE] À valider par Alexandre avant tout changement.

| Code (`src/utils.js`) | Référence (`docs/EXTRACTION_IA_REFERENCE.md`) |
|---|---|
| `:135-136` : un pupitre par **ligne** de bois ou cuivres (« 3 Flûtes » = 1 pupitre) | `:113` : harmonie = 1 pupitre **par musicien** |
| `:137` : un pupitre par pôle de percussion | `:115` : percussions = tablettes, pas de pupitres |
| `:146` : chaises hautes = CB + chef + percussions, codé en dur | `:122`, `:129-131` : dépend de l'orchestre, ne jamais supposer. Chaises percu et timbalier sur la page PERCU. |
| `:116-119` : chef seulement si `hasChef` | `:133-134` : une chaise haute chef toujours présente (répétition) |
| `:81` : stand qty = nombre de musiciens | `:136` : un stand par famille |

Défauts supplémentaires :
- `extractNumberFromItem` renvoie **1 par défaut** quand aucun nombre n'est trouvé (`utils.js:46-50`). Une quantité inconnue devient donc 1, au lieu de rester nulle et signalée.
- `cordesCounts.other = num` (`:72`) est une **affectation** : plusieurs cordes « autres » s'écrasent au lieu de s'additionner.
- « Violons 1 » en chiffres arabes tombe dans `other`.
- Harpes et claviers rangés dans `autres` ne reçoivent ni chaise, ni banquette, ni pupitre.

**S13. Aucune gestion des dimensions, unités, échelles ou coordonnées.** [PREUVE]
- Aucun code ne traite cotes, échelle ou unités (vérifié par grep sur `src/`).
- Les dimensions de la référence, en mm (`EXTRACTION_IA_REFERENCE.md:227-228`), ne sont pas exploitées.
- C'est conforme à l'exigence « pas de dimension inférée depuis les pixels », mais par absence de fonctionnalité, pas par garde-fou. Toute évolution devra imposer : valeur + unité + source (cote lue ou échelle lue), sinon `null`.

**S14. La synchro peut écraser silencieusement un concert entier.**
- [PREUVE] Fusion « dernier qui écrit gagne » au niveau du concert entier : `{...remote, ...local}` (`useStorage.js:82`). Deux appareils qui modifient le même concert : l'un écrase l'autre. Le serveur ne vérifie que les ids (`sync.js:73-98`). Vider les plans d'un concert reste donc possible.
- [PREUVE] Lecture puis écriture non atomiques côté serveur (`sync.js:142-162`), d'où une condition de concurrence entre deux appareils.
- [PREUVE] Une photo supprimée réapparaît, faute de marqueur de suppression (`useStorage.js:102-115`).
- [PREUVE] Une suppression faite sur l'appareil A ne se propage pas à B : B renvoie la liste complète.

**S15. L'historique de synchro grossit sans limite.** [PREUVE] Deux copies complètes par sauvegarde (`sync.js:150-151`), sans rétention. Coût et stockage Supabase à surveiller. Ne rien purger sans décision.

**S16. Aucun délai maximal sur les appels IA.** [PREUVE] Ni côté client (`pdfParser.js:1918`), ni sur l'appel DeepSeek (`extract-ai.js:133`) face au `maxDuration` de 60 s. Le message d'erreur amont est renvoyé tel quel au client (`:141`).

**S17. Un rollback mettra du temps à atteindre les téléphones.** [PREUVE]
- `public/sw.js:86-90` sert toujours `index.html` depuis le cache. Une nouvelle version, ou un retour arrière, n'est active qu'**à l'ouverture suivante** après installation du nouveau service worker.
- Conséquence pour cette nuit : prévoir 2 ouvertures avec réseau sur chaque appareil, matin compris.

**S18. Le sidecar OMR est exposé sur le réseau local.** [PREUVE] Moyenne, hors prod.
- `scripts/omr-sidecar.mjs:34` (`Access-Control-Allow-Origin: *`) et `:257` (écoute sur `0.0.0.0`), sans authentification. N'importe quelle page web ouverte sur le réseau local peut lancer Audiveris.
- En prod HTTPS, l'appel client vers `hostname:8766` (`pdfParser.js:1947`) ne peut pas fonctionner.

**S19. Tesseract dépend probablement d'un CDN.** [HYPOTHÈSE]
- `pdfParser.js:1438-1445` : `createWorker("fra+eng")` télécharge probablement les données de langue depuis un CDN externe (comportement par défaut, à vérifier).
- Effets : échec hors ligne, appel réseau tiers.

**S20. Problèmes de documentation et d'hygiène.**
- **Lien AGENTS.md cassé, cause trouvée** : `CLAUDE.md` est dans `.gitignore:8`. Le fichier existe sur les machines de dev mais jamais dans le dépôt.
- `INDEX.md:9` mentionne encore xAI Grok, et `:35` une « clé Gemini ».
- `vite.config.js:62` injecte encore `GOOGLE_API_KEY`. Le serveur de dev Vite n'expose pas `/api/sync` ni `/api/recovery-dump` (`vite.config.js:52-58`) : la synchro ne se teste pas en local avec `npm run dev`.
- `XAI_API_KEY` est toujours dans Vercel sans être lue. Je recommande de la révoquer ; la décision appartient à Alexandre.
- `.claude/hooks/session_start.sh:9-12` interpole `INDEX.md` dans un heredoc Python : un `"""` dans INDEX casse le hook.

**Points positifs vérifiés** :
- Suppression ciblée en local et sur le serveur (`useStorage.js:466-485`, `sync.js:73-98`).
- File d'attente persistante avec révision (`useStorage.js:165-275`).
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax`, et `AUTH_SECRET` obligatoire en prod (`auth-utils.js:31-37`, `:73-76`).
- Liste blanche des champs IA côté serveur, et consigne anti-injection dans le prompt (`extract-ai.js:58`).
- `/api/*` jamais mis en cache par le service worker.
- pdfjs `^4.10.38`, donc postérieur au correctif CVE-2024-4367, à confirmer dans `package-lock.json`.
- Aucun secret trouvé dans le dépôt (grep).

---

## 3. Modèles IA : implémentation réelle

| Moteur | Où | État réel |
|---|---|---|
| **DeepSeek** | `api/extract-ai.js:117-137` | `model: "deepseek-flash"`, `thinking: {type:"disabled"}`, `temperature 0.1`, `max_tokens 16384`, pas de `response_format`. La légende (`nomenclature-legend.js`, base64) est envoyée en image 1, puis jusqu'à 8 pages. |
| Grok | plus dans le code | Clé `XAI_API_KEY` encore dans Vercel (`STATE.md:30`) |
| Gemini | `main` (`repo/api/extract-ai.js`), `docs/prompts-v2-draft/test-gemini-plan.js`, `vite.config.js:62` | Mort sur la branche, **vivant sur `main`** (voir §1) |

**À vérifier dans la documentation officielle DeepSeek**, sans rien supposer :
- existence et nom exact du modèle `deepseek-flash` ;
- support de la vision et du format `image_url` en data URI ;
- paramètre `thinking` ;
- tarifs, quotas et limites de taille d'image ;
- cache de préfixe : prompt + légende identiques pourraient en bénéficier ;
- conservation des données et juridiction.

Les plans contiennent des **noms de musiciens**. Leur envoi à un fournisseur tiers demande une validation d'Alexandre et, le cas échéant, de l'employeur (Radio France / Aix). C'est une décision RGPD et de confidentialité, pas technique.

Les prix de `BENCHMARK_IA_ENGINES.md:16-31` ne sont **pas vérifiés** et ne doivent pas servir de base de décision. Le plafond « < 5 €/mois » (`:90`) est un objectif, pas une mesure.

**Abonnements et application publique** : les abonnements CLI (Claude Code, Codex, etc.) ne couvrent pas les appels d'une fonction Vercel publique. Il faut une clé API facturée à l'usage, dédiée à l'app. Je ne recommande pas de broker privé adossé à des abonnements personnels : conditions d'utilisation, disponibilité, et couplage avec une machine privée.

**Coûts** : aucun cache des résultats. Chaque « Extraire par IA » renvoie la légende et toutes les pages. Aucune limite d'appels par utilisateur au-delà de la session.

---

## 4. Plan P0 pour cette nuit : livrable et réversible, sans refonte

**Règles de nuit**
- Aucun push sur `main`.
- Branche `hotfix/p0-2026-11-16` créée **depuis le SHA de prod établi en §1**. Si la prod est `ea95c5b` et non `07f3f56`, demander à Alexandre si la bascule DeepSeek part demain : c'est une décision, pas un détail.
- Déploiement **preview uniquement**. La promotion en prod se fait le matin, sur feu vert humain.
- Aucune migration destructive. Aucune purge de l'historique.

### Lot 0 : établir la baseline et poser les filets (30-45 min, avant tout le reste)
- §1 points 1 à 5, en lecture seule.
- Noter l'ID du déploiement de rollback.
- Snapshot Supabase en lecture : export de `orkmap_user_data` par l'opérateur autorisé, stocké hors dépôt.

### Lot A : synchro sûre
**Propriétaire** : `src/useStorage.js` seul. Il livre des fonctions exportées ; il **ne touche pas `App.jsx`**.
- **A0** : `exportLocalDataToFile()`. Téléchargement local d'un JSON (`exportLocalDataForRecovery`, sans aucun upload).
- **A1** : `reloadConcertsFromAccountSafe(remote)`. La version serveur gagne pour les ids présents sur le serveur ; **les concerts locaux absents du serveur sont conservés** ; aucun `removedIds` ; export A0 proposé avant.
- **A2** : dans le `catch` de chargement (`:540-554`), passer en **mode dégradé**. Pas de `markPending`, `getPayload` renvoie `null` tant qu'IndexedDB n'a pas été lu correctement. Délai porté à 15 s, ou nouvel essai.
- **A3** : avant `saveRemote`, mesurer la taille. Au-delà d'un seuil configurable (4 Mo par défaut, à confirmer contre la doc Vercel), ne pas envoyer, garder la file, et exposer un état `tooLarge` pour le bandeau.
- **A4** : exposer `lastError` (413, 500, 401) dans `useSyncStatus`.

### Lot B : sécurité serveur
**Propriétaire** : `api/auth-utils.js`, `api/request-code.js`, `api/verify-code.js`, `api/recovery-dump.js`, `supabase/migrations/004_*.sql`.
- **B1** : `recovery-dump` exige `requireSession` et `email === session.email`. En option, un drapeau env `RECOVERY_DUMP_ENABLED` (désactivé par défaut).
- **B2** : migration additive `004`.
  - `enable row level security` sur `orkmap_sync_history` et `orkmap_recovery_dumps`.
  - Table `orkmap_login_challenges (id, email, code_hash, attempts, expires_at, used_at)`.
- **B3** : le compteur de tentatives passe côté serveur. Le cookie ne porte plus que l'id du challenge, et un code est à usage unique. Limite `request-code` : 1/min et 5/h par adresse.
  - **Repli** si B3 ne passe pas les tests : ne livrer que B1 + RLS, et noter le risque résiduel.
- **B4 (optionnel, si le temps le permet)** : `sync.js` en écriture conditionnelle. `PATCH ... &updated_at=eq.<lu>`. Si 0 ligne n'est modifiée, renvoyer 409. Le chemin 409 et la fusion existent déjà côté client (`useStorage.js:259-272`), le contrat est inchangé.

### Lot C : exactitude IA, échec honnête
**Propriétaire** : `api/extract-ai.js`, `src/pdfParser.js:1912-1944`, et **seul propriétaire de `src/App.jsx`**. Il intègre aussi les appels A0 et A1.
- **C1** : `enrichWithAi`. En cas d'échec, message visible : « Lecture IA échouée (<raison>). Données = lecture locale, **à vérifier** ». Champ `aiStatus: "failed"` sur la pièce.
- **C2** : réponse serveur **augmentée, sans casser l'existant**.
  - Ajout de `meta: { model, pagesReceived, pagesAnalysed, skipped:[{index,reason}], truncated, repaired, at }`.
  - Le client avertit si `pagesAnalysed < pagesReceived` ou si `repaired`.
- **C3** : `handleAddPlan`, PDF : ajouter `data.planDataUrls` (toutes les pages).
- **C4** : délais maximaux. `AbortController` à 55 s côté serveur, 70 s côté client, avec un message clair.
- **C5** : marquage « À valider (IA) ».
  - Toute pièce créée ou remplie par l'IA reçoit `review: { source: "ai", model, at, validated: false }` et un badge visible.
  - La validation est un geste humain explicite.
  - Le mobilier calculé depuis une lecture IA porte le même badge.
- **C6** : brancher « Garder » et « Ignorer » (`App.jsx:2302`, `:2359`), ou les retirer.
- **Hors nuit** (P1) : modifier le prompt ou le schéma pour des sources par champ. Un changement de prompt modifie l'exactitude et doit passer l'A/B sur le corpus.

### Lot D : documentation
**Propriétaire** : fichiers `.md` seulement, sans conflit avec les autres lots.
- `AGENTS.md` pointe vers `INDEX.md`, ou on commite un `CLAUDE.md` sans secret (décision d'Alexandre).
- Corriger STATE §Dernier déploiement et INDEX (Grok, Gemini).
- Lister les divergences de mobilier (S12) **pour validation par Alexandre**, sans modifier le code.

### Ordonnancement et parallélisme
- **T0** : Lot 0, séquentiel, bloquant.
- **T0 + 45 min** : lots A, B, C et D **en parallèle**. Propriétaires de fichiers disjoints ; `App.jsx` appartient au seul propriétaire de C.
- **Contrats figés** :
  - `/api/sync` inchangé, sauf 409 supplémentaires via B4.
  - `/api/extract-ai` additif (`meta`).
  - Signatures exportées de A définies avant de commencer :
    - `exportLocalDataToFile(): Promise<void>`
    - `reloadConcertsFromAccountSafe(): Promise<{kept:number, updated:number}>`
    - `useSyncStatus()` → `{online, pending, sessionExpired, lastError, tooLarge}`
- **Intégration** : A, puis B, puis C, avec `npm run build` et `node --check api/*.js` à chaque étape. Déploiement preview.

### Tests à exécuter par l'orchestrateur (non exécutés ici)

**A**
- Concert créé hors ligne, puis « Recharger » : il est **conservé**.
- Payload de plus de 4 Mo : pas d'envoi, bandeau `tooLarge`, rien de perdu.
- Ouverture d'IndexedDB ralentie artificiellement : aucun envoi pendant le mode dégradé.
- Rejouer le scénario Puppeteer de 21 contrôles (`STATE.md:7`). Identifier le script exact : les `verify_*.cjs` à la racine sont à vérifier.

**B**
- Rejeu du même cookie challenge au-delà de 5 essais : refus.
- `recovery-dump` sans session : 401.
- 2e `request-code` en moins d'une minute : 429.
- Login normal d'Alexandre OK.
- Lecture de `sync_history` avec la clé anon : refus.

**C**
- PDF de 10 pages : avertissement « 8/10 analysées ».
- `DEEPSEEK_API_KEY` absente en preview : message d'échec visible, import marqué `failed`.
- Ajout d'un PDF de 3 pages : 3 plans.

**Corpus réel**
- Uniquement les plans réels autorisés, **déclenchement manuel, aucun upload automatique**.
- L'envoi à DeepSeek **est** un upload à un tiers : accord explicite d'Alexandre et nombre d'appels plafonné.

### Critères d'acceptation
- Zéro diminution du nombre de concerts, local et serveur, sur tous les scénarios.
- Aucune régression hors ligne.
- Toute lecture IA est visiblement « à valider » ou « échouée ».
- Aucune page ignorée sans message.

### Rollback
- Client : promotion du déploiement noté au Lot 0. **Prévenir qu'il faut 2 ouvertures avec réseau par appareil** (S17).
- Migration `004` : additive. Retour arrière = `disable row level security` et suppression de la table des challenges. Aucune donnée existante n'est modifiée.
- Drapeaux d'env pour couper B1/B3 sans redéployer le client.

### Point de contrôle du matin (avant 8 h)
1. Preview validée par les tests → **décision humaine** de promotion.
2. Sur chaque appareil (Fairphone/Brave, iPhone) : export A0 **d'abord**, puis ouvrir deux fois avec réseau.
3. Compter les concerts avant et après, et vérifier que les marques `pending` se vident.
4. Une lecture IA sur un plan connu : badge « à valider » présent.
5. Si un point échoue : rollback immédiat.

### Mode dégradé humain (si l'IA ou la synchro sont indisponibles demain)
- **Saisie manuelle** depuis le PDF original, qui reste la référence.
- Contrôler à la main : ligne effectif du cartouche, nombre de timbaliers et de percussionnistes, mobilier.
- **Ne pas utiliser « Recharger depuis le compte » tant que A1 n'est pas en prod.**
- Faire un export A0 à la fin de chaque journée.
- Pour les concerts : travailler sur un seul appareil tant que S14 n'est pas traité.

---

## 5. P1 : architecture à long terme (ni promise ni lancée cette nuit)

1. **Stockage des médias hors du JSON** : plans et photos dans Supabase Storage, un objet par fichier avec hash. Les concerts ne référencent plus que les ids. Cela règle S4 et S15.
2. **Synchro par enregistrement** :
   - `updatedAt` par concert et par pièce ;
   - marqueurs de suppression ;
   - fusion au niveau du champ ou présentation des conflits ;
   - écritures conditionnelles côté serveur.
3. **Schéma d'extraction avec provenance**. Pour chaque champ :
   - `value | null` ;
   - `status: read | inferred | unknown` ;
   - `source: {fileId, page, bbox?, quote}`, cliquable vers la page et la zone ;
   - `modelConfidence`, explicitement **non calibrée** et jamais affichée comme une probabilité ;
   - `validatedBy/At`.
   Abstention obligatoire plutôt que valeur par défaut. Unités explicites. **Interdiction de convertir des pixels en mètres sans échelle ou cote lue.**
4. **Moteur de mobilier par profil d'orchestre** (Radio France, Aix, etc.), à partir de `LOOKUP_MOBILIER.json` et des règles validées par Alexandre, avec des tests de référence par profil. Mobilier explicitement lu sur la fiche, avec priorité sur le calcul.
5. **Chemin vectoriel ou scan** : PDF vectoriel = texte et positions pdf.js, rotation incluse, avec provenance exacte. Scan = vision. Multi-PDF par pièce.
6. **Cache des extractions** par `sha256(pages) + promptVersion + model`. Plafond d'appels par compte. Traces de coût.
7. **Jeu d'évaluation** à partir du corpus autorisé : vérité terrain saisie par Alexandre, métriques par champ, A/B obligatoire à tout changement de modèle ou de prompt.
8. **Unification Git et Vercel** : une branche de prod unique, déploiement depuis Git uniquement (plus de CLI depuis un répertoire non commité), retrait des déploiements de `main` obsolètes.

---

## 6. Prompt de transmission à l'équipe de dev de nuit

```
Contexte : OrkMap (PWA React/Vite, Vercel, Supabase, IndexedDB), outil de régie d'orchestre en usage réel demain matin. Exactitude métier et préservation des données priment sur tout.

INTERDITS : push sur main ; promotion en prod sans feu vert humain ; migration destructive ; purge de orkmap_sync_history ; modification du prompt IA ; upload automatique de documents ; lecture de .env ; refonte.

ÉTAPE 0 (bloquante) : établir le SHA/ID du déploiement prod actuel (Vercel), la Production Branch, les NOMS des variables d'env, les déploiements encore joignables (main inclus : son /api/extract-ai est public). Créer hotfix/p0-2026-11-16 depuis le SHA prod. Noter l'ID de rollback.

LOTS PARALLÈLES (propriétaires de fichiers exclusifs) :
- A (src/useStorage.js uniquement) : exportLocalDataToFile ; reloadConcertsFromAccountSafe (garde les concerts locaux absents du serveur, aucun removedIds) ; mode dégradé si chargement IndexedDB en échec (aucun envoi) ; garde de taille avant envoi (tooLarge) ; lastError dans useSyncStatus.
- B (api/auth-utils, request-code, verify-code, recovery-dump, migration 004 additive) : session obligatoire sur recovery-dump ; RLS sur sync_history et recovery_dumps ; challenge OTP stocké côté serveur, usage unique, tentatives comptées côté serveur ; limite request-code. Optionnel : écriture conditionnelle sur updated_at dans sync.js (409).
- C (api/extract-ai.js, pdfParser.js extractWithGemini, SEUL propriétaire de src/App.jsx) : échec IA visible + aiStatus ; meta additive {model,pagesReceived,pagesAnalysed,skipped,truncated,repaired} ; handleAddPlan ajoute toutes les pages ; délais maximaux 55 s/70 s ; badge "À valider (IA)" sur les données IA et le mobilier qui en dérive ; brancher le bouton "Recharger" sur A ; ajouter un bouton d'export local.
- D (.md seulement) : AGENTS.md → INDEX.md ; corriger STATE/INDEX ; liste des divergences mobilier (utils.js:72,81,135-146 vs EXTRACTION_IA_REFERENCE.md:113-136) POUR VALIDATION par Alexandre, sans changement de code.

CONTRATS : /api/sync inchangé (409 en plus possible) ; /api/extract-ai additif uniquement ; signatures A figées avant de commencer.

TESTS (preview uniquement) : npm run build ; node --check api/*.js ; scénario hors ligne Puppeteer existant ; concert hors ligne + Recharger = conservé ; payload > 4 Mo = non envoyé, rien perdu ; rejeu OTP > 5 = refus ; recovery-dump sans session = 401 ; PDF 10 pages = alerte 8/10 ; clé IA absente = échec visible. Corpus réel : déclenchement manuel, accord d'Alexandre, nombre d'appels plafonné.

ACCEPTATION : aucune baisse du nombre de concerts (local et serveur) ; hors ligne intact ; toute donnée IA marquée à valider ou en échec ; aucune page ignorée en silence.
ROLLBACK : promotion du déploiement noté ; drapeaux d'env ; migration 004 réversible. Prévenir : le service worker impose 2 ouvertures avec réseau par appareil.

LIVRABLE MATIN : rapport avec SHA preview, résultats réels des tests (échecs inclus), points non faits, checklist appareil (export avant, ouverture x2, compte des concerts avant/après).

À VÉRIFIER DANS LES SOURCES OFFICIELLES (ne rien supposer) : limite de corps de requête des fonctions Vercel ; nom, vision, paramètre thinking, prix et conservation des données de DeepSeek "deepseek-flash" ; comportement CDN de tesseract.js ; droits par défaut de la clé anon Supabase sur public.
```
