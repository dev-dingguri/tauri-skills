---
name: tauri-setup
description: >-
  Use when creating a new Windows-tested Tauri v2 desktop app with the verified
  default stack: React, TypeScript, pnpm, Biome, Vitest, Playwright CDP, and
  optional shadcn/ui. Trigger: "new tauri app", "tauri setup".
---

# Tauri v2 Project Setup

> **Verified path:** Windows + MSVC + WebView2, Tauri v2, React + TypeScript,
> pnpm, Biome, Vite, Vitest, Playwright CDP, optional shadcn/ui.
> Other frameworks/package managers are out of scope for this setup skill.

> **External dependencies:** Setup runs `create-tauri-app`, `pnpm`, `cargo`,
> and optionally `shadcn`, which fetch from npm and crates.io.

Configuration bodies live in `references/templates/`. This file keeps only the
order, traps, and decisions that prevent expensive setup failures.

## 1. Required Inputs

Ask only for:

- Project name
- Bundle ID, e.g. `com.company.app`
- Project directory, default `./<project-name>`
- Whether to install shadcn/ui
- If shadcn is yes: base primitive (`radix` default, `base` optional) and
  preset (`vega` default)
- Icon library if needed: `lucide-react` default, `@radix-ui/react-icons`
  optional

## 2. Scaffold

```bash
pnpm create tauri-app <project-name> --template react-ts --manager pnpm
cd <project-name>
```

If the target directory already contains user files, scaffold into
`<project-name>-scaffold`, merge the generated files, then remove the temporary
directory.

Rename scaffold references:

| File | Update |
|---|---|
| `src-tauri/tauri.conf.json` | `productName`, `identifier` |
| `src-tauri/Cargo.toml` | `[package] name`, `[lib] name` |
| `src-tauri/src/main.rs` | old lib crate -> new lib crate |
| `package.json` | `name` |

**Critical:** forgetting `main.rs` causes unresolved crate build errors.

Copy `references/templates/gitattributes` to `.gitattributes` before the first
`git add`. Tauri scaffolds PNG/ICO/ICNS icons; staging them before binary rules
can corrupt line endings.

## 3. Install Tooling Before Editing Config

Run install groups before editing `package.json`; `pnpm add` rewrites it.

```bash
pnpm add -D @biomejs/biome @types/node vitest jsdom @testing-library/react @testing-library/jest-dom
pnpm add tailwindcss @tailwindcss/vite
```

Apply templates:

- `tsconfig-add.jsonc` -> merge into `tsconfig.json`.
- `vite.config.ts` -> `vite.config.ts`. It reads `TAURI_DEV_PORT` and
  `TAURI_DEV_HOST`.
- `vitest.config.ts` -> `vitest.config.ts`.
- `biome.json` -> `biome.json`; update `$schema` to the installed Biome
  version from `pnpm ls @biomejs/biome --depth 0`.
- `cargo-append.toml` -> append to `src-tauri/Cargo.toml`; remove
  `staticlib` from `[lib] crate-type` unless targeting mobile.
- `cargo-config.toml` -> both `.cargo/config.toml` and
  `src-tauri/.cargo/config.toml`.
- `rustfmt.toml` -> `src-tauri/rustfmt.toml`.

Keep the `@/` alias synchronized across `tsconfig.json`, `vite.config.ts`,
`vitest.config.ts`, and `components.json` if shadcn is used.

If Cargo fails with `os error 1455` or impossible std crate errors, run
`cargo clean`; interrupted Windows MSVC builds can leave corrupted `target/`
artifacts.

## 4. Tailwind and shadcn/ui

Create `src/index.css` before `shadcn init`:

```css
@import "tailwindcss";
```

Import it from `src/main.tsx`:

```typescript
import "./index.css";
```

If shadcn is enabled:

```bash
pnpm dlx shadcn@latest init --template vite --base <radix|base> --preset <preset> --yes
```

After init:

- Do not overwrite `package.json`; shadcn adds runtime dependencies.
- Check `components.json` aliases.
- Remove unexpected preset-bundled icon packages if needed, then install
  `lucide-react` or `@radix-ui/react-icons`.
- Add `src/lib/utils.ts` if shadcn did not create it:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Runtime UI libraries belong in `dependencies`; build/test tools belong in
`devDependencies`.

## 5. Show Gate

Apply `references/templates/show-gate.md` to every window:

- Set each Tauri window `visible: false`.
- Add `class="no-transitions"` to `<html>`.
- Add the CSS gate to the main stylesheet.
- After async frontend init, remove `no-transitions`, then call
  `getCurrentWindow().show()`.

Missing any piece allows unfinished WebView rendering to flash.

## 6. Capabilities

Tauri v2 frontend API calls need explicit permissions in
`src-tauri/capabilities/*.json`. The default `core:default` is enough to boot,
but new APIs must update capabilities in the same change.

Common misses:

- `core:window:allow-show`, `allow-hide`, `allow-close`
- `core:window:allow-set-position`, `allow-set-size`,
  `allow-start-dragging`
- `core:webview:allow-create-webview-window`
- `opener:default`

If a frontend Tauri API call fails silently, check capabilities first.

## 7. WebView Debug and Multi-Instance Hooks

Use `/tauri-webview-debug` only for its initial `.mcp.json` setup. Tell the
user Claude Code/Codex must restart before new MCP servers take effect.

Use `/tauri-multi-instance` to install the dev launcher from that skill:

- Copy its `references/tauri-dev.mjs` to `scripts/tauri-dev.mjs`.
- Add `"dev:tauri": "node scripts/tauri-dev.mjs"` to `package.json`.

`vite.config.ts` already reads `TAURI_DEV_PORT` / `TAURI_DEV_HOST`; the launcher
becomes the primary dev entry point instead of direct `pnpm tauri dev`.

## 8. Project Instructions

Copy `references/templates/CLAUDE.md.tmpl` to `CLAUDE.md` and fill project
placeholders. Keep it limited to project purpose, non-obvious architecture,
behavioral rules, and required skill usage. Do not duplicate versions or
commands that already live in config files.

## 9. Install and Build

pnpm v10+ blocks dependency build scripts by default. Add:

```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild", "msw"]
}
```

Then run:

```bash
pnpm install
cargo build --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm test
```

After setup, start development with `pnpm dev:tauri`. For WebView debugging,
restart the agent host after `.mcp.json` changes, then use `/tauri-webview-debug`.
