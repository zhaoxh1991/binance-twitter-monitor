#!/bin/bash
# deliver.sh - Run the poller and extract delivery content for OpenClaw cron
# Usage: deliver.sh

REPO_DIR="/vol1/@apphome/trim.openclaw/data/workspace/binance-twitter-monitor"
GITHUB_RAW="https://raw.githubusercontent.com/zhaoxh1991/binance-twitter-monitor/main"

cd "$REPO_DIR"

# Run the poller
OUTPUT=$(node poller.js 2>&1)
EXIT_CODE=$?

echo "$OUTPUT" | grep -A 1000 "---DELIVERY---" | tail -n +2 || true

if echo "$OUTPUT" | grep -q "No new alpha tweets to push"; then
  echo "NO_NEW"
elif echo "$OUTPUT" | grep -q "GitHub repo not configured"; then
  echo "NO_REPO"
fi

exit $EXIT_CODE
