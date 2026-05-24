# DECISIONS.md — OrkMap

## VALIDÉ

- 2026-05-24 — Déploiement Vercel via auto-deploy GitHub (push sur main). Validation : git commit vide (`--allow-empty`) déclenche bien le build. Pas besoin de token Vercel CLI sur le serveur.

## ABANDONNÉ

- (aucun dans cette session)

## Notes

- Les 4 commits suivants étaient déjà sur `origin/main` sans avoir été déployés (HEAD local détaché sur af36d19) : parseur DCM Radio France, extraction texte libre + titre éditable, mobilier chef conditionnel + consort baroque, suppression création automatique percus depuis effectifDetail.
