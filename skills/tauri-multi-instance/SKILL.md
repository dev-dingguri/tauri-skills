---
name: tauri-multi-instance
description: >-
  Port allocation contract for running multiple Tauri v2 instances in parallel
  (git worktrees, side-by-side projects). Defines the TAURI_DEV_PORT / TAURI_CDP_PORT
  env var contract shared by Vite config, CDP debuggers, and test fixtures.
  Provides the tauri-dev.mjs launcher and .mcp.json template.
  Trigger: "multi-instance", "port conflict", "parallel tauri", "worktree dev",
  or when orchestrated by tauri-setup / tauri-webview-debug / tauri-test-setup.
---

# Tauri Multi-Instance Port Allocation

> **Platform note:** Tested on Windows (WebView2). macOS/Linux unverified.

Running multiple Tauri instances simultaneously (worktrees, parallel projects)
conflicts on the default ports: Vite `1420`, CDP `9222`. This skill is the
single source of truth for the port allocation contract and its launcher.

## Port Allocation Policy

- **Vite base:** `1420`, step `+10` → `1420`, `1430`, `1440`, ...
- **CDP base:** `9222`, step `+10` → `9222`, `9232`, `9242`, ...
- **HMR:** `TAURI_DEV_PORT + 1` (hence step 10 — leaves headroom)
- **Scan:** up to 10 candidates per base; OS-assigned port as fallback.
- **Scope:** one launcher instance owns one `(vite, cdp)` pair for its lifetime.
  Ports are not recycled across restarts — free-port scan re-runs each launch.

## Environment Variable Contract

All consumers MUST read ports from env, never hardcode:

| Variable | Consumer | Purpose |
|---|---|---|
| `TAURI_DEV_PORT` | `vite.config.ts` | Vite dev server port + HMR base |
| `TAURI_DEV_HOST` | `vite.config.ts` | Optional HMR host override |
| `TAURI_CDP_PORT` | Playwright/pytest fixtures | CDP endpoint for test attach |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | WebView2 runtime | `--remote-debugging-port=<cdp>` |

The launcher sets all four. Consumers read only — never write.

## Files in `references/`

- **`tauri-dev.mjs`** — the launcher. Copied verbatim into a consuming project
  as `scripts/tauri-dev.mjs`. It scans free ports, updates `.mcp.json` in-place
  if the CDP port changed, sets env vars, and runs `cargo tauri dev --config ...`
  (JSON Merge Patch override of `build.devUrl`, so `tauri.conf.json` stays clean).
- **`mcp-json-template.json`** — starting `.mcp.json` with `chrome-devtools-cdp`
  and `playwright-cdp` entries pointing at default `127.0.0.1:9222`. The launcher
  rewrites the port if/when it changes.

## Invoke Guidance

### From `tauri-setup` (project scaffold)
1. Copy `references/tauri-dev.mjs` → `<project>/scripts/tauri-dev.mjs`.
2. Add `"dev:tauri": "node scripts/tauri-dev.mjs"` to `package.json` scripts.
3. Ensure `vite.config.ts` reads `process.env.TAURI_DEV_PORT` (fallback `1420`)
   and `process.env.TAURI_DEV_HOST` for HMR.
4. If `.mcp.json` does not exist yet, copy `references/mcp-json-template.json`.

### From `tauri-webview-debug`
1. Recommended launch: `node scripts/tauri-dev.mjs` (handles port conflicts).
2. Manual launch fallback: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cdp>`
   then `cargo tauri dev`.
3. After the launcher updates `.mcp.json`, **restart Claude Code** — MCP server
   configs are fixed at session start; runtime rewrites take effect only after
   a new session.

### From `tauri-test-setup`
1. Python/Playwright fixtures must read `TAURI_CDP_PORT` (fallback `9222`),
   and connect to `http://127.0.0.1:<port>` — **IPv4 only** (Windows WebView2
   does not listen on `::1`).

## Critical Gotchas

- **IPv4 only:** `localhost` resolves to IPv6 (`::1`) on Windows; WebView2 CDP
  listens on `127.0.0.1` only. Always use the literal `127.0.0.1` in URLs.
- **`.mcp.json` restart:** The launcher rewrites CDP port in `.mcp.json` when
  it changes, but Claude Code reads MCP config once at session start. A restart
  is required for the change to take effect.
- **`--config` JSON Merge Patch:** The launcher passes `--config` with only the
  diff (`build.devUrl`). This is RFC 7396 and leaves `tauri.conf.json` untouched
  on disk, which is essential for worktree isolation.
- **Dev only:** The CDP port is an unauthenticated debugging endpoint. Never
  enable `--remote-debugging-port` in production builds.

## Non-Goals

- This skill does **not** cover Cargo build tuning, test infrastructure, or
  WebView debugging workflows. Those are the concerns of `tauri-setup`,
  `tauri-test-setup`, and `tauri-webview-debug` respectively — they invoke
  this skill for the port contract only.
