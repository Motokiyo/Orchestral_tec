# Audit ciblé de la fidélité aux plans d'OrkMap (lecture seule, branche `feature/omr-family-access` @ 07f3f56)

**En bref :** la « base de données » que vous percevez est surtout statique. Rien n'y sert à reconnaître ce qui est dessiné sur un plan précis. Le code peut ajouter des percussions à trois endroits : la légende générique, le prompt et ses exemples, le parseur local avec repli automatique. Les types de chaise ne sont jamais lus sur le plan : ils sont calculés à partir de l'effectif. Le traitement après le modèle ajoute lui aussi des erreurs.

**Ce que j'ai fait :** lectures statiques uniquement (Read/Grep). Je n'ai exécuté aucun test, ouvert aucun PDF ou image réel, ni accédé à Supabase ou au réseau.
- **[PREUVE]** : lu dans le code.
- **[REPRODUIT-ORCH]** : reproduit par l'orchestrateur sur des réponses simulées (pas par moi), voir `docs/PLAN_FIABILITE_PLANS.md:16-18`.
- **[HYPOTHÈSE]** : conséquence plausible, non vérifiée.
- **[À REPRODUIRE]** : symptôme signalé par l'utilisateur, à rejouer sur un plan autorisé.

---

## 1. Ce qui sert de « base » : statique, Supabase, qualité non prouvée

| Élément | Nature | Rôle réel |
|---|---|---|
| `src/data.js:16-23` `CATEGORIES` | 6 chaînes statiques (Timbales & Peaux, Claviers…) | Simples étiquettes de rangement, pas un catalogue d'objets avec symbole, dimensions ou signature visuelle |
| `src/data.js:2-14` `BARNIER` | Couleurs | Affichage seulement |
| `api/nomenclature-legend.js` | **Une** image de légende générique, codée en dur | Envoyée comme image 1 à chaque appel (`extract-ai.js:55`). Ce n'est pas la légende du plan analysé |
| `DANIELS_*` (`App.jsx:1079-1092`) | Expressions régulières | Recalculent la notation Daniels, pas la reconnaissance |
| `src/constants*` | **N'existe pas** (Glob vide) | — |
| Supabase | D'après l'audit Claude : un bloc JSON par utilisateur (`orkmap_user_data`) et un historique | Stockage des concerts. **Aucune table d'instruments, de symboles ou de chaises n'a été vue.** Le contenu réel n'est pas vérifié (pas d'accès) |

Conclusion **[PREUVE]** : il n'existe ni registre de symboles par institution, ni classes d'objets, ni dimensions, ni lien entre un objet et sa position sur la page. La qualité de reconnaissance n'a jamais été mesurée (`PLAN_FIABILITE_PLANS.md:20`).

## 2. Le parcours d'un plan : où le contenu réel se perd

**1. Ce que voit le modèle (`api/extract-ai.js`)**
- `:41` : seules les 8 premières pages sont envoyées. Les pages au-delà, ou dans un format non accepté, sont ignorées sans avertissement (`:45-46`) **[REPRODUIT-ORCH 9→8]**.
- `:55` et `:59` : la légende **générique**, qui contient des dessins de percussions et de claviers, est envoyée en premier, avec la consigne d'identifier les instruments dessinés « même non étiquetés ».
  - **[HYPOTHÈSE forte]** Le modèle peut compter des symboles de la légende comme présents sur le plan. Rien ne sépare ce qui vient de la légende de ce qui vient de la scène.
- `:59` et `:88` : les claviers sont reconnus « par leur FORME ». Un rectangle allongé peut aussi bien être une table, une estrade ou une praticable. Il n'existe aucune classe « inconnu ».

**2. Le prompt, qui pousse à inventer des percussions**
- `:77` : « 2 timbales → 2 Timbaliers ». Cela confond un instrument et un poste de musicien.
- `:80` : « Chaque timbale = 1 item séparé ». Cela pousse à énumérer des timbales qui ne sont pas comptées sur le plan.
- `:66` et `:78` : les chiffres décodés doivent « correspondre exactement » à la notation Daniels. Le modèle crée donc autant de pôles que la notation l'indique, même s'ils ne sont pas dessinés.
- `:94` (exemple Mahler, 3 percussionnistes) et `:107-108` (exemple de schéma avec Vibraphone et Triangle). **[HYPOTHÈSE]** Ces exemples peuvent être recopiés quand le plan est pauvre.
- `:84` : un effectif est **déduit** du nombre de noms ou de chaises.
- `:68` : la règle « Daniels > Texte > Visuel » écrase ce qui est dessiné.
- `:90` (« NE PAS inventer ») contredit les lignes précédentes, et rien ne permet d'exprimer une abstention par objet.

