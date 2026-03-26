# PlateauMap — Prompts de test Vision IA

## Confidentialité

Les photos et plans sont des documents de travail appartenant à l'orchestre.
Ne jamais publier les photos sur un repo public. Les garder en local uniquement.
Le dossier `test-data/` est dans le `.gitignore`.

---

## Contexte

Ces prompts servent à tester les LLM vision sur des photos et plans de plateau orchestral.
L'objectif est de générer automatiquement la fiche technique d'un concert au format des plans AutoCAD de Radio France / Maison de la Radio.

### Principe : LE TERRAIN PRIME

On envoie d'abord le PDF (plan théorique), puis les photos (réalité terrain).
Si les photos montrent quelque chose de différent du plan, c'est que les musiciens ou le chef a changé l'installation.
**Les photos ont toujours raison sur le plan.**

---

## PROMPT 1 — Extraction complète au format plan de plateau

> Envoyer : le PDF du plan AutoCAD d'abord, puis les photos de l'installation.
> Le prompt demande l'effectif COMPLET de l'orchestre, pas seulement les percussions.

```
Tu es un régisseur de plateau spécialisé en musique orchestrale et contemporaine.

Je te fournis un plan de plateau (PDF AutoCAD) et des photos prises pendant le montage ou la répétition.
Le plan est le PROJET. Les photos sont la RÉALITÉ. Si les photos contredisent le plan, les photos ont raison.

Génère la fiche technique complète du concert au format suivant (c'est le format standard des plans AutoCAD de Radio France / Philharmonie) :

═══════════════════════════════════════════════════
[COMPOSITEUR en majuscules]
[Titre de l'œuvre]
Durée : [XX']
Direction : [Chef d'orchestre]
Salle : [Nom de la salle]
Date : [Date]
═══════════════════════════════════════════════════

EFFECTIF ORCHESTRAL
───────────────────────────────────────────────────
Cordes :      Vl1 [n] pup. — Vl2 [n] pup. — Vla [n] pup. — Vlc [n] pup. — CB [n] pup.
Bois :        [n] Fl (+ Picc) — [n] Htb (+ CA) — [n] Cl (+ Cl basse) — [n] Fg (+ Cfg)
Cuivres :     [n] Cor — [n] Tp — [n] Tb — [n] Tuba
Percussion :  [n] Timbalier — [n] Percussionniste(s)
Autres :      Harpe — Piano — Célesta — Orgue — [Soliste] — [Électronique]

MOBILIER & STANDS
───────────────────────────────────────────────────
Pupitres :    [n] pupitres Manhasset / Riedel
Chaises :     [n] chaises orchestre
Estrade :     [description si présente]
Podium chef : [type]
Tabourets :   [n] (contrebasses, harpe, etc.)
Piano :       [type — queue, demi-queue, droit] + banc
Harpe :       [position : cour/jardin]
Retours son : [n] enceintes de retour
Micros :      [description si visible]

TIMBALIER
───────────────────────────────────────────────────
Position :    [Jardin / Centre / Cour]
Timbales :    [nombre] — tailles si identifiables
Accessoires : [mailloches, sourdines, etc.]
Stands :      [n] pieds, tables
Pupitres :    [n]

PERCU 1
───────────────────────────────────────────────────
Position :    [Jardin / Centre / Cour]

  CLAVIERS
    - [instrument] (marque/modèle si visible)
    - ...
  
  TIMBALES & PEAUX
    - ...
  
  ACCESSOIRES
    - ...
  
  GROSSES PIÈCES
    - ...
  
  STANDS & SUPPORTS
    - [n] pieds de cymbale
    - [n] tables d'accessoires
    - [n] pupitres
    - [n] chaises / tabourets
    - ...
  
  BAGUETTES & SPÉCIAL
    - ...

PERCU 2
───────────────────────────────────────────────────
[même format]

...

PLAN DE DESSUS (description textuelle)
───────────────────────────────────────────────────
Décris la disposition vue de dessus, de Jardin à Cour :

JARDIN (gauche vu de la salle) :
  - [ce qui s'y trouve]

CENTRE :
  - [ce qui s'y trouve]

COUR (droite vu de la salle) :
  - [ce qui s'y trouve]

DEVANT (côté chef / public) :
  - [ce qui s'y trouve]

FOND DE SCÈNE :
  - [ce qui s'y trouve]

ÉCARTS PLAN vs TERRAIN
───────────────────────────────────────────────────
Si les photos montrent des différences avec le plan PDF :

  ✅ CONFORME : [élément] — identique au plan
  ⚠️ MODIFIÉ : [élément] — [ce qui a changé]
  🆕 AJOUTÉ : [élément] — pas sur le plan, visible sur les photos
  ❌ RETIRÉ : [élément] — sur le plan, pas visible sur les photos

CONFIANCE GLOBALE : [HAUTE / MOYENNE / BASSE]
PHOTOS MANQUANTES : [angles qui auraient aidé]

Réponds en français. Sois exhaustif sur le mobilier et les stands — chaque pupitre, chaque chaise, chaque pied de cymbale compte pour le montage.
```

