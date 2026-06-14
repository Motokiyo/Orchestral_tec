# STATE.md — OrkMap

> Snapshot projet. Mis à jour : 2026-06-14

## P0 ouverts

- Vérifier depuis les appareils réels que la première synchro pousse bien les concerts/partitions existants vers Supabase OrkMap, puis qu'ils réapparaissent sur un autre appareil connecté au même email.

## Pi-Only

- (aucun — app web PWA, pas de contrainte Raspberry Pi)

## Dernier déploiement

- **Déclenché** : 2026-06-14 (déploiement Vercel CLI production)
- **Mode** : Vercel CLI production, alias `orkmap.eiffelai.io`
- **Branche** : `feature/omr-family-access`
- **URL** : https://orkmap.eiffelai.io
- **Déploiement** : `dpl_8ThXtvXxp3gobgMyY3ezk1pN13MM`
- **Contenu vérifié** :
  - Build Vite OK.
  - Alias production OK.
  - `/api/sync` protégé sans session.
  - Smoke test local OK sur Supabase OrkMap séparé (`yxkktarojpnktsfrvjhb`), ligne de test nettoyée.

## Backend données

- **Supabase OrkMap séparé** : projet `orkmap`, ref `yxkktarojpnktsfrvjhb`, région `eu-west-1`.
- **Table** : `public.orkmap_user_data`, clé `(email, type)`, types `concerts`, `photos`, `omr-scores`.
- **Vercel production** : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` configurés pour OrkMap, pas Tarot.
- **Cache local** : IndexedDB reste actif ; Supabase devient la source de synchro par compte.

## Problèmes connus

- OMR Audiveris reste une architecture sidecar/local : Vercel ne lance pas Audiveris.
- `npm test` n'existe pas dans ce projet ; vérification actuelle par `npm run build` et tests API directs.
