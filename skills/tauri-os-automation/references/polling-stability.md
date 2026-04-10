# Window Polling Stability — `FindWindowW` vs `Desktop().windows()`

## TL;DR

Use `ctypes.windll.user32.FindWindowW` for window-existence polling.
Reserve `pywinauto.Desktop(backend="uia")` for **one-shot** UI
interaction (click, read properties). Calling `Desktop().windows()` in
a tight polling loop can trigger COM error `0x80040155`
(`REGDB_E_IIDNOREGISTERED`) — a fatal crash with no Python-level
recovery, observed on Python 3.14 + recent `pywinauto` releases.

## The Failure

```python
# ❌ Polls via UIA COM — may crash with REGDB_E_IIDNOREGISTERED
def wait_for_window(title: str, timeout: float = 10) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(w.window_text() == title
               for w in Desktop(backend="uia").windows()):
            return True
        time.sleep(0.2)
    return False
```

What happens:

- `Desktop(backend="uia").windows()` enumerates every top-level window
  via the UI Automation COM interface `IUIAutomationElementArray`.
- Repeated calls over a short interval can land in a state where the
  COM apartment or one of the proxy stubs is mid-teardown, and the
  next call fails with `0x80040155` (the IID has no registered proxy).
- The error is raised from deep inside `comtypes` and crashes the
  Python process. There is no reliable `try: ... except:` that catches
  it consistently — the process is already partially unwound.

## The Fix

```python
# ✅ Polls via Win32 user32 — no COM, no UIA, no crash
import ctypes
import time

def wait_for_window(title: str, timeout: float = 10) -> bool:
    """Return True as soon as a top-level window with the given title exists."""
    user32 = ctypes.windll.user32
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        # Why FindWindowW: pure Win32, no COM apartment, safe in tight loops.
        # First arg None means "any class name"; second is the exact title.
        if user32.FindWindowW(None, title) != 0:
            return True
        time.sleep(0.2)
    return False
```

Notes:

- `FindWindowW` matches **exact** titles. For partial matches use
  `EnumWindows` with a callback that compares `GetWindowTextW`.
- Returns an `HWND` (non-zero) on success, `0` if not found. Convert
  with `!= 0` for a boolean — avoid truthiness on `HWND` types from
  `ctypes.wintypes` as they compare by identity in some builds.
- `FindWindowW` is case-sensitive and does not handle wildcards. For
  title patterns, enumerate with `EnumWindows`.

## When UIA is Still the Right Tool

Use `pywinauto` UIA for:

- **One-shot interaction** — click a tray menu item, read a label,
  toggle a switch. These are called once per test, not in a loop.
- **Reading accessibility properties** — `.automation_id()`, `.role()`,
  `.legacy_properties()` have no Win32 equivalent.
- **Chained UI walks** — `window.child_window(...).child_window(...)`,
  where the parent lookup is amortized across multiple children.

The rule of thumb: **if it is inside a `while` or `for` loop with a
sleep, it should not be a UIA call.** Hoist the existence check out to
`FindWindowW` and only enter UIA once the window is confirmed to exist.

## Safer UIA One-Shot Pattern

```python
# 1. Wait for existence via Win32 (safe loop)
if not wait_for_window("Your App — Settings", timeout=10):
    raise TimeoutError("Settings window never appeared")

# 2. Attach UIA once — no loop, no COM hammering
from pywinauto import Desktop
settings = Desktop(backend="uia").window(title="Your App — Settings")
settings.wait("visible", timeout=2)  # internal wait is fine — single call
settings.child_window(auto_id="autostart-switch").click_input()
```

## Related References

- `windows-tray-uia.md` — uses `Desktop(backend="uia")` but only as a
  single call after the tray icon is known to exist.
- `pywinauto-patterns.md` — full process-lifecycle helpers built on
  `FindWindowW` for detection, `psutil` for cleanup.
