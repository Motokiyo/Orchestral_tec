# 🧪 Test Infrastructure — Gemini Plan Extraction

Outil standalone pour tester et itérer sur le prompt Gemini d'extraction de plans de scène d'orchestre.

## Prérequis

```bash
# poppler-utils pour la conversion PDF → PNG
sudo apt install poppler-utils   # Linux
brew install poppler              # macOS

# Node.js 18+ (fetch natif)
node --version

# Clé API Gemini
export GOOGLE_API_KEY="votre-clé-ici"
```

**Aucune dépendance npm requise** — le script utilise `pdftoppm` (CLI) et `fetch` natif.

## Utilisation rapide

### 1. Tester un plan

```bash
cd test-infra

# Test avec le prompt par défaut (copié de api/extract-ai.js)
node test-gemini-plan.js ../test-plans/mon-plan.pdf

# Test avec un prompt custom
node test-gemini-plan.js ../test-plans/mon-plan.pdf --prompt prompts/v2-orchestral-expert.txt

# Dry run (vérifie que tout marche sans appeler l'API)
node test-gemini-plan.js ../test-plans/mon-plan.pdf --dry-run
```

### 2. Comparer des prompts

```bash
# Compare tous les prompts du dossier prompts/ sur un même PDF
./compare-prompts.sh ../test-plans/mon-plan.pdf

# Compare seulement 2 prompts
./compare-prompts.sh ../test-plans/mon-plan.pdf prompts/default.txt prompts/v2-orchestral-expert.txt
```

### 3. Options avancées

```bash
# Page spécifique (si le plan est page 2)
node test-gemini-plan.js plan.pdf --page 2

# Tag personnalisé (pour organiser les résultats)
node test-gemini-plan.js plan.pdf --tag "test-v3"
# → Sauvegarde: plan-result-test-v3.json

# Sauvegarder aussi la réponse brute
node test-gemini-plan.js plan.pdf --raw

# Modèle différent
node test-gemini-plan.js plan.pdf --model gemini-2.5-pro-preview-05-06
```

## Structure

```
test-infra/
├── test-gemini-plan.js       # Script principal
├── compare-prompts.sh        # Comparaison multi-prompts
├── prompts/
│   ├── default.txt           # Prompt actuel (copié de api/extract-ai.js)
│   └── v2-orchestral-expert.txt  # Version améliorée
├── test-plans/               # PDFs de test (gitignored)
├── results/                  # Résultats sauvegardés
└── README.md                 # Ce fichier
```

## Workflow d'itération

```
1. Éditer un prompt dans prompts/
2. Tester: node test-gemini-plan.js test-plans/mon-plan.pdf --prompt prompts/mon-prompt.txt
3. Vérifier le JSON de sortie
4. Comparer: ./compare-prompts.sh test-plans/mon-plan.pdf
5. Quand satisfait → copier le prompt dans api/extract-ai.js
```

## Créer un nouveau prompt

1. Copier un prompt existant : `cp prompts/default.txt prompts/v3-experimental.txt`
2. Éditer le nouveau fichier
3. Tester : `node test-gemini-plan.js plan.pdf --prompt prompts/v3-experimental.txt --tag v3`
4. Comparer avec le défaut : `diff plan-result.json plan-result-v3.json`

## Format de sortie

Le JSON de résultat inclut un bloc `_meta` avec les métadonnées du test :

```json
{
  "_meta": {
    "source": "test-plans/mon-plan.pdf",
    "prompt": "default.txt",
    "model": "gemini-2.5-flash-preview-05-20",
    "timestamp": "2026-03-27T21:18:00.000Z",
    "elapsed_seconds": 4.2,
    "tokens": { "promptTokenCount": 1234, "candidatesTokenCount": 567 }
  },
  "titre": "Symphonie No. 5",
  "compositeur": "Beethoven",
  ...
}
```
