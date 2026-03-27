# CHANGELOG — test-infra

## [v2] — 2026-03-27

### Nouveau prompt : `prompts/v2-orchestral-expert.txt`

**Améliorations par rapport à `default.txt` :**

1. **Notation Daniels percussions chiffrée (W.X.Y.Z)**
   - Documentation explicite du format : Timbalier.Percussionnistes.Harpe.Claviers
   - Exemples de décodage : `1.3.1.1` → 1 timbalier, 3 percussionnistes, 1 harpe, 1 clavier

2. **Variantes de format (tirets)**
   - Reconnaissance des tirets comme séparateur alternatif : `0-1-0-1` au lieu de `0.1.0.1`
   - Fréquent en musique baroque/ancienne
   - Règle de normalisation en points dans le JSON final

3. **Vocabulaire baroque**
   - Termes reconnus : Dessus, Tailles, Viole, Violone, Théorbe
   - Continuo documenté comme section à part (`orchestre.continuo`)
   - Claviers baroques (orgue, clavecin) → continuo, pas orchestre.autres

4. **Vocabulaire trilingue FR/EN/DE**
   - Abréviations complètes en 3 langues pour chaque instrument
   - DB (Double Bass), Kb (Kontrabass) → Contrebasse
   - Posaune → Trombone, Bratsche → Alto, etc.

5. **Stratégie contextuelle par style musical**
   - Baroque : continuo, cordes en 5 parties, vocabulaire spécifique
   - Classique : effectifs standard, peu de percussions
   - Romantique : effectifs étendus, harpes, célesta
   - Contemporain : électronique, nomenclature non-standard

6. **Nouveau champ JSON : `style`**
   - baroque | classique | romantique | moderne | contemporain
   - Détection automatique à partir du compositeur et de l'effectif

7. **Nouveau champ JSON : `orchestre.continuo`**
   - Pour les formations baroques (orgue, clavecin, théorbe, etc.)

### Exemples documentés (`examples/`)

4 cas de référence analysés manuellement :
- `brahms-symphonique.json` — Romantique, notation standard
- `etymo-contemporain-ircam.json` — Contemporain IRCAM, électronique
- `philharintime-chambre-cuivres.json` — Chambre cuivres
- `grandes-odes-baroque.json` — Baroque, tirets, continuo, vocabulaire spécifique

### Tests

⚠️ Pas de PDFs dans le repo pour tester automatiquement.
Le prompt est prêt pour test manuel avec :
```bash
node test-gemini-plan.js <plan.pdf> --prompt prompts/v2-orchestral-expert.txt --tag v2
```

Comparer avec le prompt par défaut :
```bash
node test-gemini-plan.js <plan.pdf> --prompt prompts/default.txt --tag default
```

---

## [v1] — 2026-03-26

### Prompt initial : `prompts/default.txt`

- Extraction de base des plans de scène
- Règles percussions (timbalier vs percu)
- Comptage timbales individuelles
- Désambiguïsation Cel (Célesta vs Violoncelle)
- Abréviations FR de base
