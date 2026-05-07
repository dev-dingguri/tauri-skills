---
name: tauri-test-setup
description: >-
  Use when planning or adding tests in a Tauri v2 project: journey coverage
  gaps, layer classification, Vitest+RTL mocks, WebView CDP, and OS/manual
  boundaries. Trigger: "test setup", "test infrastructure", "generate tests",
  "missing tests", "coverage gap", "E2E test", "component test" in src-tauri/
  projects.
---

# Tauri v2 Testing

> **Platform note:** L2 (Vitest + RTL) is cross-platform, but L3/L4
> (CDP, pywinauto, UIA) have only been tested on Windows. macOS/Linux
> equivalents are unverified.

Use this skill to decide **what to test**, **which layer should test it**,
and **which infrastructure pattern to reuse**. Write tests for user outcomes,
then place each assertion at the cheapest layer that proves it.

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

## Step 1: Discover Journeys and Gaps

For new tests or coverage audits, start from user journeys instead of files.
Skip to Step 2 only when the journey/gap is already explicit.

Scan four sources:

| Source | How to find | What it reveals |
|---|---|---|
| Tauri commands | `rg "#\[tauri::command\]" src-tauri/src` | Backend capabilities and side effects |
| Frontend actions | Stores/components that call `invoke()` or `emit()` | User-initiated IPC steps |
| Entry points | `index.html`, extra window HTML files | Test surfaces and windows |
| Event listeners | `rg "listen\(" src` | Backend-to-frontend reactive steps |

Group commands/actions that share state or run in sequence into one journey.
Flag unused commands, missing infrastructure, duplicated hardcoded data, and
journeys whose OS side effects are untestable automatically.

Output a compact coverage matrix before writing tests:

```markdown
| Journey | Step | Existing Test | Layer | Status |
|---|---|---|---|---|
| J-01 Settings | Toggle option -> invoke save -> persist | settings.test.tsx | L2 | Covered |
| J-01 Settings | Registry side effect | (none) | L4 | Manual |
```

Prioritize gaps:

- High user impact + easy layer coverage -> write now.
- High user impact + hard OS dependency -> document manual QA.
- Low impact -> skip unless the user explicitly asks.

When writing tests, find an existing test at the same layer first and copy its
structure, imports, mock setup, assertion style, and naming conventions.

---

## Step 2: Test Layers & Tool Selection

| Layer | Tool | Coverage | Examples |
|---|---|---|---|
| **L1 — Pure Logic** | Rust `#[test]` / Vitest | State machines, calculations, parsing, serialization | Config parsing, debounce, data aggregation |
| **L2 — Frontend Rendering** | Vitest + RTL + Tauri mock | React components, stores, conditional UI | Card rendering, toast lifecycle, slider defaults |
| **L3 — WebView Integration** | Playwright / Chrome DevTools MCP (CDP) | Live DOM, screenshots, console errors | Multi-window layout, CSS transition, a11y audit |
| **L4 — OS Integration** | Python pytest + pywinauto (partial) / Manual | Global key hooks, tray, registry, audio | OS hotkeys, tray menu, autostart, device detection |

Classification rules:

- Plain Rust/TypeScript logic with no Tauri boundary -> L1.
- Frontend code calling Tauri `invoke`, `listen`, `emit`, or
  `@tauri-apps/api/window` -> L2 with mocks.
- Live WebView DOM, CSS, multi-window layout, screenshots, console errors -> L3.
- Direct OS effects (registry, tray, audio device, global key hook) -> L4.
- OS trigger followed by WebView state, or WebView action followed by OS side
  effect -> L3+L4 hybrid.
- Canvas or non-React WebView rendering -> L3 for pixels/DOM, L4 only when the
  trigger or assertion crosses the OS boundary.

---

## Step 3: L2 — Vitest + RTL + Tauri Mock

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

## Step 4: L3 — WebView CDP Tests

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

## Step 5: L4 — OS Native Tests

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