---

## PROMPT 2 — Photos seules (sans plan PDF)

> Quand on n'a que les photos, pas de plan de référence.

```
Tu es un régisseur de plateau spécialisé en musique orchestrale et contemporaine.

Analyse ces photos d'un plateau de concert et génère la fiche technique complète.

Génère au format plan AutoCAD standard :

═══════════════════════════════════════════════════
[COMPOSITEUR] — [Titre] — [Durée si lisible]
[Chef] — [Salle] — [Date si lisible]
═══════════════════════════════════════════════════

EFFECTIF ORCHESTRAL (déduit des photos)
───────────────────────────────────────────────────
Cordes :      Vl1 [n] pup. — Vl2 [n] pup. — Vla [n] pup. — Vlc [n] pup. — CB [n] pup.
              (compter les pupitres visibles)
Bois :        Identifier les instruments à vent visibles
Cuivres :     Identifier les cuivres visibles
Percussion :  [n] postes de percussions
Autres :      Harpe, piano, soliste, électronique

MOBILIER & STANDS
───────────────────────────────────────────────────
Pupitres :    [compter tous les pupitres visibles]
Chaises :     [compter les chaises]
Estrade :     [oui/non, description]
Piano :       [type, position]
Harpe :       [position]

PERCU [n] (pour chaque poste)
───────────────────────────────────────────────────
  CLAVIERS
    - ...
  TIMBALES & PEAUX
    - ...
  ACCESSOIRES
    - ...
  GROSSES PIÈCES
    - ...
  STANDS & SUPPORTS
    - [n] pieds cymbale
    - [n] tables accessoires
    - [n] pupitres
    - [n] chaises/tabourets

PLAN DE DESSUS
───────────────────────────────────────────────────
JARDIN : ...
CENTRE : ...
COUR : ...

Pour chaque instrument identifié, indique :
- CERTAIN / PROBABLE / INCERTAIN
- Marque si lisible

Réponds en français. Compte tout le mobilier visible.
```

---

## PROMPT 3 — Dessin à la main

> Pour les croquis/schémas faits à la main.

```
Tu es un régisseur de plateau spécialisé en plans de scène orchestraux.

Cette image est un DESSIN À LA MAIN d'un plan de plateau. 

Conventions de lecture :
- Rectangles allongés = claviers (marimba, xylo, vibra)
- Grands cercles = timbales, gongs, tam-tams
- Petits cercles = cymbales, accessoires
- "P1", "P2" = numéro de percussionniste
- Chef = en bas (côté public)
- Jardin = gauche, Cour = droite (vu du public)

Génère la fiche technique au même format que le Prompt 1 :
- En-tête (titre, compositeur, durée, chef, salle)
- Effectif orchestral complet
- Mobilier & stands
- Détail par percussionniste
- Plan de dessus textuel

Retranscris TOUT le texte manuscrit visible.

Pour la reconstitution numérique, donne aussi le JSON :
```json
{
  "titre": "...",
  "compositeur": "...",
  "effectif": { "cordes": "...", "bois": "...", "cuivres": "...", "percussions": "..." },
  "postes_percu": [
    {
      "nom": "P1",
      "position": "jardin",
      "instruments": [
        { "nom": "Marimba", "type": "clavier", "x_pct": 25, "y_pct": 60 }
      ]
    }
  ]
}
```

Confiance par élément : CERTAIN / PROBABLE / INCERTAIN.
Réponds en français.
```

---

## Grille de notation

| Critère | Description | /5 |
|---------|-------------|-----|
| **Effectif** | Cordes, bois, cuivres, percus bien identifiés ? Nombre de pupitres ? | |
| **Mobilier** | Pupitres, chaises, estrades, piano, harpe comptés ? | |
| **Percussions** | Instruments correctement identifiés par poste ? | |
| **Stands** | Pieds, tables, racks comptés pour chaque percu ? | |
| **Spatialité** | Disposition jardin/centre/cour correcte ? | |
| **Texte** | Marques, annotations, marquages lus ? | |
| **Comparaison** | Diff plan vs photos pertinent ? | |
| **Confiance** | Le modèle sait dire "je ne suis pas sûr" ? | |
| **Format** | Respect du format plan AutoCAD demandé ? | |
| **TOTAL** | | **/45** |

| Critère | Claude | GPT-4o | Gemini | GLM-4 |
|---------|--------|--------|--------|-------|
| Effectif | /5 | /5 | /5 | /5 |
| Mobilier | /5 | /5 | /5 | /5 |
| Percussions | /5 | /5 | /5 | /5 |
| Stands | /5 | /5 | /5 | /5 |
| Spatialité | /5 | /5 | /5 | /5 |
| Texte | /5 | /5 | /5 | /5 |
| Comparaison | /5 | /5 | /5 | /5 |
| Confiance | /5 | /5 | /5 | /5 |
| Format | /5 | /5 | /5 | /5 |
| **TOTAL** | /45 | /45 | /45 | /45 |
