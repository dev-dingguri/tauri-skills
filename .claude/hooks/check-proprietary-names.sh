#!/bin/bash
# Claude Code PreToolUse hook: block proprietary names in file writes
# Reads tool input JSON from stdin, checks against blocklist patterns

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BLOCKLIST="$SCRIPT_DIR/blocklist.txt"

if [ ! -f "$BLOCKLIST" ]; then
  exit 0
fi

input=$(cat)

# Build grep pattern from blocklist (skip comments and blank lines)
patterns=$(grep -v '^\s*#' "$BLOCKLIST" | grep -v '^\s*$')
if [ -z "$patterns" ]; then
  exit 0
fi

# Check tool input for matches
matches=$(echo "$input" | grep -oiE "$( echo "$patterns" | paste -sd'|' )" | sort -u)

if [ -n "$matches" ]; then
  matched_list=$(echo "$matches" | paste -sd', ')
  printf '{"decision":"block","reason":"Proprietary name detected: %s. This repo must not contain company/product names."}\n' "$matched_list"
fi
