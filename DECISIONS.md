# DECISIONS.md — OrkMap

## VALIDÉ

- 2026-09-23 — **Usage hors ligne (concert sans réseau)**. (1) Le dernier compte connecté est mémorisé sur l'appareil (`orkmap-last-email`) : l'app s'ouvre sur les données locales sans attendre le serveur ; seul un « pas de session » explicite du serveur propose de se reconnecter, sans jamais bloquer l'accès aux données. Décision d'Alexandre : pas de données secrètes, le verrou du téléphone suffit. (2) Session serveur **glissante 90 jours**, renouvelée à chaque ouverture (`/api/session`). (3) **File d'attente persistante** (`orkmap-pending:<email>:<type>` en localStorage) : toute modification, suppressions comprises, est marquée puis renvoyée au retour du réseau (événement online, retour au premier plan, toutes les 60 s, après reconnexion) ; sur 409, fusion avec le serveur puis nouvel envoi. La marque n'est effacée qu'après acceptation par le serveur. (4) Suppressions appliquées tout de suite dans IndexedDB et sauvegarde forcée quand l'app passe en arrière-plan. (5) **Service worker** : précache de tout le build (liste injectée par le plugin `precacheServiceWorker` de `vite.config.js`), app servie depuis le cache immédiatement, `/api/*` jamais mis en cache, version courante + précédente conservées. (6) IA et OMR grisées ou refusées avec message hors ligne ; import de plan hors ligne = lecture locale seule.
- 2026-06-17 — **Moteur de reconnaissance de documents = xAI Grok** (`grok-4.20-0309-non-reasoning`, `api.x.ai/v1/chat/completions`, format OpenAI image_url, clé dédiée `XAI_API_KEY`). Remplace Google Gemini. Vérifié sur 7+ plans réels.
- 2026-06-17 — `/api/extract-ai` envoie la **légende visuelle d'Alexandre** embarquée (`api/nomenclature-legend.js`) en image 1 + **toutes les pages** du document. Côté client, l'IA est **autorité pour les plans/photos** ; le parser texte local ne sert que pour les listes texte propres (fin de la fabrication d'effectif à partir des chiffres du plan).
- 2026-06-17 — **Suppression chirurgicale** : `saveLocal`/`saveRemote` (concerts + omr-scores) ne suppriment QUE les ids explicitement retirés (`removedIds`, calculés prev→next), jamais « tout ce qui est absent ». Le garde-fou serveur `/api/sync` autorise exactement ces suppressions. Empêche l'effacement accidentel (cause de l'incident du jour).
- 2026-06-17 — **Photos cloisonnées par concert** : dé-duplication des ids de pièces au chargement (1er concert garde ses ids), et galerie/compteur photos scopés au concert courant (plus de `Object.values(photos).flat()`).
- 2026-06-17 — **sansChef** détecté par l'IA et propagé jusqu'au mobilier (pas de chef → pas de podium/pupitre/chaise haute). Ensemble homogène (consort) → effectif déduit du nombre de musiciens + instrument.
- 2026-06-17 — Tri des concerts par date (récent/ancien/manuel, parseur de dates FR) + champ de recherche. Bouton « Recharger depuis le compte » pour faire primer la version serveur sur un local périmé.
- 2026-06-13 — OrkMap est l'application Eiffel unique accessible sur `https://orkmap.eiffelai.io`, avec deux accès applicatifs : concerts/régie et scores/OMR.
- 2026-06-13 — L'OMR doit utiliser un vrai moteur OMR (Audiveris côté sidecar/local) et non Gemini pour lire les partitions.
- 2026-06-13 — Authentification familiale par code email, limitée pour l'instant à `<adresse d'Alexandre>`, `<adresse d'un membre de la famille>`, `<adresse Parédé>`.
- 2026-06-13 — Envoi des codes de connexion via Gmail OAuth en production Vercel. Le code fixe `790762` et `AUTH_FALLBACK_CODE` sont supprimés.
- 2026-06-14 — Les données OrkMap synchronisées par compte utilisent un projet Supabase séparé (`orkmap`, ref `yxkktarojpnktsfrvjhb`), distinct de Supabase TarotMarseille.
- 2026-06-14 — IndexedDB reste le cache local/offline ; Supabase OrkMap devient la couche de synchronisation pour `concerts`, `photos`, `omr-scores`.
- 2026-06-14 — Toute synchro OrkMap doit être non destructive : fusion locale+serveur, payload complet, historique serveur à chaque sauvegarde, refus serveur `409` si un appareil tente d'écraser des données existantes avec moins d'identifiants.
- 2026-06-14 — Les dumps de récupération utilisent une table séparée `orkmap_recovery_dumps` et ne doivent pas modifier `orkmap_user_data`.
- 2026-05-24 — Déploiement Vercel via auto-deploy GitHub (push sur main). Validation : git commit vide (`--allow-empty`) déclenche bien le build. Pas besoin de token Vercel CLI sur le serveur.
- 2026-05-24 — Correction 3 bugs auto-création :
  - `DEFAULT_MOBILIER` : plus de Podium/Pupitre chef — ajoutés conditionnellement via `hasChef` (faux par défaut)
  - `App.jsx` : `percus: []` à l'import PDF et création manuelle
  - `pdfParser.js` : `buildPercuFromEffectif` vidée — les percussions viennent uniquement du parsing explicite (P1:, DCM, EIC, IA)

## ABANDONNÉ

- 2026-06-17 — **DeepSeek V4 pour la vision** : l'API officielle `api.deepseek.com` (standard ET `/beta`) refuse toute image (`unknown variant image_url`) → text-only en pratique, incapable de lire un plan. Écarté au profit de xAI Grok.
- 2026-06-17 — **Google Gemini** comme moteur de reconnaissance (remplacé par xAI Grok ; `GOOGLE_API_KEY` plus utilisé par `/api/extract-ai`).
- 2026-06-13 — Abandon de l'import/migration visible "Importer mes données Vercel" dans l'interface utilisateur.

## Notes

- Les 4 commits suivants étaient déjà sur `origin/main` sans avoir été déployés (HEAD local détaché sur af36d19) : parseur DCM Radio France, extraction texte libre + titre éditable, mobilier chef conditionnel + consort baroque, suppression création automatique percus depuis effectifDetail.
