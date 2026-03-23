#!/bin/bash

# Gemini API Reliability Harvester
# -------------------------------
# This script gathers data about 500 API errors encountered during evaluation runs
# (eval.yml) from GitHub Actions. It is used to analyze developer friction caused 
# by transient API failures.
#
# Usage:
#   ./scripts/harvest_api_reliability.sh [SINCE] [LIMIT]
#
# Examples:
#   ./scripts/harvest_api_reliability.sh           # Last 7 days, limit 300
#   ./scripts/harvest_api_reliability.sh 14d 500   # Last 14 days, limit 500
#   ./scripts/harvest_api_reliability.sh 2026-03-01 # Since specific date
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated (`gh auth login`)
#   - jq installed
#   - unzip installed

# Arguments & Defaults
SINCE_ARG=${1:-"7d"}
LIMIT=${2:-300}

# Calculate actual date string for gh compatibility
if [[ "$SINCE_ARG" =~ ^[0-9]+d$ ]]; then
    DAYS=${SINCE_ARG%d}
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SINCE=$(date -v-"$DAYS"d +%F)
    else
        SINCE=$(date --date="$DAYS days ago" +%F)
    fi
elif [[ "$SINCE_ARG" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    SINCE=$SINCE_ARG
else
    SINCE=$SINCE_ARG
fi

WORKFLOWS=("Testing: E2E (Chained)" "Evals: Nightly")
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

# gh run list --created supports ">YYYY-MM-DD"
CREATED_QUERY=">$SINCE"

for WORKFLOW in "${WORKFLOWS[@]}"; do
    echo "🔍 Fetching runs for '$WORKFLOW' created since $SINCE (max $LIMIT runs)..."

    RUN_IDS=$(gh run list --workflow "$WORKFLOW" --created "$CREATED_QUERY" --limit "$LIMIT" --json databaseId --jq '.[].databaseId')

    if [ -z "$RUN_IDS" ]; then
        echo "📭 No runs found for workflow '$WORKFLOW' since $SINCE."
        continue
    fi

    for ID in $RUN_IDS; do
        echo "📥 Downloading logs from run $ID..."
        # Download artifacts named 'eval-logs-*'
        gh run download "$ID" -p "eval-logs-*" -D "$DEST_DIR/$ID" --skip-extract 2>/dev/null || continue
        
        # Extract only the reliability file to save space
        find "$DEST_DIR/$ID" -name "*.zip" -exec unzip -q -o {} "api-reliability.jsonl" -d "$DEST_DIR/$ID" \; 2>/dev/null
        
        # Append to master log
        find "$DEST_DIR/$ID" -name "api-reliability.jsonl" -exec cat {} + >> "$MERGED_FILE"
    done
done

if [ ! -f "$MERGED_FILE" ]; then
    echo "📭 No reliability data found in the retrieved logs."
    exit 0
fi

echo -e "\n✅ Harvest Complete! Data merged into: $MERGED_FILE"
echo "------------------------------------------------"
echo "📊 Gemini API Reliability Summary (Since $SINCE)"
echo "------------------------------------------------"

cat "$MERGED_FILE" | jq -s '
  group_by(.model) | map({
    model: .[0].model,
    retries: (map(select(.status == "RETRY")) | length),
    skips: (map(select(.status == "SKIP")) | length)
  })'

echo -e "\n💡 Total events captured: $(wc -l < "$MERGED_FILE")"
