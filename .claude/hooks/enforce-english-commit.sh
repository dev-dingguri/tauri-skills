#!/bin/bash
# Claude Code PreToolUse hook: enforce English-only commit messages
# Blocks CJK (Hangul, Chinese, Japanese) while allowing typographic
# characters like em dash, en dash, curly quotes, ellipsis, and arrows.
# Matches the policy and Unicode ranges used by enforce-english-content.sh.
# Reads tool input JSON from stdin

input=$(cat)

# Only check git commit commands
if ! echo "$input" | grep -q "git commit"; then
  exit 0
fi

# Why -CSD: enables UTF-8 on stdin/stdout/default layer
# Ranges: Hangul Syllables, Hangul Compat Jamo, CJK Unified, Hiragana, Katakana
if echo "$input" | perl -CSD -ne 'exit 1 if /[\x{AC00}-\x{D7AF}\x{3131}-\x{318E}\x{4E00}-\x{9FFF}\x{3040}-\x{309F}\x{30A0}-\x{30FF}]/'; then
  exit 0
else
  printf '{"decision":"block","reason":"Commit message must be in English. CJK characters (Hangul, Chinese, Japanese) detected."}\n'
fi
