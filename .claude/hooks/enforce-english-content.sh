#!/bin/bash
# Claude Code PreToolUse hook: block non-English (CJK) content in file writes
# Reads tool input JSON from stdin

input=$(cat)

# Why -CSD: enables UTF-8 on stdin/stdout/default layer
if echo "$input" | perl -CSD -ne 'exit 1 if /[\x{AC00}-\x{D7AF}\x{3131}-\x{318E}\x{4E00}-\x{9FFF}\x{3040}-\x{309F}\x{30A0}-\x{30FF}]/'; then
  exit 0
else
  printf '{"decision":"block","reason":"Non-English (CJK) characters detected. All content in this repo must be written in English."}\n'
fi
