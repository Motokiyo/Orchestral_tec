# OrkMap : audit UI/UX (17/11/2026)

Branche `feature/omr-family-access`, lecture seule. Le dépôt a été copié dans `.../scratchpad/orkmap-ux/repo` (sans `.env.local`, sans clés). Le serveur de dev (port 5199) est arrêté.

## 0. Ce qui a été vu à l'écran et ce qui a été seulement lu

**Vu à l'écran (Puppeteer headless, muet, 150 s max, 375 px et 1280 px)**
- Accueil, liste des concerts, création d'un concert, concert vide, import d'un fichier TXT, import d'une image, écran pièce (métadonnées, orchestre, mobilier avec son mode édition, texte généré), pôle de percussion ouvert, protocole photo, galerie vide, écran TXT.
- Le clic sur « Extraire les données par IA » a été fait, mais toute requête `/api/*` était coupée par le navigateur de test. Rien n'est parti vers un fournisseur, aucun compte réel n'a servi.
- Mode d'accès : un faux compte local (`orkmap-last-email`) évite le login. C'est le mode « ouverture hors ligne » prévu par l'app. Le login lui-même (code par e-mail) n'a pas été parcouru, seulement lu (`App.jsx:334`).
- Captures : `/private/tmp/claude-501/-Users-alexandre/1754c331-e049-4db4-a159-ca47e7505e44/scratchpad/orkmap-ux/*.png` (suffixes `-375` et `-1280`).

**Seulement lu dans le code (jamais affiché)**
- Le concert de démo : il n'apparaît pas dès qu'un concert existe.
- Écrans de capture caméra (`CaptureView`, `StandaloneCamera`), `Lightbox`, téléchargement ZIP des photos, OrkScore (partitions), résultats de fusion IA (`App.jsx:2213`), vrai import PDF et vrai retour de l'IA.
- Le comportement hors ligne réel (service worker) : le service worker n'est actif qu'en build de production, pas en `vite dev`.
- Les mesures de cibles tactiles viennent du navigateur (taille réelle des éléments à 375 px). Les contrastes sont calculés à partir des couleurs du code.

Limite du test : l'import de mon image de test passe par un plan synthétique, pas un vrai plan AutoCAD. L'import de mon TXT de test montre une fragilité du parseur (voir problème 8), mais mon format de texte était inventé, à confirmer sur un vrai fichier.

## 1. Carte des écrans telle qu'elle existe

Application d'un seul gros composant `App.jsx`, sans routeur : la navigation est un `useState("screen")` (`App.jsx:1178`). Cela a deux conséquences : le bouton Retour du téléphone ou du navigateur ne fait pas « un cran en arrière » (il quitte l'app), et rien n'est lien-partageable ni restauré après fermeture. C'est une lecture du code, non testée sur appareil.

```
Connexion (code e-mail)  334          [hors ligne : sautée si compte mémorisé]
  |
Accueil (start) 2377
  |-- Concerts & régie --> Liste des concerts 2687
  |        |  + Nouveau concert (5 boîtes prompt() à la suite)
  |        |  recherche/tri (si >1 concert), Recharger depuis le compte, archives
  |        v
  |    Concert (home) 2818  : pièces, notes, Importer fichier, + Nouvelle pièce
  |        |  barre du bas : Pièces | Photos | TXT
  |        v
  |    Pièce 2948 (une seule page de ~1400 px de haut) :
  |        couleur barnier, 7 champs, plans, [Ajouter plan] [Photo libre],
  |        [Extraire par IA], pôles percussion (dépliables), Orchestre,
  |        Mobilier (lecture/édition), Texte de la pièce, Notes, Liste TXT
  |          |-- Pôle > Photos --> Protocole photo 3778 --> Capture 4744
  |          |-- Photo libre --> Choix de zone 4308 --> Caméra 4424
  |          |-- Résultats IA (fusion) 2213 (seulement après le bouton IA)
  |    Galerie 3813  /  Liste TXT 3883
  |-- OrkScore 2440 (lecture de partition : photo, notes, audio) : autre produit
```

## 2. Parcours principal : étapes et taps

Étapes mesurées ou comptées, depuis l'ouverture de l'app :

