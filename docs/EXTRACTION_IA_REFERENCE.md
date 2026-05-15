# OrkMap — Référence extraction IA

## Principe fondamental

**LE TERRAIN PRIME.** Si les photos contredisent le plan, les photos ont raison.

L'extraction IA doit produire 3 blocs de données structurées à partir de n'importe quel type de source :

1. **PERCUSSIONS** — détail par poste (Timbalier, Percu 1, Percu 2…) avec chaque instrument identifié
2. **INSTRUMENTS** — effectif orchestral complet (bois, cuivres, cordes, autres)
3. **MOBILIER** — inventaire précis du matériel de régie (pupitres, chaises par type, stands, tablettes…)

En-tête commun : Titre, Compositeur, Durée, Chef, Orchestre, Salle, Date, Nomenclature Daniels resserrée.

---

## Les 19 familles de l'orchestre (colonnes de référence)

Dans cet ordre exact (= colonnes du fichier Numbers de référence) :

```
Flûtes | Hautbois | Clarinettes | Clar Basse | Bassons | Contrebasson |
Cors | Trompettes | Trombones | Tuba |
Timbales | Percussions | Harpe | Piano |
Violons I | Violons II | Altos | Violoncelles | Contrebasses
```

### Notation Daniels

```
BOIS           CUIVRES        PERCUSSIONS         CORDES
Fl.Hb.Cla.Bn — Cor.Tp.Tbn.Tub — Timb.Perc.Hp.Clav — V1.V2.Alt.Vlc.Cb
3.3.3.3       - 4.3.3.1        - 1.3.2.1           - 16.14.12.10.8
```

Séparateurs groupes : `/` ou ` - `
Séparateurs intra-groupe : `.` ou `-`
Brackets : `[Cel/Pno]` = claviers supplémentaires
Suffixes : `(pic)`, `+eh`, `*3` = doublings
Préfixe `*` = pupitre dédié (pas un doublage)

### Types d'orchestre et effectifs variables

L'IA doit comprendre que l'orchestre symphonique n'est qu'un type parmi d'autres. Les effectifs varient radicalement :

| Type | Effectif typique | Particularités |
|------|-----------------|----------------|
| **Orchestre symphonique** | 80-120 musiciens | Nomenclature Daniels classique : `3.3.3.3 - 4.3.3.1 - 1.3 - 16.14.12.10.8` |
| **Orchestre de chambre** | 20-50 musiciens | Cordes réduites (ex: 8.6.4.4.2), parfois sans cuivres lourds |
| **Ensemble de musique contemporaine** | 5-30 musiciens | Souvent 1 par pupitre, effectifs très variables, instruments rares |
| **Ensemble baroque** | 10-40 musiciens | **Continuo** = clavecin + théorbe/luth + viole de gambe/violoncelle. Orgue possible. Cordes en boyau, instruments d'époque |
| **Musique de chambre** | 2-10 musiciens | 1 musicien par pupitre, pas de chef |
| **Opéra** | 60-100+ musiciens | Fosse d'orchestre, contraintes spatiales spécifiques |

**Continuo baroque** — L'IA doit reconnaître la basse continue :
- Clavecin (obligatoire sauf exceptions)
- Théorbe / chitarrone / luth (cordes pincées)
- Viole de gambe (basse) OU violoncelle
- Orgue (orgue positif de continuo)
- Parfois basson doublant la basse

**Instruments baroques spécifiques** : flûte à bec (soprano, alto, ténor), hautbois baroque, trompette naturelle (sans pistons), cor naturel, sacqueboute (trombone ancien), viole de gambe (dessus, ténor, basse), violone.

⚠️ **Piège LLM** : ne JAMAIS supposer un effectif symphonique standard. Lire le plan/texte tel quel. Un plan EIC aura souvent 1 violon, 1 alto, 1 violoncelle — pas 16+14+12.

### Abréviations standards

| Famille | Abréviations acceptées |
|---------|----------------------|
| Flûtes | fl, Fl, flûte, flauto, flt |
| Hautbois | ob, hb, htb, hautbois, oboe |
| Cor anglais | CA, Eh, eng hn, cor anglais |
| Clarinettes | cl, cla, clarinette, clarinet |
| Clarinette basse | ClaB, bcl, Ebcl, bass cl |
| Bassons | bn, bsn, fg, basson, fagott |
| Contrebasson | cbn, cfg, contrebasson, contrafagotto |
| Cors | cor, hn, horn, cor en fa |
| Trompettes | tp, trp, trompette, trumpet |
| Trombones | tbn, trb, trombone, pos |
| Tuba | tub, tuba |
| Timbales | tmp, timb, timbales, timpani |
| Percussions | perc, percu, percussion |
| Harpe | hp, harpe, harp |
| Piano | pno, piano |
| Célesta | cel, célesta, celesta |
| Violons I | V1, Vl1, Vln1, vn1 |
| Violons II | V2, Vl2, Vln2, vn2 |
| Altos | Alt, Vla, Va, alto, viola |
| Violoncelles | Vlc, Vc, Cello, violoncelle |
| Contrebasses | CB, Cb, DB, contrebasse, double bass |

### Instruments baroques et continuo

| Instrument | Abréviations acceptées |
|-----------|----------------------|
| Clavecin | cem, hpd, clavecin, harpsichord, cembalo |
| Orgue (continuo) | org, orgue, organ, orgue positif |
| Théorbe | théorbe, theorbo, chitarrone |
| Luth | luth, lute, laute |
| Viole de gambe | vdg, viole, viol, viola da gamba, gambe |
| Flûte à bec | fl.bec, recorder, flauto dolce, Bfl |
| Hautbois baroque | hb.bar, baroque oboe |
| Trompette naturelle | tp.nat, natural trumpet, clarino |
| Cor naturel | cor.nat, natural horn, corno da caccia |
| Sacqueboute | sacq, sackbut, sacqueboute |
| Violone | violone |

