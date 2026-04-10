# L3+L4 Hybrid Recipe — Playwright CDP from Python + pywinauto

Some user journeys span both OS-level UI (tray menu, native windows)
and WebView-internal UI (React components, Radix primitives). Neither
tool alone covers them:

- **pywinauto** cannot click WebView2 internal elements (Radix Switch,
  Canvas controls, Shadow DOM) — WebView2 does not expose them on the
  UIA accessibility tree.
- **Playwright CDP** cannot interact with OS-level UI (system tray,
  native context menus, Win32 popups).

The hybrid pattern connects *both* from the same Python test.

> Prerequisites:
> - `/tauri-os-automation` — pywinauto patterns for tray and registry.
> - `/tauri-multi-instance` — `TAURI_CDP_PORT` env-var contract.

## When to Use the Hybrid Pattern

| Signal | Example |
|---|---|
| Journey starts on the OS, ends in WebView state | Tray "Settings" → toggle switch → registry change |
| WebView element is not in the UIA tree | Radix Switch, Canvas widget, Shadow DOM |
| Verification needs an OS API after a WebView action | Registry / filesystem / process state check |

If the journey is WebView-only, stay in Playwright (TypeScript) —
`l3-playwright-fixture.md` is simpler. Reach for this recipe only when
you need both sides.

## Infrastructure: CDP Context Manager (`helpers/cdp.py`)

Use a context manager instead of a pytest fixture. The test itself
decides **when** to connect, which is critical because WebView2 CDP
only sees windows that exist at connection time (see
`l3-playwright-fixture.md` — connect-after pattern).

```python
# tests-native/helpers/cdp.py
import os
import time
from contextlib import contextmanager

# Why env var: multi-instance dev allocates non-default ports. See
# /tauri-multi-instance for the full contract.
CDP_PORT = int(os.environ.get("TAURI_CDP_PORT", "9222"))


@contextmanager
def connect_cdp(timeout: float = 10):
    """Connect Playwright to the Tauri WebView2 CDP endpoint.

    Connect AFTER the target window exists — WebView2 does not expose
    new targets to a pre-existing CDP connection.
    """
    from playwright.sync_api import sync_playwright

    pw = sync_playwright().start()
    # Why 127.0.0.1: Windows resolves `localhost` to IPv6; WebView2
    # CDP listens on IPv4 only. Same rule as l3-playwright-fixture.md.
    cdp_url = f"http://127.0.0.1:{CDP_PORT}"

    deadline = time.monotonic() + timeout
    browser = None
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            browser = pw.chromium.connect_over_cdp(cdp_url)
            break
        except Exception as e:
            last_error = e
            time.sleep(0.5)

    if browser is None:
        pw.stop()
        raise TimeoutError(f"CDP connection failed ({cdp_url}): {last_error}")

    try:
        yield browser
    finally:
        browser.close()
        pw.stop()
```

## Infrastructure: App Fixture with CDP Env Var

The pytest `app` fixture from `/tauri-os-automation`'s pywinauto
patterns needs a small extension to pass `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
to the Tauri subprocess:

```python
# tests-native/conftest.py — extend the app fixture from
# /tauri-os-automation's pywinauto-patterns.md
import os
import subprocess
import pytest
from helpers.app import wait_for_window, kill_tree

CDP_PORT = int(os.environ.get("TAURI_CDP_PORT", "9222"))


@pytest.fixture
def app(exe_path):
    env = {
        **os.environ,
        # Tauri v2 forwards this to the WebView2 process at creation
        # time — the only supported way to set --remote-debugging-port
        # on the embedded WebView. tauri.conf.json has no equivalent.
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS":
            f"--remote-debugging-port={CDP_PORT}",
    }
    proc = subprocess.Popen([exe_path], env=env)
    try:
        if not wait_for_window("Your App", timeout=15):
            raise TimeoutError("App window never appeared")
        yield proc
    finally:
        kill_tree(proc.pid)
```

If the project already has an `app` fixture from the L4-only
pywinauto pattern, merge the `env` block in — do not create a second
fixture.

## Test Pattern: Tray → Switch → Registry

The classic hybrid flow. Open the settings window via the tray menu
(L4), toggle a Radix Switch inside it via CDP (L3), then verify the
registry change (L4 again).

```python
# tests-native/test_autostart.py
import time

from helpers.cdp import connect_cdp
from helpers.tray import open_tray_context_menu, click_tray_menu_item
from helpers.registry import is_autostart_registered

APP_NAME = "Your App"


def test_toggle_off_removes_autostart(app, autostart_backup):
    # Step 1 — OS: open settings via tray menu (pywinauto)
    menu = open_tray_context_menu(APP_NAME)
    click_tray_menu_item(menu, "Preferences")
    time.sleep(1)  # Window creation is async

    # Step 2 — WebView: toggle the Radix switch via CDP (Playwright)
    # Connect HERE, not earlier — the settings window didn't exist at
    # app start, so a fixture-level connection would miss it.
    with connect_cdp() as browser:
        settings_page = next(
            p
            for ctx in browser.contexts
            for p in ctx.pages
            if "settings" in p.url
        )
        switch = (
            settings_page.locator('div:has-text("Start automatically")')
            .locator('[role="switch"]')
            .first
        )

        # Ensure the switch is ON before testing the OFF path
        if switch.get_attribute("data-state") != "checked":
            switch.click()
            time.sleep(1)

        switch.click()
        time.sleep(1)

    # Step 3 — OS: verify the registry change (winreg)
    assert not is_autostart_registered(APP_NAME)
```

`autostart_backup` is the registry snapshot/restore fixture from
`/tauri-os-automation`'s pywinauto patterns — request it **before**
`app` so teardown order is: stop app → restore registry.

## Dependencies

Add `playwright` to the existing `tests-native/pyproject.toml` that
`/tauri-os-automation` sets up:

```toml
dependencies = [
    "pytest>=8.0",
    "pytest-timeout>=2.3",
    "pywinauto>=0.6.8",
    "psutil>=6.0",
    "playwright>=1.40",
]
```

After `pip install -e .` (or `uv sync`), run once:

```bash
playwright install chromium
```

The Chromium install is only used for the CDP client — it never
launches; Playwright attaches to the Tauri WebView2 instead.

## Locator Strategy Across Binaries

The same dual-locator rule from `l3-playwright-fixture.md` applies:
prefer `data-testid` after a frontend rebuild, but fall back to DOM
structure + ARIA role (`role="switch"`, `data-state="checked"`) when
running against an existing binary.

## Related

- `l3-playwright-fixture.md` — the TypeScript equivalent, plus the
  underlying connect-after rationale.
- `l3-debug-commands.md` — debug commands to reach backend-only
  features from either TS or Python CDP.
- `/tauri-os-automation` — tray, registry, and process helpers this
  recipe composes with.
- `/tauri-multi-instance` — the `TAURI_CDP_PORT` contract.
