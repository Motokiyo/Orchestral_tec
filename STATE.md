# STATE.md — OrkMap

> Snapshot projet. Mis à jour : 2026-06-17

## P0 ouverts

- **Confirmer en vrai dans l'app** (connecté `alexferran@gmail.com`) : la reconnaissance xAI Grok sur un plan réel, le bouton « Recharger depuis le compte », le tri/recherche, et que les photos ne débordent plus entre concerts.
- Vérifier depuis les appareils réels que la synchro fusionne `concerts`, `photos`, `omr-scores` sans suppression (la fusion donne priorité au LOCAL : une correction serveur peut être masquée par un local périmé → utiliser le bouton « Recharger depuis le compte »).
- (Optionnel demandé) rendre général la **lecture du mobilier explicite** écrit sur les fiches (chaises/pupitres/podium) au lieu de le déduire de l'effectif.

## Incident perte de données (2026-06-17) — clos

- 3 mois de concerts (CNSM/EIC/Radio France), corrigés à la main, **perdus** : l'arrivée des comptes (jonction email) a écrasé la base locale dans **Brave sur Fairphone (Android)** par le concert démo, et ces concerts n'avaient jamais été synchronisés intacts sur le serveur. Aucune sauvegarde (pas de Time Machine, pas de backup tél). **Irrécupérables** (vérifié : Mac, serveur Supabase, et la mémoire Brave du tél via adb/CDP ne contenaient que le démo).
- Cause technique : `saveLocal` supprimait tout enregistrement absent de la nouvelle liste → corrigé (suppression chirurgicale, voir DECISIONS 2026-06-17).
- Récupération partielle : ~5 concerts **recréés depuis les plans** (xAI Grok) et écrits sur le compte `alexferran@gmail.com` (OLC session 20, Master Percussion CNSM 2026, Récital Hajime & Chung En, Consort Les Lucioles, La Femme sans ombre). Photos non récupérées (perdues avec les concerts).

## Pi-Only

- (aucun — app web PWA, pas de contrainte Raspberry Pi)

## Environnement

- Racine actuelle du territoire/vault : `/Users/alexandre/Territoire/Galaad-Motokiyo-Ferran`.
- Helper daily log : `/Users/alexandre/Territoire/Galaad-Motokiyo-Ferran/_scripts/log_event.sh`.
- Ne plus utiliser l'ancien chemin `/Users/alexandre/Galaad-Motokiyo-Ferran`.

## Reconnaissance de documents (refonte 2026-06-17)

- **Moteur = xAI Grok** (`grok-4.20-0309-non-reasoning`), endpoint `https://api.x.ai/v1/chat/completions`, format OpenAI `image_url`, clé **dédiée** `XAI_API_KEY` (suivi de dépense séparé, dans Vercel + coffre `api-keys/xai-orkmap.env`).
- **DeepSeek écarté** : l'API officielle `api.deepseek.com` (standard ET `/beta`) refuse toute image → text-only en pratique. Vérifié.
- `/api/extract-ai` envoie : (1) la **légende visuelle d'Alexandre** embarquée (`api/nomenclature-legend.js`, base64) en image 1, puis (2) **toutes les pages** du document. Le client (`enrichWithAi`) rend l'IA **autorité pour les plans/photos** ; le parser texte local ne sert que pour les listes texte propres.
- Capacités vérifiées sur 7+ plans réels : cartouche + effectif, percussion poste par poste (timbales/grosse caisse/cymbales lus sur le dessin), claviers non étiquetés (par forme), `sansChef` (pas de chef → pas de podium/pupitre/chaise haute), ensemble homogène déduit (consort → « 7 violes de gambe »), mobilier explicite lu sur fiche (« 7 chaises + 7 pupitres bas »).

## Dernier déploiement

- **Déclenché** : 2026-06-17 (Vercel CLI production, alias `orkmap.eiffelai.io`)
- **Branche** : `feature/omr-family-access`
- **Commit** : `13ff48e` (chaîne du jour, voir DECISIONS 2026-06-17)
- **Contenu** : moteur xAI Grok + légende embarquée + multi-pages + sansChef ; suppression chirurgicale (anti-perte) ; photos cloisonnées par concert (dé-dup ids + galerie scopée) ; tri par date + recherche ; bouton « Recharger depuis le compte ».
- **Vérifié** : build Vite OK, `node --check` OK sur les fonctions API, prod HTTP 200, `/api/sync` et `/api/extract-ai` présents (401 sans session), test bout-en-bout xAI sur les plans réels.

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

- **Fusion synchro à priorité LOCAL** (`mergeConcerts` : `{...remote, ...local}`) : un appareil avec un local périmé masque les corrections serveur. Contournement : bouton « Recharger depuis le compte » (remplace local par serveur via removedIds ; photos non touchées). À terme, envisager une fusion par horodatage.
- OMR Audiveris reste une architecture sidecar/local : Vercel ne lance pas Audiveris.
- `npm test` n'existe pas ; vérification par `npm run build`, `node --check` (API) et tests xAI directs.
- Les payloads images/plans (et la légende embarquée + multi-pages) peuvent être lourds : ne pas baisser les limites d'API sans test réel.
- Recréation depuis plans : reste 2 bricoles éditables à la main (résidu sur la ligne effectif brute OLC ; mobilier explicite des fiches pas encore lu en général).
