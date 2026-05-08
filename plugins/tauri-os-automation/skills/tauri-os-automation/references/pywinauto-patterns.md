# pywinauto Patterns — App, Tray, and Registry

Reusable recipes for L4 Tauri tests. Each section is a drop-in file
for `tests-native/`. All of them honor the
`tauri-multi-instance` env var contract (`TAURI_CDP_PORT`) and the
tray / polling rules in the sibling reference files.

## Project Layout

```
tests-native/
├── pyproject.toml          # pytest + pywinauto + psutil + pytest-timeout [+ playwright]
├── conftest.py             # app fixture (CDP env var, start/stop), registry backup
├── helpers/
│   ├── app.py              # Process lifecycle (FindWindowW + psutil cleanup)
│   ├── tray.py             # Overflow search + #32768 menu walk
│   └── registry.py         # winreg-based read / verify / backup
├── test_tray_menu.py       # Icon presence, left-click, context menu, menu actions
└── test_autostart.py       # (if hybrid) tray(L4) → switch(L3) → registry(L4)
```

`helpers/cdp.py` (Playwright CDP context manager) is **not** part of
this skill — it belongs to `tauri-test-setup`'s L3+L4 hybrid recipe.
Include it only when the project actually needs hybrid tests.

## Pattern 1: App Fixture (`conftest.py`)

Process lifecycle plus the CDP port passthrough. The `app` fixture is
the single place that decides how the Tauri binary is launched; every
test just asks for `app` and gets a running process with CDP enabled.

```python
# tests-native/conftest.py
import os
import subprocess
import time
import pytest
import psutil

from helpers.app import wait_for_window, kill_tree

# Why env var: multi-instance dev (worktrees, parallel projects) allocates
# non-default CDP ports via scripts/tauri-dev.mjs. The test must honor
# whatever port the launcher picked, not hardcode 9222.
# See /tauri-multi-instance for the full contract.
CDP_PORT = int(os.environ.get("TAURI_CDP_PORT", "9222"))

WINDOW_TITLE = "Your App"  # must match Tauri window title


@pytest.fixture
def exe_path() -> str:
    """Path to the built Tauri exe. Override per project as needed."""
    return os.environ.get(
        "APP_EXE",
        r"src-tauri\target\debug\your-app.exe",
    )


@pytest.fixture
def app(exe_path):
    """Launch the Tauri app with CDP enabled, tear it down on exit."""
    env = {
        **os.environ,
        # Why WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: Tauri v2 forwards this
        # env var to the WebView2 process at creation time. It is the only
        # supported way to set --remote-debugging-port for the embedded
        # WebView — tauri.conf.json has no equivalent option.
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS":
            f"--remote-debugging-port={CDP_PORT}",
    }

    proc = subprocess.Popen([exe_path], env=env)
    try:
        if not wait_for_window(WINDOW_TITLE, timeout=15):
            raise TimeoutError(f"App window '{WINDOW_TITLE}' never appeared")
        yield proc
    finally:
        # Why kill_tree: cargo-built Tauri processes spawn WebView2 host
        # children. Killing only the parent leaves orphans that hold the
        # CDP port and break the next test run.
        kill_tree(proc.pid)
```

## Pattern 2: Process Helpers (`helpers/app.py`)

`FindWindowW`-based detection (per `polling-stability.md`) plus a tree
killer that covers WebView2 child processes.

```python
# tests-native/helpers/app.py
import ctypes
import time
import psutil


def wait_for_window(title: str, timeout: float = 10) -> bool:
    """Poll for a top-level window by exact title. See polling-stability.md."""
    user32 = ctypes.windll.user32
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if user32.FindWindowW(None, title) != 0:
            return True
        time.sleep(0.2)
    return False


def kill_tree(pid: int):
    """Terminate a process and all descendants (WebView2 host, msedgewebview2.exe)."""
    try:
        parent = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    for child in parent.children(recursive=True):
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    try:
        parent.kill()
    except psutil.NoSuchProcess:
        pass
```

