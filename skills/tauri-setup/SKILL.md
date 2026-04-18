---
name: tauri-setup
description: >-
  Tauri v2 + React project setup skill. Scaffolds with create-tauri-app,
  configures tooling (Biome, Vitest, Playwright, shadcn/ui), and orchestrates
  tauri-webview-debug, tauri-multi-instance, tauri-docs skills.
  Trigger: "new tauri app", "tauri project setup", "tauri setup".
---

# Tauri v2 Project Initial Setup

> **Platform note:** This skill targets Windows (MSVC toolchain, WebView2).
> macOS/Linux setup has not been tested.

> **External dependencies:** This skill runs `create-tauri-app`, `shadcn`,
> `pnpm`, and `cargo`, which fetch code from the npm registry and crates.io
> during setup. Review the commands in Step 2 and Step 7 before executing.

End-to-end setup for a new Tauri v2 desktop app project. Configuration
file bodies live in `references/templates/` — this SKILL.md decides
*when* and *why* to apply each; the templates hold the *what*. Flow:
gather inputs → scaffold → config files → show-gate CSS →
capabilities → invoke webview-debug skill → invoke
`tauri-multi-instance` → CLAUDE.md → install & verify.

---

## Step 1: Gather Inputs

Ask the user the questions below, one block at a time. Each choice has
a letter identifier — the user can answer like "Q4: a, Q5: a, Q6: b"
or just "all defaults". Defaults are marked **(default)**.

### 1a. Project Basics (free-text)

- **Q1.** Project name? *(required)*
- **Q2.** Bundle ID? — e.g., `com.company.app` *(required)*
- **Q3.** Project directory? *(default: `./<project-name>`)*

### 1b. Tech Stack

**Q4. Package manager?**
- a) pnpm **(default)**
- b) npm
- c) yarn
- d) bun

**Q5. Frontend framework?**
- a) React + TypeScript **(default)**
- b) Vue
- c) Svelte
- d) Solid
- e) Vanilla

**Q6. CSS framework?**
- a) Tailwind CSS v4 **(default)**
- b) CSS Modules
- c) Vanilla CSS

**Q7. Linter/formatter?**
- a) Biome **(default)**
- b) ESLint + Prettier

**Q8. State management?**
- a) Zustand **(default)**
- b) Jotai
- c) Redux
- d) None

### 1c. shadcn/ui (optional)

**Q9. Use shadcn/ui?**
- a) Yes
- b) No **(default)**

If Q9 = a, ask Q10–Q11:

**Q10. Base primitive?** *(project-level, cannot mix later)*
- a) Radix UI — wider ecosystem, `asChild` composition **(default)**
- b) Base UI — MUI lineage, `render` prop composition

**Q11. Style preset?** *(names are plain — e.g., `nova`, not `radix-nova`; base primitive is picked via `--base`. Preview at ui.shadcn.com before choosing)*
- a) `vega` — the classic shadcn/ui look; default baseline
- b) `nova` — reduced spacing for compact layouts
- c) `maia` — soft and rounded, with generous spacing; prior reports indicate it may bundle `hugeicons`
- d) `lyra` — boxy and sharp; pairs well with mono fonts
- e) `mira` — compact, made for dense interfaces
- f) `sera` — minimal, editorial, typographic; underline controls and uppercase headings; shaped by print-design principles
- g) `luma` — rounded geometry, soft elevation, breathable layouts; inspired by macOS Tahoe (minus the glass)
- h) custom (paste a preset URL from ui.shadcn.com)

> If unsure, start with `vega` (the classic look) and switch later.

### 1d. Icon Library

Asked last because the preset choice (Q11) may bundle one by default —
check `package.json` `dependencies` after `shadcn init` (Step 3d) to
see what was installed. If the bundled library doesn't match your
choice below, remove it and install the chosen one.

**Q13. Icon library?**
- a) **Lucide** — shadcn's default pairing; consistent 1.5px outline, ~1500 icons, MIT. Works with any preset.
- b) **Radix Icons** — by the Radix UI team (same org as the `radix` base primitive); 15×15 pixel-perfect, geometric, ~300 icons, MIT. Small set but crisp at small sizes.
- c) None

