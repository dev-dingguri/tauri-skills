---
name: tauri-test-setup
description: >-
  Test infrastructure guide for Tauri v2 apps. Covers test layer classification,
  Tauri API mock recipes for Vitest + RTL, and CDP/manual test boundaries.
  Trigger on: "test setup", "test infrastructure", "QA automation", "component test",
  "E2E test" in a Tauri project.
  Also trigger when: a project with src-tauri/ discusses vitest, testing-library, or
  test strategy. Use when designing test infrastructure or strategy, not when simply
  adding individual test cases.
---

# Tauri v2 Testing — Layer-Based Test Infrastructure

> **Platform note:** L2 (Vitest + RTL) is cross-platform, but L3/L4
> (CDP, pywinauto, UIA) have only been tested on Windows. macOS/Linux
> equivalents are unverified.

Recipes under `references/recipes/`:

- `l2-vitest-mock.md` — Tauri API mock triple + invoke mock data
- `l2-zustand-testing.md` — store state injection pattern
- `l2-act-fake-timers.md` — `act()` + `vi.useFakeTimers` pattern
- `l3-playwright-fixture.md` — CDP fixture, connect-after, persisted
  state, locator strategy
- `l3-debug-commands.md` — debug `#[tauri::command]` + dev-only store
- `l4-hybrid-cdp-python.md` — L3+L4 hybrid via Playwright CDP + pywinauto

External delegations:

- `/tauri-webview-debug` — CDP launch, `.mcp.json`, IPv4 requirement,
  build/run split
- `/tauri-multi-instance` — `TAURI_CDP_PORT` env-var contract
- `/tauri-os-automation` — Windows L4 pywinauto patterns (tray,
  registry, window polling, key-hook constraints)

---

## Step 1: Test Layers & Tool Selection

| Layer | Tool | Coverage | Examples |
|---|---|---|---|
| **L2 — Frontend Rendering** | Vitest + RTL + Tauri mock | React components, stores, conditional UI | Card rendering, toast lifecycle, slider defaults |
| **L3 — WebView Integration** | Playwright / Chrome DevTools MCP (CDP) | Live DOM, screenshots, console errors | Multi-window layout, CSS transition, a11y audit |
| **L4 — OS Integration** | Python pytest + pywinauto (partial) / Manual | Global key hooks, tray, registry, audio | OS hotkeys, tray menu, autostart, device detection |

---

## Step 2: L2 — Vitest + RTL + Tauri Mock

### Bootstrap

Before any L2 test runs:

- **`vitest.config.ts`**: `environment: "jsdom"` (RTL needs a DOM) and
  the `@/` path alias matching `tsconfig.json` so imports resolve the
  same in tests as in source.
- **`tsconfig.json`**: exclude test files — `"exclude": ["src/test",
  "**/*.test.ts", "**/*.test.tsx"]`. Vitest's globals (`vi`, `expect`)
  aren't declared during `tsc` builds, so type-checking test files in
  `tsc` fails. Excluding them keeps `tsc` green while Vitest still
  runs them at test time.
- **`src/test/setup.ts`**: `import "@testing-library/jest-dom/vitest";`
  — registers matchers like `toBeInTheDocument()` so assertions read
  naturally.

### Mock Recipes

Mock building blocks in `references/recipes/`:

1. **`l2-vitest-mock.md`** — Tauri API mock triple (`core`, `event`,
   `window`) plus per-command invoke mock data. Every test file needs
   this or a shared `src/test/setup.ts`.
2. **`l2-zustand-testing.md`** — direct `setState` instead of
   replaying store actions, with cross-test leakage guards.
3. **`l2-act-fake-timers.md`** — `act()` + `vi.useFakeTimers` for
   timer-driven state updates (toast auto-dismiss, debounce).

### CRITICAL: `vi.clearAllMocks()` vs `vi.restoreAllMocks()`

Single most common L2 footgun:

```typescript
afterEach(() => {
  cleanup();
  vi.clearAllMocks();   // ✅ clears call history, preserves implementations
  // vi.restoreAllMocks(); // ❌ wipes mockResolvedValue set in vi.mock() factories
});
```

Why: `vi.fn().mockResolvedValue(...)` inside a `vi.mock()` factory is
still a `vi.fn()`. `restoreAllMocks()` calls `.mockRestore()` on it and
wipes the implementation. The next test sees `listen()` return
`undefined`, and the component crashes on `unlisten.then()` during
unmount. Always `clearAllMocks`, never `restoreAllMocks`, in Tauri v2
mock setups.

Pair it with `vi.useRealTimers()` in the same `afterEach` to prevent
fake-timer leakage across tests (see `l2-act-fake-timers.md`).

---

## Step 3: L3 — WebView CDP Tests

L3 drives the **running** Tauri WebView via CDP. `/tauri-webview-debug`
owns CDP infrastructure (`.mcp.json`, IPv4 requirement, Vite HMR
warning, build/launch split). Read it first if the CDP endpoint is
not available — this section assumes it is.

### L3 Recipes

- **`l3-playwright-fixture.md`** — CDP connection fixture, main-window
  selection, the persisted-settings trap, the connect-after pattern
  for multi-window tests, dual locator strategy for shipped binaries,
  and the Vitest/Playwright `test.describe` collision guard.
- **`l3-debug-commands.md`** — expose backend-only features to E2E
  via a debug `#[tauri::command]` (with the `thread::spawn` deadlock
  fix), and the `window.__TEST_STORE__` dev-only store handle.

Both recipes read `TAURI_CDP_PORT` from the env — never hardcode.
See `/tauri-multi-instance` for the contract.

---

## Step 4: L4 — OS Native Tests

L4 (Windows system tray, registry, global key hooks, window polling)
is owned by **`/tauri-os-automation`**. Follow its "From
tauri-test-setup (L4 section)" guidance. It provides:

- The L4 Automatable vs Manual table (what pywinauto can/cannot do).
- `TrayIconBuilder::tooltip()` requirement + Windows 11 two-places
  pitfall (`windows-tray-uia.md`).
- `FindWindowW` over `Desktop().windows()` for polling stability
  (`polling-stability.md`).
- `LLKHF_INJECTED` + SendInput constraint — why global key hook tests
  remain manual (`key-hook-constraints.md`).
- `conftest.py` app fixture, `helpers/app.py`, `helpers/tray.py`,
  `helpers/registry.py`, autostart backup fixture
  (`pywinauto-patterns.md`).

The app fixture must pass `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`
reading `TAURI_CDP_PORT` from the env — see `/tauri-multi-instance`
for the port contract, and `l4-hybrid-cdp-python.md` for the extended
fixture when the project runs L3+L4 hybrid tests.
