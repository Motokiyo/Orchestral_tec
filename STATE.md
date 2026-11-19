# STATE.md — OrkMap

> Snapshot projet. Mis à jour : 2026-11-17 (soir), fin du chantier de fiabilisation (lots 1 à 8).

## Reprise (lire d'abord)

- **Tout est en production** depuis le 17/11/2026 au soir : commit `99f13d4`, branche `feature/omr-family-access` (poussée), copie de travail `~/Territoire/worktrees/orkmap-chantier` (branche locale `chantier/fiabilite`, identique).
- **Déploiement** : `vercel deploy --prod --yes --scope team_d0VlvUm56NR9QnALHLRCqasl` depuis le worktree (`.vercel/project.json` copié depuis le dossier d'origine, `.vercelignore` exclut la page d'essai, les audits et les tests). **Jamais par un push sur `main`** : `main` = `6dc9123`, très ancien ; Vercel déploie `main` en production, un push y remettrait une vieille version.
- **Retour arrière** : la base locale des téléphones est passée en version 5 (magasin `images`, lot 6). Une version d'avant `5a7c892` ne peut plus l'ouvrir (VersionError). Ne jamais promouvoir un déploiement antérieur à `5a7c892` ; corriger en avançant.
- **Le dossier d'origine** (`1 Projets/Orchestral-tec`, dans le vault) est resté à `e6892c8` avec des modifications non commitées qui ne sont pas de cette session (INDEX.md, README.md, docs/EXTRACTION_IA_REFERENCE.md, docs/PLAN_remise-a-plat.md, test-infra/CHANGELOG.md). Ne pas l'écraser : demander à Alexandre avant de le resynchroniser (`git pull` de `feature/omr-family-access`).
- **Prochaine action** : retours d'Alexandre sur son téléphone (ouverture plus rapide, bouton « Partager » du dossier pour la salle, jamais testé sur un vrai téléphone). Puis, au choix d'Alexandre : écran « À vérifier » après import, photos rangées pièce par pièce, prévention de la pause Supabase, découpage d'`App.jsx`.

## Lot 9 (19/11/2026, retours du plateau du 18/11) : EN LIGNE le 19/11 (orkmap.eiffelai.io, `index-DqIznqO4.js`, commit `e5c8c09`, accord d'Alexandre)

- Commits `1439201` à `HEAD` sur `chantier/fiabilite`. 416 tests, build, essai Playwright 412x915 sur le vrai concert « atelier de compo Nov 2026 » (réseau coupé), relecture hostile Sonnet faite et corrigée.
- 9a : cartouche CNSM sur deux lignes décodé (`Pno[Prép] - Sax[S+Bar] - Ondes - Acc - Cordes[…] - soit 23 mus`) ; consigne IA : recopier les deux lignes, ondes/piano/harpe jamais en percussion. Cas réel : « Quand ma langue aura fondu » sortait en cuivres 0.1.1.1 et 2 timbaliers inventés.
- 9b : alertes de synchro en pastille ronde (coin bas droit, cachée pendant la caméra) ; remarques de lecture IA en accordéon replié. Le message gênant devant le déclencheur était « Mémoire du téléphone lente » (mode dégradé : IndexedDB > 4 s à l'ouverture, rien n'est envoyé au compte). La sauvegarde en ligne s'arrête au 18/11 15 h 07.
- 9c : volet par instrument (`src/percuEdit.js`, `src/PercuItemSheet.jsx`) : poste, catégorie, support (pied, grande ou petite tablette), vers « Autres » et retour (« → percu ») ; ⇄ échange les postes (noms et place, photos suivent) ; supports tout prêts ; résumé « À prévoir ». Les supports ne sont PAS encore comptés dans le mobilier.
- 9d : « Importer des plans » accepte plusieurs fichiers (une pièce par fichier, ordre des noms).
- 9e : support attaché d'office à l'instrument (`SUPPORTS_OBLIGES` dans `src/utils.js` : cymbale suspendue → pied de cymbale, caisse claire, glock valise, cymbales frappées, grosse caisse, tam-tam/gong → cadre, temple-blocks, bongos/congas, toms, mark tree), il suit l'instrument, retirable (support « aucun »), pas de support si le nom dit « posé sur / sur … ». « À prévoir » compte les supports par nom. Noms anglais remis en français à l'import (`franciserNom`) + consigne IA.
- Non poussé sur GitHub : SSH vers github.com refusé le 19/11 depuis le Mac (port 22). Pousser `chantier/fiabilite` vers `feature/omr-family-access` quand le réseau le permet.
- Restes connus : un instrument envoyé vers « Autres » perd notes et support (la liste « Autres » ne garde que du texte) ; un instrument « sur pied » plus un « Pied de … » ajouté comptent 2 pieds.

## P0 ouverts

- **Supabase gratuit mis en PAUSE après inactivité** : trouvé `INACTIVE` le 17/11/2026 (la synchro échouait en silence depuis des semaines), réveillé par l'API de gestion (`POST /v1/projects/yxkktarojpnktsfrvjhb/restore`). Peut se reproduire. Décision à prendre avec Alexandre (passage payant, ou appel régulier qui garde le projet actif).
- **Bouton « Partager »** du dossier pour la salle : `navigator.canShare({files})` jamais essayé sur Android réel.

