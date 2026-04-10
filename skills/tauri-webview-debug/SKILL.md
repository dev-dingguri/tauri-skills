---
name: tauri-webview-debug
description: >-
  Debug Tauri v2 WebView2 via CDP — Playwright MCP (primary) + Chrome DevTools MCP
  (fallback). Handles .mcp.json setup, CDP launch, and Lighthouse.
  Trigger: UI debugging, DOM inspection, screenshots, a11y, or perf analysis in src-tauri/ projects.
---

# Tauri WebView Debug — Browser Debugging Tools for Tauri v2

Workflow for debugging Tauri v2 WebViews using Playwright MCP (primary) and
Chrome DevTools MCP (fallback) via the WebView2 CDP endpoint. Long-form
templates and alternate paths live under `references/`:

- `references/mcp-json-template.json` — `.mcp.json` with CDP-connected MCP servers
- `references/alt-cdp-config.md` — config-file alternative to the env var path
- `references/browser-lighthouse-mock.md` — browser-direct path for full Lighthouse

## Platform Check

Tauri v2 uses different webview engines per platform. Only Windows
(WebView2) supports CDP — macOS WKWebView and Linux WebKitGTK do not.
This skill has only been tested on Windows.

| Platform | WebView Engine | CDP Support | Status |
|----------|---------------|:-----------:|--------|
| **Windows** | WebView2 (Chromium) | **Yes** | **Tested** |
| macOS | WKWebView (WebKit) | No | Unverified |
| Linux | WebKitGTK | No | Unverified |

On macOS/Linux, the built-in inspector (right-click → Inspect) is the
only option; external CDP tools do not apply.

> **Multi-instance:** default ports below (Vite `1420`, CDP `9222`)
> assume a single instance. For worktrees or side-by-side projects,
> invoke `/tauri-multi-instance` — it owns the port contract
> (`TAURI_DEV_PORT` / `TAURI_CDP_PORT`), the launcher, and in-place
> `.mcp.json` rewrites.

---

## Step 0: Ensure `.mcp.json` Has CDP Servers

Chrome DevTools MCP and Playwright MCP need CLI flags (`--browserUrl`,
`--cdp-endpoint`) to connect to the Tauri WebView2 CDP port instead of
launching their own browser. **These flags must be set in the MCP server
configuration before the session starts** — they cannot be changed at
runtime.

Check the project root for `.mcp.json`. If it does not exist, or does not
contain `chrome-devtools-cdp` / `playwright-cdp` entries, copy
`references/mcp-json-template.json` into place. It pins both servers to
the default CDP port `9222`; the multi-instance launcher rewrites the
port in place if a different one is allocated.

> **Why `cmd /c` on Windows?** `npx` is actually `npx.cmd` — a batch file
> that requires shell interpretation. Without `cmd /c`, MCP server startup
> fails silently.

> These are **project-level** CDP-connected servers that coexist with the
> global plugins (which connect to their own browser). Use
> `chrome-devtools-cdp` / `playwright-cdp` for Tauri WebView2 debugging;
> use the regular plugin versions for standalone browser work.

If `.mcp.json` was just created or modified, **tell the user that a Claude
Code restart is required** for the new MCP servers to take effect. Do not
proceed with CDP-dependent steps until the servers are available.

---

## Step 1: Build & Launch with CDP

Split into two phases to avoid timeouts during long Rust compilations.

### Step 1a: Build (slow — long timeout or background)

Pre-compile the Rust backend first.

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

> Generous timeout (up to 10 min) or run in the background. Subsequent
> runs are incremental. On memory-constrained machines, set `jobs = 2`
> in `src-tauri/.cargo/config.toml` and drop `"staticlib"` from
> `Cargo.toml` `[lib] crate-type` (iOS/mobile only — adds a full
> extra pass).

### Step 1b: Launch with CDP Port (fast — binary already built)

The CDP port is **process-level** — discarded when the terminal closes.

**Recommended: the multi-instance launcher.** Invoke
`/tauri-multi-instance` and follow its "From tauri-webview-debug"
guidance — `node scripts/tauri-dev.mjs` handles port conflicts, sets
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, and updates `.mcp.json` in place
if the CDP port changes (restart Claude Code to pick up the new port).

**Manual single-instance fallback:**

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" cargo tauri dev
```

```powershell
# PowerShell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
cargo tauri dev
```

Since the binary is already compiled, `cargo tauri dev` only starts Vite
and launches the app — typically under 10 seconds.

> **Only open the CDP port in development.** It is an unauthenticated
> endpoint; exposing it in production lets external processes drive the
> app.

For a `tauri.conf.json`-based alternative (rare — conflicts with the
multi-instance launcher), see `references/alt-cdp-config.md`.

---

## Step 2: Connect Tools

**Always try Playwright MCP (`playwright-cdp`) first.** It uses the
accessibility tree (semantic, compact) and covers DOM, console, network,
screenshots, and UI automation. Fall back to Chrome DevTools MCP
(`chrome-devtools-cdp`) only for **performance tracing**
(`performance_start_trace` / `performance_stop_trace`), which Playwright
lacks.

- Playwright MCP connects via `--cdp-endpoint http://127.0.0.1:9222`.
  Exclusive: `browser_snapshot` (accessibility tree).