---

## Règles mobilier (CRITIQUE — varie par orchestre)

### Pupitres
- **Harmonie** (bois + cuivres) : 1 pupitre = 1 musicien
- **Cordes** : 1 pupitre = 2 musiciens (ils partagent un pupitre)
- **Percussions** : pas de pupitres standards → tablettes percu

### Assises orchestre (dans la page MOBILIER)

| Type | Usage | Détail |
|------|-------|--------|
| Chaises standards | Cordes, bois, cuivres | La majorité de l'orchestre |
| Chaises hautes R&S | Contrebasses OU percussions | **Dépend de l'orchestre** |
| Chaises hautes Percu / Kolberg | Percussions (certains orchestres) | Kolberg = tournantes mais VISSABLES (blocage rotation) |
| Chaises spécifiques Vlc | Violoncelles | Plus basses, inclinées |
| Chaises australiennes | Alternative ergonomique | Certains orchestres seulement |
| Banquettes | Piano, Célesta, parfois Harpe, parfois Vlc solo | Assise longue |
| Tabourets | Contrebasses (certains orchestres) | |

⚠️ **INVERSION POSSIBLE** : un orchestre peut utiliser R&S pour les basses et Kolberg pour les percus, un autre fait l'inverse. L'IA ne doit JAMAIS supposer le type de chaise — elle doit le VOIR sur le plan ou la photo.

⚠️ **La chaise/tabouret timbalier et les chaises percu vont dans la page PERCU**, pas dans mobilier général.

### Chaise haute toujours présente (1)
= Pour le **chef en répétition** (pas sur scène en concert). C'est le "1" par défaut dans le template.

### Stands instruments (1 par famille si musiciens présents)
Stand Flûtes, Stand Hautbois, Stand Clarinettes, Stand Clar Basse, Stand Bassons, Stand Contrebasson, Stand Cors, Stand Trompettes, Stand Trombones, Stand Tuba, Stand Contrebasses.

### Autre mobilier orchestre
- Tablettes d'harmonie (pour poser les partitions des bois/cuivres)
- Râteau (porte-partitions collectif)
- Mallette Cordes Harpe (si harpe)
- Planches à Pic (pour les contrebasses — pieds antidérapants)
- Pare-sons (écrans acoustiques entre sections)

