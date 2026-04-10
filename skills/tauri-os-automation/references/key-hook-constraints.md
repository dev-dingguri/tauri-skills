# Global Key Hooks — Why They Are Not Automatable

## TL;DR

`SendInput` (used by `pynput`, `pywinauto.keyboard.send_keys`,
`pyautogui`, AutoHotkey) always sets the `LLKHF_INJECTED` flag on the
generated key events. Apps that filter injected events in their
`WH_KEYBOARD_LL` hook — a common pattern for IME, gaming anti-cheat,
and rdev-based global hotkeys — will **not see the key at all**.

This is an OS-level constraint, not a bug in either layer.

## The Mechanism

1. Tauri app registers a low-level keyboard hook (`SetWindowsHookExW`
   with `WH_KEYBOARD_LL`) — directly or via a crate like `rdev`.
2. Windows delivers every key event through the hook chain, passing a
   `KBDLLHOOKSTRUCT` whose `flags` field includes `LLKHF_INJECTED`
   (`0x00000010`) when the event came from `SendInput`.
3. Most production hooks drop injected events so they don't double-fire
   on IME keystrokes, macro players, or remote desktop input.
4. The test driver calls `pynput.keyboard.Controller().press(...)`,
   which eventually calls `SendInput` under the hood.
5. The hook sees `LLKHF_INJECTED`, returns early, and the app never
   reacts.

## How to Recognize This Failure

Symptoms:

- `pynput` / `pywinauto.keyboard.send_keys` / `keyboard` pip package
  all work for typing into a focused app window, but **none** of them
  trigger the app's global hotkey handler.
- Manual keypress at the same moment works.
- The Rust hook logs show no event (if the hook logs at all) during
  automated runs.
- Focus is irrelevant — even with the correct window focused, global
  hooks see nothing.

If **all three** conditions match the test hits this constraint and no
amount of tweaking in Python will bypass it.

## Workarounds

### 1. Code-level bypass (recommended for test coverage)

Add a test-only escape hatch in the Rust hook:

```rust
// src-tauri/src/key_hook.rs
let injected = (flags & LLKHF_INJECTED) != 0;
let bypass = std::env::var("APP_TEST_ACCEPT_INJECTED").is_ok();

if injected && !bypass {
    // Normal production path: ignore SendInput-generated events
    return CallNextHookEx(ptr::null_mut(), code, wparam, lparam);
}
```

Then in the pytest fixture:

```python
env = {**os.environ, "APP_TEST_ACCEPT_INJECTED": "1"}
proc = start_app(exe_path, env=env)
```

**Trade-off:** the test no longer exercises the exact production
filtering path, only the hotkey dispatch that follows it. Document this
as a known gap in the test's docstring.

### 2. HID hardware emulator

A USB device that enumerates as a real HID keyboard (e.g., Arduino
Leonardo, Digispark, dedicated Teensy projects) generates key events
that the OS treats as non-injected. This restores full coverage but:

- Requires physical hardware on the test runner.
- Adds a serial / HID driver dependency to the test framework.
- Not compatible with most CI runners.

Reserve for release qualification on a dedicated bench.

### 3. Accept as manual QA

Document the keypress journeys in a manual QA checklist. This is the
default for projects that cannot afford option 1 (no code access) or
option 2 (no hardware budget).

## What This Does NOT Apply To

- **WebView-internal keypresses** via Playwright `keyboard.press(...)`
  or CDP `Input.dispatchKeyEvent`. Those fire DOM events inside
  WebView2, not system-level events, so `LLKHF_INJECTED` is irrelevant.
  Use them for in-page shortcut tests (e.g., focus trap, form submit).
- **Window message simulation** (`PostMessage(WM_KEYDOWN, ...)`) to a
  specific app window. This bypasses the hook chain entirely, so it
  neither triggers `WH_KEYBOARD_LL` nor gets filtered. Only useful for
  apps that read key events directly from their message pump.

## Related References

- `pywinauto-patterns.md` — the pytest fixture used for code-level
  bypass, showing how to pass env vars to the Tauri subprocess.
- `windows-tray-uia.md` — for keyless journeys (tray menu → settings),
  use UIA automation instead; it does not cross the key hook chain.
