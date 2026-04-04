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

# Tauri v2 Testing — Layer-Based Test Strategy

## Core Principle

A Tauri app is a **web frontend + native backend** dual architecture.
Trying to test everything with a single tool will fail.
Pick the right tool for each layer, and clearly delineate what cannot be automated.

---

## Step 1: Classify Test Layers

The first step is to classify the project's features into these four layers.

| Layer | Tool | Coverage | Examples |
|-------|------|----------|----------|
| **L1 — Pure Logic** | Rust `#[test]` / Vitest | State machines, calculations, serialization, heuristics | Data aggregation, input debounce, config parsing |
| **L2 — Frontend Rendering** | Vitest + RTL + Tauri mock | React components, state stores, conditional UI | Card rendering, toast lifecycle, slider defaults |
| **L3 — WebView Integration** | Chrome DevTools MCP (CDP) | Live DOM inspection, screenshots, console errors | Multi-window layout, CSS transition, a11y audit |
| **L4 — OS Integration** | Manual testing only | Global key hooks, system tray, registry, audio hardware | OS hotkeys, tray menu, autostart, device detection |

### Classification Criteria

- **Frontend code calling Tauri `invoke`** → L2 (mock invoke)
- **Code depending on Tauri events (`listen`/`emit`)** → L2 (mock listen)
- **Code using `@tauri-apps/api/window`** → L2 (mock getCurrentWindow)
- **Plain JS + Canvas outside React (e.g., overlay.html)** → L3 or L4
  - Only need to verify canvas rendering → L3 (CDP screenshot)
  - Input trigger is OS-level (rdev, etc.) → L4 (CDP press_key only fires WebView-internal events)
- **Direct OS API calls** (registry, audio devices, system tray) → L4

---

## Step 2: L1 — Rust Unit Tests

Rust tests need minimal setup. Key considerations:

- **Functions requiring `AppHandle`**: Extract core logic into pure functions testable without Tauri app context
- **File I/O**: Test in-memory structs instead of `tauri-plugin-store`
- **Time-dependent logic**: Use injectable timestamp parameters instead of `Instant::now()`

```rust
// Good: testable pure function
fn aggregate_records(records: &[Record], cutoff: Duration) -> Summary { ... }

// Bad: tied to AppHandle — requires full Tauri app context to test
fn get_stats(app: AppHandle) -> Stats { ... }
```

---

## Step 3: L2 — Vitest + RTL + Tauri Mock

### Tauri API Mock Recipe

The core of Tauri v2 frontend testing. Three modules must be mocked.

```typescript
import { vi } from "vitest";

// --- 1. @tauri-apps/api/core ---
// Extracting invoke to an external variable allows per-test return values.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// --- 2. @tauri-apps/api/event ---
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// --- 3. @tauri-apps/api/window ---
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    hide: vi.fn(),
    destroy: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    setFocus: vi.fn(),
  })),
}));
```

### Setting Up invoke Mock Data

```typescript
beforeEach(() => {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_settings":
        return Promise.resolve({ active: true, volume: 0.8 /* ... */ });
      case "get_stats":
        return Promise.resolve({ elapsed: 3720, count: 1250 });
      default:
        return Promise.resolve(undefined);
    }
  });
});
```

### Critical Pitfall: `vi.clearAllMocks()` vs `vi.restoreAllMocks()`

```typescript
afterEach(() => {
  cleanup();
  // ✅ Correct: clears call history only, preserves mock implementations
  vi.clearAllMocks();

  // ❌ Dangerous: resets mockResolvedValue implementations created by vi.mock factories.
  //    Next test: listen() returns undefined → component crashes on unlisten.then().
  // vi.restoreAllMocks();
});
```

Why: `vi.fn().mockResolvedValue(...)` inside a `vi.mock` factory is still a `vi.fn()`.
`restoreAllMocks()` calls `.mockRestore()` on it, wiping the implementation.
When `listen` returns `undefined`, `unlisten.then()` throws TypeError.

### `act()` + Fake Timers

React state updates triggered by timers must run inside `act()`:

```typescript
import { act } from "@testing-library/react";

it("auto-dismisses after 5 seconds", () => {
  vi.useFakeTimers();
  render(<Toast />);

  act(() => {
    vi.advanceTimersByTime(5000);
  });

  expect(screen.queryByText("toast text")).not.toBeInTheDocument();
  vi.useRealTimers();
});
```

Add `vi.useRealTimers()` to `afterEach` to prevent fake timer leaks across tests.

### Zustand Store Testing

Zustand actions that internally call Tauri invoke can be tested by directly setting store state:

