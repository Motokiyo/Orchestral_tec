# Prompt Claude Code — Mise à jour OrkMap v1 (régisseur plateau)

> Copier-coller ce prompt dans Claude Code à la racine du projet 1 Projets/Orchestral-tec.

---

Tu travailles sur OrkMap, une PWA React (Vite 6) mobile-first pour les régisseurs de plateau d'orchestre. Lis attentivement CLAUDE.md et docs/EXTRACTION_IA_REFERENCE.md avant de commencer.

## Contexte

L'app fonctionne bien dans son état actuel (IndexedDB, navigation, édition pièces/poles/items, TXT, photos watermark, couleurs barnier, drag-reorder). **Ne casse rien de ce qui marche.** Tous les changements sont des AJOUTS ou des AMÉLIORATIONS ciblées.

3 chantiers à traiter, dans cet ordre :

---

## Chantier 1 — Import multi-plans intelligent (pièce existante)

### Problème actuel
Quand on ajoute un plan (PDF ou image) à une pièce qui en a déjà, le plan est simplement ajouté dans `piece.plans[]` sans interaction. Or un nouveau plan peut contenir des infos (effectif, percus, metadata) qui complètent ou corrigent celles déjà présentes.

### Ce qu'il faut faire

Quand l'utilisateur ajoute un plan à une pièce qui a DÉJÀ au moins un plan :

1. **Afficher un choix modal** (pas un `confirm()`, un vrai composant React) :
   - **"📎 Ajouter le plan uniquement"** — le plan (image/PDF rendu) est ajouté à `piece.plans[]`, aucune donnée n'est modifiée. C'est le comportement actuel.
   - **"🔄 Fusionner les informations"** — le PDF est parsé (via `extractFromPdf`), puis les infos extraites sont présentées à l'utilisateur dans un écran de comparaison AVANT d'être appliquées.

2. **Écran de fusion** (si l'utilisateur choisit "Fusionner") :
   - Afficher côte à côte ou empilé (mobile-first !) :
     - **Existant** (valeurs actuelles de la pièce)
     - **Nouveau** (valeurs extraites du PDF)
   - Pour chaque champ metadata (titre, compositeur, durée, salle, chef, date, effectif) :
     - Radio-button : garder l'existant OU prendre le nouveau
     - Si le nouveau est vide, pré-sélectionner l'existant
     - Si l'existant est vide, pré-sélectionner le nouveau
   - Pour les **percus** :
     - Lister les poles existants + les poles extraits du nouveau plan
     - Checkbox pour chaque pole extrait : "Ajouter ce pole" / "Ignorer"
     - Si un pole du même nom existe déjà (ex: "Percu 1"), proposer : "Remplacer les items" / "Fusionner les items" / "Ignorer"
   - Pour l'**orchestre** :
     - Même logique : comparer bois/cuivres/cordes/autres, choisir existant ou nouveau par section
   - Bouton **"Appliquer"** → applique les choix et ajoute aussi le plan à `piece.plans[]`
   - Bouton **"Annuler"** → revient à la pièce sans rien changer

3. **Si c'est une image** (pas un PDF) → pas de parsing possible, donc directement "Ajouter le plan uniquement" sans modal.

4. **Si c'est le premier plan de la pièce** (plans[] vide ou inexistant) → comportement actuel inchangé (ajout + parsing auto si PDF).

### Contraintes techniques
- Le modal et l'écran de fusion sont des composants dans App.jsx (pas de fichier séparé, l'app est en fichier unique).
- Mobile-first : tout doit être lisible et utilisable sur iPhone portrait.
- Les valeurs vides ne doivent pas écraser les valeurs existantes par défaut.

---

## Chantier 2 — Système d'archivage

### Problème actuel
Aucune archive n'existe. Supprimer un concert = perdu définitivement. Pas de possibilité de retrouver un concert passé.

### Ce qu'il faut faire

#### 2a. Flag `archived` sur les concerts

- Ajouter un champ `archived: boolean` (défaut `false`) dans le modèle Concert.
- Sur l'écran **concerts** : séparer en 2 sections :
  - **"Concerts actifs"** (liste actuelle, `archived !== true`)
  - **"Archives"** — section rétractable en bas, fermée par défaut. Affiche les concerts archivés.
- Action sur un concert actif : bouton ou swipe "Archiver" (déplace vers archives).
- Action sur un concert archivé :
  - **"Restaurer"** → remet `archived = false`, revient dans la liste active
  - **"Supprimer définitivement"** → confirmation stricte ("Supprimer définitivement le concert [titre] et toutes ses données ?"), puis suppression réelle.

#### 2b. Archivage avec choix des données

Quand l'utilisateur archive un concert, afficher un **modal de choix** :

```
Archiver "[titre du concert]"

Que souhaitez-vous conserver dans l'archive ?

☑️ Métadonnées (titre, date, lieu, orchestre, chef)     [toujours coché, grisé]
☑️ Pièces et effectifs
☑️ Détail percussions (poles + items)
☑️ Plans de scène
☑️ Photos
☑️ Notes

[Archiver]  [Annuler]
```