- Chrome DevTools MCP connects via `--browserUrl http://127.0.0.1:9222`.
  Exclusive: `performance_start_trace` / `performance_stop_trace`.

### When to Fall Back

| Need | Playwright | Chrome DevTools | Use |
|------|:----------:|:---------------:|-----|
| DOM / CSS / console / network | Yes | Yes | Playwright |
| Screenshots | Yes | Yes | Playwright |
| UI automation | Yes | Yes | Playwright |
| Accessibility tree snapshot | **Yes** | No | Playwright |
| Performance trace (CLS, TBT) | No | **Yes** | Chrome DevTools |
| Playwright connection fails | — | Yes | Chrome DevTools |

### Critical: Windows IPv4 Requirement

On Windows, Node.js `fetch()` and Playwright resolve `localhost` to IPv6
(`::1`), but WebView2 CDP only listens on IPv4 (`127.0.0.1`). **Always
use `127.0.0.1` explicitly** — `http://localhost:9222` fails with
`ECONNREFUSED`. This affects every CDP URL: Playwright `connectOverCDP()`,
`--cdp-endpoint`, `--browserUrl`, and Node.js readiness `fetch()` calls.

> `curl` may still work with `localhost` because it tries both IPv4 and
> IPv6, masking the issue.

### Multi-Window Page Selection

When a Tauri app uses multiple WebView windows (e.g., main + overlay),
CDP exposes multiple pages. Select the target:

- Chrome DevTools MCP: `list_pages` → `select_page`
- Playwright MCP: `browser_tabs` to inspect

### Critical: Playwright + Vite HMR Interference

> **NEVER navigate the regular Playwright plugin to the Vite dev server
> URL (`localhost:1420`) while the Tauri app is running.**

The regular Playwright plugin opens its own Chromium and navigates to
URLs. Connecting it to Vite's dev server adds an extra HMR WebSocket
client — HMR messages then broadcast to ALL clients, including the
Tauri WebView2 windows, causing overlay state corruption, unexpected
hot-reloads, and phantom `about:blank` windows.

**`playwright-cdp` is safe** — it attaches to the existing WebView2 via
CDP instead of navigating to a URL, so no extra HMR client is created.
Another reason to prefer `playwright-cdp` over the regular Playwright
plugin when debugging Tauri.

### Verify CDP Connection

After launch: Playwright `browser_tabs` (or Chrome DevTools `list_pages`)
should list Tauri app pages, **not** `about:blank`. If only `about:blank`
appears, the tool is connected to its own browser — return to Step 0 and
verify the `-cdp` variants (not plain `playwright` / `chrome-devtools`)
are configured.

---

## Step 3: Limitations — What Works and What Doesn't on WebView2 CDP

### Works Well

| Capability | Tool |
|-----------|------|
| DOM inspection / CSS editing | Both |
| Console logs | Both |
| Network request analysis | Both |
| Screenshots | Both |
| JS execution | Both |
| UI automation (click, type) | Both |
| CLS / TBT measurement | Chrome DevTools (performance trace) |
| Accessibility checks (DOM-based) | Both |

### Does Not Work or Is Limited

| Capability | Reason |
|-----------|--------|
| **Lighthouse Performance (full)** | Local file loading → zero network latency → FCP, LCP, TTFB inaccurate |
| **Lighthouse SEO** | Desktop apps are not crawled |
| **Lighthouse PWA** | Already a native app |
| **Best Practices (partial)** | HTTPS, HTTP/2, and other server-related checks don't apply |
| **Tauri `invoke()` debugging** | CDP only accesses the webview layer — no Rust backend debugging |
| **`rdev` keyboard hook testing** | Playwright / Chrome DevTools `press_key` fire WebView-internal events — not OS-level, so global `rdev` hooks may miss them |

### Lighthouse Categories Summary

| Category | WebView2 Direct | Chrome on localhost |
|----------|:--------------:|:-------------------:|
| Performance | Partial (CLS, TBT only) | **Full** |
| Accessibility | **Full** | **Full** |
| Best Practices | Partial | **Full** |
| SEO | N/A | N/A (it's an app) |
| PWA | N/A | N/A (it's an app) |

---

## Step 4: Browser-Direct Approach for Full Lighthouse

`cargo tauri dev` runs a Vite dev server internally, accessible from any
browser at `localhost:<TAURI_DEV_PORT>` (default `1420`). Opening that URL
in Chrome gives you the same frontend with full Lighthouse support — but
Tauri-specific `invoke()` calls fail because `window.__TAURI__` is absent
outside the WebView.

The workaround is a **Vite alias mock** gated on `BROWSER_TEST=true`, so
mock code is never bundled into production. See
`references/browser-lighthouse-mock.md` for the full pattern
(`vite.config.ts` alias, `src/mocks/tauri-core.ts` implementation, run
command).

---

## Workflow Summary: When to Use Which Approach

| Purpose | Tool | invoke Mock Needed |
|---------|------|:-----------------:|
| DOM / CSS / console / network | Playwright MCP | No |
| Accessibility tree snapshot | Playwright MCP | No |
| Screenshots | Playwright MCP | No |
| UI automation testing | Playwright MCP | No |
| CLS, TBT performance trace | Chrome DevTools MCP | No |
| Full Lighthouse audit | Chrome on localhost | **Yes** |
