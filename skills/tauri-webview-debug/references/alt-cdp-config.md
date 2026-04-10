# Alternative: Declare CDP Port in `tauri.conf.json`

The recommended path sets the CDP port via the
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable (the
multi-instance launcher does this automatically). If you need a
config-file approach instead — e.g., a named window that always exposes
CDP during dev — use `additionalBrowserArgs` on that window.

```jsonc
{
  "app": {
    "windows": [{
      "label": "main",
      "additionalBrowserArgs": "--remote-debugging-port=9222 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    }]
  }
}
```

## Caveats

- **Overrides wry's defaults.** `additionalBrowserArgs` replaces the flags
  wry normally passes to WebView2. Restore
  `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
  explicitly (as shown) or you'll regress on transparent windows and
  Smart Screen prompts.
- **Dev only.** A hardcoded CDP port in `tauri.conf.json` is a production
  risk: the endpoint is unauthenticated and lets any local process drive
  the app. Guard behind a dev-only build, or prefer the env var path.
- **Conflicts with multi-instance.** The `tauri-multi-instance` launcher
  allocates a free CDP port at runtime and sets the env var accordingly.
  A hardcoded `tauri.conf.json` port defeats that mechanism — two
  instances will fight for `9222`.

Prefer the env var path unless you have a specific reason to hardcode.