- Les **métadonnées concert** sont TOUJOURS archivées (checkbox grisée, toujours cochée).
- Chaque autre catégorie est une checkbox (cochée par défaut).
- Les données NON cochées sont SUPPRIMÉES au moment de l'archivage (pas de retour possible).
- Afficher un résumé du poids : "Plans : N images (~X Mo)" pour aider l'utilisateur à choisir ce qu'il veut alléger.

**Pourquoi ?** Les plans et photos en base64 prennent beaucoup de place en IndexedDB. Un régisseur qui archive 50 concerts par an doit pouvoir garder les infos texte sans les images.

#### 2c. Recherche dans les archives

Ajouter un **champ de recherche** en haut de la section Archives :
- Recherche textuelle simple (pas Fuse.js, juste `includes()` sur les champs) :
  - titre du concert
  - lieu
  - orchestre
  - chef
  - date
  - titres des pièces
  - noms des compositeurs
- Filtrer la liste archives en temps réel pendant la frappe.
- Placeholder : "Rechercher par date, compositeur, orchestre, pièce…"

---

## Chantier 3 — Améliorer le parsing PDF (pdfParser.js)

### Problème actuel
Le parsing PDF fonctionne mal en pratique. Les plans AutoCAD et Photoshop ont des structures textuelles très variables. Le texte extrait par pdfjs-dist est souvent fragmenté, mal ordonné, ou incomplet.

### Ce qu'il faut améliorer

#### 3a. Robustesse de l'extraction texte

- Le regroupement par lignes (y±4) est trop strict. Passer à **y±6** ou utiliser un seuil adaptatif basé sur la hauteur moyenne des caractères de la page.
- Certains PDFs AutoCAD ont du texte tourné à 90° (rotation). Détecter `transform` dans les items de texte et traiter les rotations.
- Ajouter un **log de debug** (console.log conditionnel derrière un flag `DEBUG_PDF`) qui affiche :
  - Nombre de pages
  - Nombre de lignes extraites
  - Les 20 premières lignes de texte
  - Le format détecté
  - Les champs extraits

#### 3b. Meilleure détection de format

Ajouter la détection de **nouveaux patterns** courants :
- **Orchestre de Paris** : chercher "Orchestre de Paris" + format programme
- **CNSM** : chercher "Conservatoire" ou "CNSM"
- **Générique amélioré** : si aucun format n'est détecté, essayer d'extraire le maximum avec des heuristiques :
  - Chercher une notation Daniels N'IMPORTE OÙ dans le texte (pas seulement après un label)
  - Chercher un nom de compositeur connu (base de ~200 noms courants du répertoire orchestral)
  - Chercher des patterns de date en français ("janvier", "février"... ou JJ/MM/AAAA)

#### 3c. Meilleur parsing des percussions

Le parsing percu est fragile. Améliorer :
- Accepter plus de variantes : "Perc.", "Percussion", "Percussions", "PERC", "perc", "P1", "P2", "Percu I", "Percu II"
- Instruments : enrichir `isKnownInstrument` avec les instruments de docs/EXTRACTION_IA_REFERENCE.md section "Instruments de percussion" (il en manque beaucoup dans la liste actuelle).
- Quantités : parser "2 triangles" → qte:2, "paire de cymbales" → qte:1 (c'est 1 paire), "jeu de 4 timbales" → qte:4.

#### 3d. Gestion multi-pages PDF

Actuellement seule la page 1 est rendue en image. Améliorer :
- **Rendre TOUTES les pages** du PDF en images JPEG et les ajouter toutes à `piece.plans[]`.
- Le texte est déjà extrait de toutes les pages (OK).
- Afficher un indicateur "Page 1/N" sur chaque plan dans la vue pièce.

---

## Règles impératives

1. **Ne pas créer de nouveaux fichiers .jsx/.js.** Tout reste dans les fichiers existants (App.jsx, useStorage.js, pdfParser.js, data.js, utils.js, styles.js).
2. **Mobile-first.** Tout doit être testable sur iPhone portrait (375px).
3. **Pas de dépendance supplémentaire.** Utiliser uniquement les deps existantes (React, idb, pdfjs-dist).
4. **IndexedDB.** Toutes les données (y compris le nouveau flag `archived`) passent par le hook `useConcerts` et sont persistées.
5. **Tester sur localhost** que l'import PDF, la navigation, les photos, le TXT, et le drag-reorder fonctionnent toujours après tes modifications.
6. **Commits atomiques** : un commit par chantier (1, 2, 3), avec messages en français.

---

## Ordre de travail suggéré

1. Commence par le **Chantier 2 (archive)** — c'est le plus indépendant, il ne touche pas au parsing.
2. Puis le **Chantier 1 (multi-plans)** — il touche à l'import mais de façon additive.
3. Enfin le **Chantier 3 (parsing)** — c'est le plus risqué, il modifie pdfParser.js.

Après chaque chantier, vérifie que l'app compile (`npm run dev`) et que la navigation fonctionne.
