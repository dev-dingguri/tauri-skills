# tauri-skills

AI coding agent skills for [Tauri v2](https://v2.tauri.app/) desktop app development — built from real-world experience on Windows.

## Installation

### As a Claude Code plugin (recommended)

```bash
/plugin marketplace add dev-dingguri/tauri-skills
/plugin install tauri-skills@tauri-skills
```

Private repo? Make sure `gh auth login` is set up first. For background
auto-updates, also export `GITHUB_TOKEN` (or `GH_TOKEN`) — git credential
helpers don't run unattended.

### As skills via npx (alternative)

```bash
npx skills add dev-dingguri/tauri-skills
```

## Skills

| Skill | What It Does |
|-------|-------------|
| **tauri-setup** | Scaffolds a new Tauri v2 + React project via `create-tauri-app`, configures tooling (Biome, Vitest, Playwright, shadcn/ui), and orchestrates webview-debug and multi-instance skills during initial project creation |
| **tauri-docs** | Documentation-first workflow — verifies Tauri APIs against local docs before writing code. Ships with [gotchas.md](skills/tauri-docs/gotchas.md) for pitfalls not covered in official docs |
| **tauri-test-setup** | Test infrastructure guide with layer classification (L2 Vitest + RTL + Tauri mock / L3 Playwright CDP / L4 pywinauto + manual) and per-layer recipes |
| **tauri-test-generator** | Journey-based test generation — discovers user flows from the codebase, identifies coverage gaps, and writes tests at the cheapest layer that verifies each gap |
| **tauri-webview-debug** | WebView2 debugging via CDP — Playwright MCP (primary) + Chrome DevTools MCP (fallback). Handles `.mcp.json` setup and Lighthouse audits |
| **tauri-multi-instance** | Port allocation contract for running multiple Tauri instances in parallel (git worktrees, side-by-side projects). Provides the `tauri-dev.mjs` launcher and the env var contract shared by Vite, CDP, and test fixtures |
| **tauri-os-automation** | Windows L4 automation constraints — system tray, registry, global key hooks via pywinauto / UIA / winreg. Defines what is automatable and what must stay manual |

Each skill works independently. `tauri-setup` orchestrates webview-debug and multi-instance skills during initial project creation. `tauri-test-setup` and `tauri-test-generator` delegate L4-specific work to `tauri-os-automation`.

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
