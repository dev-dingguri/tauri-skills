# Tauri v2 Gotchas — Experience-Based Knowledge

These are pitfalls discovered through hands-on development, **not covered in official docs**.
They apply to any Tauri v2 desktop app (primarily Windows/WebView2).

> This file complements official docs — it does NOT replace them.
> Official docs remain the source of truth for APIs and configuration.

---

## Panic Hook Init Order

`panic_hook::init()` (or any custom panic handler) must be called **before** `tauri::Builder::default()`.

**Why:** `windows_subsystem = "windows"` hides stderr. Panics during Tauri setup are lost silently without a custom panic handler.

## WebView2 Transparency

When drawing on a transparent WebView2 canvas, must use `ctx.clearRect()` — `fillRect` makes the surface opaque, even with `rgba(0,0,0,0)`.

## Show Gate Pattern

`WebviewWindowBuilder::build()` + `show()` does NOT wait for WebView content to load. Showing immediately causes a flash of incomplete rendering.

**Rule:** All windows must:
1. Be created with `visible(false)`
2. Add `class="no-transitions"` to `<html>` + CSS: `transition: none !important` + `body { opacity: 0 }`
3. Call `getCurrentWindow().show()` from JS **after** all async init completes (`document.fonts.ready`, state fetches, etc.)

Note: Rust-side `show()` bypasses capabilities, but JS IPC `show()` requires `core:window:allow-show`.

## device_event_filter(Always) Required on Windows

Without `device_event_filter(DeviceEventFilter::Always)` in the Tauri builder, global device events (keyboard hooks via `WH_KEYBOARD_LL`) are **lost when a Tauri window has focus**.

Related: [Tauri Issue #14770](https://github.com/tauri-apps/tauri/issues/14770)

## WebviewWindow Creation Deadlock in Commands

`WebviewWindowBuilder::build()` called inside a `#[tauri::command]` handler deadlocks.

**Why:** `build()` dispatches window creation to the main thread, but the main thread is blocked waiting for the IPC response from that same command. This only happens on the IPC invoke path — `tauri::async_runtime::spawn` or main-thread contexts (setup, tray events) are fine.

**Workarounds:**
1. Use the JS `WebviewWindow` API from frontend
2. Call `build()` only from main-thread contexts (setup callback, tray/menu events)
3. `std::thread::spawn` to return the command first, then `build()` on a separate OS thread

Related: [tauri-apps/wry#583](https://github.com/tauri-apps/wry/issues/583)

## Background Thread Shutdown Ordering

Background threads that access Tauri managed state (`try_state()`, `app.store()`, etc.) cause deadlock at shutdown.

**Why:** `ResourceTable::clear()` during `RunEvent::Exit` holds a write lock. If a background thread wakes up and requests a read lock on the same table, both sides wait forever.

**Rule:**
1. Every background thread must accept an `Arc<AtomicBool>` shutdown handle
2. Use short sleep intervals (e.g., 1s) and check the flag each iteration — not one long sleep
3. `RunEvent::ExitRequested` → signal all handles (parallel)
4. `RunEvent::Exit` → `stop()` + `join()` before managed state is dropped

## Option\<State\<T\>\> Not Supported in Commands

`Option<State<T>>` cannot be used as a `#[tauri::command]` parameter. Compilation fails.

**Why:** `State<T>` has a custom `CommandArg` impl, but `Option<State<T>>` does not. It falls through to the blanket `impl<D: Deserialize> CommandArg for D`, and `State` doesn't implement `Deserialize`.

**Workaround:** Use `AppHandle` parameter and call `app.try_state::<T>()` manually.

```rust
#[tauri::command]
fn my_command(app: AppHandle) -> Result<(), String> {
    if let Some(engine) = app.try_state::<AudioEngine>() {
        engine.do_something();
    }
    Ok(())
}
```