### ⚠️ Ce qui va dans la page PERCU, PAS dans mobilier
- Tablettes percu (tables d'accessoires)
- Pieds de cymbale, pieds de caisse claire
- Cols de cygne
- Portiques tam-tam / gong
- Chaise timbalier (tournante)
- Chaises/tabourets percu
- Racks, pinces, supports
- Tout le matériel listé dans "STANDS & SUPPORTS PERCU" plus bas

---

## Instruments de percussion — Référence complète

D'après la nomenclature visuelle d'Alexandre (nomenclature-OrchestreFINAL2.png).

### PEAUX
- Timbales (2, 3, ou 4 — avec tailles)
- Grosse caisse (L, M)
- Caisse claire (M)
- Tambour militaire
- Tom (avec diamètre)
- Rototom
- Bongos
- Congas (Tumba, Conga, Quinto)
- Tambourin basque
- Timbale baroque
- Bodhran

### CLAVIERS
- Vibraphone (3 oct, 3.5 oct)
- Marimba (4 oct, 4.5 oct, 5 oct)
- Xylophone
- Glockenspiel (à pédale)
- Glockenspiel valise (portable)
- Célesta
- Cloches tubes (avec notes si spécifiées)
- Crotales (en octave, 2 octaves)
- Steel drum
- Cloche église

### MÉTAUX / CYMBALES
- Cymbales frappées (paire)
- Cymbale suspendue (avec diamètre)
- Cymbale cloutée
- Cymbale charleston (hi-hat / charley)
- Cymbale splash
- Cymbale chinoise (avec taille)
- Cymbale crash
- Lait de cygne (cymbale sur tige flexible)
- Arbre à cymbales
- Triangle
- Gong (avec diamètre, ou sur cadre)
- Tam-tam (avec diamètre — DIFFÉRENT du gong)
- Piqûninos (en octave)
- Plaque tonnerre (tôle tonnerre)

### BOIS / DIVERS
- Wood block (sur barre ou individuel)
- Temple block (sur barre ou individuel)
- Tambour de bois
- Guiro
- Claves
- Maracas
- Castagnettes
- Sand blocks
- Fouet

### EFFETS / SPÉCIAUX
- Spring drum (Thunder tongue)
- Spring coil
- Lion's roar (tambour à friction)
- Machine à vent
- Bell tree
- Bamboo tree (bambou chime)
- Chime (mark tree)
- Boobam

### STANDS & SUPPORTS PERCU (dans la liste PERCU, PAS dans mobilier général)

**Tablettes / Tables d'accessoires** :
- Tablette petite (365×305 mm type R&S PIE 5303)
- Tablette grande (365×590 mm type R&S PIE 5301)
- Tablette grande avec compartiments baguettes (R&S PIE 5302)

**Pieds / Stands** :
- Pied de cymbale (droit ou perche/boom)
- Pied de caisse claire
- Pied de grosse caisse
- Pied de tom
- Col de cygne (gooseneck — pour cymbale suspendue, petite percussion)
- Stand cymbales frappées (paire)
- Stand triangle (pince + tige)
- Stand tam-tam / gong (portique — simple ou double niveau)
- Support bongos
- Support congas
- Support cloches tubes (cadre)
- Support crotales (cadre 1 ou 2 niveaux)
- Portique modulaire (1 à 5 niveaux, type R&S)

**Racks & systèmes** :
- Rack multi-percussion (système combiné Kolberg)
- Pinces / clamps (fixation sur rack)

**Assises percu** :
- Chaise timbalier (TOURNE — pivot pneumatique, Kolberg 3110 ou R&S ELISE®)
- Chaise/tabouret percu haute (Kolberg 3110H, hauteur 72-98 cm)
- Tabouret percu voyage (Kolberg 3117, pliant)

### ÉQUIPEMENTS IMPLICITES

Quand l'IA identifie un instrument, elle doit AUSSI compter le support associé :

| Instrument | Implique automatiquement |
|-----------|------------------------|
| Triangle | 1 pied + 1 pince/clip triangle |
| Cymbale suspendue | 1 pied de cymbale OU 1 col de cygne |
| Cymbales frappées | 1 stand cymbales frappées (ou tenues à la main) |
| Caisse claire | 1 pied de caisse claire |
| Grosse caisse | 1 support grosse caisse |
| Tam-tam / Gong | 1 portique (partagé si même poste) |
| Bongos | 1 support bongos (sauf si sur table) |
| Congas | 1 support par conga |
| Cloches tubes | 1 cadre cloches tubes |
| Crotales | 1 cadre crotales (1 ou 2 niveaux) |
| Temple blocks (barre) | 1 support barre + 1 pied |
| Wood blocks (barre) | 1 support barre + 1 pied |
| Tout accessoire petit | 1 tablette d'accessoires (partagée) |
| Tout clavier | Aucun support supplémentaire (pieds intégrés) |
| Timbales | Aucun support (pieds intégrés) |

---

## Tessiture des instruments à sons déterminés

Base de référence pour la vérification de partitions (Phase 4).
Sources : Kolberg, Adams, Bergerault, Yamaha.

### Claviers

| Instrument | Taille | Tessiture | Notation |
|-----------|--------|-----------|----------|
| **Marimba** | 3 oct | C4 – C7 | Son réel |
| **Marimba** | 4 oct | C3 – C7 | Son réel |
| **Marimba** | 4.3 oct | A2 – C7 | Son réel (Adams, Bergerault standard) |
| **Marimba** | 4.5 oct | F2 – C7 | Son réel (Bergerault Campus Bass) |
| **Marimba** | 4.6 oct | E2 – C7 | Son réel (Bergerault Signature) |
| **Marimba** | 5 oct | C2 – C7 | Son réel (concert standard) |
| **Vibraphone** | 3 oct | F3 – F6 | Son réel (standard orchestral) |
| **Vibraphone** | 3.5 oct | C3 – F6 | Son réel (Adams Alpha) |
| **Xylophone** | 3.5 oct | F4 – C8 | Sonne 1 octave au-dessus de l'écrit |
| **Xylophone** | 4 oct | C4 – C8 | Sonne 1 octave au-dessus de l'écrit |
| **Glockenspiel pédale** | 3 oct | C5 – C8 | Sonne 2 octaves au-dessus de l'écrit |
| **Glockenspiel valise** | 2.5 oct | F5 – C8 | Sonne 2 octaves au-dessus de l'écrit |
| **Célesta** | 4 oct | C4 – C8 | Sonne 1 octave au-dessus de l'écrit |
| **Crotales** | 1 oct | C6 – C7 (ou C7-C8) | Son réel |
| **Crotales** | 2 oct | C6 – C8 | Son réel |
| **Cloches tubes** | 1.5 oct | C4 – F5 | Son réel (18 tubes standard) |
| **Cloches tubes** | 2 oct | F3 – F5 | Son réel (25 tubes) |

### Timbales (par taille de fût)

| Taille | Tessiture | Notes |
|--------|-----------|-------|
| 20" | F3 – C4 | Aigu (ajout optionnel) |
| 23" | D3 – A3 | Petit standard |
| 25" | Bb2 – F3 | |
| 26" | A2 – E3 | Moyen standard |
| 28" | F2 – C3 | Grand standard |
| 29" | F2 – C3 | Grand alternatif |
| 30" | E2 – B2 | Grave étendu |
| 32" | D2 – A2 | Le plus grave |

**Jeu standard 4 timbales** : 32" + 29" + 26" + 23" → D2 – A3
**Jeu étendu 5 timbales** : + 20" → D2 – C4

---

## Types de sources et stratégie d'extraction

L'app reçoit des sources très variées. Le workflow réel d'un régisseur :

1. **Import de plan** (PDF AutoCAD ou Photoshop, parfois JPEG) — contient un cartouche (ensemble, date, lieu, chef, nomenclature Daniels) + le plan au-dessus
2. **Dessins à la main des percussionnistes** — les percu envoient des croquis manuscrits de leur setup pour que les régisseurs puissent installer au mieux
3. **Listes texte** — copié-collé de programme, email, fichier TXT
4. **Photos terrain** — correction et complétion : rajouter ce qui manque dans le plan d'après ce qu'on voit sur les photos
5. **Partitions** (futur, en ligne sur le site) — vérification que TOUS les instruments (toutes les percus) sont bien renseignés, signalement des erreurs avec localisation dans la partition

Le résultat de tout ça est archivable : plans + photos + listes texte par pièce et par concert, avec recherche par date, compositeur, orchestre, pièce.

### Source 1 : PDF plan AutoCAD / Photoshop

**Ce qu'on reçoit** : Document vectoriel (AutoCAD) ou raster (Photoshop) avec texte structuré + formes géométriques. Exporté en PDF ou JPEG.
**Ce qu'on peut en tirer** : TOUT (effectif, mobilier, percussions détaillées, disposition spatiale).

**Structure typique** : un **cartouche** (bloc d'informations) contenant ensemble/date/lieu/chef/nomenclature Daniels, avec le plan de plateau au-dessus.

**Détection du format** :
- EIC : présence de `Perc N :` dans le texte
- Radio France : présence de `Objet :` + `Nomenclature :`
- Lamoureux : `Effectif :` + notation slash
- Générique : fallback patterns

**Pipeline** :
1. pdfjs-dist extrait le texte brut côté client
2. Le parser identifie le format et extrait les champs structurés
3. Si le texte est insuffisant → envoi à l'IA Vision (Gemini Flash) pour analyse des formes

**Prompt spécialisé — PDF AutoCAD** :

```
Tu es un régisseur de plateau spécialisé en musique orchestrale, contemporaine et baroque.

Je te fournis un plan de plateau au format PDF (AutoCAD ou Photoshop).

ATTENTION : l'effectif peut être symphonique (80-120), de chambre (20-50), contemporain (5-30), baroque (10-40 avec continuo) ou musique de chambre pure (2-10). Ne JAMAIS supposer un effectif symphonique — lis ce qui est écrit.

Extrais TOUTES les informations suivantes et retourne-les en JSON structuré.

## EN-TÊTE
- titre: string (nom de l'œuvre)
- compositeur: string
- duree: string (format "XX'" ou "~XX'")
- chef: string
- orchestre: string
- salle: string
- date: string

## NOMENCLATURE DANIELS
Un objet avec le nombre de musiciens par famille :
{ flutes, hautbois, clarinettes, clarBasse, bassons, contrebasson, cors, trompettes, trombones, tuba, timbales, percussions, harpe, piano, violons1, violons2, altos, violoncelles, contrebasses }
+ le string Daniels resserré (ex: "3.3.3.3 - 4.3.3.1 - 1.3.2.1 - 16.14.12.10.8")

## PERCUSSIONS (détail par poste)
Pour chaque poste (Timbalier, Percu 1, Percu 2, etc.) :
{
  nom: string,
  position: "jardin" | "centre" | "cour",
  instruments: [
    {
      nom: string,
      categorie: "Peaux" | "Claviers" | "Métaux/Cymbales" | "Bois/Divers" | "Effets/Spéciaux",
      quantite: number,
      details: string (taille, marque, notes),
      confiance: "CERTAIN" | "PROBABLE" | "INCERTAIN"
    }
  ]
}

## MOBILIER
{
  musiciens: number (total),
  pupitres: number (total — rappel : 1/musicien harmonie, 1/2 musiciens cordes),
  chaisesStandards: number,
  chaisesHautesRS: number,
  chaisesHautesPercu: number,
  chaiseSpecifiqueVlc: number,
  chaisesAustraliennes: number,
  chaiseTimbalier: number (0 ou 1 — chaise tournante spécifique),
  banquettes: number (piano, célesta, harpe, vlc solo),
  tablettesHarmonie: number,
  tablettesPercu: number,
  rateau: number,
  stands: { flutes, hautbois, clarinettes, clarBasse, bassons, contrebasson, cors, trompettes, trombones, tuba, contrebasses },
  malletteCordesHarpe: number (0 ou 1),
  planchesAPic: number (contrebasses),
  pareSons: number,
  podiumChef: boolean,
  piano: { type: "queue" | "demi-queue" | "droit", marque: string } | null,
  harpe: { position: "jardin" | "cour" } | null
}

## DISPOSITION SPATIALE
Description textuelle jardin/centre/cour de la scène, vue de dessus.

## CONFIANCE
Pour chaque section : HAUTE / MOYENNE / BASSE + ce qui manque.

Réponds en JSON uniquement. Pas de texte autour.
```

---

### Source 2 : Photos de plateau

**Ce qu'on reçoit** : 1 à N photos prises pendant le montage ou la répétition.
**Ce qu'on peut en tirer** : Percussions (instruments, marques), mobilier visible, disposition, vérification vs plan.

**Principe** : Les photos sont la RÉALITÉ. Elles priment sur le plan.

**Pipeline** :
1. Photos envoyées à l'IA Vision (Kimi K2.5 Thinking ou Gemini)
2. Si un plan PDF existe aussi → comparaison plan vs terrain

**Prompt spécialisé — Photos de plateau** :

```
Tu es un régisseur de plateau spécialisé en musique orchestrale, contemporaine et baroque.

Analyse ces photos d'un plateau de concert prises pendant le montage ou la répétition.

ATTENTION : l'effectif peut être symphonique, de chambre, contemporain ou baroque (avec continuo : clavecin, théorbe, viole de gambe, orgue). Adapte ton analyse au type d'ensemble visible.

RÈGLES IMPORTANTES :
- Un vibraphone, marimba, xylophone, glockenspiel = CLAVIERS (pas "batterie" ou "drum kit")
- Distinguer glockenspiel à pédale (grand, sur pied) et glockenspiel valise (petit, portable)
- Un tam-tam est DIFFÉRENT d'un gong (tam-tam = plat sans bosse centrale, gong = avec bosse)
- Lire les MARQUES visibles (Yamaha, Adams, Bergerault, Musser, Sabian, Zildjian, LP…)
- Compter CHAQUE pupitre, chaque chaise, chaque pied de cymbale
- Distinguer les types de chaises : standards, hautes R&S, hautes percu/Kolberg, spécifiques Vlc
- Les chaises Kolberg tournantes ont une base ronde vissable
- Les banquettes = piano, célesta, harpe, vlc solo
- 1 pupitre harmonie = 1 musicien. 1 pupitre cordes = 2 musiciens.

Pour chaque instrument identifié, indique :
- CERTAIN : clairement visible et identifiable
- PROBABLE : forme compatible mais pas 100% sûr
- INCERTAIN : hypothèse basée sur le contexte

Retourne le résultat en JSON avec la même structure que pour les plans PDF :
{ entete, nomenclature, percussions, mobilier, disposition, confiance }

Éléments non identifiables : dis-le explicitement. Ne JAMAIS inventer.
```

**Prompt complémentaire — Comparaison plan vs photos** :

```
Tu as déjà analysé le plan PDF. Voici maintenant les photos du terrain réel.

Compare et signale :
  ✅ CONFORME : [élément] — identique au plan
  ⚠️ MODIFIÉ : [élément] — [ce qui a changé]
  🆕 AJOUTÉ : [élément] — pas sur le plan, visible sur les photos
  ❌ RETIRÉ : [élément] — sur le plan, pas visible sur les photos

Les photos ont TOUJOURS RAISON sur le plan.
Retourne le JSON mis à jour (version terrain) + le diff.
```

---

### Source 3 : Dessin à la main (croquis percu)

**Ce qu'on reçoit** : Photo ou scan d'un croquis manuscrit. Souvent envoyé par les percussionnistes eux-mêmes pour indiquer le détail de leur setup, afin que les régisseurs puissent installer au mieux.
**Ce qu'on peut en tirer** : Percussions détaillées, disposition. Effectif et mobilier partiels.

**Contexte** : Les symboles suivent la nomenclature d'Alexandre (nomenclature-OrchestreFINAL2.png) ou les conventions personnelles du percussionniste. L'IA doit connaître les conventions standard et s'adapter aux variantes.

**Pipeline** :
1. Photo du dessin → IA Vision (Gemini ou Kimi)
2. L'image de référence de la nomenclature peut être envoyée en contexte

**Prompt spécialisé — Dessin à la main** :

```
Tu es un régisseur de plateau spécialisé en plans de scène orchestraux.

Cette image est un DESSIN À LA MAIN d'un plan de plateau.

CONVENTIONS DE LECTURE (nomenclature standard régisseurs) :
- Rectangles allongés = claviers (marimba, xylo, vibra, glocken)
- Grands cercles = timbales, gongs, tam-tams
- Petits cercles = cymbales, accessoires
- Cercles avec croix intérieure = timbales (vue de dessus, tension croisée)
- Forme en U ou en arc = harpe vue de dessus
- Rectangle avec clavier = piano (queue, demi-queue)
- "P1", "P2", "Percu 1" = numéro de percussionniste
- "T" ou "Timb" = timbalier
- Chef = en bas (côté public)
- Jardin = gauche, Cour = droite (VU DU PUBLIC)

Retranscris TOUT le texte manuscrit visible.

Retourne le résultat en JSON structuré :
{ entete, nomenclature, percussions, mobilier, disposition, confiance }

Pour chaque élément identifié : CERTAIN / PROBABLE / INCERTAIN.
```

---

### Source 4 : Liste texte / TXT / CSV

**Ce qu'on reçoit** : Texte brut copié-collé, fichier TXT, ou CSV d'un programme.
**Ce qu'on peut en tirer** : Effectif complet, percussions, pas de spatial.

**Pipeline** :
1. Parser côté client (regex + heuristiques)
2. Si parsing échoue → envoi à l'IA texte (Gemini Flash ou GLM-OCR)

**Prompt spécialisé — Texte / Liste** :

```
Tu es un régisseur de plateau spécialisé en musique orchestrale, contemporaine et baroque.

Voici une liste d'instruments ou un programme de concert en texte brut.

Extrais les informations structurées :
- En-tête (titre, compositeur, durée, chef, orchestre, salle, date)
- Nomenclature Daniels (nombre de musiciens par famille)
- Percussions par poste si détaillé

RÈGLES :
- "Perc N :" ou "Percu N :" introduit un poste de percussionniste
- Les instruments peuvent avoir des quantités ("1 Xylo", "4 Timbales", "2 oct. de Crotales")
- Format Daniels : "3.3.3.3 - 4.3.3.1" = bois.bois.bois.bois - cuivres.cuivres.cuivres.cuivres
- Les doublings sont entre parenthèses : "2 Fl (+ Picc)" = 2 flûtistes dont 1 double au piccolo
- Si le texte mentionne "continuo", "b.c.", "basse continue" → ensemble baroque. Le continuo comprend typiquement clavecin + théorbe + viole de gambe/violoncelle
- Ne JAMAIS supposer un effectif symphonique. Lire les chiffres tels quels.

Retourne en JSON : { entete, nomenclature, percussions }
Le mobilier ne peut PAS être déduit d'un texte seul (il dépend de l'orchestre).
```

---

### Source 5 : Partition — Vérification en ligne (Phase 4)

**Ce qu'on reçoit** : PDF de partition scannée ou MusicXML.
**Ce qu'on peut en tirer** : Effectif théorique, tessiture, transpositions.

**Objectif** : vérifier que TOUS les instruments sont correctement renseignés dans la partition, y compris toutes les percussions. Si des erreurs sont trouvées :
- Annoncer l'erreur (instrument mal nommé, tessiture hors gamme, transposition manquante)
- Localiser l'erreur dans la partition (numéro de mesure, numéro de page, système)
- Distinguer erreur certaine vs avertissement (ex: note extrême mais jouable)

**Types d'erreurs à détecter** :
- Nomenclature incohérente (instrument annoncé en couverture mais absent, ou l'inverse)
- Tessiture hors gamme (note impossibles sur l'instrument — cf. TESSITURE_PERCUSSION.md)
- Transposition manquante ou incorrecte (instruments transpositeurs non traités)
- Percussion sans attribution de poste
- Instrument demandé mais inexistant dans la nomenclature standard

**Fonctionnalité en ligne sur le site web**, pas dans l'app mobile.
Voir CLAUDE.md section Roadmap Phase 4 pour le détail technique.

---

## Format de sortie JSON unifié

Quelle que soit la source, l'extraction produit ce JSON :

```json
{
  "entete": {
    "titre": "ETYMO",
    "compositeur": "Luca FRANCESCONI",
    "duree": "~25'",
    "chef": "Pascal ROPHÉ",
    "orchestre": "Ensemble Intercontemporain",
    "salle": "CMPP",
    "date": "26 mars 2026"
  },
  "daniels": {
    "string": "1.1.1.1 - 0.0.0.0 - 0.2.1.1 - 1.1.1.1.1",
    "familles": {
      "flutes": 1, "hautbois": 1, "clarinettes": 1, "clarBasse": 0,
      "bassons": 1, "contrebasson": 0,
      "cors": 0, "trompettes": 0, "trombones": 0, "tuba": 0,
      "timbales": 0, "percussions": 2, "harpe": 1, "piano": 1,
      "violons1": 1, "violons2": 1, "altos": 1, "violoncelles": 1, "contrebasses": 1
    }
  },
  "percussions": [
    {
      "poste": "Percu 1",
      "position": "jardin",
      "instruments": [
        { "nom": "Vibraphone 3 oct", "cat": "Claviers", "qte": 1, "details": "", "confiance": "CERTAIN" },
        { "nom": "Xylophone", "cat": "Claviers", "qte": 1, "details": "", "confiance": "CERTAIN" },
        { "nom": "Tam-tam 100cm", "cat": "Métaux/Cymbales", "qte": 1, "details": "diamètre 100cm", "confiance": "CERTAIN" }
      ]
    },
    {
      "poste": "Percu 2",
      "position": "cour",
      "instruments": [
        { "nom": "Marimba", "cat": "Claviers", "qte": 1, "details": "", "confiance": "CERTAIN" },
        { "nom": "Glockenspiel valise", "cat": "Claviers", "qte": 1, "details": "portable", "confiance": "PROBABLE" },
        { "nom": "Bongos", "cat": "Peaux", "qte": 1, "details": "paire", "confiance": "CERTAIN" }
      ]
    }
  ],
  "mobilier": {
    "musiciens": 14,
    "pupitres": 10,
    "chaisesStandards": 8,
    "chaisesHautesRS": 0,
    "chaisesHautesPercu": 2,
    "chaiseSpecifiqueVlc": 1,
    "chaisesAustraliennes": 0,
    "chaiseTimbalier": 0,
    "banquettes": 1,
    "tablettesHarmonie": 0,
    "tablettesPercu": 2,
    "rateau": 0,
    "stands": {
      "flutes": 1, "hautbois": 1, "clarinettes": 1, "clarBasse": 0,
      "bassons": 1, "contrebasson": 0, "cors": 0, "trompettes": 0,
      "trombones": 0, "tuba": 0, "contrebasses": 1
    },
    "malletteCordesHarpe": 1,
    "planchesAPic": 1,
    "pareSons": 0,
    "podiumChef": true,
    "chaiseChefRepetition": 1,
    "piano": { "type": "queue", "marque": "Yamaha" },
    "harpe": { "position": "jardin" }
  },
  "disposition": {
    "jardin": "Percu 1 (vibra, xylo, glock, marimba, tam-tam)",
    "centre": "Cordes, chef",
    "cour": "Percu 2 (marimba, glock valise, bongos, roto-toms)"
  },
  "confiance": {
    "globale": "HAUTE",
    "percussions": "HAUTE",
    "instruments": "HAUTE",
    "mobilier": "MOYENNE — types de chaises non confirmés visuellement",
    "manque": "Photos des assises pour confirmer les types de chaises"
  },
  "source": "pdf_autocad",
  "format_detecte": "EIC"
}
```

---

## Choix du modèle IA par type de source

| Source | Modèle recommandé | Fallback | Raison |
|--------|-------------------|----------|--------|
| PDF AutoCAD (texte lisible) | Parser client-side | Gemini Flash | Le texte est structuré, pas besoin d'IA |
| PDF AutoCAD (formes à interpréter) | Gemini 2.5 Flash | Kimi K2.5 | Meilleur en spatial/layout |
| Photos de plateau | Kimi K2.5 Thinking | Gemini Pro | Champion détails terrain (39/45) |
| Dessin à la main | Gemini Flash + nomenclature en contexte | Kimi K2.5 | Bon en formes géométriques |
| Texte / TXT / CSV | Parser client-side | GLM-OCR | Pas besoin de vision |
| Vérification (plan vs photos) | Claude Sonnet 4.6 | Kimi K2.5 | Meilleure fiabilité, dit ce qu'il ne sait pas |

### Coûts API (rappel)
- Gemini Flash free tier : 0 $ (250 req/jour)
- Gemini Pro free tier : 0 $ (100 req/jour)
- Kimi K2.5 Thinking : ~35 $/an pour 10 orchestres
- Claude Sonnet : ~74 $/an pour 10 orchestres

---

## Erreurs courantes des LLM (benchmark du 26 mars 2026)

À rappeler dans le prompt ou le system message :

1. **Effectif EIC** : les LLM confondent ensemble de chambre (1 par pupitre) avec orchestre symphonique (3-4 pupitres Vl1). Préciser "EIC = ensemble, pas orchestre symphonique".
2. **Polyblocks vs wood-blocks** : le terme correct en musique contemporaine est "wood-blocks", pas "polyblocks".
3. **Glockenspiel pédale vs valise** : deux instruments différents, souvent confondus et inversés P1/P2.
4. **Tam-tam vs gong** : différents ! Tam-tam = plat, gong = bosse centrale.
5. **"Batterie" / "drum kit"** : un setup de percussionniste orchestral N'EST PAS un drum kit. Ne jamais utiliser ces termes.
6. **Piano vs harpe** : vue de dessus, les LLM confondent la harpe avec un piano décoré.
7. **Marques** : les LLM inventent des marques. Ne citer que si clairement lu (SABIAN, Zildjian, Yamaha, Adams…).
8. **Orchestre baroque** : les LLM oublient le continuo (clavecin + théorbe + viole de gambe). Si le contexte est baroque, toujours vérifier la présence d'un groupe de basse continue.
9. **Musique de chambre vs symphonique** : ne JAMAIS extrapoler "violons = 16". Lire le chiffre exact. 1 violon = 1 violon.
10. **Instruments d'époque** : ne pas "moderniser" l'instrumentation. Un hautbois baroque n'est pas un hautbois moderne, une sacqueboute n'est pas un trombone.

---

## Fichiers de référence dans le repo

| Fichier | Contenu |
|---------|---------|
| `docs alex regie/nomenclature-OrchestreFINAL2.png` | Nomenclature visuelle complète (tous les symboles) |
| `docs alex regie/Nomenclature Orchestre - copie.numbers` | Template de sortie (4 feuilles) |
| `docs alex regie/Nomenclature Orchestre/*.csv` | Exports CSV du template |
| `docs/BENCHMARK_VISION_IA.md` | Résultats du benchmark 10 modèles |
| `docs/PROMPTS_VISION_TEST.md` | Prompts de test originaux (v1) |
| `docs/EXTRACTION_IA_REFERENCE.md` | CE DOCUMENT — référence pour tout le pipeline |
| `docs/TESSITURE_PERCUSSION.md` | Tessitures complètes (Kolberg Tonumfangtabelle + constructeurs) |
| `docs/RS_CATALOGUE_COMPLET.csv` | **2093 produits R&S** avec références (SIE, PUP, POD, PIE, etc.) |
| `docs/RS_SITEMAP_COMPLET.tsv` | Sitemap complet r-sons.com (2617 URLs percu+mobilier) |
| `docs/RS_REFS_CLAVIERS.tsv` | 265 claviers R&S avec refs (CEL, GLO, MAR, VIB, XYL) |
| `docs/RS_REFS_TIMBALES.tsv` | 259 timbales R&S avec refs (TIM, TAC, TAPR) |
| `docs/RS_REFS_METAUX_BOIS_PEAUX.tsv` | 963 métaux/bois/peaux R&S avec refs |
| `docs/KOLBERG_CATALOGUE_REFERENCE.csv` | 170 produits Kolberg (chaises, stands, tessiture) |
| `docs alex regie/Tonumfangtabelle_A1-Kolberg.pdf` | Poster Kolberg tessitures (LA référence mondiale) |
| `docs alex regie/Kolberg_percussion_orchestra_2024_LOW.pdf` | Catalogue Kolberg orchestre 2024 (chaises + tablettes) |
| `docs alex regie/KST_Katalog_2024_Kolberg-stands.pdf` | Catalogue Kolberg Kombiständer 2024 (100+ stands) |
| `docs alex regie/detail-mobilier-percu-kolberg.pdf` | Poster Kolberg parties modulaires |

---

## Catalogues constructeurs — Références complètes

### Kolberg — Chaises orchestre (32 modèles)

| Réf | Modèle | Usage | Specs |
|-----|--------|-------|-------|
| **3106** | Chaise orchestre standard | Cordes, bois, cuivres | H48/50/52cm, 6kg, empilable x6 |
| **3107** | Chaise sync adjustment | Cordes, bois, cuivres | Inclinaison sync 15°, 6.5kg |
| **3100** | Chaise comfort | Cordes, bois, cuivres | Inclinaison 20°, 8.5kg, empilable x8 |
| **3100H** | Chaise comfort réglable | Cordes, bois, cuivres | H46-52cm réglable, 9kg |
| **3109** | Chaise bois hêtre | Cordes | Cadre hêtre, 5kg, empilable x5 |
| **3105** | Chaise comfort line | Orchestre/Harpe | H42-55cm ou H50-70cm, 5 pieds, 9kg |
| **3105T** | Chaise tuba | Cuivres (tuba) | Assise large, 10kg |
| **3111** | Chaise cuivres | Cuivres | H50-70cm, repose-pieds triangulaire, 11kg |
| **3106P** | Chaise plateforme | Estrade | H48-52cm + plateforme 20cm, 11kg |
| **3100HP** | Chaise comfort plateforme | Estrade | Comfort + plateforme, 14kg |
| **3114** | Chaise comfort line plateforme | Estrade | Comfort line + plateforme, 16kg |
| **3113** | Tabouret piano/célesta | Piano, Célesta | Ø38cm, H42-55cm, pivotant, 6kg |
| **3113D** | Tabouret piano non-pivotant | Piano, Célesta | Fixe, 6kg |
| **3090** | Chaise contrebasse comfort | Contrebasses | H68-81cm, forme F, 2 repose-pieds, 12kg |
| **3090RS** | Chaise contrebasse ronde | Contrebasses | Assise ronde, 12kg |
| **3110RS** | Chaise contrebasse triangulaire | Contrebasses | H60-86cm, repose-pieds triangulaire, 11kg |
| **3110RSF** | Chaise contrebasse spéciale | Contrebasses | Repose-pieds spéciaux, 13kg |
| **3092** | Tabouret CB voyage | Contrebasses (voyage) | H68-81cm, pliant, 8.5kg |
| **3093** | Tabouret CB repose-pieds étagé | Contrebasses (voyage) | H72-85cm, 7.5kg |
| **3094** | Tabouret CB démontable | Contrebasses (voyage) | H62-86cm, 4.8kg |
| **3095** | Tabouret CB pneumatique | Contrebasses (voyage) | H60-86cm, 6kg |
| **3095SL** | Tabouret CB comfort voyage | Contrebasses (voyage) | Comfort, 10kg |
| **3110** | Chaise timbalier/percu pivotante | **Timbalier, Percussionnistes** | H58-84cm, 5 pieds, 11kg |
| **3110TR** | Chaise timbalier roulettes | **Timbalier, Percussionnistes** | H57-77cm, roulettes, 12kg |
| **3112** | Tabouret percu | **Percussionnistes** | H58-84cm, 7kg |
| **3110D** | Chaise chef pivotante | Chef d'orchestre | H58-84cm, 11kg |
| **3106D** | Chaise chef standard | Chef d'orchestre | Base 3106, 6kg |
| **3114D** | Chaise chef comfort line | Chef d'orchestre | Comfort line, 16kg |
| **3110R** | Chaise directeur | Direction | Accoudoirs, 12kg |
| **3110RR** | Chaise directeur renforcée | Direction | Accoudoirs renforcés, 13kg |
| **3116C** | Tabouret violoncelle voyage | Violoncelles | Pliant, 5kg |

### Kolberg — Kombiständer système modulaire (100+ pièces)

**Bases** : 100G (3 pieds caoutchouc), 100R (roulettes), 100V (télescopique), 110R (Ø25mm roulettes), 110H (4 pieds roulettes, 8.4kg), 120/120S (chariot)

**Tubes insert** : 160-169 (Ø16mm, 100-1100mm), 200-209 (Ø20mm, 200-1100mm)

**Tubes transversaux** : 122/125 (Ø20-25mm), 223-229M4 (carrés 300-2000mm)

**Anneaux/Crochets** : 115/115D/115L/115R/115S (Ø20mm), 116/116D/116S/116UL (Ø25mm), 117/117W/113S (jumeaux)

**Tablettes trap** : 230P/230PSW (étroites 40×12cm), 230 (bois 40×40cm), 230G3/G80/G100 (grandes sur 110H)

**Portiques combinés** : X (1 niveau, 14.6kg), XI (2 niveaux, 16.2kg), XII (multifonction, 21kg), 1325K (tôle tonnerre), MSX (tam-tam basic)

**Stands cymbales** : 130-5 (arbre 5), 134-1/3/5 (offset), 136-1/S (tilter), 2110KS (concert), 100R-G2 (2 paires mobile), 110H-G4 (4 paires mobile)

**Stands crotales** : 2370KST/2375KST/2380KST1 (combinés), 2370SD/2375SD/2380SD (pédale damper)

**Stands triangle** : 170 (col de cygne), 240-247, 242FS/247FS (Free Suspended), 2110K1/KM/KS/K2 (concert)

**Stands caisse claire** : 132-140/133-140/134-140 (standard), 133-140FS/134-140FS (Free Suspended)

**Stands cloches tubes** : 110H-RGD (8 cloches, 16.7kg), 224RGD (4 cloches), 2458/2458S/2455 (7 cloches)

**Stands spéciaux** : 1130A (enclumes), 1190K (klaxons Gershwin), 1321K/1325K (tôle tonnerre), 1505K (castagnettes), 1652K (carillon métal), 1380K (verre), 2320 (taxi horns), 2412 (bouteilles), 2437 (lithophon/mokushos), 510-516 (toms concert), 1470 (wood/poly blocks), 2050K/CH (temple blocks), 225XR10/16 (Xenakis Rebonds)

### Rythmes & Sons — Système de références (2093 produits catalogués)

**Préfixes de référence R&S** :

| Préfixe | Signification | Exemples |
|---------|--------------|----------|
| **SIE** | Sièges (chaises orchestre) | SIE 1345N (Orchestra H45), SIE 5510N (multi-réglable) |
| **PUP** | Pupitres musiciens | PUP 0301 06 (Symphony Manhasset 48) |
| **PUC** | Pupitres choriste/spécial | PUC 0901 (choriste Manhasset) |
| **POD** | Podiums | POD 0220 63 (direction hêtre), POD 0300 (HECTOR pliant) |
| **PIE** | Pieds / Stands | PIE 1322 06 (cymbale droit), PIE 3500 06 (CC double embase) |
| **PRT** | Portiques gongs/tam-tams | PRT 1212 26 (petit), PRT 1214 26 (grand) |
| **ATT** | Attaches | ATT 2500 26 (triangle), ATT 3000 26 (tambourin) |
| **CHS** | Châssis | CHS 1010 26 (1 niveau), CHS 6011 06 (crotales Zildjian) |
| **CHR** | Chariots transport | CHR 5110 22 (chariot chaises), CHR 1010HOU (housse) |
| **CEL** | Célesta | CEL 1051 04 (Schiedmayer 5 oct), CEL 2055 04 (Yamaha) |
| **GLO** | Glockenspiel | GLO 30BERF (Bergerault Radio France 3 oct) |
| **MAR** | Marimba | MAR (suivi du modèle constructeur) |
| **VIB** | Vibraphone | VIB (suivi du modèle constructeur) |
| **XYL** | Xylophone | XYL (suivi du modèle constructeur) |
| **TIM** | Timbales | TIM (suivi du modèle + taille) |
| **TAC** | Timbales accessoires | TAC 0026 05 (housse Adams 26") |
| **CYM** | Cymbales | CYM (suivi du modèle Zildjian/Sabian/Paiste) |
| **GON** | Gongs | GON (suivi du modèle) |
| **TRI** | Triangles | TRI (suivi du modèle) |
| **BEL** | Cloches/clochettes | BEL 2027 06 (arbre 27 cloches) |
| **BNG** | Bongos | BNG 0105 06 (Meinl 7"+8") |
| **PED** | Pédales | PED 21200D (charleston Yamaha) |
| **BAG** | Baguettes/mailloches | BAG (suivi du modèle) |

**Marques distribuées par R&S** : Adams, Bergerault, Yamaha, Zildjian, Sabian, Paiste, Meinl, Remo, LP (Latin Percussion), Toca, Manhasset, König & Meyer, Mapex, Schiedmayer, Musser, Ludwig, Premier, Majestic, Cadeson, Stagg, Sonor.

> **Fichier complet** : `docs/RS_CATALOGUE_COMPLET.csv` (2093 lignes avec refs exactes)
