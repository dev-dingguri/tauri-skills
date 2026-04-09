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
| **L4 — OS Integration** | Python pytest + pywinauto (partially) / Manual | Global key hooks, system tray, registry, audio hardware | OS hotkeys, tray menu, autostart, device detection |

### Classification Criteria

- **Frontend code calling Tauri `invoke`** → L2 (mock invoke)
- **Code depending on Tauri events (`listen`/`emit`)** → L2 (mock listen)
- **Code using `@tauri-apps/api/window`** → L2 (mock getCurrentWindow)
- **Plain JS + Canvas outside React (e.g., overlay.html)** → L3 or L4
  - Only need to verify canvas rendering → L3 (CDP screenshot)
  - Input trigger is OS-level (rdev, etc.) → L4 (CDP press_key only fires WebView-internal events)
- **Direct OS API calls** (registry, audio devices, system tray) → L4
- **Journey spanning OS trigger → WebView UI** (e.g., tray menu → settings toggle → registry)
  → L3+L4 hybrid (see Step 4a)

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
- **Multi-window dynamic detection**: WebView2 CDP does NOT auto-expose new windows
  to an existing CDP connection. Each Tauri window is a separate WebView2 control,
  and `context.pages()` only reflects targets known at connection time.
  → Connect to CDP **after** all target windows are open (see "Connect-After Pattern" below).
  Chrome DevTools MCP requires `list_pages` → `select_page`.

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

#### CRITICAL: Multi-Window — Connect-After Pattern

WebView2 CDP does **not** auto-detect new windows on an existing connection.
Unlike Chrome (where new tabs emit `Target.targetCreated`), each Tauri window is
a separate WebView2 control that only appears in the CDP target list at **connection time**.

**Wrong approach** — polling `context.pages()` for a new window will never find it:

```typescript
// ❌ This will timeout — WebView2 does NOT add new targets to an existing connection
const toast = await waitForWindow(context, "/pages/toast.html"); // hangs forever
```

**Correct approach** — connect to CDP **after** the target window is open:

```typescript
// ✅ Open window first, then connect
await page.evaluate((reason) =>
  (window as any).__TAURI_INTERNALS__.invoke("debug_show_toast", { reason }),
  "speaker",
);
await new Promise(r => setTimeout(r, 1000)); // Wait for window creation

// Reconnect — all current targets are now visible
const browser2 = await chromium.connectOverCDP(CDP_URL);
const toastPage = browser2.contexts()[0].pages()
  .find(p => p.url().includes("/pages/toast.html"));
```

**For Python (L3+L4 hybrid)**, use a context manager — see Step 4a below.

**Triggering methods** differ by window type:

| Window type | Trigger | Example |
|-------------|---------|---------|
| JS-created (about, settings) | Click menu item on main page | `page.locator("text=Settings").click()` |
| Rust-created (toast, overlay) | Debug Tauri command via `invoke` | See "Debug Tauri Command" pattern below |
| OS-triggered (settings via tray) | pywinauto tray menu click (L4) | See Step 4a hybrid pattern |

After connecting, always call `waitForLoadState("networkidle")` to wait
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
await new Promise(r => setTimeout(r, 1000)); // Wait for window creation

// Reconnect to CDP — new WebView2 windows only appear at connection time
const browser2 = await chromium.connectOverCDP(CDP_URL);
const toast = browser2.contexts()[0].pages()
  .find(p => p.url().includes("/pages/toast.html"));
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

#### Gotcha: WebView Element Locator Strategy

`data-testid` is the preferred locator, but it requires a frontend rebuild to be
reflected in the binary. For tests that must run against **existing binaries**
(e.g., release builds, CI artifacts), use a dual strategy:

```python
# ✅ Works with any binary — uses DOM structure + ARIA role
settings_page.locator('div:has-text("Start automatically")').locator('[role="switch"]').first

# ✅ Works after frontend rebuild — direct data-testid
settings_page.locator('[data-testid="autostart-switch"]')
```

**Rules:**
- Radix UI components expose `role` attributes (`role="switch"`, `role="slider"`, etc.)
  and `data-state` for state (`data-state="checked"` / `data-state="unchecked"`)
- Use `:has-text("label text")` to scope locators to the correct container
- `.first` is safe when DOM order is stable (but fragile if order changes)
- Always add `data-testid` to components used in tests — it becomes available on next build

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

## Step 4a: L3+L4 Hybrid — pywinauto + Playwright CDP

Some journeys span both OS-level UI (tray, windows) and WebView-internal UI
(React components, Radix primitives). Neither tool alone can cover them:

- **pywinauto** cannot click WebView2 internal elements (Radix Switch, etc.)
  because WebView2 does not expose them to the UIA accessibility tree
