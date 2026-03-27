#!/bin/bash
# compare-prompts.sh — Compare Gemini results across different prompts
#
# Usage: ./compare-prompts.sh <plan.pdf> [prompt1.txt prompt2.txt ...]
#        ./compare-prompts.sh <plan.pdf>   (uses all prompts in prompts/)
#
# Results are saved with --tag matching prompt filename

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PDF="${1:?Usage: $0 <plan.pdf> [prompt1.txt prompt2.txt ...]}"

if [ ! -f "$PDF" ]; then
  echo "❌ File not found: $PDF"
  exit 1
fi

shift
PROMPTS=("$@")

# If no prompts specified, use all .txt files in prompts/
if [ ${#PROMPTS[@]} -eq 0 ]; then
  PROMPTS=("$SCRIPT_DIR"/prompts/*.txt)
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║     🔄 Gemini Prompt Comparison Tool             ║"
echo "╚══════════════════════════════════════════════════╝"
echo "📄 PDF: $PDF"
echo "📝 Prompts: ${#PROMPTS[@]} to compare"
echo ""

RESULTS=()

for PROMPT_FILE in "${PROMPTS[@]}"; do
  TAG=$(basename "$PROMPT_FILE" .txt)
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🧪 Testing: $TAG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  node "$SCRIPT_DIR/test-gemini-plan.js" "$PDF" \
    --prompt "$PROMPT_FILE" \
    --tag "$TAG" \
    --raw
  
  RESULT_FILE="${PDF%.pdf}-result-${TAG}.json"
  RESULTS+=("$RESULT_FILE")
  echo ""
done

# ── Comparison summary ───────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     📊 Comparison Summary                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Show key fields side by side
echo "🔑 Key fields comparison:"
echo ""
printf "%-20s" "Field"
for R in "${RESULTS[@]}"; do
  TAG=$(basename "$R" .json | sed 's/.*-result-//')
  printf "%-30s" "$TAG"
done
echo ""
printf "%-20s" "─────"
for R in "${RESULTS[@]}"; do printf "%-30s" "──────────────────────────"; done
echo ""

for FIELD in titre compositeur effectif chef date; do
  printf "%-20s" "$FIELD"
  for R in "${RESULTS[@]}"; do
    if [ -f "$R" ]; then
      VAL=$(node -e "const d=JSON.parse(require('fs').readFileSync('$R','utf8')); console.log((d.$FIELD||'(vide)').slice(0,27))")
      printf "%-30s" "$VAL"
    else
      printf "%-30s" "(missing)"
    fi
  done
  echo ""
done

# Percussion pole count
echo ""
printf "%-20s" "nb_percus_poles"
for R in "${RESULTS[@]}"; do
  if [ -f "$R" ]; then
    VAL=$(node -e "const d=JSON.parse(require('fs').readFileSync('$R','utf8')); console.log((d.percus||[]).length)")
    printf "%-30s" "$VAL"
  fi
done
echo ""

# Diff between first two results
if [ ${#RESULTS[@]} -ge 2 ] && [ -f "${RESULTS[0]}" ] && [ -f "${RESULTS[1]}" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📝 Diff: $(basename "${RESULTS[0]}") vs $(basename "${RESULTS[1]}")"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Strip _meta for cleaner diff
  node -e "const d=JSON.parse(require('fs').readFileSync('${RESULTS[0]}','utf8')); delete d._meta; require('fs').writeFileSync('/tmp/cmp-a.json', JSON.stringify(d,null,2))"
  node -e "const d=JSON.parse(require('fs').readFileSync('${RESULTS[1]}','utf8')); delete d._meta; require('fs').writeFileSync('/tmp/cmp-b.json', JSON.stringify(d,null,2))"
  
  diff -u /tmp/cmp-a.json /tmp/cmp-b.json || true
  rm -f /tmp/cmp-a.json /tmp/cmp-b.json
fi

echo ""
echo "✅ All results saved. Files:"
for R in "${RESULTS[@]}"; do
  echo "   📁 $R"
done