| Étape | Taps | Remarque |
|---|---|---|
| Accueil > Concerts | 1 | Un écran de choix qui ne sert qu'à séparer deux produits |
| Nouveau concert | 1 tap + **5 boîtes de dialogue** saisies à la suite (nom, date, lieu, orchestre, chef) | Pas d'annulation à mi-chemin : un champ vide passe au suivant. Date en texte libre |
| Importer fichier | 1 + sélecteur de fichier | Lancement de l'IA automatique, sans avertissement ni confirmation |
| Vérifier/corriger | variable | On atterrit sur la pièce, rien n'indique ce qui vient de l'IA, du calcul ou de la saisie |
| Plateau/inventaire | 2 à 3 (ouvrir Orchestre, Mobilier, pôles) | Tout est sur une seule page très longue |
| Photos | Pôle > Photos > protocole > capture : 4 écrans par pôle | |
| Export | descendre jusqu'au bas de la page pièce ; Copier / Télécharger TXT / Mobilier seul | Pas de PDF, pas d'export concert complet en une fois (TXT par pièce) |

Total jusqu'au premier export : environ 12 à 15 taps et 5 boîtes système, sans compter la vérification.

## 3. Les 10 problèmes les plus importants, classés

### 1. L'IA échoue en silence, l'app affiche quand même une pièce « importée » (BLOQUANT : donnée trompeuse)
- Écran : Concert > Importer fichier (image ou PDF).
- Ce qui se passe : `enrichWithAi` attrape toute erreur, fait `console.warn` et renvoie la lecture locale (`App.jsx:2011`). Vu à l'écran : après l'import de mon image avec l'IA coupée, la pièce s'ouvre sans aucune alerte, avec « Aucun orchestre ». Seule la lecture IA a sa propre alerte (« Erreur extraction IA : Failed to fetch », `App.jsx:2086`), et ce message brut est inintelligible.
- Pourquoi ça gêne : un régisseur voit une pièce créée et croit à un plan lu. Avec un vrai plan, la lecture locale est celle que le STATE.md décrit comme fabriquant des effectifs à partir des chiffres du plan (cotes, sièges). Il peut préparer un plateau faux sans le savoir.
- Correction : afficher en tête de pièce un bandeau « Lecture automatique non faite (réseau/serveur) : les données ci-dessous sont partielles » avec bouton Réessayer ; traduire les erreurs en phrases humaines.
- Réf. : `App.jsx:1999-2013`, `2086`.

