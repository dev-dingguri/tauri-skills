---
name: tauri-webview-debug
description: >-
  Debug Tauri v2 WebView2 via CDP — Playwright MCP (primary) + Chrome DevTools MCP
  (fallback). Handles .mcp.json setup, CDP launch, and Lighthouse.
  Trigger: UI debugging, DOM inspection, screenshots, a11y, or perf analysis in src-tauri/ projects.
---

# Tauri WebView Debug — Browser Debugging Tools for Tauri v2

Workflow for debugging Tauri v2 WebViews using Chrome DevTools MCP / Playwright MCP.

## Platform Check

Tauri v2 uses different webview engines per platform.

| Platform | WebView Engine | CDP Support |
|----------|---------------|:-----------:|
| **Windows** | WebView2 (Chromium) | **Yes** |
| macOS | WKWebView (WebKit) | No |
| Linux | WebKitGTK | No |

CDP-based tools (Chrome DevTools MCP, Playwright MCP) can **only connect directly on Windows** via WebView2.
On macOS/Linux, only Step 4 (browser-direct approach) is available.

---

## Step 0: Ensure `.mcp.json` Has CDP Servers

Chrome DevTools MCP and Playwright MCP need CLI flags (`--browserUrl`, `--cdp-endpoint`) to connect
to the Tauri WebView2 CDP port instead of launching their own browser. These flags must be set
in the MCP server configuration **before the session starts** — they cannot be changed at runtime.

**Check** the project root for `.mcp.json`. If it does not exist, or does not contain
`chrome-devtools-cdp` and `playwright-cdp` entries, create/update it:

```json
{
  "mcpServers": {
    "chrome-devtools-cdp": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "chrome-devtools-mcp@latest",
        "--browserUrl",
        "http://127.0.0.1:9222"
      ]
    },
    "playwright-cdp": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "@playwright/mcp@latest",
        "--cdp-endpoint",
        "http://127.0.0.1:9222"
      ]
    }
  }
}
```

> **Why `cmd /c`?** On Windows, `npx` is actually `npx.cmd` — a batch file that requires
> shell interpretation. Without `cmd /c`, MCP server startup fails silently.

> These are **project-level** CDP-connected servers that coexist with the global plugins
> (which connect to their own browser). Use `chrome-devtools-cdp` / `playwright-cdp` for
> Tauri WebView2 debugging; use the regular plugin versions for standalone browser work.

If `.mcp.json` was just created or modified, **inform the user that a Claude Code restart
is required** for the new MCP servers to take effect. Do not proceed with CDP-dependent
steps until the servers are available.

---

## Step 1: Build & Launch with CDP

Split into two phases to avoid timeout during long Rust compilations.

### Step 1a: Build (slow — run with long timeout or in background)

Pre-compile the Rust backend. This is the slow part — especially on memory-constrained
environments.

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

> Run this with a generous timeout (up to 10 min) or in the background.
> Subsequent runs are incremental and fast if source hasn't changed.

On memory-constrained machines, limit parallel jobs. Prefer persisting in
`.cargo/config.toml` so every `cargo` invocation (including `cargo tauri dev`
internals) respects it automatically:

```toml
# src-tauri/.cargo/config.toml
[build]
jobs = 2
```

Also check `Cargo.toml` `crate-type`: Tauri desktop apps only need `["cdylib", "rlib"]`.
Remove `"staticlib"` if present — it adds an extra full compilation pass
(staticlib is only needed for iOS/mobile targets).

### Step 1b: Launch with CDP port (fast — binary already built)