**3. Le traitement après le modèle ajoute des erreurs [PREUVE]**
- `extract-ai.js:149-174` : un JSON tronqué est « réparé » puis renvoyé avec un code 200, sans indicateur. Des percussions partielles passent pour complètes.
- `:185` : si la réponse ne parle pas du chef, la sortie devient « sans chef » **[REPRODUIT-ORCH]**.
- `:189` : un pôle sans nom reçoit le nom « Percu ». `:191` : un objet sans catégorie reçoit « Accessoires ». Des valeurs par défaut sont ainsi présentées comme lues.
- `:188` : un mauvais type de données provoque une erreur 500 **[REPRODUIT-ORCH]**.
- **Pas de champ mobilier ou chaise dans la sortie (`:178-195`).** Même si le modèle voyait des chaises différentes, le serveur jetterait l'information.

**4. Fusion côté client (`src/App.jsx`)**
- `:2008` : si l'IA renvoie **zéro** percussion, le code reprend les percussions du parseur local. **Une abstention de l'IA est donc remplacée par une invention locale.**
- `:2007` : même mécanisme pour `orchestre`. `:2010-2013` : toute erreur de l'IA est avalée en silence (`console.warn`) et le résultat local est utilisé seul.
- Parseur local, `src/pdfParser.js:1815-1820` : dès qu'une ligne « Timbales : … » est trouvée, il **ajoute en dur un objet « 4 Timbales »** et crée un pôle « Timbalier ».
  - **[PREUVE]** C'est une percussion inventée, avec une quantité fixe.
  - `:1798-1807` : la recherche du motif « perc : » sur tout le texte peut capturer une ligne de nomenclature.
- `:1132-1137` `calculateDanielsNotation` : le nombre de timbaliers et de percussionnistes est recalculé à partir des **noms de pôles**. Un pôle inventé gonfle donc la notation.

**5. Calcul des chaises (`src/utils.js:53-170`) : aucune n'est lue sur le plan [PREUVE]**
- `:97-111` : chaque pôle dont le nom contient « timbalier » donne une « Chaise timbalier ». Chaque autre pôle donne une « Chaise haute ».
- `:142-146` : chaises normales = cordes + bois + cuivres. Chaises hautes = contrebasses + chef + nombre de pôles.
- `:161` : `chaisesSpeciales: []` est toujours vide au calcul. Les types (« Tabouret piano », « Chaise australienne »…) ne sont que du texte libre saisi à la main (`App.jsx:3519` et `:3527`).
- Le calcul est déclenché à l'import (`App.jsx:1888`), recalculé quand l'orchestre change (`:1480`, seules les chaises spéciales sont préservées, `:1483-1486`), et refait à l'affichage si le mobilier manque (`:3310`, `:3328`, `:3443`).

**Conséquence :** « ne sait pas discriminer les chaises » n'est pas un défaut du modèle. **C'est structurel**. Ni le schéma, ni le catalogue, ni le stockage n'ont de type de chaise observé. L'interface n'en propose que deux, plus une liste libre.

**6. Données de démonstration**
- `App.jsx:1177` et `useStorage.js:520` : le concert de démonstration, avec ses pôles « Percu 1 / Percu 2 » (`data.js:46-150`), est injecté dans un nouveau compte.
- **[HYPOTHÈSE faible]** Cela peut prêter à confusion, mais ce n'est pas un ajout dans une pièce importée.

## 3. Ce qui reste à reproduire sur plan autorisé [À REPRODUIRE]

1. **Percussion absente du plan :** chercher la source dans cet ordre : (a) légende générique, (b) exemples du prompt, (c) repli `:2008` vers le parseur local, (d) « 4 Timbales » codé en dur, (e) Daniels qui l'emporte sur le dessin. Il faut journaliser la réponse brute de l'IA **et** le résultat local pour savoir lequel est en cause.
2. **Chaises différentes non distinguées :** confirmer qu'aucune chaise n'est lue. Le résultat attendu, d'après le code, est un compte calculé identique quel que soit le dessin.
3. **Faux claviers (rectangles) et faux timbaliers (« 2 timbales »).**

## 4. P0 fidélité, à faire avant toute discussion de moteur

Il ne s'agit ni de changer de modèle ni de tout refondre : ce sont des corrections de contrat et de pipeline.

1. **Le catalogue sert à faire correspondre, jamais à générer.**
   - Supprimer le repli `App.jsx:2008` et `:2007` : un tableau vide renvoyé par l'IA signifie « rien vu », pas « prendre le local ».
   - Supprimer « 4 Timbales » (`pdfParser.js:1820`).
   - Supprimer les valeurs par défaut « Percu » et « Accessoires » (`extract-ai.js:189-191`) et les remplacer par `null` avec un statut « inconnu ».
   - Supprimer `sansChef` par défaut (`:185`) : valeur `null` si non observé.