### 2. Aucune étape de vérification après l'import, et aucune distinction lu / calculé / saisi (BLOQUANT)
- Écran : Pièce.
- Ce qui se passe : après l'import on arrive sur la page pièce, qui ressemble à une pièce saisie à la main. Le mobilier (pupitres, chaises) est affiché dès qu'un orchestre existe : `piece.mobilier || calculateMobilier(...)` (`App.jsx:3310`) : c'est un calcul présenté comme un fait. Seule une petite pastille « ✎ » signale une édition manuelle. Rien ne dit « calculé d'après l'effectif » ni « lu sur le plan ». Cela recoupe l'audit de fiabilité (chaises calculées au lieu d'être lues).
- Pourquoi ça gêne : le régisseur est responsable du nombre de chaises ; il ne peut pas savoir lesquelles vérifier en priorité.
- Correction : écran « À vérifier » juste après l'import (voir cible §6) ; étiquette par ligne : « lu sur le plan » / « calculé » / « modifié par vous » ; plan visible à côté (ou en haut) des valeurs.
- Réf. : `App.jsx:3308-3330`, `1472-1490`.

### 3. Le bouton « Recalculer » efface le travail manuel sans confirmation (BLOQUANT)
- Écran : Pièce > Mobilier, en lecture comme en édition.
- Ce qui se passe : un tap sur « 🔄 Recalculer » remet le mobilier au calcul automatique et lève le drapeau « modifié » (`App.jsx:3405` et le bouton de la vue lecture). En édition, le bouton est collé entre « Enregistrer » et « Annuler », trois boutons de même taille. Ensuite, `recalcDaniels` réécrit aussi le champ Effectif tapé par l'utilisateur à chaque ajout ou suppression d'instrument (`App.jsx:1472-1481`).
- Pourquoi ça gêne : en coulisse, un doigt qui glisse détruit des corrections faites à la main (précisément ce que l'incident de juin a fait souffrir). Pas d'annulation possible.
- Correction : confirmation avec le nombre de valeurs modifiées perdues ; bouton « Annuler la dernière action » (toast 8 s) ; séparer visuellement Recalculer (secondaire, à distance).

### 4. Création d'un concert : cinq boîtes de dialogue système à la suite (GÊNANT)
- Écran : Concerts > + Nouveau concert ; aussi Nouvelle pièce, renommer, ajouter un pôle, ajouter un instrument.
- Ce qui se passe : `prompt()` x5 (`App.jsx:2708-2716`). Constaté en test : 5 boîtes. Le titre vide annule tout ; les autres champs vides sont acceptés sans rien dire. La date est un texte libre, d'où le tri « Plus récents » qui repose sur `parseConcertDate` (`App.jsx:36`) et peut mal ranger.
- Pourquoi ça gêne : sur téléphone, les boîtes système sont petites, sans correction du texte ni mémorisation de la salle ou de l'orchestre, et on ne peut pas revenir au champ précédent. 17 `prompt()` et 9 `confirm()` dans l'app.
- Correction : un seul formulaire (titre, date avec sélecteur de date, lieu et orchestre proposés depuis les concerts précédents, chef) ; les autres champs facultatifs.

### 5. Cibles tactiles trop petites, surtout les suppressions collées aux actions (GÊNANT)
- Mesures à 375 px : écran pièce, 23 cibles sur 31 font moins de 44 px ; mode édition du mobilier, 73 sur 84. Quelques valeurs : bouton retour 30x34, « ✕ » 26x29 (ferme la pièce), sélecteurs de couleur 32x32, bouton « ✎ » du concert 11x17, champs de métadonnées 22 px de haut, ✕ des lignes de mobilier 19x20, ✕ de pièce 20x22 sur la carte, 📦 archiver 28x30 juste à côté de ✕ supprimer.
- Pourquoi ça gêne : doigts froids, gants, une main sur le téléphone et l'autre tenant un câble. La suppression d'un instrument (`×`, `S.deleteBtn` `styles.js:133`) n'a aucune confirmation (`App.jsx:1343`) ; supprimer une pièce ou un pôle en demande une, mais sur une cible minuscule collée à « renommer ».
- Correction : minimum 44x44 via un style commun ; écarter suppression et renommage ; suppression d'instrument avec « Annuler » (toast) plutôt qu'une confirmation.
- Réf. : `styles.js:133-141`, `App.jsx:2767`, `2900`, `3102`.

### 6. Contraste insuffisant, y compris sur les éléments clés (GÊNANT)
- Constaté à l'écran : la pièce a par défaut la couleur « blanc » (`App.jsx:1887`, `2866`) ; les pastilles « 75 mus. » et « 31 pup. · 74 ch. » sont écrites en gris très clair `#E0E0E0` sur fond `#FAFAFA` : contraste 1,26:1 (il faut 4,5:1). Le bouton « 📸 Photos » est gris sur gris. Ce sont les chiffres que le régisseur cherche.
- Autres : texte secondaire `#A8A29E` sur blanc = 2,5:1 (labels de champs, « Chef : », sous-titres, onglets inactifs de la barre du bas, icône 📦) ; jaune barnier sur jaune pâle : 1,3:1.
- Correction : texte des pastilles toujours en `#1C1917` ; remplacer `#A8A29E` par `#78716C` ou plus foncé pour tout texte porteur d'information ; la couleur barnier reste en bordure ou en pastille, jamais en texte.

### 7. Pastille « Envoi des modifications… » qui recouvre la barre de navigation, et reste affichée (GÊNANT)
- Écran : tous les écrans à barre du bas.
- Ce qui se passe : la pastille est fixe en bas, centrée, `z-index` 9999 (`App.jsx:171-185`) ; la barre de navigation fait 430 px de large, `z-index` 100 (`styles.js:188`). Sur mes captures elle cache l'onglet « Photos ». Elle s'affiche à chaque modification tant que la synchro n'est pas faite, et dans mon test (serveur injoignable) elle ne s'est jamais effacée. Limite : en usage réel, elle disparaît après une synchro réussie ; je n'ai pas pu le vérifier ici.
- Pourquoi ça gêne : l'onglet Photos est la porte d'entrée vers un tiers du métier.
- Correction : placer la pastille au-dessus de la barre (`bottom: 70px`) et la rendre plus discrète (point coloré dans l'en-tête).

### 8. Page pièce interminable, et métadonnées non protégées (GÊNANT)
- Écran : Pièce, 1 370 à 1 400 px de haut à 375 px pour une pièce quasi vide (bien plus avec des pôles ouverts).
- Ce qui se passe : métadonnées en 7 champs de 22 px, plans, boutons, pôles, orchestre, mobilier, texte généré, notes, export : tout dans un défilement ; le titre dans l'en-tête sticky peut occuper 8 lignes (constaté avec mon TXT, où tout le texte a été avalé dans le titre ; mon format était inventé, mais rien ne limite la taille du titre) et masquer la moitié de l'écran. Dans cet import TXT les percussions « P1/P2 » n'ont pas été créées (pôles vides : « Aucune percussion »), sans message.
- Correction : en-tête limité à 2 lignes avec ellipse ; sections repliées avec un résumé (comme Orchestre, déjà) ; barre d'onglets internes « Fiche | Plateau | Percus | Photos | Export » ; avertissement si un import a trouvé des champs mais aucune percussion.
- Réf. : `App.jsx:2958-2965`, `2948-3345`.

### 9. Boutons morts ou trompeurs dans l'écran de fusion IA (GÊNANT)
- Écran : Résultats IA (après « Extraire par IA »).
- Ce qui se passe : « Garder » et « Ignorer » sont `disabled` en permanence (`App.jsx:2302`, `2359`) : ils ressemblent à un choix, ne font rien. « Remplacer » ne montre aucun retour après le tap (pas de changement d'état, pas de coche). Le message vert « ✓ Rempli automatiquement » affiche des succès avant que l'utilisateur ait pu juger du contenu. Seuls les champs vides sont remplis, donc une relecture IA ne corrige jamais un champ déjà faux : la fonction promet plus qu'elle ne fait. Lu dans le code ; non vu à l'écran.
- Correction : retirer les boutons morts ou en faire de vrais choix (état « choisi » visible) ; titre de l'écran « Comparer avec la lecture IA » ; compteur « n différences à trancher ».

### 10. Ordinateur : colonne de 430 px au milieu d'un écran vide ; pas de zoom (COSMÉTIQUE / ACCESSIBILITÉ)
- Constaté à 1280 px : tout reste dans une colonne de 430 px centrée (captures `-1280`). Aucun usage du large espace alors que la préparation du plateau (plan à gauche, valeurs à droite) se fait souvent sur ordinateur.
- Accessibilité : la balise viewport interdit le zoom (`maximum-scale=1.0, user-scalable=no`, `index.html:5`) ; 1 seul `aria-label` dans toute l'app (`App.jsx`) ; boutons icône sans nom accessible (✕, ✎, 📦, ↻) ; polices en 10 à 12 px pour les labels et la barre du bas (10 px, `styles.js:206`). Polices Google chargées par `@import` (`index.html:12`) : hors ligne, l'app retombe sur la police système, sans gravité.
- Correction : autoriser le zoom ; deux colonnes à partir de 900 px (plan fixe à gauche) ; `aria-label` sur les boutons icône.

## Autres constats (hors top 10)
- **Hors ligne** : la bannière explique bien l'état (« Hors ligne · modifications gardées… », `App.jsx:162-164`), l'IA est grisée avec message : c'est une bonne pratique. Mais un nouvel appareil ne peut pas se connecter sans réseau (annoncé), et l'import de plan hors ligne se fait en « lecture locale seulement » avec une alerte unique qu'on peut manquer. Le bouton « Recharger depuis le compte » (`App.jsx:2741`) remplace les données locales : il est affiché en permanence sur la liste, au même niveau que « Nouveau concert ». Il devrait vivre dans un menu « Réglages ».
- **Pas d'état de chargement parlant** : l'import et l'IA (de 3 s à 60 s) n'affichent que « ⏳ Import... » sur le bouton (`App.jsx:2857`), sans étape ni durée, et sans bouton d'annulation. L'écran « Connexion... » de démarrage reste affiché jusqu'à 4 s hors ligne sans compte.
- **État vide** : concert sans pièce = deux boutons et une zone de notes, sans phrase d'accompagnement (« Importez le plan pour commencer »). Galerie vide : bon texte, mais la photo se prend seulement via un pôle ou « Photo libre ».
- **Accueil** : un écran entier pour choisir entre régie et OrkScore (produit de lecture de partition, sans rapport avec le plateau), avec deux cartes de 132 et 154 px. Le nom de compte est tronqué (« demo-audit@example.… ») et « Sortir » (28 px de haut) est un bouton de déconnexion sans confirmation visible dans le code vu.
- **Incohérences** : « 1 instruments » (pas de pluriel, `App.jsx:3093`) ; la carte Orchestre affiche « 0.0.0.1 » pour les claviers alors que le champ Effectif dit « 2.4.0.1 [Cel/Pno] » (deux calculs pour la même donnée) ; « Accueil » existe aussi bien en bouton qu'en logo ; ✕ ferme la pièce alors que ← fait la même chose (`App.jsx:2963`) ; le bouton « + Ajouter » d'un pôle range toujours dans « Accessoires » sans choisir la catégorie (`App.jsx:3144`) ; les emojis servent d'icônes et s'affichent différemment selon l'appareil.
- **Mort ou caché** : tri « Ordre manuel » avec poignées de déplacement (`DragHandle`, flèches) peu visibles ; archives sans aucune explication ; le mode récupération `RecoveryExportScreen` (`App.jsx:197`) est un écran d'urgence à ne pas laisser dans la route publique.
- **Dates** : « 26 mars 2026 » en texte libre partout ; aucun contrôle.

## 4. Gains rapides (moins d'une heure chacun)

1. Mettre la pastille de synchro au-dessus de la barre du bas (`App.jsx:171`, `bottom` à ~72 px).
2. Texte des pastilles « mus. / pup. / ch. » et des tags toujours en `#1C1917` (`App.jsx:3009` environ, `styles.js` `tag`).
3. Remplacer `#A8A29E` par `#78716C` pour tout texte porteur d'information.
4. Autoriser le zoom dans `index.html:5` (retirer `maximum-scale` et `user-scalable=no`).
5. `padding` de 10 px et zone minimale de 44x44 pour `S.deleteBtn`, `S.backBtn`, boutons « ✕ » des cartes ; écarter archiver de supprimer.
6. Confirmation avant « Recalculer » (les deux boutons) avec message « Vos modifications du mobilier seront perdues ».
7. Alerte claire quand l'IA échoue à l'import (remplacer le `console.warn` de `App.jsx:2011` par un message à l'écran et un bouton Réessayer).
8. Supprimer ou rendre fonctionnels les boutons « Garder » / « Ignorer » (`App.jsx:2302`, `2359`).
9. Pluriel « 1 instrument » (`App.jsx:3093`), `aria-label` sur les boutons icône, en-tête de pièce limité à 2 lignes.
10. Traduire « Failed to fetch » en « Impossible de joindre le serveur de lecture ; réessayez avec du réseau » (`App.jsx:2086`).
11. Phrase d'aide dans un concert vide : « Importez un plan (PDF ou photo) ou créez une pièce à la main ».
12. Déplacer « Recharger depuis le compte » dans un menu secondaire.

## 5. Autres chantiers (plus d'une heure)
- Remplacer les `prompt()` par un formulaire de concert unique ; remplacer ceux de pôle/instrument par une saisie en ligne.
- Écran « À vérifier » après import avec provenance de chaque valeur.
- Découper `App.jsx` en écrans et mettre un vrai routage (Retour du téléphone, liens, reprise après fermeture).
- Disposition large à deux colonnes.

## 6. Cible UX recommandée pour le parcours principal

Principe : le régisseur donne le plan, l'app lit, puis **montre ce qu'elle a lu à côté du plan** et demande une seule validation. Chaque valeur porte son origine. Le plateau devient un résumé lisible, l'export un geste unique.

```
[1 Concerts]                         liste + gros bouton « + Nouveau concert »
      |
[2 Nouveau concert]   un seul formulaire :
      Titre  Date (sélecteur)  Lieu*  Orchestre*  Chef      (* proposés)
      [ Créer et importer un plan ]  [ Créer sans plan ]
      |
[3 Import]  choix du fichier -> « Lecture du plan... étape 2/3 · annuler »
      |      (si l'IA échoue : bandeau orange « lecture partielle » + Réessayer)
      v
[4 À VÉRIFIER]          plan (zoom) en haut / valeurs dessous
      Effectif : 2.2.2.2 / 4.2.3.1 ...      [lu sur le plan]  ok / corriger
      Chef : oui                            [lu]              ok / corriger
      Chaises : 67  (calculé : à confirmer) [calculé]         ok / corriger
      Percussions : P1 Timbales x4 ...      [lu]              ok / corriger
      « 3 points à confirmer »  ->  [ Valider le plateau ]
      |
[5 Pièce]  onglets :  Plateau | Percus | Photos | Export
      Plateau  = chiffres clés en gros (pupitres, chaises, praticables)
      Percus   = un pôle par ligne, cases « installé »
      Photos   = un bouton « Photo » par pôle, zones Jardin/Milieu/Cour
      Export   = [ Texte du concert complet ] [ PDF ] [ Photos ZIP ]
      |
[6 Concert]  barre fixe : Pièces | Photos | Export concert
```

Règles associées : cibles 44 px minimum, aucune boîte système, annulation (toast 8 s) à la place des confirmations pour les petites suppressions, confirmation seulement pour les suppressions de pièce ou de concert, texte secondaire à 4,5:1 de contraste minimum, pastille de synchro placée au-dessus de la barre, plan toujours accessible en un tap depuis les valeurs.