Once the build completes, start the app with a CDP debugging port.
The environment variable is **process-level** — discarded when the terminal closes.

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" cargo tauri dev
```

PowerShell:
```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
cargo tauri dev
```

Since the Rust binary is already compiled in Step 1a, `cargo tauri dev` only starts
the Vite dev server and launches the app — typically under 10 seconds.

### Alternative: Declare CDP port in tauri.conf.json

Add `additionalBrowserArgs` to `app.windows[]`.
Note: this overrides wry's default flags, so you must restore them manually:

```jsonc
{
  "app": {
    "windows": [{
      "label": "main",
      "additionalBrowserArgs": "--remote-debugging-port=9222 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    }]
  }
}
```

> **Warning**: Only open the CDP port in **development**. Exposing it in production allows external actors to control the app.

---

## Step 2: Connect Tools

**Always try Playwright MCP (`playwright-cdp`) first.** Fall back to Chrome DevTools MCP
(`chrome-devtools-cdp`) only when Playwright cannot do the job (see fallback table below).

**Why Playwright first**: Playwright uses the **accessibility tree** (semantic, compact).
Chrome DevTools uses **raw DOM/CSS**. Chrome DevTools is needed only for **performance tracing**
(`performance_start_trace` / `performance_stop_trace`), which Playwright lacks.

### Primary: Playwright MCP

Connect via CDP endpoint:
```
--cdp-endpoint http://127.0.0.1:9222
```

Capabilities:
- `browser_snapshot` — accessibility-tree-based snapshot (Playwright exclusive)
- `browser_click`, `browser_fill_form`, `browser_type` — UI automation
- `browser_take_screenshot` — screenshots
- `browser_console_messages` — console logs
- `browser_network_requests` — network analysis
- `browser_evaluate` — JS execution

### Fallback: Chrome DevTools MCP

Use when Playwright MCP is unavailable or when you need **performance tracing** (CLS, TBT).

Connect via `--browserUrl`:
```
--browserUrl http://127.0.0.1:9222
```

Capabilities:
- `take_screenshot` — capture UI state
- `evaluate_script` — run JS, inspect DOM
- `list_network_requests` / `get_network_request` — network analysis
- `list_console_messages` — console log inspection
- `performance_start_trace` / `performance_stop_trace` — **rendering performance (exclusive)**
- `click`, `fill`, `hover` — UI interaction

### When to Fall Back to Chrome DevTools MCP

| Need | Playwright | Chrome DevTools | Use |
|------|:----------:|:---------------:|-----|
| DOM / CSS / console / network | Yes | Yes | Playwright |
| Screenshots | Yes | Yes | Playwright |
| UI automation | Yes | Yes | Playwright |
| Accessibility tree snapshot | **Yes** | No | Playwright |
| Performance trace (CLS, TBT) | No | **Yes** | Chrome DevTools |
| Playwright connection fails | — | Yes | Chrome DevTools |

### Critical: Windows IPv4 Requirement

On Windows, Node.js `fetch()` and Playwright resolve `localhost` to IPv6 (`::1`), but WebView2 CDP only listens on IPv4 (`127.0.0.1`). **Always use `127.0.0.1` explicitly:**

| | URL | Result on Windows |
|---|---|---|
| ✅ | `http://127.0.0.1:9222` | Works |
| ❌ | `http://localhost:9222` | ECONNREFUSED (IPv6 mismatch) |

This affects:
- Playwright `connectOverCDP()` calls
- Playwright MCP `--cdp-endpoint` configuration
- Node.js `fetch()` for CDP readiness checks
- Chrome DevTools MCP `--browserUrl` configuration

> `curl` may still work with `localhost` because it tries both IPv4 and IPv6, masking the issue.

### Multi-Window Note

When a Tauri app uses multiple WebView windows (e.g., main + overlay),
CDP exposes multiple pages. Select the target window:

- Chrome DevTools MCP: `list_pages` → `select_page`
- Playwright MCP: `browser_tabs` to inspect

### Critical: Playwright + Vite HMR Interference

> **NEVER navigate Playwright to the Vite dev server URL (`localhost:1420`) when the Tauri app is running.**

This warning applies to the **regular Playwright plugin** (which opens its own Chromium and navigates
to URLs). When it connects to `localhost:1420`, Vite's HMR WebSocket gains an additional client.
HMR messages broadcast to ALL clients — including the Tauri WebView2 windows. This can cause:

- Overlay window state corruption (visual effects stop working)
- Unexpected hot-reload behavior in the Tauri app
- Phantom browser windows (`about:blank`, `overlay.html`) confusing the user

**`playwright-cdp` is safe** — it connects to the existing WebView2 via CDP, not by navigating
to a URL. No additional HMR client is created. This is another reason to prefer `playwright-cdp`
over the regular Playwright plugin when debugging Tauri apps.

### Verify CDP Connection (Step 0 prerequisite)

If Step 0 was completed, `playwright-cdp` and `chrome-devtools-cdp` MCP servers should be
available. Verify connection after launching the app:

- Playwright MCP: `browser_tabs` should list Tauri app pages
- Chrome DevTools MCP (fallback): `list_pages` should show Tauri app pages, NOT `about:blank`
- If only `about:blank` appears, the tool is connected to its own browser — go back to Step 0

> If the regular plugin versions (`playwright`, `chrome-devtools`) are used instead of the
> `-cdp` variants, they will connect to their own browser, not the Tauri WebView2.

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
| CLS measurement | Chrome DevTools MCP (performance trace) |
| TBT measurement | Chrome DevTools MCP (performance trace) |
| Accessibility checks (DOM-based) | Both |

### Does Not Work or Is Limited

| Capability | Reason |
|-----------|--------|
| **Lighthouse Performance (full)** | Local file loading means zero network latency → FCP, LCP, TTFB are inaccurate |
| **Lighthouse SEO** | Desktop apps are not crawled by search engines |
| **Lighthouse PWA** | Already a native app |
| **Best Practices (partial)** | HTTPS, HTTP/2, and other server-related checks are not applicable |
| **Tauri invoke() debugging** | CDP only accesses the webview layer — Rust backend debugging is not possible |
| **rdev keyboard hook testing** | Playwright `press_key` / Chrome DevTools MCP `press_key` only fire WebView-internal events — they may not be captured by `rdev` global hooks since they are not OS-level events |

### Lighthouse Categories Summary

| Category | WebView2 Direct | Chrome on localhost |
|----------|:--------------:|:------------------:|
| Performance | Partial (CLS, TBT only) | **Full** |
| Accessibility | **Full** | **Full** |
| Best Practices | Partial | **Full** |
| SEO | N/A | N/A (it's an app) |
| PWA | N/A | N/A (it's an app) |

---

## Step 4: Browser-Direct Approach — When Full Lighthouse Audits Are Needed

`cargo tauri dev` runs a frontend dev server internally:

```
cargo tauri dev
  ├─ Vite dev server (localhost:1420)  ← accessible from any browser
  └─ Tauri WebView2 (loads the same URL)
```

Opening `http://localhost:1420` in Chrome gives you the same frontend with full Lighthouse support.

### Problem: invoke() Fails

Browsers lack Tauri IPC, so `window.__TAURI__` is undefined:

```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('get_user_data'); // ❌ window.__TAURI__ is undefined
```

### Solution: Vite Alias Mock Injection

Inject mocks at build time without polluting production code:

```typescript
// vite.config.ts
const isBrowserTest = process.env.BROWSER_TEST === 'true';

export default defineConfig({
  resolve: {
    alias: isBrowserTest ? {
      '@tauri-apps/api/core': './src/mocks/tauri-core.ts'
    } : {}
  }
});
```

```typescript
// src/mocks/tauri-core.ts
const mockData: Record<string, unknown> = {
  get_user_data: { name: 'Test User', id: 1 },
  // Add dummy data for each invoke command in the project
};

export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  console.warn(`[Mock] invoke('${cmd}') — returning dummy data`);
  return (mockData[cmd] ?? null) as T;
}
```

Run:
```bash
BROWSER_TEST=true npx vite dev   # Open localhost:1420 in Chrome and run Lighthouse
```

> Vite's `resolve.alias` is resolved at build time, so mock code is never included in production builds.

---

## Workflow Summary: When to Use Which Approach

```
┌──────────────────────────────────────────────────────────┐
│ Day-to-day Development — Playwright MCP (primary)        │
│ playwright-cdp → WebView2 CDP                            │
│ - DOM inspection, console errors, network analysis       │
│ - Accessibility tree snapshots                           │
│ - UI automation (click, type, fill)                      │
│ - Screenshots                                            │
├──────────────────────────────────────────────────────────┤
│ Performance Tracing — Chrome DevTools MCP (fallback)     │
│ chrome-devtools-cdp → WebView2 CDP                       │
│ - CLS, TBT measurement (performance_start/stop_trace)   │
├──────────────────────────────────────────────────────────┤
│ Pre-release Quality Checks                               │
│ Open localhost in Chrome and run Lighthouse (with Mocks)  │
│ - Performance (full metrics including network)            │
│ - Accessibility (full audit)                             │
│ - Best Practices (full audit)                            │
└──────────────────────────────────────────────────────────┘
```

| Purpose | Tool | invoke Mock Needed |
|---------|------|:-----------------:|
| DOM / CSS / console / network | Playwright MCP | No |
| Accessibility tree snapshot | Playwright MCP | No |
| Screenshots | Playwright MCP | No |
| UI automation testing | Playwright MCP | No |
| CLS, TBT performance trace | Chrome DevTools MCP | No |
| Full Lighthouse audit | Chrome on localhost | **Yes** |

---

## Checklist

1. [ ] Verify platform (Windows?)
2. [ ] Ensure `.mcp.json` has `chrome-devtools-cdp` and `playwright-cdp` entries (Step 0)
3. [ ] Build Rust backend (`cargo build --manifest-path src-tauri/Cargo.toml`) — long timeout / background
4. [ ] Launch with CDP port (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" cargo tauri dev`)
5. [ ] Verify connection: Playwright `browser_tabs` or Chrome DevTools `list_pages` should show Tauri app pages, NOT `about:blank`
6. [ ] Select target page if multi-window
7. [ ] **NEVER** navigate the regular Playwright plugin to `localhost:1420` while Tauri is running (`playwright-cdp` via CDP is safe)
8. [ ] Perform debugging
9. [ ] (If needed) Switch to Chrome + Mock for full Lighthouse audit
