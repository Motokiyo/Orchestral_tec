# OrkMap — Benchmark moteurs IA pour extraction documents

## Objectif

Tester et comparer les moteurs IA pour 3 cas d'usage OrkMap :
1. **OCR pur** : extraire le texte d'un plan PDF / partition scannée
2. **Vision spatiale** : comprendre le layout d'un plan de scène (positions instruments)
3. **OMR (Optical Music Recognition)** : lire les notes sur une partition scannée

## Moteurs à tester

### Chinois (forts en reconnaissance image/texte grâce à la complexité du mandarin)

| Modèle | Éditeur | Taille | OCR Bench | Prix input/1M tok | Prix output/1M tok | Contexte | Spécialité |
|--------|---------|--------|-----------|-------------------|-------------------|----------|------------|
| **GLM-OCR** | Zhipu AI (Tsinghua) | 0.9B | **94.0** | ~$0.03 | ~$0.03 | Petit | OCR spécialisé, tables, formules. SOTA sur OmniDocBench (94.6). Open source (HuggingFace + Ollama). **Le moins cher du marché.** |
| **GLM-5** | Zhipu AI | 745B MoE (44B actifs) | N/A | $1.00 | $3.20 | Grand | Vision + raisonnement. Entraîné sur puces Huawei Ascend. HuggingFace. |
| **DeepSeek-OCR 2** | DeepSeek AI | 3B MoE | ~97% (compression 1x) | $0.028 (cache) / $0.28 | $0.42 | Grand | OCR + compression contexte. 100+ langues. 200k pages/jour sur 1 GPU A100. Open source (Ollama). |
| **Kimi K2.5** | Moonshot AI | Grand | ~92 | $0.60 | $2.50 | 256K | Multimodal natif, agent swarm. Vision-to-code. Cache auto -75% sur input. Utilisé par Cursor Composer 2. |
| **MiniMax M2.7** | MiniMax | MoE | N/A | $0.30 | $1.20 | 205K | **Texte uniquement (pas de vision)**. Très bon en raisonnement, pas adapté à l'OCR/OMR. À tester uniquement pour le traitement post-extraction. |

### Occidentaux

| Modèle | Éditeur | OCR Bench | Prix input/1M tok | Prix output/1M tok | Contexte | Spécialité |
|--------|---------|-----------|-------------------|-------------------|----------|------------|
| **Gemini 2.5 Flash** | Google | ~91 | $0.30 | $2.50 | **1M tokens** | Vision spatiale excellente ("spatial reasoning"). Comprend les layouts de plans. Free tier 250 req/jour. |
| **Gemini 2.5 Pro** | Google | ~93 | $1.25 | $10.00 | **1M tokens** | Plus précis que Flash, mais 4x plus cher. |
| **Mistral OCR 3** | Mistral AI | ~89 | **$2/1000 pages** ($1 en batch) | inclus | N/A | OCR spécialisé. **Champion écriture manuscrite (88.9%)** vs Azure (78.2%) vs DeepSeek (57.2%). Pas de vision spatiale. |
| **Pixtral Large** | Mistral AI | ~91 (MM-MT) | $2.00 | $6.00 | 128K | 124B multimodal. Meilleur modèle open-weights sur LMSys Vision. Documents + charts + images naturelles. |
| **GPT-4o** | OpenAI | ~93 | $2.50 | $10.00 | 128K | Très bon en écriture manuscrite. Cher. |
| **Claude Sonnet** | Anthropic | ~92 | $3.00 | $15.00 | 200K | Meilleur pour longs documents textuels. Le plus cher. |

## Stratégie de test

### Jeu de test à constituer

Collecter **10 documents réels** représentatifs des cas OrkMap :

#### Plans de scène (OCR + Vision spatiale)
- [ ] 2 plans EIC (AutoCAD PDF, cartouche en bas, labels instruments)
- [ ] 2 plans Radio France (cartouche 2 colonnes, Nomenclature, P1:-P4:)
- [ ] 1 plan Orchestre de Paris (format à découvrir)
- [ ] 1 plan manuscrit / croquis de percu

#### Partitions (OMR + Vérification)
- [ ] 2 partitions imprimées (conducteur, page avec percussions)
- [ ] 1 partition avec nomenclature en première page
- [ ] 1 partie séparée de percussion (la plus critique)

### Protocole de test

Pour chaque document × chaque moteur :