## Pattern 3: Tray Menu Click (`helpers/tray.py`)

Builds on `windows-tray-uia.md`. Returns a menu handle that tests can
walk to find specific items.

```python
# tests-native/helpers/tray.py
import time
from pywinauto import Desktop


def _overflow_window():
    # Win11 primary path; fall back to Win10 if your support matrix needs it.
    return Desktop(backend="uia").window(
        class_name="TopLevelWindowForOverflowXamlIsland"
    )


def find_tray_icon(app_name: str):
    """Locate the system tray icon by tooltip text."""
    return _overflow_window().child_window(
        class_name="SystemTray.NormalButton",
        title_re=f".*{app_name}.*",
    )


def open_tray_context_menu(app_name: str):
    """Right-click the tray icon and return the #32768 popup."""
    icon = find_tray_icon(app_name)
    icon.right_click_input()
    time.sleep(0.3)  # Let the Win32 popup attach — UIA sees it slightly late.
    return Desktop(backend="uia").window(class_name="#32768")


def click_tray_menu_item(menu, label: str):
    """Click a menu item by its visible label."""
    item = menu.child_window(title=label, control_type="MenuItem")
    item.click_input()
```

## Pattern 4: Registry Backup / Restore (`helpers/registry.py` + fixture)

Autostart tests mutate `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
Always back up and restore — a failed test must leave the user's real
autostart list exactly as it found it.

```python
# tests-native/helpers/registry.py
import winreg

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def read_run_value(name: str) -> str | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _type = winreg.QueryValueEx(key, name)
            return value
    except FileNotFoundError:
        return None


def write_run_value(name: str, value: str):
    with winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE
    ) as key:
        winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)


def delete_run_value(name: str):
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.DeleteValue(key, name)
    except FileNotFoundError:
        pass


def is_autostart_registered(name: str) -> bool:
    return read_run_value(name) is not None
```

```python
# tests-native/conftest.py (additional fixture)
import pytest
from helpers.registry import read_run_value, write_run_value, delete_run_value

AUTOSTART_NAME = "YourApp"


@pytest.fixture
def autostart_backup():
    """Snapshot the autostart Run entry and restore it after the test."""
    original = read_run_value(AUTOSTART_NAME)
    try:
        yield
    finally:
        if original is None:
            delete_run_value(AUTOSTART_NAME)
        else:
            write_run_value(AUTOSTART_NAME, original)
```

Every test that mutates autostart must request `autostart_backup`
**before** `app`, so the teardown order is: stop app → restore registry.

## Pattern 5: Example Test — Tray Menu Action

Shows how the pieces compose. No new infrastructure; it only reuses
the helpers above.

```python
# tests-native/test_tray_menu.py
import time
from helpers.tray import open_tray_context_menu, click_tray_menu_item

APP_NAME = "Your App"


def test_tray_preferences_opens_settings_window(app):
    menu = open_tray_context_menu(APP_NAME)
    click_tray_menu_item(menu, "Preferences")
    time.sleep(1)  # Window creation is async; keep short and explicit.

    # Verification is on the OS side — a settings window should now exist.
    # (For WebView-internal state, the test would cross into L3+L4 hybrid;
    # see tauri-test-setup for that pattern.)
    from helpers.app import wait_for_window
    assert wait_for_window("Your App — Settings", timeout=5)
```

## Related References

- `windows-tray-uia.md` — the why behind the overflow / `#32768` search.
- `polling-stability.md` — why `FindWindowW` is used in `app.py`.
- `key-hook-constraints.md` — why there is **no** pattern here for
  global hotkey tests; they cannot be driven by pywinauto at all.
- `/tauri-multi-instance` — the authoritative `TAURI_CDP_PORT`
  contract consumed by the `app` fixture.
