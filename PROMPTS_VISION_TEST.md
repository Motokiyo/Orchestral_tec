# PlateauMap — Prompts de test Vision IA

## Contexte d'utilisation

Ces prompts servent à tester les LLM vision sur des photos réelles d'installations de percussions orchestrales. L'objectif est de déterminer quel modèle est le plus fiable pour :
1. Identifier le matériel sur les photos
2. Lire les textes/annotations
3. Comparer avec un plan théorique (PDF AutoCAD)

### Principe fondamental : LE TERRAIN PRIME

On envoie d'abord le PDF (plan théorique), puis les photos (réalité terrain).
Si les photos montrent quelque chose de différent du plan, c'est que les musiciens ou le chef ont changé l'installation entre le plan et le montage réel.
**Les photos ont toujours raison sur le plan.**

---

## PROMPT 1 — Analyse complète : PDF + Photos de plateau

> Envoyer : d'abord le PDF du plan, puis les photos de l'installation réelle.

```
Tu es un assistant spécialisé en régie de concert et installations de percussions orchestrales.

Je vais te fournir :
1. Un PDF de plan de dessus (plan AutoCAD) — c'est le PLAN THÉORIQUE prévu avant le montage
2. Des photos prises APRÈS le montage sur le plateau — c'est la RÉALITÉ TERRAIN

IMPORTANT : les photos arrivent APRÈS le plan et sont plus fiables. Si quelque chose diffère entre le plan et les photos, c'est que les musiciens ou le chef a changé l'installation. Les photos font foi, pas le plan.

### ÉTAPE 1 : EXTRACTION DU PDF

Depuis le plan PDF, extrais :
- Titre de l'œuvre
- Compositeur
- Durée
- Salle / lieu
- Chef d'orchestre
- Date
- Nombre de percussionnistes (pôles)
- Liste du matériel par percussionniste tel qu'indiqué sur le plan
- Effectif orchestral global (cordes, bois, cuivres, autres)
- Disposition prévue (qui est où)

### ÉTAPE 2 : ANALYSE DES PHOTOS

Pour chaque photo, identifie :

**A) MATÉRIEL VISIBLE** — classé par catégorie :
- CLAVIERS (xylophone, marimba, vibraphone, glockenspiel, célesta, cloches tubulaires)
- TIMBALES & PEAUX (timbales, caisse claire, toms, bongos, congas, tambourin, bodhran, roto-toms)
- ACCESSOIRES (triangle, wood-block, claves, castagnettes, cymbales, crotales, grelots)
- GROSSES PIÈCES (gong, tam-tam, grosse caisse, tôle tonnerre)
- STANDS & SUPPORTS (pieds de cymbale, racks, tables d'accessoires, pupitres)
- BAGUETTES & SPÉCIAL (mailloches, archets, objets atypiques, électronique, clavier MIDI)

Pour chaque instrument :
- Nom exact si identifiable (marque, modèle, taille)
- Quantité
- Confiance : CERTAIN / PROBABLE / INCERTAIN

**B) DISPOSITION SPATIALE** (vue de dessus si possible) :
- Côté JARDIN (gauche vu de la salle)
- CENTRE
- Côté COUR (droite vu de la salle)
- DEVANT (côté chef) vs DERRIÈRE (fond de scène)

**C) TEXTE VISIBLE** :
- Marquages sur les instruments (marques, logos)
- Texte sur les partitions si lisible
- Annotations, barnier (gaffer coloré), marquages au sol
- Filigrane/watermark sur les photos

**D) CONTEXTE** :
- Moment : montage / répétition / concert
- Nombre de musiciens visibles
- La salle (si identifiable)
- Tout autre détail pertinent

### ÉTAPE 3 : COMPARAISON PLAN vs TERRAIN

Compare ce que le PDF prévoyait avec ce que les photos montrent :

Pour chaque instrument du plan :
- ✅ CONFIRMÉ : visible sur les photos, conforme au plan
- ⚠️ MODIFIÉ : présent mais différent (position, modèle, quantité)
- ❌ ABSENT : prévu sur le plan mais pas visible sur les photos
- ❓ INCERTAIN : impossible à confirmer depuis les angles disponibles

Instruments AJOUTÉS (visibles sur les photos mais PAS sur le plan) :
- 🆕 AJOUT : [instrument] — probablement ajouté par le musicien/chef

### ÉTAPE 4 : LISTE MATÉRIEL FINALE (TERRAIN)

Génère la liste de matériel RÉELLE basée sur les photos (pas le plan) :

```
PERCU 1 :
  CLAVIERS
    - [instrument]
  TIMBALES & PEAUX
    - [instrument]
  ...

