# STATE.md — OrkMap

> Snapshot projet. Mis à jour : 2026-06-13

## P0 ouverts

- (aucun signalé — app stable, déploiement automatique)

## Pi-Only

- (aucun — app web PWA, pas de contrainte Raspberry Pi)

## Dernier déploiement

- **Déclenché** : 2026-06-13 (commit `004d13d`)
- **Mode** : Vercel CLI production, alias `orkmap.eiffelai.io`
- **Branche** : `feature/omr-family-access`
- **URL** : https://orkmap.eiffelai.io
- **Déploiement** : `dpl_8S75XEnFM2RnCMbDb6WSLAgbSnZv`
- **Contenu vérifié** :
  - Auth par code email via Gmail OAuth.
  - Code fixe `790762` refusé.
  - Emails hors allowlist refusés.
  - `/api/extract-ai` protégé sans session.

## Problèmes connus

- OMR Audiveris reste une architecture sidecar/local : Vercel ne lance pas Audiveris.
- `npm test` n'existe pas dans ce projet ; vérification actuelle par `npm run build` et tests API directs.