- **Playwright CDP** cannot interact with OS-level UI (system tray, native menus)

The hybrid pattern combines both in the same test.

### When to Use L3+L4 Hybrid

| Signal | Example |
|--------|---------|
| Journey starts with OS UI, ends with WebView state | Tray "Settings" → toggle switch → registry change |
| WebView element not in UIA tree | Radix Switch, custom Canvas controls, Shadow DOM |
| Verification requires OS API | Registry, file system, process state after WebView action |

### Infrastructure: CDP Context Manager

Use a context manager instead of a pytest fixture for CDP connections. This gives
the test control over **when** the connection is established — critical because
WebView2 CDP only sees windows that exist at connection time.

```python
# tests-native/helpers/cdp.py
from contextlib import contextmanager
import time

CDP_PORT = 9222

@contextmanager
def connect_cdp(timeout: float = 10):
    """Playwright CDP connection — connect AFTER target windows are open."""
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    # Why 127.0.0.1: localhost resolves to IPv6 on Windows, WebView2 CDP is IPv4 only
    cdp_url = f"http://127.0.0.1:{CDP_PORT}"

    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            browser = pw.chromium.connect_over_cdp(cdp_url)
            break
        except Exception as e:
            last_error = e
            time.sleep(0.5)
    else:
        pw.stop()
        raise TimeoutError(f"CDP connection failed ({cdp_url}): {last_error}")

    try:
        yield browser
    finally:
        browser.close()
        pw.stop()
```

### Infrastructure: App Startup with CDP Port

The `app` fixture must pass the CDP environment variable to `start_app()`:

```python
# conftest.py
CDP_PORT = 9222

@pytest.fixture
def app(exe_path):
    env = {
        **os.environ,
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": f"--remote-debugging-port={CDP_PORT}",
    }
    proc = start_app(exe_path, env=env)
    # ... toast cleanup, yield, stop
```

### Test Pattern: Hybrid Flow

```python
def test_toggle_off_removes_autostart(self, app, autostart_backup):
    # Step 1: OS layer — open settings via tray menu (pywinauto)
    menu = open_tray_context_menu()
    click_tray_menu_item(menu, "Preferences")
    time.sleep(1)

    # Step 2: WebView layer — click switch via CDP (Playwright)
    # Why connect here: WebView2 CDP only sees windows at connection time
    with connect_cdp() as browser:
        settings_page = next(
            p for ctx in browser.contexts for p in ctx.pages
            if "settings" in p.url
        )
        switch = settings_page.locator(
            'div:has-text("Start automatically")'
        ).locator('[role="switch"]').first

        # Ensure toggle is ON before testing OFF
        if switch.get_attribute("data-state") != "checked":
            switch.click()
            time.sleep(1)

        switch.click()
        time.sleep(1)

    # Step 3: OS layer — verify registry (winreg)
    assert not is_autostart_registered()
```

### Dependencies

Add `playwright` to `tests-native/pyproject.toml`:

```toml
dependencies = [
    "pytest>=8.0",
    "pytest-timeout>=2.3",
    "pywinauto>=0.6.8",
    "psutil>=6.0",
    "playwright>=1.40",
]
```

Run `playwright install chromium` after dependency installation.

---

## Step 5: L4 — OS Native Tests (Python pytest + pywinauto)

L4 was previously "manual only." With Python + pywinauto, **system tray and registry**
can be automated. Key hooks and audio remain manual.

### L4 Automatable vs Manual

| Category | Automatable? | Tool | Notes |
|----------|:---:|------|-------|
| System tray icon presence | ✅ | pywinauto UIA (`SystemTray.NormalButton`) | Requires `.tooltip()` on `TrayIconBuilder` |
| Tray context menu | ✅ | pywinauto UIA (`#32768` popup) | Must find icon in overflow, not taskbar app button |
| Tray menu actions | ✅ | pywinauto UIA click on `MenuItem` | |
| Registry autostart | ✅ | Python `winreg` | Backup/restore via fixture |
| Window existence | ✅ | `ctypes.windll.user32.FindWindowW` | Faster and stabler than UIA for polling |
| Global key hooks (rdev, WH_KEYBOARD_LL) | ❌ | — | `LLKHF_INJECTED` blocks SendInput — see below |
| Audio playback | ❌ | — | Requires audio hardware |
| Device detection | ❌ | — | Requires physical device changes |
| Reboot autostart | ❌ | — | Requires OS reboot |

### CRITICAL: `LLKHF_INJECTED` and SendInput

`SendInput` (used by pynput, pywinauto, AutoHotkey) always sets the `LLKHF_INJECTED`
flag on generated key events. If the app's `WH_KEYBOARD_LL` hook filters injected
events (common for IME compatibility), SendInput-based key tests **will not trigger
the hook at all**. This is an OS-level constraint, not a bug.

