# CHANGELOG — Prompts Gemini Vision

## v3 — 2025-03-27 — Optimisation IA + inline (v3-gemini-optimized.txt)

**Objectif :** Prompt compact (~3200 chars) prêt à intégrer inline dans `extract-ai.js`, avec "philosophie IA" pour maximiser la qualité Gemini.

**Changements par rapport à v2 :**
- **Rôle d'expert** (pas assistant) : régisseur d'orchestre professionnel, 20 ans d'expérience
- **Chain of Thought en 6 étapes** : Observer → Identifier style → Chercher Daniels → Décoder → Lire texte → Croiser sources
- **Hiérarchie de confiance** : Daniels > Texte > Visuel (explicite)
- **Perception visuelle guidée** : cartouche, nomenclature marge, plan vue dessus, légende
- **Vocabulaire naturel condensé** : abréviations FR/EN/DE sur une ligne, pas dictionnaire
- **Exemples few-shot inline** : 2 mini-exemples (baroque Purcell + romantique Mahler)
- **Gestion incertitude explicite** : "NE PAS inventer, mettre '' ou []"
- **Taille** : ~3200 chars (vs ~11300 chars pour v2) — 72% plus compact
- **Conserve toutes les règles critiques** de v2 (timbalier vs percu, comptage timbales, Daniels percus W.X.Y.Z, baroque continuo, désambiguïsation Cel)

**Ce qui est nouveau par rapport à v1 :**
- Champ `style` (baroque/classique/romantique/moderne/contemporain)
- Champ `orchestre.continuo` pour musique baroque
- Distinction timbalier/percu avec règles de comptage
- Décodage Daniels percus chiffré (W.X.Y.Z)
- Vocabulaire trilingue FR/EN/DE
- Désambiguïsation "Cel" (Célesta vs Violoncelle selon contexte)

---

## v2 — 2025-03-27 — Enrichissement règles (v2-orchestral-expert.txt)

**Objectif :** Prompt exhaustif (~11300 chars) documentant toutes les règles métier orchestrales.

**Changements par rapport à v1 :**
- Notation Daniels complète (format, variantes points/tirets, décodage percus W.X.Y.Z)
- Règles percussions détaillées (timbalier séparé, comptage timbales individuelles)
- Stratégie contextuelle par style musical (baroque, classique, romantique, contemporain)
- Vocabulaire trilingue FR/EN/DE complet avec abréviations
- Désambiguïsation "Cel" (Célesta vs Violoncelle)
- Continuo baroque
- Champ `style` ajouté au schéma JSON
- Champ `orchestre.continuo` ajouté

**Limite :** Trop long pour intégration inline (~11300 chars). Sert de documentation de référence.

---

## v1 — Prompt initial (inline dans extract-ai.js)

**Taille :** ~900 chars
**Contenu :** Prompt basique "assistant spécialisé", schéma JSON, règles minimales (Direction = chef, catégories percus).
**Statut :** En production, stable. Fonctionne mais manque de précision sur cas complexes (baroque, percussions, nomenclature Daniels).
