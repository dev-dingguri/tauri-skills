# tauri-skills

AI coding agent skills for [Tauri v2](https://v2.tauri.app/) desktop app development — built from real-world experience on Windows.

## Installation

```bash
npx skills add dev-dingguri/tauri-skills
```

## Skills

| Skill | What It Does |
|-------|-------------|
| **tauri-setup** | End-to-end project scaffolding with config sync, build optimization, and show-gate pattern |
| **tauri-docs** | Verifies Tauri APIs against local docs before writing code. Includes [gotchas.md](skills/tauri-docs/gotchas.md) for pitfalls not in official docs |
| **tauri-test-setup** | Layer-based test strategy (L1 unit → L2 component → L3 CDP → L4 manual) with Tauri API mock recipes |
| **tauri-webview-debug** | WebView2 debugging via CDP — Playwright MCP primary, Chrome DevTools MCP for perf tracing |

Each skill works independently. `tauri-setup` orchestrates the others during initial project creation.

### Gotchas Included

7 pitfalls not covered in official docs. Highlights:

| Gotcha | Impact |
|--------|--------|
| `WebviewWindowBuilder::build()` in commands | Deadlock — main thread blocked by IPC |
| Background threads accessing state at shutdown | Deadlock — `ResourceTable` mutex contention |
| `Option<State<T>>` in commands | Won't compile — no `CommandArg` impl |

[Full list →](skills/tauri-docs/gotchas.md)

## Platform Support

`tauri-webview-debug` L3 CDP features require Windows (WebView2). All other skills work cross-platform. On macOS/Linux, use the browser-direct approach for debugging.

## Contributing

PRs welcome — especially macOS/Linux debugging, new gotchas, and Vue/Svelte/Solid setup templates.

## License

[MIT](LICENSE)