## Téléphone d'Alexandre

- **Android** : Fairphone, navigateur Brave (incident du 17/06), app installée sur l'écran d'accueil. Pas d'iPhone. Tester en Chromium 412x915.

## Chantier de fiabilisation du 17/11/2026 (tout en ligne)

- Audits et plan : `docs/audit/` (UX, fond, technique, Aristote, règles du lot 4).
- Lot 1 / 1b / 3 : données protégées (rechargement non destructif, copie de sécurité, export local, garde de taille), connexion par code à usage unique côté serveur (migrations 004, 006), RLS sur l'historique et les dumps (005).
- Lot 2 : l'app n'invente plus (plus de « 4 timbales », quantité inconnue = « ? », chef à trois états, échec IA visible) ; décodeur Daniels/LSO juste sur 21 lignes réelles.
- Lot 4 : mobilier selon les règles du régisseur (DECISIONS du 17/11) ; effectif en ordre Daniels cordes à la fin ; DeepSeek recopie le cartouche (`cartoucheBrut`), notre décodeur décode ; réglages du mobilier par pièce ou concert (stand pour deux, R&S/Kolberg, chef) ; écarts plan / calcul ; ajout d'un plan de percussions à une pièce.
- Lot 5 : images des plans envoyées une par une (`api/plan-image.js`, table `orkmap_plan_images`, migration 007) ; concerts envoyés légers. Sauvegarde du régisseur vérifiée le 17/11 : 6 concerts, 9 pièces, 15 plans, aucun manquant (la sauvegarde en ligne était bloquée depuis le 17/06 : 20,4 Mo dans un seul envoi, limite Vercel 4,5 Mo).
- Lot 6 : images rangées à part sur le téléphone (magasin IndexedDB `images`, `PlanImage`), écritures sérialisées, une seule connexion IndexedDB avec message « Ferme les autres fenêtres OrkMap ».
- Pastilles : plus aucune pastille permanente (photos gardées sur le téléphone, copie de secours, plans non sauvegardés) : l'info est sous « Exporter toutes mes données » ; les encarts se replient et se ferment.
- Lots 7 et 8 : « Enregistrer mes photos dans Téléchargements » ; « Préparer le dossier pour la salle » (zip ; fiche du concert = sommaire + une page par œuvre sans total ; fiches PDF et TXT ; signets PDF, métadonnées, `00_Sommaire.json`).
- Vérifications à chaque mise en ligne : 403 tests `node --test tests/*.mjs` (le glob est nécessaire sous Node 24), build, essai hors ligne Playwright (concert + note + plan affichés réseau coupé), relecture hostile par un agent séparé pour tout ce qui touche aux données (lots 4, 5, 6).

## Pi-Only

- (aucun — app web PWA, pas de contrainte Raspberry Pi)

## Environnement

- Racine du vault : `/Users/alexandre/Territoire/Galaad-Motokiyo-Ferran`. Helper daily log : `_scripts/log_event.sh`.
- Supabase : SQL par l'API de gestion avec le jeton de la CLI rangé dans le trousseau (« Supabase CLI ») ; jamais afficher le jeton.
- Clé DeepSeek : présente dans l'environnement du shell de la session et dans Vercel (production + preview) ; `vercel env pull` ne la rend pas (variable sensible). Le `.env.local` du dossier d'origine ne la contient pas.

## Reconnaissance de documents

- **Moteur = DeepSeek `deepseek-flash`** = DeepSeek V4.1 Flash révision 1017 au 17/11/2026 (alias qui suit la dernière version Flash), raisonnement désactivé. Bonne copie du cartouche, mauvais décodage : l'effectif retenu vient de la couche texte du PDF, puis du décodage local de `cartoucheBrut`, puis seulement de l'IA (avec avertissement). Timbales lues sur le dessin = « à vérifier ».
- Consignes IA sans exemples chiffrés (un exemple « 1.3.2.1 » était recopié tel quel).

## Backend données

- Supabase `orkmap`, ref `yxkktarojpnktsfrvjhb`, `eu-west-1`. Tables : `orkmap_user_data` (concerts sans images), `orkmap_sync_history`, `orkmap_recovery_dumps`, `orkmap_login_challenges`, `orkmap_plan_images`. RLS activée partout, accès par la clé serveur seulement. Migrations appliquées : 001 à 007.
- `/api/sync` refuse une sauvegarde destructive (409) ; suppressions chirurgicales.

## Problèmes connus

- Photos : un seul enregistrement par compte, lu en entier à l'ouverture, jamais copié en ligne (choix : elles restent sur le téléphone ; export ou bouton Téléchargements).
- Fusion à priorité LOCAL : bouton « Recharger depuis le compte » pour faire primer le serveur.
- OMR Audiveris : sidecar local, Vercel ne le lance pas.
- Défauts antérieurs non traités : fermeture pendant l'écriture côté photos, deux onglets (consigne : une seule fenêtre OrkMap à la fois).