**Suggested pairings by preset** (starting points — final choice is taste):

| Preset (Q11) | Suggested icon (Q13) | Reason |
|---|---|---|
| `vega` | a) Lucide | shadcn's default pairing; matches the classic look |
| `nova` | b) Radix Icons | 15×15 pixel-perfect renders cleanly in compact layouts |
| `maia` | a) Lucide | rounded stroke ends pair with the soft/rounded geometry |
| `lyra` | b) Radix Icons | geometric, pixel-grid aligned — fits boxy/sharp aesthetic |
| `mira` | b) Radix Icons | stays crisp and legible in dense interfaces |
| `sera` | a) Lucide | consistent stroke complements editorial typography |
| `luma` | a) Lucide | rounded stroke ends echo the rounded geometry |

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

### 3a. Pre-install Tooling

The config templates below reference packages that must already be
installed. Do these **before** applying templates and **before** running
`shadcn init`.

> **package.json edit race**: `pnpm add` rewrites `package.json`. If you
> later `Edit` the file after a stale `Read`, the tool errors with
> "file modified since read". Rule: **complete all `pnpm add` commands
> in a group first**, then do any `Edit` tweaks. Always `Read`
> immediately before `Edit` on `package.json`.

Base tooling (always):

```bash
pnpm add -D @biomejs/biome @types/node
```

Tailwind (required if shadcn is chosen, or if Step 1b selected Tailwind):

```bash
pnpm add tailwindcss @tailwindcss/vite
```

Vitest + testing libs (if tests are planned):

```bash
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

### 3b. Apply Config Templates

Apply the templates from `references/templates/`. Variants per file:

- **`tsconfig-add.jsonc`** → merge into `tsconfig.json` `compilerOptions`.
  The `@/` alias must be synchronized across **4 files**: `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`, and `components.json` (if shadcn).
- **`vite.config.ts`** → `vite.config.ts`. Remove the `tailwindcss`
  plugin/import if no Tailwind. Defaults to single-window; if multiple
  windows are added later, add `multiPageInput` + `build.rollupOptions`
  at that time. Reads `TAURI_DEV_PORT` / `TAURI_DEV_HOST` — the
  multi-instance port contract, owned by `tauri-multi-instance` (Step 7).
  For heavy libraries (Three.js, Monaco, PDF.js, etc.) added later,
  use `build.rollupOptions.output.manualChunks` to split the bundle —
  skip for initial setup.
- **`vitest.config.ts`** → `vitest.config.ts`. No variants.
- **`biome.json`** → `biome.json`. Remove `css.parser.tailwindDirectives`
  if no Tailwind. **Update `$schema` to match the installed Biome
  version** — the template pins a specific version
  (`https://biomejs.dev/schemas/<version>/schema.json`) that may lag
  behind what Step 3a installed. Check with
  `pnpm ls @biomejs/biome --depth 0` and edit the URL accordingly;
  a mismatch causes editor warnings but not build failures. The
  template sets `indentStyle: "tab"` globally but overrides JSON
  files to `indentStyle: "space", indentWidth: 2` — this prevents
  Biome from reformatting `.claude/settings.json` and similar config
  files with tabs.
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

### 3c. Tailwind Bootstrap (if Tailwind)

`shadcn init` (3d) inspects the project to detect Tailwind. Without an
installed Tailwind (done in 3a) **and** a base CSS file with the
Tailwind import, detection fails. Create `src/index.css`:

```css
@import "tailwindcss";
```

Import it from `src/main.tsx`:

```typescript
import "./index.css";
```

The `create-tauri-app` react-ts scaffold generates `src/App.css` but
not `src/index.css`, and does not pre-import Tailwind — these two
steps are what shadcn detection relies on.

### 3d. shadcn/ui init (if chosen)

```bash
pnpm dlx shadcn@latest init --template vite --base <radix|base> --preset <preset-name> --yes
```

