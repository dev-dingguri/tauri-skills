# Windows System Tray — UIA Discovery

## TL;DR

- `TrayIconBuilder::new(...).tooltip("Your App")` is **mandatory** — no
  tooltip means empty UIA name, and pywinauto cannot find the icon by name.
- On Windows 11 the same app appears in **two** different UIA elements
  with the same or similar name. Right-clicking the wrong one opens the
  OS Jump List instead of your app's context menu.
- Always search for `control_type="Button"` / `class_name="SystemTray.NormalButton"`
  inside the **overflow area**, never inside `Shell_TrayWnd`.

## Prerequisite: `.tooltip()` on `TrayIconBuilder`

```rust
// src-tauri/src/tray.rs
TrayIconBuilder::new()
    .tooltip("Your App")          // REQUIRED for UIA discovery
    .icon(app.default_window_icon().unwrap().clone())
    .menu(&menu)
    .build(app)?;
```

Without `.tooltip()`:
- pywinauto cannot locate the icon by `title` / `title_re`.
- Accessibility tools (screen readers, Narrator) announce nothing.

The tooltip string is what `SystemTray.NormalButton.Name` exposes to UIA,
so any title-based search (`title_re=".*Your App.*"`) will match it.

## The Windows 11 Two-Places Pitfall

Windows 11 shows the same Tauri app at **two locations** with different
UIA elements, different classes, and **different right-click behavior**:

| Element | UIA Class | Parent window | Right-click opens |
|---|---|---|---|
| Taskbar app button | `Taskbar.TaskListButtonAutomationPeer` | `MSTaskSwWClass` in `Shell_TrayWnd` | **OS Jump List** (recent files, pin, close) — NOT your app menu |
| System tray icon | `SystemTray.NormalButton` | `TopLevelWindowForOverflowXamlIsland` (overflow area) | **Your app's context menu** (Win32 class `#32768`) |

**The trap:** Searching `Shell_TrayWnd` for `title_re=".*YourApp.*"` matches
the **taskbar app button** first (because it shares the name). Right-clicking
the match opens the Jump List, and the test wrongly concludes the app menu
is broken.

## Correct Discovery Pattern

```python
# tests-native/helpers/tray.py
from pywinauto import Desktop

def find_tray_icon(app_name: str):
    """Locate the system tray icon (not the taskbar app button)."""
    # Why overflow: Win11 system tray icons live inside the XAML island,
    # not inside Shell_TrayWnd. Shell_TrayWnd search matches the taskbar
    # app button first and opens the OS Jump List on right-click.
    overflow = Desktop(backend="uia").window(
        class_name="TopLevelWindowForOverflowXamlIsland"
    )
    return overflow.child_window(
        class_name="SystemTray.NormalButton",
        title_re=f".*{app_name}.*",
    )

def open_tray_context_menu(app_name: str):
    """Right-click the tray icon and return the #32768 popup menu."""
    icon = find_tray_icon(app_name)
    icon.right_click_input()
    # Why #32768: Win32 standard menu class. Any app context menu opened
    # via TrayIconBuilder is a Win32 popup, not a XAML flyout.
    return Desktop(backend="uia").window(class_name="#32768")
```

## Verification Checklist

When a tray-icon test fails, verify in order:

1. `TrayIconBuilder` has `.tooltip("...")` set.
2. The overflow area (`TopLevelWindowForOverflowXamlIsland`) exists on
   this Windows build — older Win10 builds use `NotifyIconOverflowWindow`.
   Fall back per OS version if supporting both.
3. The icon is actually visible in the overflow (user may have set it to
   "Always hide" in taskbar settings — in that case the overflow area
   is a hidden panel that must be opened first via the chevron).
4. The test is running in the user's **interactive session**, not a
   background service — UIA cannot see XAML islands from session 0.

## Related References

- `polling-stability.md` — why `FindWindowW` (not `Desktop().windows()`)
  should be used when waiting for the icon to appear on app start.
- `pywinauto-patterns.md` — full tray menu click + action verification
  flow built on top of the discovery pattern above.