PERCU 2 :
  ...
```

### ÉTAPE 5 : SCORE DE FIABILITÉ

- Instruments confirmés : X / Y du plan
- Instruments modifiés : X
- Instruments ajoutés : X
- Instruments absents : X
- Confiance globale : HAUTE / MOYENNE / BASSE
- Photos manquantes ? (angles qui auraient aidé)

Réponds en français. Sois exhaustif mais honnête sur tes incertitudes.
```

---

## PROMPT 2 — Analyse de dessin à la main (plan de dessus)

> Envoyer : une photo d'un croquis/schéma fait à la main par un garçon d'orchestre ou régisseur.

```
Tu es un assistant spécialisé en régie de concert et plans de plateau orchestral.

Cette image est un DESSIN À LA MAIN (croquis, schéma) d'un plan de dessus d'une installation de percussions sur un plateau de concert. Ce type de dessin est fait par les garçons d'orchestre ou les régisseurs pour documenter le placement du matériel.

### 1. LECTURE DU PLAN

Identifie et liste tous les éléments dessinés :
- Instruments représentés (même par des symboles simples)
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
- Noms d'instruments, annotations, numéros
- Noms de compositeurs ou de pièces
- Couleurs mentionnées (barnier)
- Flèches ou indications de direction

### 4. RECONSTITUTION JSON

Si tu devais reconstituer ce plan pour une app, donne-moi la structure :
```json
{
  "titre": "...",
  "percussionnistes": [
    {
      "nom": "P1",
      "instruments": [
        {
          "type": "clavier",
          "nom": "Marimba",
          "x_pct": 30,
          "y_pct": 50,
          "largeur_pct": 15,
          "hauteur_pct": 5,
          "rotation": 0
        }
      ]
    }
  ]
}
```

### 5. CONFIANCE

Pour chaque élément identifié :
- CERTAIN : texte lisible ou forme sans ambiguïté
- PROBABLE : forme reconnaissable mais pas de texte
- INCERTAIN : forme ambiguë, texte illisible

Réponds en français. En cas de doute, propose plusieurs interprétations.
```

---

## PROMPT 3 — Photo seule (sans plan de référence)

> Quand on n'a que la photo, sans plan PDF.

```
Tu es un assistant spécialisé en régie de concert et installations de percussions orchestrales.

Analyse cette photo d'une installation de percussions sur un plateau de concert.

### 1. IDENTIFICATION DU MATÉRIEL

Liste TOUT le matériel visible, classé par catégorie :

CLAVIERS | TIMBALES & PEAUX | ACCESSOIRES | GROSSES PIÈCES | STANDS & SUPPORTS | BAGUETTES & SPÉCIAL

Pour chaque instrument :
- Nom exact si identifiable (marque, modèle, taille)
- Quantité
- Confiance : CERTAIN / PROBABLE / INCERTAIN

### 2. DISPOSITION SPATIALE

Décris la disposition :
- Côté JARDIN (gauche vu de la salle) ?
- CENTRE ?
- Côté COUR (droite vu de la salle) ?
- DEVANT (côté chef) vs DERRIÈRE ?

### 3. TEXTE VISIBLE

Retranscris tout texte visible :
- Annotations, filigrane/watermark
- Marques d'instruments
- Marquages au sol (barnier/gaffer)

### 4. CONTEXTE

Déduis si possible :
- Nombre de percussionnistes
- Type de répertoire (classique, contemporain, opéra)
- Moment (montage, répétition, concert)
- Salle

### 5. GÉNÈRE LA LISTE TXT

```
PERCU 1 :
  CLAVIERS
    - ...
  TIMBALES & PEAUX
    - ...
  ACCESSOIRES
    - ...
  GROSSES PIÈCES
    - ...
