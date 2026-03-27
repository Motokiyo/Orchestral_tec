# Exemples de référence — Plans orchestraux

Ces fichiers JSON documentent les cas d'usage analysés manuellement pour valider le prompt Gemini Vision.

## Cas couverts

| Fichier | Style | Notation Daniels | Points clés |
|---------|-------|-----------------|-------------|
| `brahms-symphonique.json` | Romantique | `2.2.2.2 / 4.2.3.1 / 1.0.0.0` | Notation standard, timbalier seul |
| `etymo-contemporain-ircam.json` | Contemporain | Non-standard | Électronique IRCAM, 2 percus, 1 harpe |
| `philharintime-chambre-cuivres.json` | Classique (chambre) | `1.3.3.1 / 1.0.0.1` | Cuivres dominants, 1 clavier |
| `grandes-odes-baroque.json` | Baroque | `0-1-0-1 / 0-2-0-0 / 1-0-0-2` | Tirets, continuo, vocabulaire baroque |

## Règles illustrées

- **Notation percussions W.X.Y.Z** : Timbalier.Percussionnistes.Harpe.Claviers
- **Variante tirets** : `0-1-0-1` = `0.1.0.1` (normaliser en points dans le JSON)
- **Vocabulaire baroque** : Dessus, Tailles, Viole, Violone, Théorbe → garder tels quels
- **Continuo** : Orgue + Clavecin en baroque → `orchestre.continuo`, pas `orchestre.autres`
- **Contemporain** : Électronique IRCAM → `orchestre.autres`

## Date de création

27/03/2026 — Analyse collaborative avec Alexandre (session 21:49-22:48)