1. **Envoyer le document** via l'API du moteur
2. **Prompt structuré** identique pour tous :
   ```
   Analyse ce document de musique orchestrale.
   Extrais en JSON structuré :
   - titre, compositeur, chef, date, lieu
   - effectif (notation Daniels si possible)
   - liste des instruments de percussion par percussionniste
   - pour chaque instrument : catégorie et nom exact
   Format de sortie : { titre, compositeur, effectif, percus: [{ nom, items: [{ cat, nom }] }] }
   ```
3. **Mesurer** :
   - Précision extraction texte (% caractères corrects)
   - Précision structurelle (JSON valide, champs corrects)
   - Compréhension spatiale (instruments correctement attribués aux bons percussionnistes)
   - Temps de réponse
   - Coût réel par document

### Pipeline combiné à tester

Tester aussi la combinaison de moteurs :

| Pipeline | Étape 1 (OCR) | Étape 2 (Structuration) | Hypothèse |
|----------|---------------|------------------------|-----------|
| A | GLM-OCR | Gemini Flash | OCR chinois ultra-précis + structuration Google |
| B | DeepSeek-OCR | Gemini Flash | OCR compression + structuration |
| C | Gemini Flash seul | — | Un seul appel, plus simple |
| D | Mistral OCR 3 | Gemini Flash | Meilleur manuscrit + structuration |
| E | GLM-OCR | DeepSeek V3 | 100% chinois, coût minimal |

## Critères de décision

| Critère | Poids | Notes |
|---------|-------|-------|
| **Précision OCR** | 30% | Erreurs = instruments mal identifiés |
| **Compréhension layout** | 25% | Essentiel pour les plans de scène |
| **Prix** | 20% | Doit rester < 5€/mois pour 4 orchestres |
| **Latence** | 10% | Acceptable si < 10s par document |
| **Self-hosting possible** | 10% | GLM-OCR et DeepSeek sont open source (Ollama) |
| **Stabilité API** | 5% | Les API chinoises peuvent être instables depuis l'Europe |

## Accès API

### À ouvrir
- [ ] **Google AI Studio** : https://aistudio.google.com (Gemini) — gratuit
- [ ] **Zhipu AI** : https://bigmodel.cn (GLM-OCR, GLM-5) — gratuit
- [ ] **DeepSeek** : https://platform.deepseek.com (DeepSeek-OCR) — gratuit
- [ ] **Moonshot AI** : https://platform.moonshot.ai (Kimi K2.5) — gratuit
- [ ] **Mistral** : https://console.mistral.ai (Mistral OCR 3, Pixtral) — gratuit
- [ ] **OpenRouter** : https://openrouter.ai — agrégateur, accès à tous via une seule clé

### Self-hosting (Ollama)
```bash
# GLM-OCR (0.9B — tourne sur un laptop)
ollama pull glm-ocr
ollama run glm-ocr

# DeepSeek-OCR (3B — besoin de ~8 Go RAM)
ollama pull deepseek-ocr
ollama run deepseek-ocr
```

## Notes importantes

- **GLM-OCR** est sorti le 15 mars 2026 — très récent, à surveiller pour la stabilité
- **DeepSeek-OCR 2** sorti le 27 janvier 2026 — plus mature
- **Kimi K2.5** est utilisé en production par Cursor (Composer 2) — signal de confiance
- **MiniMax M2.7** n'a PAS de vision — ne pas tester pour l'OCR, uniquement post-traitement texte
- **Mistral OCR 3** est le champion de l'écriture manuscrite (88.9%) — crucial pour les croquis de percu manuscrits
- Les modèles chinois open source (GLM-OCR, DeepSeek-OCR) peuvent tourner en local via Ollama = **zéro coût** en production
- **OpenRouter** permet de tester tous les modèles avec une seule clé API — idéal pour le benchmark

## Résultats (à compléter après tests)

| Moteur | Plan EIC | Plan RF | Croquis percu | Partition imprimée | Nomenclature | Coût/doc | Latence |
|--------|----------|---------|---------------|-------------------|--------------|----------|---------|
| GLM-OCR | | | | | | | |
| DeepSeek-OCR 2 | | | | | | | |
| Kimi K2.5 | | | | | | | |
| Gemini 2.5 Flash | | | | | | | |
| Mistral OCR 3 | | | | | | | |
| Pixtral Large | | | | | | | |
| Pipeline A (GLM+Gemini) | | | | | | | |
| Pipeline D (Mistral+Gemini) | | | | | | | |
| Pipeline E (GLM+DeepSeek) | | | | | | | |