2. **Séparer l'effectif écrit de la scène observée.**
   - L'effectif Daniels et le texte donnent des *attendus*. Les objets dessinés sont des *observations*.
   - Un conflit entre les deux est affiché, jamais résolu automatiquement. Il faut donc retirer `:68` et `:78`, et réécrire `:77`, `:80` et `:84` en propositions à confirmer.
3. **Légende propre au plan d'abord.** Extraire la légende du document (zone et page) et l'utiliser en priorité. La légende générique n'intervient que comme aide, marquée comme telle, et un objet ne peut jamais être compté s'il n'apparaît que dans une image de légende.
4. **Prévoir des classes « inconnu ».** Le schéma d'objet comprend : `class`, `rawLabel`, `source{page, bbox}`, `status`.
   - Valeurs de statut : proposé, ambigu, inconnu, validé.
   - Valeurs de `class` : `chaise_inconnue`, `rectangle_inconnu`, `poste_percu_inconnu`.
   - **Une chaise ambiguë reste « chaise inconnue », jamais rangée par défaut dans « normale » ou « haute ».**
5. **Recadrages, zones et contexte pour apparier visuellement.**
   - Pour chaque objet proposé : recadrage de la zone, signature (forme, taille relative, étiquette proche) et contexte (pupitre voisin, section).
   - L'appariement se fait contre les symboles de la légende du plan. Le recadrage exact peut venir en P1, mais la page source est obligatoire dès P0 (contrat déjà prévu dans `PLAN_FIABILITE_PLANS.md:51`).
6. **Abstention et calibration.**
   - La confiance déclarée par le modèle n'est pas une probabilité (`PLAN:51`). Le seuil d'abstention se règle sur le corpus.
   - Aucune proposition sans source n'est validée automatiquement.
   - Remplacer la « réparation » du JSON par un refus explicite (`:149-174`).
7. **Chaises : trois couches distinctes.**
   - mobilier **lu** (objets observés) ;
   - mobilier **calculé** (`calculateMobilier`, présenté comme estimation) ;
   - mobilier **validé** (humain).
   - Il faut un champ mobilier dans le schéma de réponse, aujourd'hui absent (`:178-195`).

## 5. Plan de nuit ciblé (indicatif, aligné avec les lots A, B et C de `PLAN_FIABILITE_PLANS.md:55-76`)

- **Porte 0 :** sauvegarde, SHA de production et flag désactivé par défaut (inchangé).
- **Lot A, `api/extract-ai.js` :**
  - retirer les valeurs par défaut et la réparation JSON ;
  - réécrire les règles `:68`, `:77-80`, `:84` et `:94`, et neutraliser les exemples de percussions ;
  - marquer l'image de légende comme « référence, ne jamais compter » ;
  - ajouter au schéma `observations[]` avec page et statut, ainsi que `mobilier.observe[]` contenant `chaise_inconnue` ;
  - ajouter des tests sur des réponses simulées : `percus:[]` reste `[]` ; absence de chef donne `null`.
- **Lot B, `pdfParser.js` :** supprimer « 4 Timbales », marquer la sortie locale comme `method:"texte"` et `status:"proposé"`.
- **Lot C, `App.jsx` :**
  - supprimer les replis `:2007-2008` ;
  - afficher l'erreur de l'IA au lieu de `console.warn` (`:2011`) ;
  - présenter le mobilier calculé comme « estimation », séparé du mobilier lu ;
  - mettre en place une revue avant sauvegarde.
- **Lot D :**
  - définir la vérité terrain par plan, en séparant : percussion écrite / dessinée / absente, et types de chaise ;
  - annoter les cas « légende seule ».

## 6. Critères bloquants, mesurés sur un corpus

Ce sont des cibles sur un corpus autorisé, pas une garantie pour tous les plans.

- **0 faux positif de percussion** (pôle ou objet absent de la vérité terrain) sur le corpus annoté, mesuré séparément pour l'IA seule, le parseur local seul et la fusion. Tout échec bloque la promotion.
- **0 type de chaise attribué sans observation :** toute chaise non identifiée reste « inconnue ».
- **0 objet compté** à partir de la seule légende générique.
- 100 % des pages comptées, lues ou refusées explicitement ; chaque proposition sourcée au moins à la page.
- À publier : dénominateurs, taux d'abstention, rappel par classe et temps de correction humaine. Sur 5 à 10 plans, il n'est pas possible de conclure de façon générale.

## Limites

- Je n'ai pas lu `handleAiExtract` (`App.jsx:2036-2082`) ; je m'appuie sur l'audit Claude, qui indique qu'il remplit les champs vides sans relecture.
- Je n'ai pas lu le contenu de la légende générique (image) ni le reste de `pdfParser.js`.
- La structure Supabase vient de l'audit, pas d'une observation directe.
- Aucun test exécuté : la part de chaque source dans le symptôme reste à mesurer sur plan.