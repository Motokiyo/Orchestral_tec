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