```

Réponds en français. Sois exhaustif mais honnête sur tes incertitudes.
```

---

## Données de test

### Cas de test : ETYMO (Francesconi)

**PDF** : `test-data/FRANCESCONI_ETYMO.pdf`
- Luca FRANCESCONI — ETYMO
- Dir : Pascal ROPHÉ — CMPP — 26 mars 2026
- Percu 1 : Vibraphone 3 oct, Xylophone, Glockenspiel, Marimba 4,5 oct, Tam-tam 100cm
- Percu 2 : Marimba, Xylo, Glock valise, Bongos, Tam-tam grave, Grelots, 2 Roto-toms, Cymbale susp.
- Soprane, clavier électronique visible sur le plan

**Photos** : `test-data/etymo-photos/`
- 4210.jpg — vue de dessus rapprochée P1 (vibraphone, glockenspiel, xylophone, caisse claire, cymbales, tam-tam)
- 4213.jpg — vue de dessus P1 élargie (marimba, vibraphone, glockenspiel, tam-tam, caisse claire, bongos, cymbales, clavier électronique)
- 4216.jpg — vue de dessus P2 (marimba, vibraphone, glockenspiel, tam-tam, clavier électronique)
- 4219.jpg — vue large du plateau complet (ensemble, chef, cordes, vents, percussions au fond)
- 4222.jpg — vue large chef au pupitre (ensemble complet, harpe visible côté cour)
- 4225.jpg — vue large chef (autre angle, ensemble complet)

**Notes terrain** :
- Les photos sont prises depuis les balcons supérieurs (vue plongeante)
- On voit le marquage au sol (scotch bleu = positions)
- Le chef (Pascal Rophé) est visible en chemise blanche
- Les musiciens sont en tenue de répétition
- Une harpe est visible côté cour (pas sur le plan percu, mais fait partie de l'effectif)
- Un clavier électronique est visible (possiblement le "Soprane" du plan)

---

## Grille de notation

| Critère | Description | /5 |
|---------|-------------|-----|
| **Exhaustivité** | Combien d'instruments correctement identifiés ? | |
| **Précision** | Faux positifs ? Instruments inventés ? | |
| **Texte** | Qualité de lecture du texte / marques / filigrane | |
| **Spatialité** | Qualité de la description jardin/centre/cour | |
| **Comparaison** | Qualité du diff plan vs photos | |
| **Confiance** | Le modèle sait-il dire "je ne suis pas sûr" ? | |
| **Format** | Respect de la structure demandée | |
| **TOTAL** | | **/35** |

### Résultats par modèle

| Critère | Claude | GPT-4o | Gemini | GLM-4 | Notes |
|---------|--------|--------|--------|-------|-------|
| Exhaustivité | /5 | /5 | /5 | 4/5 | GLM: bon mais invente des polyblocks |
| Précision | /5 | /5 | /5 | 3/5 | GLM: hi-hat douteux, GC non confirmée |
| Texte | /5 | /5 | /5 | 3/5 | GLM: n'a pas lu le filigrane rouge |
| Spatialité | /5 | /5 | /5 | 4/5 | GLM: bonne description J/C |
| Comparaison | /5 | /5 | /5 | 4/5 | GLM: 95% conformité, crédible |
| Confiance | /5 | /5 | /5 | 4/5 | GLM: utilise CERTAIN/PROBABLE |
| Format | /5 | /5 | /5 | 5/5 | GLM: format parfait |
| **TOTAL** | /35 | /35 | /35 | **27/35** | |
