# L3 Recipe — Playwright CDP Fixture & Gotchas

A Playwright-based E2E fixture for WebView2 CDP. Covers connection,
main-window selection, state reset, the persisted-settings trap, the
connect-after pattern for multi-window tests, and locator strategy for
shipped binaries.

> Prerequisites:
> - `/tauri-webview-debug` — `.mcp.json`, IPv4 requirement, build/run split.
> - `/tauri-multi-instance` — the `TAURI_CDP_PORT` env-var contract.

## Fixture: CDP Connection + Main-Window Selection

```typescript
// e2e/fixtures/tauri-app.ts
import { chromium, test as base, type Page } from "@playwright/test";

// Why 127.0.0.1: Windows resolves `localhost` to IPv6 (`::1`), but
// WebView2 CDP listens on IPv4 only. See /tauri-webview-debug.
// Why env var: multi-instance dev (worktrees, parallel projects)
// allocates non-default ports via scripts/tauri-dev.mjs.
// See /tauri-multi-instance.
const CDP_URL = `http://127.0.0.1:${process.env.TAURI_CDP_PORT || "9222"}`;

export const test = base.extend<{ tauriPage: Page }>({
  tauriPage: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];

    // Why /pages/ exclusion (not `/` or `index.html`): sub-windows
    // (overlay, about, settings, toast) all live under /pages/.
    // Filtering by a single sub-path breaks as soon as a new sub-window
    // is added. Excluding /pages/ is the stable identity for "main".
    const page = context.pages().find((p) => !p.url().includes("/pages/"));
    if (!page) throw new Error("Main window not found in CDP targets");

    await page.reload(); // Reset Zustand stores bound to window state
    await page.waitForLoadState("networkidle");
    await use(page);

    // Disconnect only — do NOT close the Tauri app. `browser.close()`
    // on a CDP-attached browser disconnects the CDP session; the app
    // process keeps running for the next test.
    await browser.close();
  },
});
```

## Gotcha: Persisted App State

Tauri apps persist user settings via `tauri-plugin-store`. `page.reload()`
reloads those settings, so a hardcoded default in an assertion may not
match what the store currently holds (e.g., a previous manual run left
`volume: 0.3`). **Assert relative to current state**, not an absolute
baseline.

```typescript
// Fragile — fails if a previous run changed the value
expect(Number(await slider.inputValue())).toBeCloseTo(0.8, 1);

// Robust — verify the change, then restore
const before = await slider.inputValue();
const target = Number(before) > 0.5 ? "0.2" : "0.9";
await slider.fill(target);
await expect(slider).toHaveValue(target);
await slider.fill(before); // Restore
```

## CRITICAL: Multi-Window — Connect-After Pattern

WebView2 CDP does **not** auto-detect new windows on an existing
connection. Unlike Chrome (where new tabs emit `Target.targetCreated`),
each Tauri window is a separate WebView2 control that appears in the
CDP target list only **at connection time**.

**Wrong** — polling `context.pages()` will hang forever:

```typescript
// Will timeout — WebView2 never adds new targets to an existing connection
const toast = await waitForWindow(context, "/pages/toast.html");
```

**Correct** — open the window, then *reconnect*:

```typescript
// 1. Trigger the new window (backend or UI action)
await page.evaluate(
  (reason) =>
    (window as any).__TAURI_INTERNALS__.invoke("debug_show_toast", { reason }),
  "speaker",
);
await new Promise((r) => setTimeout(r, 1000)); // Window creation is async

// 2. Reconnect — all current targets (including the new toast) are now visible
const browser2 = await chromium.connectOverCDP(CDP_URL);
const toastPage = browser2
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes("/pages/toast.html"));
```

For Python (L3+L4 hybrid), the same rule applies — see
`l4-hybrid-cdp-python.md` for the context-manager form.

## Trigger Methods by Window Type

| Window type | How to trigger in E2E | Example |
|---|---|---|
| JS-created (settings, about) | Click a menu item on the main page | `page.locator("text=Settings").click()` |
| Rust-created (toast, overlay) | Invoke a debug Tauri command | See `l3-debug-commands.md` |
| OS-triggered (tray → settings) | pywinauto tray menu click (L4) | See `l4-hybrid-cdp-python.md` |

After any trigger, always call `page.waitForLoadState("networkidle")`
on the new page to ride out async init (font loading, data fetch,
show-gate JS).

## Gotcha: WebView Element Locator Strategy

`data-testid` is the preferred locator — **but it requires a frontend
rebuild to be reflected in the binary**. Tests that must run against
an **existing binary** (release build, CI artifact, QA handoff) need
a dual strategy:

```typescript
// Works with any binary — DOM structure + ARIA role
page
  .locator('div:has-text("Start automatically")')
  .locator('[role="switch"]')
  .first();

// Works after a frontend rebuild — direct data-testid
page.locator('[data-testid="autostart-switch"]');
```

Rules of thumb:

- Radix UI components expose `role="switch" | "slider" | ...` and
  `data-state="checked" | "unchecked"` — query by those when
  `data-testid` is not yet available in the binary.
- Use `:has-text("label")` to scope a locator to the correct container
  before drilling into the primitive.
- `.first()` is safe when DOM order is stable; fragile if the layout
  reorders.
- Always **also** add `data-testid` for the next rebuild — the dual
  strategy is a bridge, not a permanent state.

## Gotcha: Vitest/Playwright `test.describe` Collision

Both Vitest and Playwright export `test` / `describe`. If Vitest
accidentally picks up E2E files, the two harnesses collide and produce
cryptic failures ("describe is not a function" or worse, both ran
partially).

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
});
```

## Related

- `l3-debug-commands.md` — expose backend-only windows and store state
  to E2E tests.
- `l4-hybrid-cdp-python.md` — same patterns in Python, combined with
  pywinauto for journeys that start on the OS side.
- `/tauri-webview-debug` — the CDP connection infrastructure this
  recipe sits on top of.
- `/tauri-multi-instance` — the `TAURI_CDP_PORT` contract.
