# STATE.md — OrkMap

> Snapshot projet. Mis à jour : 2026-06-14

## P0 ouverts

- Vérifier depuis les appareils réels que la synchro durcie fusionne bien `concerts`, `photos`, `omr-scores` entre comptes/appareils sans suppression.
- Avant tout futur changement de stockage/synchro : créer un export JSON complet côté client + snapshot serveur, puis vérifier sur deux appareils.

## Pi-Only

- (aucun — app web PWA, pas de contrainte Raspberry Pi)

## Dernier déploiement

- **Déclenché** : 2026-06-14 (déploiement Vercel CLI production)
- **Mode** : Vercel CLI production, alias `orkmap.eiffelai.io`
- **Branche** : `feature/omr-family-access`
- **URL** : https://orkmap.eiffelai.io
- **Déploiement** : `dpl_Hfr5F437joqJ9grvDicLDUgB1NM2`
- **Commit** : `101659d Harden OrkMap sync persistence`
- **Contenu vérifié** :
  - Build Vite OK.
  - Alias production OK.
  - `/api/sync` protégé par session.
  - `node --check` OK sur `api/sync.js` et `api/recovery-dump.js`.
  - Table `orkmap_sync_history` vérifiée côté Supabase.

## Backend données

- **Supabase OrkMap séparé** : projet `orkmap`, ref `yxkktarojpnktsfrvjhb`, région `eu-west-1`.
- **Tables** :
  - `public.orkmap_user_data`, clé `(email, type)`, types `concerts`, `photos`, `omr-scores`.
  - `public.orkmap_sync_history`, historique de chaque sauvegarde entrante et de l'état précédent.
  - `public.orkmap_recovery_dumps`, dumps forensic applicatifs séparés.
- **Vercel production** : `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` configurés pour OrkMap, pas Tarot.
- **Coffre partagé serveur** : credentials OrkMap poussés dans `Galaad-credentials` (`502d625 Add OrkMap Supabase credentials`).
- **Cache local** : IndexedDB reste actif ; Supabase devient la couche de synchro par compte.
- **Règle de sécurité** : `/api/sync` refuse une sauvegarde destructive (`409`) si le payload entrant manque des ids/groupes déjà présents côté serveur.
- **Client** : `useStorage.js` fusionne local + serveur pour concerts, photos et partitions, et pousse les concerts avec médias/plans complets.

## Problèmes connus

- OMR Audiveris reste une architecture sidecar/local : Vercel ne lance pas Audiveris.
- `npm test` n'existe pas dans ce projet ; vérification actuelle par `npm run build` et tests API directs.
- Les payloads images/plans peuvent être lourds : ne pas baisser les limites d'API sans test réel sur photos/plans.
