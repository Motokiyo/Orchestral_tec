# PlateauMap — Prompts de test Vision IA

## Usage
Envoyer ces prompts avec les photos correspondantes à différents LLM (Claude, GPT-4o, Gemini, etc.) pour comparer la qualité d'extraction.

---

## PROMPT 1 — Analyse de photo d'installation de percussions

> À utiliser avec les photos de plateau (photos prises par les garçons d'orchestre pendant le montage/concert)

```
Tu es un assistant spécialisé en régie de concert et installations de percussions orchestrales.

Analyse cette photo d'une installation de percussions sur un plateau de concert.

### 1. IDENTIFICATION DU MATÉRIEL

Liste TOUT le matériel visible sur la photo, classé par catégorie :

CLAVIERS (xylophone, marimba, vibraphone, glockenspiel, célesta, cloches tubulaires)
TIMBALES & PEAUX (timbales, caisse claire, toms, bongos, congas, tambourin, bodhran, roto-toms)
ACCESSOIRES (triangle, wood-block, claves, castagnettes, cymbales, crotales, grelots, fouet)
GROSSES PIÈCES (gong, tam-tam, grosse caisse, steel drum, enclume, tôle tonnerre)
STANDS & SUPPORTS (pieds de cymbale, racks, tables d'accessoires, tréteaux, pupitres)
BAGUETTES & SPÉCIAL (mailloches visibles, archets, objets atypiques, électronique, ampli)

Pour chaque instrument, précise :
- Le nom exact si identifiable (marque, modèle, taille)
- La quantité
- Ta confiance : CERTAIN / PROBABLE / INCERTAIN

### 2. DISPOSITION SPATIALE

Décris la disposition vue de dessus :
- Qu'est-ce qui est côté JARDIN (gauche vu de la salle) ?
- Qu'est-ce qui est au CENTRE ?
- Qu'est-ce qui est côté COUR (droite vu de la salle) ?
- Qu'est-ce qui est DEVANT (côté chef) vs DERRIÈRE ?

### 3. TEXTE VISIBLE

Retranscris tout texte visible sur la photo :
- Annotations sur les photos (filigrane, watermark)
- Texte sur les pupitres / partitions
- Étiquettes, barnier (gaffer coloré), marquages au sol
- Marques d'instruments visibles

### 4. CONTEXTE

Si possible, déduis :
- Le nombre de percussionnistes (pôles) visibles
- Le type de répertoire (classique, contemporain, opéra)
- La salle (si identifiable)
- Le moment (montage, répétition, concert)

### 5. COMPARAISON AVEC UNE LISTE

Si je te fournis une liste de matériel attendu, compare avec ce que tu vois :
- ✅ Confirmé : présent sur la photo ET dans la liste
- ⚠️ Écart : présent sur la photo mais PAS dans la liste
- ❌ Manquant : dans la liste mais PAS visible sur la photo
- ❓ Incertain : impossible à confirmer depuis cet angle

Réponds en français. Sois exhaustif mais honnête sur tes incertitudes.
```

---

## PROMPT 2 — Analyse de dessin à la main (plan de dessus)

> À utiliser avec des croquis/dessins faits à la main par les garçons d'orchestre ou régisseurs

```
Tu es un assistant spécialisé en régie de concert et plans de plateau orchestral.

Cette image est un DESSIN À LA MAIN (croquis, schéma) d'un plan de dessus d'une installation de percussions sur un plateau de concert. Ce type de dessin est fait par les garçons d'orchestre ou les régisseurs pour documenter le placement du matériel.

### 1. LECTURE DU PLAN

Identifie et liste tous les éléments dessinés :
- Instruments représentés (même par des symboles simples : rectangles = claviers, cercles = timbales/gongs, etc.)
- Texte manuscrit (noms d'instruments, annotations, numéros de percu)
- Symboles (flèches, zones, repères)
- Limites du plateau, position du chef, estrade

Conventions courantes dans ces plans :
- Les rectangles allongés = claviers (marimba, xylo, vibra)
- Les cercles = timbales, gongs, tam-tams
- Les petits cercles = cymbales, accessoires
- "P1", "P2", "Perc 1", "Percu 2" = numéro de percussionniste
- Le chef est généralement en bas du plan (côté public)
- Jardin = gauche, Cour = droite (vu du public)

### 2. EXTRACTION DES DONNÉES

À partir du dessin, génère :

**a) La liste de matériel par percussionniste :**

```
PERCU 1 :
  - [instrument 1]
  - [instrument 2]
  ...

PERCU 2 :
  - [instrument 1]
  ...
```

**b) Les coordonnées approximatives** (en pourcentage du plan, 0,0 = coin haut-gauche) :
```
Instrument : X%, Y%
```

**c) Les relations spatiales** :
- Quels instruments sont regroupés ensemble ?
- Quel est l'ordre de gauche à droite (Jardin → Cour) ?
- Qu'est-ce qui est partagé entre plusieurs percussionnistes ?

### 3. TEXTE MANUSCRIT

Retranscris TOUT le texte manuscrit visible, même partiellement lisible :
- Noms d'instruments
- Annotations
- Numéros
- Noms de compositeurs ou de pièces
- Couleurs mentionnées (barnier)
- Flèches ou indications de direction

### 4. RECONSTITUTION

Si tu devais reconstituer ce plan en SVG, donne-moi la structure :
```json
{
  "elements": [
    {
      "type": "clavier|timbale|gong|accessoire|stand|zone",
      "nom": "Marimba",
      "percu": "P1",
      "x_pct": 30,
      "y_pct": 50,
      "largeur_pct": 15,
      "hauteur_pct": 5,
      "rotation": 0
    }
  ]
}
```

### 5. QUALITÉ ET CONFIANCE

Pour chaque élément identifié, indique ta confiance :
- CERTAIN : texte lisible ou forme sans ambiguïté
- PROBABLE : forme reconnaissable mais pas de texte
- INCERTAIN : forme ambiguë, texte illisible

Réponds en français. Sois exhaustif. En cas de doute, propose plusieurs interprétations.
```

---

## PROMPT 3 — Comparaison photo vs liste (vérification terrain)

> À utiliser pour comparer une photo avec la liste de matériel attendu

```
Tu es un assistant de vérification pour les installations de percussions orchestrales.

Je te fournis :
1. UNE PHOTO d'une installation de percussions sur un plateau
2. UNE LISTE de matériel attendu pour ce pôle

Compare la photo avec la liste et donne-moi un rapport :

### RÉSULTAT PAR INSTRUMENT

Pour chaque item de la liste :
- ✅ CONFIRMÉ : je vois cet instrument sur la photo
- ❌ MANQUANT : cet instrument n'est PAS visible (peut être caché ou pas encore installé)
- ❓ INCERTAIN : je ne peux pas confirmer depuis cet angle

### SURPLUS

Instruments visibles sur la photo qui ne sont PAS dans la liste :
- ⚠️ SURPLUS : [nom de l'instrument] — possible ajout de dernière minute

### SCORE

- Confirmés : X / Y
- Manquants : X
- Surplus : X
- Confiance globale : HAUTE / MOYENNE / BASSE

### RECOMMANDATION

- Faut-il reprendre une photo sous un autre angle ?
- Quels instruments nécessitent une vérification physique ?

LA LISTE ATTENDUE :
[coller la liste ici]
```

---

## Comment tester

### Modèles à comparer
1. **Claude Sonnet / Opus** (Anthropic)
2. **GPT-4o** (OpenAI)
3. **Gemini Pro Vision** (Google)
4. **Llama 3.2 Vision** (Meta, si dispo)

### Critères d'évaluation
- **Exhaustivité** : combien d'instruments correctement identifiés ?
- **Précision** : faux positifs ? Instruments inventés ?
- **Texte** : qualité de la lecture du texte manuscrit / filigrane
- **Spatialité** : qualité de la description de la disposition
- **Confiance** : le modèle sait-il dire "je ne suis pas sûr" ?
- **Format** : respect de la structure demandée

### Photos à utiliser
- Photos de plateau EIC (celles avec filigrane "etymo P1 jardin", "etymo P2 cour", etc.)
- Photos sans filigrane (vues générales)
- Dessins à la main de plans de dessus
- PDF AutoCAD rendus en image

### Grille de notation (sur 5 par critère)
| Critère | Claude | GPT-4o | Gemini | Notes |
|---------|--------|--------|--------|-------|
| Exhaustivité | /5 | /5 | /5 | |
| Précision | /5 | /5 | /5 | |
| Texte | /5 | /5 | /5 | |
| Spatialité | /5 | /5 | /5 | |
| Confiance | /5 | /5 | /5 | |
| Format | /5 | /5 | /5 | |
| **TOTAL** | /30 | /30 | /30 | |
