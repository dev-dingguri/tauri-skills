---
name: tauri-setup
description: >-
  Tauri v2 + React project setup skill. Scaffolds with create-tauri-app,
  configures tooling (Biome, Vitest, Playwright, shadcn/ui), and orchestrates
  tauri-test-setup, tauri-webview-debug, tauri-multi-instance, tauri-docs
  skills. Trigger: "new tauri app", "tauri project setup", "tauri setup".
---

# Tauri v2 Project Initial Setup

> **Platform note:** This skill targets Windows (MSVC toolchain, WebView2).
> macOS/Linux setup has not been tested.

End-to-end setup for a new Tauri v2 desktop app project. Configuration
file bodies live in `references/templates/` — this SKILL.md decides
*when* and *why* to apply each; the templates hold the *what*. Flow:
gather inputs → scaffold → config files → show-gate CSS →
capabilities (if multi-window) → invoke test/debug skills → invoke
`tauri-multi-instance` → CLAUDE.md → install & verify.

---

## Step 1: Gather Inputs

Ask the user the following. Present recommended defaults — accept or override.

### 1a. Project Basics

| Input | Ask | Default |
|---|---|---|
| Project name | "Project name?" | — (required) |
| Bundle identifier | "Bundle ID? (e.g., `com.company.app`)" | — (required) |
| Project directory | "Project directory?" | `./<project-name>` |

### 1b. Tech Stack

| Category | Recommended | Alternatives |
|---|---|---|
| Package manager | **pnpm** | npm, yarn, bun |
| Frontend framework | **React + TypeScript** | Vue, Svelte, Solid, Vanilla |
| CSS framework | **Tailwind CSS v4** | CSS Modules, vanilla CSS |
| Linter/formatter | **Biome** | ESLint + Prettier |
| State management | **Zustand** | Jotai, Redux, none |
| Icon library | Material Symbols, Lucide, Tabler | — |

### 1c. shadcn/ui (optional)

Ask: "Use shadcn/ui?" If yes, ask in order:

1. **Base primitive** (project-level, cannot mix): **Radix UI** (wider
   ecosystem, `asChild`) or **Base UI** (MUI lineage, `render` prop).
2. **Style preset**: `nova`, `vega`, `maia`, `lyra`, `mira`, `luma`, or
   a custom preset pasted from ui.shadcn.com. Preset names are plain —
   e.g., `nova`, not `radix-nova`. The base primitive is picked via `--base`.
3. **Base color**: slate, gray, zinc, neutral, or stone — selected
   interactively during `shadcn init` (no `--base-color` CLI flag exists).

### 1d. Architecture

Ask: "Do you need multiple windows?" If yes, list the windows (e.g.,
overlay, settings, about, toast). Affects Vite multi-page config, Tauri
capabilities, and the `pages/` directory structure.

---

## Step 2: Scaffold

```bash
pnpm create tauri-app <project-name> --template react-ts --manager pnpm
cd <project-name>
```

Adjust `--template` / `--manager` based on Step 1. If the target
directory already exists (has `docs/`, `assets/`, etc.), scaffold into
`<project-name>-scaffold`, merge files into the existing directory,
then delete the temporary.

### 2a. Rename scaffold references (4 files)

| File | Fields to update |
|---|---|
| `tauri.conf.json` | `productName`, `identifier` |
| `Cargo.toml` | `[package] name`, `[lib] name` (e.g., `<project>_lib`) |
| `src-tauri/src/main.rs` | `<old_lib_name>::run()` → `<new_lib_name>::run()` |
| `package.json` | `name` |

> **Critical**: Forgetting `main.rs` causes `unresolved crate` build errors.

### 2b. `.gitattributes` — BEFORE first `git add`

Copy `references/templates/gitattributes` → `.gitattributes` **before any
binary file is staged**. The scaffold generates icons (PNG, ICO, ICNS) in
`src-tauri/icons/`; if staged first, `eol=lf` silently corrupts PNG
signatures by stripping `\r` from the `\x89PNG\r\n\x1a\n` header. The
template uses `text=auto` so Git auto-detects, with explicit `*.png binary`
lines as a safety net.

---

## Step 3: Config Files

Apply the templates from `references/templates/`. Variants per file:

- **`tsconfig-add.jsonc`** → merge into `tsconfig.json` `compilerOptions`.
  The `@/` alias must be synchronized across **4 files**: `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`, and `components.json` (if shadcn).
- **`vite.config.ts`** → `vite.config.ts`. Remove the `tailwindcss`
  plugin/import if no Tailwind; remove `multiPageInput` +
  `build.rollupOptions` if single-window. Reads `TAURI_DEV_PORT` /
  `TAURI_DEV_HOST` — the multi-instance port contract, owned by
  `tauri-multi-instance` (Step 7).
- **`vitest.config.ts`** → `vitest.config.ts`. No variants.
- **`biome.json`** → `biome.json`. Remove `css.parser.tailwindDirectives`
  if no Tailwind.
- **`cargo-append.toml`** → append to `src-tauri/Cargo.toml`. First
  change `[lib] crate-type` from `["staticlib", "cdylib", "rlib"]` to
  `["cdylib", "rlib"]`. `staticlib` is iOS/mobile-only; keeping it forces
  a full extra compilation pass.
