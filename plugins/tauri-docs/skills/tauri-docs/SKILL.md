---
name: tauri-docs
description: >-
  Use when modifying Tauri v2 Rust code, tauri.conf.json, capabilities, plugins,
  windows, WebView behavior, or frontend code that calls @tauri-apps/api and
  the answer must be checked against official docs and known gotchas.
---

# Tauri v2 Docs and Gotchas

Tauri code must be checked against current official docs, then cross-checked
against `gotchas.md` for experience-based failures not covered by docs.

Use docs for API shape and configuration. Use gotchas for traps such as
deadlocks, shutdown ordering, WebView2 quirks, capability misses, and Windows
focus/input behavior.

## Required Flow

1. Read the relevant section of `gotchas.md` first when the task touches:
   windows, WebView creation/showing, commands, managed state, shutdown,
   global input hooks, WebView2 transparency, or optional `State<T>`.
2. Verify the API/configuration against official Tauri v2 docs.
3. If docs and gotchas appear to conflict, trust official docs for API
   contract, then treat gotchas as implementation constraints to account for.
4. Before editing, state the source used when the decision depends on docs.

## Known Gotchas Index

See `gotchas.md` in this skill directory. Current entries cover:

- Panic hook init order before `tauri::Builder::default()`
- Transparent WebView2 canvas clearing
- Show-gate pattern for `visible(false)` windows
- `device_event_filter(DeviceEventFilter::Always)` on Windows
- `WebviewWindowBuilder::build()` deadlock inside `#[tauri::command]`
- Background thread shutdown ordering with managed state
- `Option<State<T>>` not supported in command parameters

## Official Docs Lookup

Prefer local official docs if present:

- Docs path: `references/tauri-docs/src/content/docs/`
- Plugin source: `references/plugins-workspace/plugins/`
- Index, when generated: `references/auto-index.md`

If local docs are missing or incomplete, use official online Tauri v2 docs:
`https://v2.tauri.app/`.

If context7 is available, use these library IDs as a fallback:

| Case | Library ID |
|---|---|
| Tauri v2 | `/websites/v2_tauri_app` |
| User explicitly asks about v1 | `/websites/v1_tauri_app_v1` |

Do not rely on model memory for Tauri API details when docs are reachable.

## Documentation Verification Is Complete When

- The relevant Tauri v2 API, config key, permission, or plugin behavior has
  been checked against official docs.
- Any matching `gotchas.md` entry has been considered.
- The intended change names the required capability or permission if frontend
  code calls a native Tauri API.
- The implementation avoids known deadlock paths, especially window creation
  inside IPC commands and shutdown-time managed-state access.
- The response or commit reasoning can cite the source category:
  `official docs`, `local docs`, `context7`, or `gotchas.md`.

## Local Docs Setup

Local docs are optional but useful for repeated work. Run the updater from this
skill directory when you want an offline copy:

```bash
bash references/update.sh
```
