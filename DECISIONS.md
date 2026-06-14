# DECISIONS.md — OrkMap

## VALIDÉ

- 2026-06-13 — OrkMap est l'application Eiffel unique accessible sur `https://orkmap.eiffelai.io`, avec deux accès applicatifs : concerts/régie et scores/OMR.
- 2026-06-13 — L'OMR doit utiliser un vrai moteur OMR (Audiveris côté sidecar/local) et non Gemini pour lire les partitions.
- 2026-06-13 — Authentification familiale par code email, limitée pour l'instant à `alexferran@gmail.com`, `larminaux.claire@gmail.com`, `galileo@leparede.org`.
- 2026-06-13 — Envoi des codes de connexion via Gmail OAuth en production Vercel. Le code fixe `790762` et `AUTH_FALLBACK_CODE` sont supprimés.
- 2026-06-14 — Les données OrkMap synchronisées par compte utilisent un projet Supabase séparé (`orkmap`, ref `yxkktarojpnktsfrvjhb`), distinct de Supabase TarotMarseille.
- 2026-06-14 — IndexedDB reste le cache local/offline ; Supabase OrkMap devient la couche de synchronisation pour `concerts`, `photos`, `omr-scores`.
- 2026-06-14 — Toute synchro OrkMap doit être non destructive : fusion locale+serveur, payload complet, historique serveur à chaque sauvegarde, refus serveur `409` si un appareil tente d'écraser des données existantes avec moins d'identifiants.
- 2026-06-14 — Les dumps de récupération utilisent une table séparée `orkmap_recovery_dumps` et ne doivent pas modifier `orkmap_user_data`.
- 2026-05-24 — Déploiement Vercel via auto-deploy GitHub (push sur main). Validation : git commit vide (`--allow-empty`) déclenche bien le build. Pas besoin de token Vercel CLI sur le serveur.

## ABANDONNÉ

- 2026-06-13 — Abandon de l'import/migration visible "Importer mes données Vercel" dans l'interface utilisateur.

## Notes

- Les 4 commits suivants étaient déjà sur `origin/main` sans avoir été déployés (HEAD local détaché sur af36d19) : parseur DCM Radio France, extraction texte libre + titre éditable, mobilier chef conditionnel + consort baroque, suppression création automatique percus depuis effectifDetail.