- **`cargo-config.toml`** → **both** `/.cargo/config.toml` and
  `/src-tauri/.cargo/config.toml` (Windows MSVC + PDB + `jobs = 2`).
- **`rustfmt.toml`** → `src-tauri/rustfmt.toml`.

> **OOM recovery**: If a Cargo build fails with `os error 1455` (paging
> file too small) or `can't find crate` errors on std types, run
> `cargo clean` first — interrupted builds leave corrupted `target/`
> artifacts.

### 3a. shadcn/ui init (if chosen)

```bash
pnpm dlx shadcn@latest init --template vite --base <radix|base> --preset <preset-name> --yes
```

> **Critical**: `shadcn init` adds deps to `package.json` (`clsx`,
> `tailwind-merge`, `class-variance-authority`, `radix-ui`, `tw-animate-css`,
> `@fontsource-variable/geist`). Do NOT overwrite `package.json` after
> this step — use `Edit` for specific fields. Overwriting loses these
> deps; a stale lockfile may still build locally, masking the problem
> until a fresh `pnpm install` on another machine.

After init, verify `components.json` aliases match `@/` (the 4th sync
point). Install utilities if not auto-installed:
`pnpm add clsx tailwind-merge`. Create `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## Step 4: Show-Gate CSS Pattern

Every Tauri window must prevent unfinished rendering from flashing on
show. The pattern is a **three-piece set** — HTML class, CSS rules, JS
gate — that functions as a single unit. Missing any piece defeats the
protection.

Apply the pattern from `references/templates/show-gate.md`: add
`class="no-transitions"` to `<html>` (set `lang` appropriately), paste
the CSS into the main stylesheet, and in each window's entry script —
after async init — call `document.documentElement.classList.remove("no-transitions")`
then `getCurrentWindow().show()`. Each window in `tauri.conf.json` must
also be declared `visible: false`: the JS is what actually shows it.

---

## Step 5: Tauri Capabilities (if multi-window)

Create per-window capability files in `src-tauri/capabilities/` from
`references/templates/capability.json`. Principle: **minimum privilege
per window**.

| Window type | Typical permissions |
|---|---|
| Main (settings UI) | `core:window:*`, `core:webview:allow-create-webview-window`, `opener:default` |
| Overlay (transparent) | `core:default` only |
| Settings sub-window | `core:window:allow-close`, `core:window:allow-show`, `core:window:allow-start-dragging` |
| Toast/notification | `core:default`, `core:window:allow-show` |
| About dialog | `core:app:default`, `core:window:allow-close`, `opener:default` |

Update `tauri.conf.json` to reference each capability file and set
windows to `visible: false` (show-gate requires JS-side `show()`).

---

## Step 6: Invoke Existing Skills

**6a. /tauri-test-setup — Setup Checklist only.** Invoke and follow only
that section: verify `vitest.config.ts` (from Step 3), add
`@testing-library/jest-dom/vitest` to `src/test/setup.ts`, write the
Tauri API mock triple (core, event, window), and note L4 manual items
as a CLAUDE.md placeholder. Do NOT run Step 1 "Classify features into
L1–L4" — no features exist at init time.

**6b. /tauri-webview-debug — Step 0 only.** Invoke and follow only
"Ensure .mcp.json": create `.mcp.json` with `chrome-devtools-cdp` and
`playwright-cdp` entries. Tell the user a Claude Code restart is
required for MCP servers to take effect. Do NOT run Steps 1–4 — the
app hasn't been built yet.

---

## Step 7: Invoke /tauri-multi-instance — Dev Launcher

Invoke `tauri-multi-instance` and follow its "From tauri-setup"
guidance: copy `references/tauri-dev.mjs` → `<project>/scripts/tauri-dev.mjs`,
and add `"dev:tauri": "node scripts/tauri-dev.mjs"` to `package.json`
scripts. `vite.config.ts` already reads `TAURI_DEV_PORT` /
`TAURI_DEV_HOST` from Step 3, so no further config is needed. This
replaces `pnpm tauri dev` as the primary dev entry point and handles
parallel instances (worktrees, side-by-side projects).

---

## Step 8: Generate CLAUDE.md

Copy `references/templates/CLAUDE.md.tmpl` → `<project>/CLAUDE.md` and
fill in the placeholders.

> **Principle**: If Claude can read the answer from a file, it doesn't
> belong in CLAUDE.md. Only project purpose, non-obvious architectural
> patterns, behavioral rules, and skill invocation directives go here.
> Tech stack, commands, versions, and linter settings live in their own
> config files — do not duplicate.

---

## Step 9: Install Dependencies & Verify

pnpm v10+ blocks dependency build scripts by default. esbuild (used by
Vite) needs its `postinstall` to install platform binaries, so add to
`package.json`:

```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild"]
}
```

Then install and verify:

```bash
pnpm install                                          # frontend deps
cargo build --manifest-path src-tauri/Cargo.toml      # Rust build
pnpm build                                            # frontend build
pnpm test                                             # Vitest (passes with no tests)
```

If all pass, setup is complete. Tell the user: start dev with
`pnpm dev:tauri` (multi-instance launcher from Step 7); for WebView
debugging, restart Claude Code for MCP then `/tauri-webview-debug`;
for tests, `/tauri-test-setup`; for shadcn components, `/shadcn`.