**Workarounds:**
- Code-level: add env-var bypass (e.g., `TODOK_TEST=1` skips `LLKHF_INJECTED` check)
- Hardware: USB HID emulator (expensive, complex)
- Accept: document as manual QA

### CRITICAL: Windows 11 Tray Icon UIA Pitfall

Windows 11 taskbar shows the same app in **two places** with different UIA elements:

| Element | UIA Class | Location | Right-click behavior |
|---------|-----------|----------|---------------------|
| Taskbar app button | `Taskbar.TaskListButtonAutomationPeer` | `MSTaskSwWClass` in `Shell_TrayWnd` | **OS Jump List** (NOT app menu) |
| System tray icon | `SystemTray.NormalButton` | `TopLevelWindowForOverflowXamlIsland` (overflow) | **App context menu** (`#32768`) |

**The trap:** Searching `Shell_TrayWnd` for `title_re=".*AppName.*"` matches the
**taskbar app button** first. Right-clicking it opens the OS Jump List, not your
app's custom tray menu.

**The fix:** Always search for `SystemTray.NormalButton` in the overflow area.

**Prerequisite:** `TrayIconBuilder` must have `.tooltip("App Name")` — without it,
the system tray icon has an empty UIA name and cannot be found by name.

### Stability: `FindWindowW` over `Desktop().windows()`

pywinauto's `Desktop(backend="uia").windows()` uses UIA COM internally. When called
in a polling loop (e.g., waiting for window to appear), it can trigger COM error
`0x80040155` (`REGDB_E_IIDNOREGISTERED`) — a fatal crash with no Python-level recovery.

**Use `ctypes.windll.user32.FindWindowW` for window-existence polling:**

```python
import ctypes

def _find_window_by_title(title: str) -> bool:
    hwnd = ctypes.windll.user32.FindWindowW(None, title)
    return hwnd != 0
```

Reserve pywinauto UIA for actual UI interaction (click, read properties), not for
existence polling.

### L4 Project Structure

```
tests-native/
├── pyproject.toml          # pytest + pywinauto + psutil + pytest-timeout + playwright
├── conftest.py             # app fixture (CDP env var, start/stop), registry backup
├── helpers/
│   ├── app.py              # Process lifecycle (FindWindowW for detection, psutil for cleanup)
│   ├── cdp.py              # Playwright CDP connection context manager (for L3+L4 hybrid)
│   ├── tray.py             # Overflow → SystemTray.NormalButton search, #32768 menu
│   └── registry.py         # winreg-based read/verify
├── test_tray_menu.py       # Icon presence, left-click, context menu, menu actions
└── test_autostart.py       # Hybrid: tray(L4) → switch(L3/CDP) → registry(L4)
```

### Items That Remain Manual

| Category | Examples | Why Not Automatable |
|----------|----------|---------------------|
| Global keyboard hooks | rdev/WH_KEYBOARD_LL key events → sound | `LLKHF_INJECTED` filter blocks SendInput |
| Audio playback | rodio/cpal actual sound output | Requires audio hardware |
| Device detection | cpal audio device polling | Requires physical device changes |
| Reboot autostart | Registry key → survives reboot | Requires OS reboot |
| Performance / stability | CPU usage, memory leaks over time | Requires long-running monitoring |

---

## Setup Checklist

When building tests for a new Tauri v2 project:

1. [ ] Classify features into L1–L4
2. [ ] Configure vitest.config.ts with `environment: "jsdom"` and `@/` alias
3. [ ] Exclude test files from tsconfig.json (`"exclude": ["src/test", "**/*.test.ts", "**/*.test.tsx"]`) — prevents Vitest global type errors in `tsc` builds
4. [ ] Add `@testing-library/jest-dom/vitest` import in `src/test/setup.ts`
5. [ ] Write Tauri API mock triple (core, event, window)
6. [ ] Use `vi.clearAllMocks()` + `vi.useRealTimers()` in `afterEach` (never restoreAllMocks)
7. [ ] Define invoke mock data for each Tauri command in the project
8. [ ] Set `.tooltip()` on `TrayIconBuilder` for UIA discoverability
9. [ ] Set up `tests-native/` with pytest + pywinauto for L4 automatable items
10. [ ] Add `playwright` to `tests-native/pyproject.toml` + `helpers/cdp.py` for L3+L4 hybrid
11. [ ] Pass `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` CDP port in `app` fixture
12. [ ] Add `data-testid` to WebView elements used in hybrid tests (available on next build)
13. [ ] Document remaining L4 manual items with rationale
