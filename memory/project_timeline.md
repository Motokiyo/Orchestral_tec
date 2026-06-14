# project_timeline.md — OrkMap

> Chronologie des actions. +/- = avancée/recul.

## 2026-05-24

- **+** Wiki créé : `STATE.md`, `DECISIONS.md`, `memory/project_timeline.md`
- **+** INDEX.md mis à jour (date, nouveaux parseurs, liens wiki)
- **+** Déploiement Vercel déclenché : rattrapage des 4 commits (DCM Radio France, freeform parsing, mobilier chef conditionnel, correction percus)
- **+** `git pull` (fast-forward vers 77d110b) puis `git commit --allow-empty` + `git push origin main` pour trigger build Vercel

## 2026-06-13

- **+** Branche `feature/omr-family-access` utilisée pour ajouter le module scores/OMR et l'accès familial.
- **+** Domaine Infomaniak/Vercel configuré : `orkmap.eiffelai.io` pointe vers OrkMap.
- **+** Auth par code email limitée à trois adresses familiales ; envoi production via Gmail OAuth.
- **+** Code fixe de secours `790762` supprimé de Vercel et du code serveur.
- **+** Déploiement production vérifié : demande de code OK, ancien fallback refusé, email hors allowlist refusé, API IA protégée.
- **+** Commit poussé : `004d13d fix: send login codes with gmail`.

## 2026-06-14

- **+** Projet Supabase séparé créé pour OrkMap : `orkmap`, ref `yxkktarojpnktsfrvjhb`, région `eu-west-1`.
- **+** Migration appliquée : table `public.orkmap_user_data` pour synchroniser `concerts`, `photos`, `omr-scores` par email.
- **+** API `/api/sync` ajoutée et protégée par session OrkMap ; IndexedDB reste le cache local/offline.
- **+** Vercel production configuré avec `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` du projet OrkMap, pas Tarot.
- **+** Déploiement production `dpl_8ThXtvXxp3gobgMyY3ezk1pN13MM` aliasé sur `https://orkmap.eiffelai.io`.
- **+** Commit poussé : `e0162f2 Add account sync with dedicated OrkMap Supabase`.
- **+** Credentials OrkMap poussés dans le coffre partagé serveur `Galaad-credentials` : commit `502d625 Add OrkMap Supabase credentials`.
- **+** Synchro OrkMap durcie : `useStorage.js` réactive concerts/photos/OMR avec fusion locale+serveur, payload concerts complet, et `/api/sync` refuse les sauvegardes destructives (`409`).
- **+** Historique serveur ajouté : table `orkmap_sync_history` pour conserver les sauvegardes entrantes et l'état précédent.
- **+** Récupération séparée ajoutée : endpoint `/api/recovery-dump` + table `orkmap_recovery_dumps`, sans interaction avec `orkmap_user_data`.
- **+** Navigation ajoutée : bouton `Accueil` explicite dans `Mes concerts`; OrkScore revient au menu par la flèche.
- **+** Déploiement production `dpl_Hfr5F437joqJ9grvDicLDUgB1NM2`, commit poussé `101659d Harden OrkMap sync persistence`.