> **Critical**: `shadcn init` adds deps to `package.json` (`clsx`,
> `tailwind-merge`, `class-variance-authority`, `radix-ui`, `tw-animate-css`,
> `@fontsource-variable/geist`). Do NOT overwrite `package.json` after
> this step — use `Edit` for specific fields. Overwriting loses these
> deps; a stale lockfile may still build locally, masking the problem
> until a fresh `pnpm install` on another machine.

> **Preset-bundled icon libraries**: Some style presets pull in their
> own icon library by default — e.g., `maia` has been reported to
> install `hugeicons`. Since Q13 only offers Lucide or Radix Icons,
> after init: check `package.json` `dependencies` for any unexpected
> icon package, uninstall it (`pnpm remove <pkg>`), then install your
> Q13 choice (`pnpm add lucide-react` or `pnpm add @radix-ui/react-icons`).

After init, verify `components.json` aliases match `@/` (the 4th sync
point). Install utilities if not auto-installed:
`pnpm add clsx tailwind-merge`. Create `src/lib/utils.ts`:

> **Dependency classification rule**: Tauri bundles the frontend, so
> misclassified deps bloat the shipped bundle. Runtime libraries
> (`react`, `clsx`, `tailwind-merge`, `radix-ui`, `zustand`, shadcn
> additions) go in `dependencies`. Build/test tooling (`vite`,
> `@vitejs/plugin-react`, `@tailwindcss/vite`, `typescript`, `vitest`,
> `@biomejs/biome`, `@types/*`) goes in `devDependencies`. If you
> install via `pnpm add <pkg>` it lands in `dependencies` — use `-D`
> explicitly for tooling.

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

## Step 5: Tauri Capabilities — Permission Declaration

Tauri v2 uses an **explicit permission** model: every frontend API call
that touches a native capability must be authorized by a `capabilities/*.json`
file referenced in `tauri.conf.json`. **This applies regardless of window
count** — even a single-window app calling `window.setPosition()` or
`window.setSize()` needs the matching permission, or the call fails
silently at runtime with a log line that's easy to miss.

The default scaffold ships `src-tauri/capabilities/default.json` with
`core:default`, which covers the basic `core:*` permissions for the
main window. That is enough to boot, but the moment you add a new API,
capability must be updated in the same commit.

**Common traps** (APIs that look harmless but need explicit permission):

- `core:window:allow-set-position`, `allow-set-size`, `allow-start-dragging`
- `core:window:allow-show`, `allow-hide`, `allow-close`
- `core:webview:allow-create-webview-window` (for opening sub-windows)
- `opener:default` (to launch URLs/files via the shell)

**Procedural rule** — record this in Step 8's CLAUDE.md: *"When adding
a new Tauri API call from the frontend, update `src-tauri/capabilities/`
in the same change. If the call fails silently, check capability
coverage first."*

---

## Step 6: Invoke /tauri-webview-debug — Step 0 only

Invoke and follow only "Ensure .mcp.json": create `.mcp.json` with
`chrome-devtools-cdp` and `playwright-cdp` entries. Tell the user a
Claude Code restart is required for MCP servers to take effect. Do NOT
run Steps 1–4 — the app hasn't been built yet.

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

pnpm v10+ blocks dependency build scripts by default. Allowlist the
packages whose `postinstall` must run. `esbuild` (via Vite) installs
platform binaries; `msw` (transitively pulled in by
`@testing-library/*` / `jsdom` chains) also has a build script.
Without `msw` in the list, `pnpm install` emits "Ignored build scripts:
msw" warnings on every run. Add to `package.json`:

```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild", "msw"]
}
```

> `node-domexception` deprecation warnings come from `jsdom`'s
> dependency tree — harmless and out of our control until `jsdom`
> upgrades.

At this point, `@biomejs/biome`, `@types/node`, Tailwind, and Vitest
should already be in `package.json` from Step 3a. Verify with `grep` or
a quick `package.json` read before running install — if any are missing
(e.g., Step 3a was skipped for a minimal setup), add them now.

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
for shadcn components, `/shadcn`.
