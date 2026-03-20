#!/bin/bash

# Harvest Gemini API Reliability Data from GitHub Actions
# Use this script to gather data about frequency of 500s API errors during eval running.

WORKFLOW="evals-nightly.yml"
LIMIT=30
DEST_DIR="/tmp/gemini-reliability-harvest"
MERGED_FILE="api-reliability-summary.jsonl"

if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed."
    exit 1
fi

mkdir -p "$DEST_DIR"
rm -f "$MERGED_FILE"

echo "🔍 Fetching last $LIMIT runs for $WORKFLOW (all branches)..."
RUN_IDS=$(gh run list --workflow "$WORKFLOW" --limit "$LIMIT" --json databaseId --jq '.[].databaseId')

for ID in $RUN_IDS; do
    echo "📥 Downloading logs from run $ID..."
    gh run download "$ID" -p "eval-logs-*" -D "$DEST_DIR/$ID" --skip-extract 2>/dev/null
    
    # Extract only the reliability file to save space
    find "$DEST_DIR/$ID" -name "*.zip" -exec unzip -q -o {} "api-reliability.jsonl" -d "$DEST_DIR/$ID" 2>/dev/null
    
    # Append to master log
    find "$DEST_DIR/$ID" -name "api-reliability.jsonl" -exec cat {} + >> "$MERGED_FILE"
done

if [ ! -f "$MERGED_FILE" ]; then
    echo "📭 No reliability data found in the last $LIMIT runs."
    exit 0
fi

echo -e "\n✅ Harvest Complete! Data merged into: $MERGED_FILE"
echo "------------------------------------------------"
echo "📊 Gemini API Reliability Summary (Last $LIMIT runs)"
echo "------------------------------------------------"

cat "$MERGED_FILE" | jq -s '
  group_by(.model) | map({
    model: .[0].model,
    retries: (map(select(.status == "RETRY")) | length),
    skips: (map(select(.status == "SKIP")) | length)
  })'

echo -e "\n💡 Total events captured: $(wc -l < "$MERGED_FILE")"
