---
name: tauri-multi-instance
description: >-
  Multi-instance contract for running multiple Tauri v2 instances in parallel
  (git worktrees, side-by-side projects). Defines (1) the TAURI_DEV_PORT /
  TAURI_CDP_PORT env var contract shared by Vite config, CDP debuggers, and
  test fixtures, and (2) the TAURI_INSTANCE_ID contract for isolating
  OS-global resources (Named Mutex, AppData dir, sentinel windows) in dev
  builds. Provides the tauri-dev.mjs launcher and .mcp.json template.
  Trigger: "multi-instance", "port conflict", "parallel tauri", "worktree dev",
  "single-instance", "second instance blocked", "AppData collision", or when
  orchestrated by tauri-setup / tauri-webview-debug / tauri-test-setup.
---

# Tauri Multi-Instance Contract

> **Platform note:** Tested on Windows (WebView2). macOS/Linux unverified.

> **External dependencies:** The MCP server template
> (`references/mcp-json-template.json`) invokes `chrome-devtools-mcp@latest`
> and `@playwright/mcp@latest` via `npx` at session start. `@latest` is
> intentional so users track upstream MCP updates — pin versions in your
> project's `.mcp.json` after copying if you need deterministic builds. The
> launcher `references/tauri-dev.mjs` spawns `cargo tauri dev` with
> hardcoded arguments only; no user input is forwarded to the subprocess.

Running multiple Tauri instances simultaneously (worktrees, parallel projects)
conflicts on **two layers**:

1. **Network ports** — Vite `1420`, CDP `9222`, HMR `1421`. The launcher
   scans free ports and injects them via env vars.
2. **OS-global resources** — Named Mutex (single-instance guard), `%APPDATA%`
   data directory, Win32 window class names. Ports alone are necessary but
   **not sufficient** — a Tauri app's own single-instance guard will reject the
   second launch even when ports are free, and even if the guard is bypassed,
   two processes writing the same `%APPDATA%` files race and corrupt state.

This skill is the single source of truth for both contracts and ships the
launcher that wires them up. The Rust-side resource isolation lives in the
consuming project (it touches app-specific paths and mutex names), but the
naming convention and `cfg(debug_assertions)` discipline are defined here.

## Port Allocation Policy

- **Vite base:** `1420`, step `+10` → `1420`, `1430`, `1440`, ...
- **CDP base:** `9222`, step `+10` → `9222`, `9232`, `9242`, ...
- **HMR:** `TAURI_DEV_PORT + 1` (hence step 10 — leaves headroom)
- **Scan:** up to 10 candidates per base; OS-assigned port as fallback.
- **Scope:** one launcher instance owns one `(vite, cdp)` pair for its lifetime.
  Ports are not recycled across restarts — free-port scan re-runs each launch.

## Instance ID Policy

- **Source:** explicit `TAURI_INSTANCE_ID` env > derived from cwd path.
- **Auto-derivation:** if cwd contains `.worktrees/<...>`, the segments after
  `.worktrees` are joined with `-` (sanitized to `[A-Za-z0-9_-]`). Example:
  `C:\repo\.worktrees\sandbox\01` → `sandbox-01`.
- **Empty ID = no isolation:** running from the main repo (no `.worktrees`
  segment) yields an empty ID, and the app behaves production-like — same
  mutex, same `%APPDATA%` location. This makes the main repo the canonical
  dev environment and worktrees the isolated experiments.
- **Dev only:** consuming code MUST gate ID-based naming behind
  `#[cfg(debug_assertions)]`. Release builds ignore the env entirely so
  installer tooling (Inno Setup AppMutex etc.) and user data survive intact.

## Environment Variable Contract

All consumers MUST read these from env, never hardcode:

| Variable | Consumer | Purpose |
|---|---|---|
| `TAURI_DEV_PORT` | `vite.config.ts` | Vite dev server port + HMR base |
| `TAURI_DEV_HOST` | `vite.config.ts` | Optional HMR host override |
| `TAURI_CDP_PORT` | Playwright/pytest fixtures | CDP endpoint for test attach |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | WebView2 runtime | `--remote-debugging-port=<cdp>` |
| `TAURI_INSTANCE_ID` | Rust `lib.rs`, `persistence.rs`, sentinel windows | Suffix for OS-global resource names (debug only) |

The launcher sets all five. Consumers read only — never write.

## App-side Resource Isolation

For each OS-global resource the app owns, add a tiny helper that suffixes the
name with `TAURI_INSTANCE_ID` under `cfg(debug_assertions)`. Release builds
must compile to byte-identical output as before. Typical resources:

