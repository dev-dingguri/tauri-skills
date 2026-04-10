#!/bin/bash
# Claude Code PreToolUse hook: enforce English-only commit messages
# Reads tool input JSON from stdin

input=$(cat)

# Only check git commit commands
if ! echo "$input" | grep -q "git commit"; then
  exit 0
fi

# Block if non-ASCII characters found (commit must be English only)
if echo "$input" | LC_ALL=C grep -q $'[^\x01-\x7F]'; then
  printf '{"decision":"block","reason":"Commit message must be in English (ASCII only)."}\n'
fi