```typescript
import { useStore } from "@/stores/store";

beforeEach(() => {
  useStore.setState({
    active: true,
    volume: 0.8,
    firstRun: false,
    // ... default state
  });
});

it("conditional rendering based on store state", () => {
  useStore.setState({ firstRun: true });
  render(<WelcomeToast />);
  expect(screen.getByText("Welcome message")).toBeInTheDocument();
});
```

---

## Step 4: L3 — Chrome DevTools MCP (CDP)

> For CDP connection details, see the `tauri-webview-debug` skill.

Key constraints from a testing perspective:

### What Works
- DOM structure inspection (`evaluate_script`)
- Screenshots (`take_screenshot`)
- Console error collection (`list_console_messages`)
- Network request inspection (`list_network_requests`)
- UI automation — click, type (`click`, `fill`)

### What Does Not Work
- **rdev / global key hook triggering**: CDP `press_key` only fires WebView-internal events.
  OS-level keyboard hooks (rdev) do not respond.
  → The key input → sound/effect pipeline cannot be tested via CDP.
- **`--browserUrl` runtime change**: Chrome DevTools MCP config is fixed at server startup.
  Pre-configuration is required to connect to the Tauri CDP port.
- **Multi-window**: Playwright `context.pages()` lists all WebView windows. Use URL-based filtering to target specific pages. Chrome DevTools MCP requires `list_pages` → `select_page`.

### L3 Implementation: Playwright + CDP Patterns

#### Fixture: CDP Connection + Auto-Start

```typescript
// e2e/fixtures/tauri-app.ts
import { chromium, test as base } from "@playwright/test";

// Why 127.0.0.1: On Windows, localhost resolves to IPv6 (::1) but WebView2 CDP only listens on IPv4
const CDP_URL = "http://127.0.0.1:9222";

export const test = base.extend<{ tauriPage: Page }>({
  tauriPage: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0];
    // Why /pages/ exclusion: Sub-windows (overlay, about, settings, toast) all live
    // under /pages/. The main window is at / or /index.html. Filtering by a single
    // sub-path (e.g., /overlay.html) breaks when new sub-windows are added.
    const page = context.pages().find(p => !p.url().includes("/pages/"));
    await page.reload(); // Reset Zustand store
    await page.waitForLoadState("networkidle");
    await use(page);
    await browser.close(); // Disconnect only — app keeps running
  },
});
```

#### Gotcha: Persisted App State

Tauri apps persist settings via `tauri-plugin-store`. `page.reload()` reloads saved settings, so **never hardcode default values in E2E tests.**

```typescript
// ❌ Fragile — value may have changed from previous tests or manual use
expect(Number(await slider.inputValue())).toBeCloseTo(0.8, 1);

// ✅ Assert based on current value — verify change, then restore
const before = await slider.inputValue();
const target = Number(before) > 0.5 ? "0.2" : "0.9";
await slider.fill(target);
await expect(slider).toHaveValue(target);
await slider.fill(before); // Restore
```

#### Multi-Window E2E: Polling for Dynamically Created Windows

Tauri apps often create windows dynamically (about, settings, toast notifications).
These windows appear as new entries in `context.pages()` after creation. Use a
polling helper to wait for them:

```typescript
function findByUrl(context: BrowserContext, urlPart: string): Page | undefined {
  return context.pages().find((p) => p.url().includes(urlPart));
}

async function waitForWindow(
  context: BrowserContext,
  urlPart: string,
  timeout = 10_000,
): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = findByUrl(context, urlPart);
    if (page) return page;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Window ${urlPart} did not appear within ${timeout}ms`);
}
```

**Triggering methods** differ by window type:

| Window type | Trigger | Example |
|-------------|---------|---------|
| JS-created (about, settings) | Click menu item on main page | `page.locator("text=Settings").click()` |
| Rust-created (toast, overlay) | Debug Tauri command via `invoke` | See "Debug Tauri Command" pattern below |

After the window appears, always call `waitForLoadState("networkidle")` to wait
for any async init (e.g., font loading, data fetch → `show()`).

#### Gotcha: Debug Tauri Commands for OS-Triggered Features

Features triggered only by OS events (e.g., speaker detection → toast window) cannot
be triggered from the frontend. Expose a dev-only Tauri command:

```rust
#[tauri::command]
pub fn debug_show_toast(app: AppHandle, reason: String) -> Result<(), String> {
    if cfg!(not(debug_assertions)) {
        return Err("debug-only command".into());
    }
    // Why thread::spawn: #[tauri::command] runs on a tokio thread.
    // WebviewWindowBuilder::build() dispatches to the main thread and waits,
    // but the main thread is blocked on the IPC response → deadlock.
    // Spawning on a separate OS thread lets the command return first,
    // unblocking the main thread so build() can proceed.
    std::thread::spawn(move || {
        if let Err(e) = show_toast(&app, reason) {
            eprintln!("[debug_show_toast] {e}");
        }
    });
    Ok(())
}
```

Call from E2E:

```typescript
await page.evaluate((reason) =>
  (window as any).__TAURI_INTERNALS__.invoke("debug_show_toast", { reason }),
  "speaker",
);
const toast = await waitForWindow(context, "/pages/toast.html");
```

Key points:
- Use `cfg!(not(debug_assertions))` (expression macro) instead of `#[cfg()]` (attribute)
  because `#[cfg()]` cannot be used inside `generate_handler![]` macro arguments.