| Resource | File usually owning it | Suffix pattern |
|---|---|---|
| Named Mutex (single-instance guard) | `src-tauri/src/lib.rs` | `<MutexName>-dev-<id>` |
| `%APPDATA%` data directory | `src-tauri/src/persistence.rs` (or equivalent) | `<base>\dev-<id>\` |
| Win32 sentinel window class | `src-tauri/src/shutdown.rs` (or equivalent) | `<Class>_dev_<id>` |

Reference shape (Rust):

```rust
fn mutex_name() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(id) = std::env::var("TAURI_INSTANCE_ID") {
            if !id.is_empty() {
                return format!("{BASE_NAME}-dev-{id}");
            }
        }
    }
    BASE_NAME.to_string()
}
```

The same shape applies to data dirs and window class names — keep all three
helpers reading the same env var so they stay in sync.

## Files in `references/`

- **`tauri-dev.mjs`** — the launcher. Copied verbatim into a consuming project
  as `scripts/tauri-dev.mjs`. It scans free ports, derives `TAURI_INSTANCE_ID`
  from cwd, updates `.mcp.json` in-place if the CDP port changed, sets env
  vars, and runs `cargo tauri dev --config ...` (JSON Merge Patch override of
  `build.devUrl`, so `tauri.conf.json` stays clean).
- **`mcp-json-template.json`** — starting `.mcp.json` with `chrome-devtools-cdp`
  and `playwright-cdp` entries pointing at default `127.0.0.1:9222`. The launcher
  rewrites the port if/when it changes.

## Invoke Guidance

### From `tauri-setup` (project scaffold)
1. Copy `references/tauri-dev.mjs` → `<project>/scripts/tauri-dev.mjs`.
2. Add `"dev:tauri": "node scripts/tauri-dev.mjs"` to `package.json` scripts.
3. Ensure `vite.config.ts` reads `process.env.TAURI_DEV_PORT` (fallback `1420`)
   and `process.env.TAURI_DEV_HOST` for HMR.
4. If the app has a single-instance Named Mutex, custom `%APPDATA%` path, or
   any Win32 window class with a fixed name, wire each through a
   `cfg(debug_assertions)` helper that reads `TAURI_INSTANCE_ID` (see
   "App-side Resource Isolation" above).
5. If `.mcp.json` does not exist yet, copy `references/mcp-json-template.json`.

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

- **IPv4 only (CDP URLs):** WebView2 CDP listens on `127.0.0.1` only, but
  `localhost` resolves to `::1` on Windows. Use the literal `127.0.0.1`.
- **Dual-stack port check (Vite):** Opposite for free-port scanning — Vite
  binds `localhost` (either family), so `isPortFree` must probe both or it
  false-positives and Vite fails `EADDRINUSE`.
- **`.mcp.json` restart:** The launcher rewrites CDP port in `.mcp.json` when
  it changes, but Claude Code reads MCP config once at session start. A restart
  is required for the change to take effect.
- **`--config` JSON Merge Patch:** The launcher passes `--config` with only the
  diff (`build.devUrl`). This is RFC 7396 and leaves `tauri.conf.json` untouched
  on disk, which is essential for worktree isolation.
- **Dev only:** The CDP port is an unauthenticated debugging endpoint. Never
  enable `--remote-debugging-port` in production builds.
- **Ports are not enough:** A free `(vite, cdp)` pair does not guarantee a
  second launch will succeed. The app's own single-instance Mutex, AppData
  files, and Win32 window classes are OS-global by name and will collide
  across worktrees unless suffixed with `TAURI_INSTANCE_ID`.
- **Dev-only `cfg` discipline:** All ID-based suffixing must be inside
  `#[cfg(debug_assertions)]`. Release output must remain byte-identical to
  pre-isolation builds — installer mutex names, AppData paths, and shipped
  window classes must not change.
- **Shared dev-only side effects persist:** Even with full isolation, two dev
  instances still register the same global keyboard hook, both create tray
  icons, and both subscribe to system audio events. These are not blocked but
  may produce duplicated runtime behavior; out of scope for this skill.

## Non-Goals

- This skill does **not** cover Cargo build tuning, test infrastructure, or
  WebView debugging workflows. Those are the concerns of `tauri-setup`,
  `tauri-test-setup`, and `tauri-webview-debug` respectively — they invoke
  this skill for the port and instance-ID contracts only.
- This skill does **not** prevent duplicated runtime side effects from
  multiple dev instances (global keyboard hooks, multiple tray icons,
  duplicated audio device subscribers). Apps that need single-instance
  semantics across worktrees must add their own opt-out switch.
