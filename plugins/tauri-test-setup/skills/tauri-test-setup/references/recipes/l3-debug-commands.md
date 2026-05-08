# L3 Recipe — Debug Commands & Dev-Only Store Access

Some features are only reachable via OS events (speaker detection,
device hotplug, global hotkey) — the frontend has no direct way to
trigger them. To cover these paths in E2E, expose **dev-only escape
hatches** from frontend and backend. Both forms are gated so they
never ship in a release binary.

## Option A: Debug Tauri Command — Rust Side

Use a debug-only `#[tauri::command]` that mirrors the production event
handler. Two non-obvious requirements:

1. **`cfg!(not(debug_assertions))` expression, not `#[cfg]` attribute.**
   `generate_handler![]` cannot accept attribute-gated items, so the
   command must be unconditionally registered and self-gate at runtime.
2. **`std::thread::spawn` when the command creates a WebView window.**
   Without it, the command deadlocks (see below).

```rust
// src-tauri/src/debug.rs
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn debug_show_toast(app: AppHandle, reason: String) -> Result<(), String> {
    // Runtime guard — `cfg!()` evaluates to a const bool, so this
    // compiles out in release builds. Cannot use `#[cfg(debug_assertions)]`
    // here because generate_handler![] rejects attribute-gated fns.
    if cfg!(not(debug_assertions)) {
        return Err("debug-only command".into());
    }

    // Why thread::spawn: #[tauri::command] runs on a tokio worker. Inside
    // it, WebviewWindowBuilder::build() dispatches to the main thread
    // and WAITS for completion. But the main thread is currently blocked
    // waiting for this command's IPC response → deadlock.
    //
    // Spawning on a separate OS thread lets the command return (unblocking
    // the main thread), so build() can then proceed on the main thread.
    std::thread::spawn(move || {
        if let Err(e) = crate::toast::show_toast(&app, reason) {
            eprintln!("[debug_show_toast] {e}");
        }
    });

    Ok(())
}
```

Register it **unconditionally** in the handler list:

```rust
// src-tauri/src/lib.rs
.invoke_handler(tauri::generate_handler![
    // ... production commands ...
    debug::debug_show_toast,  // runtime-gated, safe in release
])
```

## Option A: Debug Tauri Command — TypeScript Side

```typescript
// In an E2E test
await page.evaluate(
  (reason) =>
    (window as any).__TAURI_INTERNALS__.invoke("debug_show_toast", { reason }),
  "speaker",
);

// New windows only appear at CDP connection time — reconnect.
await new Promise((r) => setTimeout(r, 1000));
const browser2 = await chromium.connectOverCDP(CDP_URL);
const toast = browser2
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes("/pages/toast.html"));
```

Why `__TAURI_INTERNALS__.invoke` instead of importing from
`@tauri-apps/api/core`: E2E tests run inside the WebView via
`page.evaluate`, which executes the callback in the page context. The
imported `invoke` symbol from the test file doesn't exist there — but
the runtime-injected `__TAURI_INTERNALS__` does.

## Option B: Expose the Zustand Store

For state that affects only the frontend (no backend work, no new
windows), expose the store on `window` under a dev-only gate:

```typescript
// src/stores/store.ts
import { create } from "zustand";
export const useStore = create<State>()((set) => ({ /* ... */ }));

// Why import.meta.env.DEV: Vite replaces this with the literal `true` /
// `false` at build time, so the assignment is tree-shaken in production.
if (import.meta.env.DEV) {
  (window as any).__TEST_STORE__ = useStore;
}
```

```typescript
// In an E2E test
await page.evaluate(() => {
  (window as any).__TEST_STORE__.setState({ deviceDetected: true });
});
```

## When to Use A vs B

| Scenario | Approach |
|---|---|
| Feature creates a new window | **A** (command + `thread::spawn`) |
| Feature writes to a file / registry / device | **A** (command) |
| Feature is frontend-only state that OS events drive | **B** (store) |
| Feature chains backend → frontend state | **A** — backend is authoritative |

Prefer A when in doubt — it exercises more of the real code path. B is
a shortcut for pure rendering tests where a backend command adds no
coverage.

## Related

- `l3-playwright-fixture.md` — the E2E harness that calls these hooks.
- `l4-hybrid-cdp-python.md` — same debug-command pattern from Python.
- `/tauri-webview-debug` — how the CDP connection from `page.evaluate`
  actually reaches the WebView2.
