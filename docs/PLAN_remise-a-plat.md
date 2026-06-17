# Plan de remise à plat OrkMap — Reconnaissance de documents + Jumelage des appareils

> Document de travail validé AVANT tout code. Deux chantiers indépendants.
> Moteur IA : on quitte Google Gemini, on passe à **DeepSeek V4 Flash** (multimodal, lit les images).
> La partie "référence/prompt" de la reconnaissance attend des documents complémentaires d'Alexandre.

---

## Diagnostic de départ (rappel court)

**Reconnaissance** : l'app fait l'inverse de la spec d'origine. Pour un plan AutoCAD, un parser de texte local
fabrique un faux effectif à partir des chiffres du plan (cotes, positions), ce faux résultat fait monter un
"score" qui empêche l'appel IA (`App.jsx:1799`), et même quand l'IA répond, le faux local la recouvre
(`App.jsx:1812`). Le texte vertical est jeté (`pdfParser.js:90`). 15+ commits de rafistolage (modèle Gemini
changé 5 fois, 6 parsers de format, 5 parsers de percu, 3 regex d'effectif) = "de mal en pis".

**Jumelage** : tout le système de compte (login + synchro Supabase) vit sur la branche
`feature/omr-family-access`, **17 commits en avance sur `main`**. `main` n'a PAS les API `sync/session/verify-code`.
Si Vercel déploie `main` en production, le compte n'existe pas sur le site visité par le tél et l'ordi.

---

## CHANTIER 1 — Jumelage téléphone / ordinateur (gain rapide)

Objectif : les deux appareils, connectés au même email, voient les mêmes concerts/photos.

### Étape 1.1 — Constat de production (aucun code, 10 min)
- [ ] Confirmer quelle branche Vercel déploie en **production** (Settings → Git → Production Branch).
- [ ] Confirmer l'URL exacte qu'Alexandre ouvre sur le tél ET sur l'ordi (même domaine ?).
- [ ] Lister les variables d'env de prod : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (+ futur `DEEPSEEK_API_KEY`).
  - Commande : `vercel env ls` (ou dashboard). On ne révèle jamais les valeurs, juste la présence.
- [ ] Sur chaque appareil après login, confirmer l'email affiché = identique (cause n°1 de désync si différent).

### Étape 1.2 — Mettre la prod sur la bonne branche
Deux options selon le constat 1.1 :
- **A. Fusionner `feature/omr-family-access` → `main`** (recommandé à terme) : passe de revue des 17 commits,
  puis merge. La prod (main) gagne le compte. Risque : volume de diff, à relire sérieusement.
- **B. Pointer la Production Branch de Vercel sur `feature/omr-family-access`** (rapide, transitoire) :
  débloque tout de suite sans merge. À régulariser ensuite par la fusion A.

### Étape 1.3 — Vérifier le round-trip réel (test vivant, pas de la théorie)
- [ ] Créer un concert sur l'appareil 1 → vérifier son apparition sur l'appareil 2 sous ~10 s.
- [ ] Inverse. Modifier un champ sur l'un, vérifier sur l'autre.
- [ ] Lire la console (F12) : repérer `Concert sync load failed`, 503 (Supabase non configuré), 401 (session), 409.

### Étape 1.4 — Corriger le garde-fou anti-suppression (secondaire mais réel)
`api/sync.js:70` refuse (409) toute synchro qui contient MOINS de concerts que le serveur. Effet de bord :
**une suppression légitime est silencieusement refusée**. À remplacer par un mécanisme propre
(marqueur de suppression "tombstone", ou fenêtre de confirmation), sans rouvrir la porte à l'écrasement accidentel.

### Étape 1.5 — Rendre les pannes visibles (petit ajout UX)
Bandeau discret : email connecté + état synchro (à jour / hors-ligne / erreur). Aujourd'hui tout échoue en silence,
c'est ce qui a donné l'illusion "c'est OK".

---

## CHANTIER 2 — Reconnaissance de documents (remise à plat propre)

Principe directeur, tiré de TA bible (`docs/EXTRACTION_IA_REFERENCE.md`) :
**le type de document décide du chemin. Un plan/dessin/photo se lit avec l'IA Vision. Une liste texte propre se lit avec le parser local.** On arrête de mélanger les deux.

### MOTEUR IA VÉRIFIÉ (test réel du 17/06/2026)

- **DeepSeek V4 (flash/pro) = AVEUGLE via l'API officielle** : `api.deepseek.com` (standard ET /beta) refuse toute image (`unknown variant image_url, expected text`). Les modèles existent sur la clé mais sont text-only ici. Les articles « V4 multimodal » étaient faux pour l'API directe. → DeepSeek ne peut PAS lire les plans.
- **xAI Grok = OK, retenu.** `grok-4.20-0309-non-reasoning` (aussi dispo : `grok-4.3`), endpoint `https://api.x.ai/v1/chat/completions`, format OpenAI `image_url` (objet `{url:"data:image/jpeg;base64,..."}`), clé `XAI_API_KEY` (coffre `api-keys/xai.env`). Non-Google.
- **Testé sur les 7 documents réels d'Alexandre** : cartouche + effectif lus quasi parfaitement (titre/lieu/date/ligne effectif verbatim, cordes exactes), y compris AutoCAD, fiches de prod multi-pages, consort baroque (noms des musiciens).
- **2 réglages de prompt à figer** : (1) « T » seul dans le bloc percussions = 1 timbalier (pas percussionniste) ; (2) garder le décodage chiffré strictement aligné sur la ligne brute du cartouche.
- À faire pour la prod : ajouter `XAI_API_KEY` aux variables d'env Vercel (déposer aussi dans le coffre, déjà présent).

### Étape 2.1 — Remplacer le moteur IA : Google → xAI Grok (vision)
- Endpoint serveur `api/extract-ai.js` réécrit pour appeler :
  - Base URL : `https://api.deepseek.com`
  - Endpoint : `/chat/completions` (format OpenAI)
  - Auth : `Authorization: Bearer ${process.env.DEEPSEEK_API_KEY}`
  - Modèle : `deepseek-v4-flash` (multimodal natif, 1M contexte, sortie JSON)
- [ ] **À vérifier par un curl réel AVANT de câbler** : forme exacte du champ image (attendu OpenAI :
  `content:[{type:"text",text:...},{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]`).
  Ne pas supposer, tester.
- [ ] Demander la sortie JSON stricte (`response_format` JSON si supporté), schéma = celui de ta bible.
- [ ] Garder `requireSession` (l'IA reste protégée par le login). Conséquence à assumer : extraction IA = être connecté.
- [ ] Supprimer toute dépendance à `GOOGLE_API_KEY` dans le code d'extraction.
- [ ] Ajouter `DEEPSEEK_API_KEY` dans `.env.local` ET dans Vercel (et déposer une copie dans `galaad-credentials`).

### Étape 2.2 — Un aiguillage unique et lisible (fini les couches qui se marchent dessus)
Nouvelle logique de décision, un seul point d'entrée :
1. Détecter le type de source : **liste texte propre** vs **plan/image/dessin/photo**.
   - Heuristique texte propre : le PDF rend un texte structuré qui matche un format connu (Radio France, DCM…)
     avec une vraie nomenclature Daniels lisible en ligne.
   - Sinon (texte fragmenté, plan, image, dessin) → chemin Vision.
2. **Chemin texte propre** : garder les parsers qui marchent vraiment (Radio France, DCM). Le local est la vérité.
3. **Chemin Vision** : l'IA DeepSeek est la vérité. Le local NE fabrique PLUS d'effectif. Il ne sert qu'au rendu du plan en image.
4. **Inverser la priorité de fusion** selon le chemin : texte → local gagne ; vision → IA gagne, local comble les trous.

### Étape 2.3 — Tuer les fabrications de fausses données
- [ ] Supprimer l'exécution des regex Daniels "génériques" sur le texte-soupe d'un plan (source des faux effectifs).
- [ ] Supprimer/neutraliser le seuil `score >= 3` qui court-circuite l'IA sur la base de données potentiellement fausses.
- [ ] Réduire les 5 parsers de percussion à un seul chemin clair + déduplication finale.
- [ ] Décider du sort du filtre de texte vertical (`pdfParser.js:90`) : sur le chemin Vision il devient sans objet
  (l'IA lit l'image entière), donc plus besoin de récupérer le texte tourné côté parser.

### Règles métier confirmées par Alexandre (à respecter par le modèle ET le prompt)

Nomenclature Daniels des percussions, bloc W.X.Y.Z :
1. **Timbalier** = ligne à part entière de l'orchestre. JAMAIS fondu avec les percussionnistes. Poste séparé dans le modèle de données.
   - Le **nombre de timbaliers = nombre de jeux de timbales**. Ex : « 2 timbales » → **2 timbaliers** (W=2).
2. **Percussionnistes**.
3. **Harpes**.
4. **Claviers** = piano, célesta, glockenspiel *si tenu par un pianiste (glock-clavier)*, clavecin.
   - Un glockenspiel n'est "claviers" que s'il est joué par un pianiste ; sinon il reste en percussion.

Exemple Die Frau (Strauss), cartouche `... 2timb. 7 percs - 2 harpes - cél/orgue` : 1 ligne timbalier distincte + 7 percussionnistes (≠ "8 percus" empilés, erreur de l'app actuelle).

### Étape 2.4 — Ancrer l'IA sur tes bases de référence
- [ ] Injecter `LOOKUP_INSTRUMENTS.json` + `LOOKUP_MOBILIER.json` dans le prompt système (tu les as construits pour ça).
- [ ] Reprendre le meilleur prompt de `docs/prompts-v2-draft/` (régisseur expert, vocabulaire trilingue, pièges connus).
- [ ] **[EN ATTENTE]** intégrer les **documents complémentaires** qu'Alexandre va fournir (exemples de plans réels,
  corrections, cas qui ont échoué). C'est ce qui calera le prompt final et les cas de test.

### Étape 2.5 — Échec honnête
- [ ] Si l'IA échoue (clé absente, réseau, 401), afficher une vraie erreur à l'écran, pas un import "réussi" vide.

### Étape 2.6 — Tests sur cas réels
- [ ] Valider sur tes 4 cas de référence (`docs/prompts-v2-draft/Examples/` : brahms, etymo, philharintime, grandes-odes).
- [ ] Valider sur le **plan AutoCAD du dernier concert** (celui qui est ressorti tout faux) + les docs à venir.
- [ ] Critère de succès : effectif Daniels correct, percus par poste correctes, pas de données inventées.

---

## Ordre proposé

1. Chantier 1 (jumelage) d'abord, étapes 1.1→1.3 : gain rapide, débloque l'usage quotidien.
2. Chantier 2 (reconnaissance) ensuite, dès réception des documents complémentaires d'Alexandre.
3. Régularisation (merge vers main, garde-fou suppression, UX synchro) en finition.

## Risques à garder en tête
- Fusion des 17 commits vers `main` : relecture sérieuse obligatoire (ne pas merger à l'aveugle).
- Changement de moteur IA : nécessite la clé DeepSeek en prod + test réel du format image avant de s'engager.
- Sécurité des données pendant les modifs de synchro : ne jamais perdre un concert existant (backups locaux déjà en place).
- Coût/quotas DeepSeek : à surveiller (modèle facturé à l'appel comme Gemini l'était).

## Décidé / à décider
- DÉCIDÉ : moteur = DeepSeek V4 Flash. Reconnaissance = remise à plat propre, pas rafistolage.
- À DÉCIDER : option 1.2-A (merge main) vs 1.2-B (pointer Vercel sur la branche) — selon constat de prod.
- À FOURNIR : documents complémentaires d'Alexandre pour caler le prompt + les cas de test.