- `thread::spawn` is **required** when the command creates a WebView window — without it,
  the `build()` call deadlocks.
- Register the command unconditionally in `generate_handler![]`; the `cfg!()` check
  makes it a no-op in release builds.

#### Gotcha: dev-only Store Access for E2E

Frontend state triggered only by OS events cannot be set from E2E tests. Two approaches:

**Option A: Expose the Zustand store** (frontend-only state changes):

```typescript
// In your store file
if (import.meta.env.DEV) {
  (window as any).__TEST_STORE__ = useStore;
}

// In E2E test
await page.evaluate(() => {
  window.__TEST_STORE__.setState({ deviceDetected: true });
});
```

**Option B: Debug Tauri command** (when backend state must also change):

```typescript
// In E2E test — uses __TAURI_INTERNALS__ to invoke a debug-only command
await page.evaluate(() =>
  (window as any).__TAURI_INTERNALS__.invoke("debug_trigger_event", { type: "device" }),
);
```

Option B is preferred when the feature involves both backend logic and a new window.

#### Gotcha: Vitest/Playwright `test.describe` Collision

Both Vitest and Playwright export `test.describe`. If E2E files are picked up by Vitest, they collide:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
});
```

#### Gotcha: Build/Run Separation to Avoid Timeouts

`cargo tauri dev` combines compilation and app launch into one long-running process.
On memory-constrained machines (or cold builds), the compilation phase alone can
take several minutes, causing CLI tool timeouts before the app even starts.

**Solution: split build and launch into two steps.**

```
Step 1: Check if app is already running on CDP port
  curl -s http://127.0.0.1:9222/json/version → success? → skip to E2E

Step 2: Build only (long timeout, e.g., 10 min)
  cargo build --manifest-path src-tauri/Cargo.toml

Step 3: Launch (fast — binary already compiled)
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" cargo tauri dev &

Step 4: Poll CDP until ready (up to 30s)
  curl -s http://127.0.0.1:9222/json/version
```

Why this works: `cargo tauri dev` internally runs `cargo build` first. If the binary
is already up-to-date, it skips compilation and launches immediately. By running the
build as a separate step with a generous timeout, the launch step completes in seconds.

On memory-constrained machines, limit parallel jobs. Prefer persisting the setting
in `.cargo/config.toml` so every `cargo` invocation (including `cargo tauri dev`
internals) respects it automatically:

```toml
# src-tauri/.cargo/config.toml
[build]
jobs = 2
```

If `.cargo/config.toml` is not an option, pass the flag manually:

```bash
cargo build --manifest-path src-tauri/Cargo.toml -j 2
```

Also check `Cargo.toml` `crate-type`: Tauri desktop apps only need `["cdylib", "rlib"]`.
Remove `"staticlib"` if present — it adds an extra full compilation pass that wastes
both time and memory (staticlib is only needed for iOS/mobile targets).

---

## Step 5: L4 — Manual Test List Management

Document non-automatable items explicitly to define the manual QA scope.

### Typical L4 Items (Common Across Tauri Apps)

| Category | Examples | Why Not Automatable |
|----------|----------|---------------------|
| Global keyboard hooks | rdev key events → sound playback | OS-level hook, cannot trigger from WebView |
| System tray | Tray icon, right-click menu | OS-native UI, inaccessible from web layer |
| Audio playback | rodio/cpal actual sound output | Requires audio hardware |
| Device detection | cpal audio device polling | Requires physical device changes |
| Registry / autostart | HKCU\Run add/remove | OS integration + reboot verification |
| Performance / stability | CPU usage, memory leaks | Requires long-running real-time monitoring |

---

## Setup Checklist

When building tests for a new Tauri v2 project:

1. [ ] Classify features into L1–L4
2. [ ] Configure vitest.config.ts with `environment: "jsdom"` and `@/` alias
3. [ ] Add `@testing-library/jest-dom/vitest` import in `src/test/setup.ts`
4. [ ] Write Tauri API mock triple (core, event, window)
5. [ ] Use `vi.clearAllMocks()` + `vi.useRealTimers()` in `afterEach` (never restoreAllMocks)
6. [ ] Define invoke mock data for each Tauri command in the project
7. [ ] Document L4 manual items with rationale
