# tauri-skills

AI coding agent skills for [Tauri v2](https://v2.tauri.app/) desktop app development — built from real-world experience on Windows.

## Installation

### Claude Code plugin

```bash
/plugin marketplace add dev-dingguri/tauri-skills
/plugin install tauri-skills@tauri-skills
```

### Codex plugin

```bash
codex plugin marketplace add dev-dingguri/tauri-skills
```

### skills

```bash
npx skills add dev-dingguri/tauri-skills
```

## Skills

| Skill | What It Does |
|-------|-------------|
| **tauri-setup** | Scaffolds the verified default stack: Tauri v2 + React + TypeScript + pnpm + Biome, with Vitest, Playwright CDP hooks, and optional shadcn/ui |
| **tauri-docs** | Checks Tauri v2 work against official docs and [gotchas.md](skills/tauri-docs/gotchas.md), with a clear completion condition for documentation verification |
| **tauri-test-setup** | Test strategy and infrastructure guide with journey coverage gaps, layer classification (L1/L2/L3/L4), Vitest + RTL mocks, WebView CDP, and OS/manual boundaries |
| **tauri-webview-debug** | WebView2 debugging via CDP — Playwright MCP (primary) + Chrome DevTools MCP (fallback). Handles `.mcp.json` setup and Lighthouse audits |
| **tauri-multi-instance** | Port allocation contract for running multiple Tauri instances in parallel (git worktrees, side-by-side projects). Provides the `tauri-dev.mjs` launcher and the env var contract shared by Vite, CDP, and test fixtures |
| **tauri-os-automation** | Windows L4 automation constraints — system tray, registry, global key hooks via pywinauto / UIA / winreg. Defines what is automatable and what must stay manual |

Each skill works independently. `tauri-setup` orchestrates webview-debug and multi-instance skills during initial project creation. `tauri-test-setup` delegates L4-specific work to `tauri-os-automation`.

### Gotchas Included

7 pitfalls not covered in official docs. Highlights:

| Gotcha | Impact |
|--------|--------|
| `WebviewWindowBuilder::build()` in commands | Deadlock — main thread blocked by IPC |
| Background threads accessing state at shutdown | Deadlock — `ResourceTable` mutex contention |
| `Option<State<T>>` in commands | Won't compile — no `CommandArg` impl |

[Full list →](skills/tauri-docs/gotchas.md)

## Platform Support

These skills are developed and tested on **Windows** (MSVC toolchain, WebView2). Key constraints:
- `tauri-os-automation` is strictly Windows (pywinauto / UIA / winreg)
- `tauri-webview-debug` CDP relies on WebView2; macOS/Linux fall back to browser-direct debugging (documented in the skill)
- Other skills are cross-platform in principle but unverified

## Contributing

PRs welcome — especially macOS/Linux debugging, new gotchas, and Vue/Svelte/Solid setup templates.

## License

[MIT](LICENSE)
