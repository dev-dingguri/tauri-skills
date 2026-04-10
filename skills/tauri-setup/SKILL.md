---
name: tauri-setup
description: >-
  Tauri v2 + React project setup skill. Scaffolds with create-tauri-app,
  configures tooling (Biome, Vitest, Playwright, shadcn/ui), and orchestrates
  tauri-test-setup, tauri-webview-debug, tauri-docs skills.
  Trigger: "new tauri app", "tauri project setup", "tauri setup".
---

# Tauri v2 Project Initial Setup

> **Platform note:** This skill targets Windows (MSVC toolchain, WebView2).
> macOS/Linux setup has not been tested.

End-to-end setup for a new Tauri v2 desktop app project.
Orchestrates scaffold, config, testing, and debugging setup in one flow.

## Process Overview

```
Gather Inputs (interactive)
  → Scaffold (create-tauri-app)
  → Config Files (tsconfig, vite, biome, cargo, etc.)
  → shadcn/ui Init (optional)
  → Show-Gate CSS Pattern
  → Tauri Capabilities
  → Invoke /tauri-test-setup (Setup Checklist only)
  → Invoke /tauri-webview-debug (Step 0 only)
  → Generate CLAUDE.md
```

---

## Step 1: Gather Inputs

Ask the user the following. Present recommended defaults — accept or override.

### 1a. Project Basics

| Input | Ask | Default |
|-------|-----|---------|
| Project name | "Project name?" | — (required) |
| Bundle identifier | "Bundle ID? (e.g., `com.company.app`)" | — (required) |
| Project directory | "Project directory?" | `./<project-name>` |

### 1b. Tech Stack

Present as a table with recommendations. User can swap any.

| Category | Recommended | Alternatives |
|----------|-------------|--------------|
| Package manager | **pnpm** | npm, yarn, bun |
| Frontend framework | **React + TypeScript** | Vue, Svelte, Solid, Vanilla |
| CSS framework | **Tailwind CSS v4** | CSS Modules, vanilla CSS |
| Linter/formatter | **Biome** | ESLint + Prettier |
| State management | **Zustand** | Jotai, Redux, none |
| Icon library | Material Symbols, Lucide, Tabler | — |

### 1c. shadcn/ui (optional)

Ask: "Use shadcn/ui?"

If yes, ask in this order:

**1. Base primitive** (project-level, cannot mix):

| Option | Pattern | Ecosystem |
|--------|---------|-----------|
| **Radix UI** | `asChild` composition | Wider ecosystem, more mature |
| **Base UI** | `render` prop composition | MUI lineage, newer |

**2. Style preset**:

| Style | Preset name |
|-------|-------------|
| Nova | `nova` |
| Vega | `vega` |
| Maia | `maia` |
| Lyra | `lyra` |
| Mira | `mira` |
| Luma | `luma` |
| Custom | user provides code from ui.shadcn.com |

> **Note**: Preset names are plain (e.g., `nova`, not `radix-nova`).
> The base primitive is selected via the `--base` flag, not the preset name.

**3. Base color**: slate, gray, zinc, neutral, stone

> **Note**: Base color is selected interactively during `shadcn init`.
> There is no `--base-color` CLI flag.

### 1d. Architecture

Ask: "Do you need multiple windows?"

If yes, ask which windows are needed (e.g., overlay, settings, about, toast).
This affects: Vite multi-page config, Tauri capabilities, pages/ directory structure.

---

## Step 2: Scaffold

Run `create-tauri-app` with the chosen stack:

```bash
pnpm create tauri-app <project-name> --template react-ts --manager pnpm
cd <project-name>
```

Adjust `--template` and `--manager` based on Step 1 choices.

If the target directory already exists (e.g., has `docs/`, `assets/`), scaffold into a
temporary name (e.g., `<project-name>-scaffold`) and merge the generated files into
the existing directory. Delete the temporary directory after merging.

After scaffold, rename all scaffold references across **4 files**:

| File | Fields to update |
|------|-----------------|
| `tauri.conf.json` | `productName`, `identifier` |
| `Cargo.toml` | `[package] name`, `[lib] name` (e.g., `<project>_lib`) |
| `src-tauri/src/main.rs` | `<old_lib_name>::run()` → `<new_lib_name>::run()` |
| `package.json` | `name` |

> **Critical**: Forgetting `main.rs` causes `unresolved crate` build errors.

### 2b. Create .gitattributes BEFORE first commit

> **Critical ordering**: `.gitattributes` must exist before any `git add` of binary files.
> The scaffold generates icons (PNG, ICO, ICNS) in `src-tauri/icons/`. If these are
> staged before `.gitattributes` exists, `eol=lf` silently corrupts PNG signatures
> by stripping `\r` bytes from the `\x89PNG\r\n\x1a\n` header.

Create `.gitattributes` immediately after scaffold, before any `git add`:

```
* text=auto eol=lf
*.png binary
*.ico binary
*.icns binary
*.glb binary
*.woff2 binary
```

> **Why `text=auto`**: `* eol=lf` alone applies line-ending conversion to ALL files,
> including binaries (PNG, ICO, GLB). This silently corrupts binary files by stripping
> bytes that look like CRLF. `text=auto` lets Git auto-detect text vs binary, and the
> explicit `binary` declarations provide a safety net for common asset types.

---

## Step 3: Config Files

### 3a. tsconfig.json — Path Alias

Add `@/*` path alias. This must be synchronized across **4 files** (Step 3b, 3c, 3g).

```jsonc
{
  "compilerOptions": {
    // ... existing options ...
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Also set strict mode if not already:
```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### 3b. vite.config.ts

Configure based on choices:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";  // Tailwind v4
import path from "path";

// Multi-page input (only if multi-window)
const multiPageInput = {
  main: "index.html",
  // Add per window: "overlay": "pages/overlay.html", etc.
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),  // Only if Tailwind chosen
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),  // Sync with tsconfig
    },
  },
  // Multi-page build (only if multi-window)
  build: {
    rollupOptions: {
      input: multiPageInput,
    },
  },
  // Tauri dev server — port from env var for multi-instance support (see scripts/tauri-dev.mjs)
  server: {
    port: parseInt(process.env.TAURI_DEV_PORT || "1420"),
    strictPort: true,
    hmr: process.env.TAURI_DEV_HOST
      ? { protocol: "ws", host: process.env.TAURI_DEV_HOST, port: parseInt(process.env.TAURI_DEV_PORT || "1420") + 1 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

### 3c. vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    passWithNoTests: true,
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),  // Sync with tsconfig
    },
  },
});
```

### 3d. biome.json

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.8/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {},
  "formatter": {
    "enabled": true,
    "indentStyle": "tab"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Omit `css.parser.tailwindDirectives` if Tailwind is not chosen.

### 3e. .gitattributes

Already created in Step 2b. Verify it exists — if missing, create it now and
re-add any binary files (`git rm --cached *.png && git add *.png`) to apply
the binary rules retroactively.

### 3f. Cargo.toml — crate-type, Clippy Lints & Release Profile

First, update `[lib] crate-type`. The scaffold generates `["staticlib", "cdylib", "rlib"]`,
but **`staticlib` is only needed for iOS/mobile targets**. For desktop-only apps, remove it
to save a full extra compilation pass (reduces build time and memory usage):

```toml
[lib]
name = "<project>_lib"
crate-type = ["cdylib", "rlib"]
```

Then append to `src-tauri/Cargo.toml`:

```toml
[lints.clippy]
# -- Safety --
unwrap_used = "warn"
cast_possible_truncation = "warn"
cast_sign_loss = "warn"
# -- Readability --
# Why not needless_pass_by_value: Tauri #[command] macro requires owned AppHandle/State
redundant_closure_for_method_calls = "warn"
manual_string_new = "warn"
implicit_clone = "warn"
# -- Maintenance --
cloned_instead_of_copied = "warn"
inefficient_to_string = "warn"
unused_self = "warn"

[profile.release]
# Why: PDB symbols for crash dump analysis. Stored in separate .pdb, no .exe size impact.
debug = true
strip = false
```

### 3g. shadcn/ui Init (if chosen)

Run with the chosen base and preset:

```bash
pnpm dlx shadcn@latest init --template vite --base <radix|base> --preset <preset-name> --yes
```

> **CLI flags**: `--base` selects the primitive (radix or base), `--preset` is the plain
> style name (e.g., `nova`, not `radix-nova`). Base color is selected interactively
> (no `--base-color` flag exists).

> **Critical**: `shadcn init` adds dependencies to `package.json` (e.g., `clsx`,
> `tailwind-merge`, `class-variance-authority`, `radix-ui`, `tw-animate-css`,
> `@fontsource-variable/geist`). Do NOT overwrite `package.json` after this step —
> use `Edit` to modify specific fields. Overwriting the file loses these dependencies,
> and the project may still build from a stale lockfile, masking the problem until
> a fresh `pnpm install` on another machine.

After init, verify `components.json` aliases match the `@/` path alias:

```jsonc
{
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

This is the **4th sync point** for the `@/` alias (tsconfig, vite, vitest, components.json).

Install utility dependencies if not auto-installed:

```bash
pnpm add clsx tailwind-merge
```

Create `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 3h. .cargo/config.toml (Windows)

Create both `/.cargo/config.toml` and `/src-tauri/.cargo/config.toml`:

```toml
[build]
target = "x86_64-pc-windows-msvc"
# Why jobs=2: Tauri's first build compiles hundreds of crates in parallel.
# Full parallelism can cause OOM on machines with limited RAM, corrupting
# the build cache (requires cargo clean to recover). 2 jobs is safe.
jobs = 2

[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=/PDBALTPATH:%_PDB%"]

[env]
RUST_BACKTRACE = "1"
```

> **OOM recovery**: If a build fails with `os error 1455` (paging file too small) or
> `can't find crate` errors on standard library types, run `cargo clean` first —
> the interrupted build left corrupted artifacts in `target/`.

### 3i. rustfmt.toml

Create `src-tauri/rustfmt.toml`:

```toml
edition = "2021"
```

---

## Step 4: Show-Gate CSS Pattern

Every Tauri window must prevent unfinished rendering from flashing on show.

### 4a. HTML entry points

Add `class="no-transitions"` to `<html>`:

```html
<html lang="ko" class="no-transitions">
```

Set `lang` to the project's primary language.

### 4b. CSS (in main stylesheet)

```css
/* Show-gate: prevent visible "pop-in" during window initialization.
   Two-layer protection: transition:none blocks animation,
   opacity:0 hides partially-rendered content. */
.no-transitions,
.no-transitions * {
  transition: none !important;
}
.no-transitions body {
  opacity: 0;
}
```

### 4c. JS show gate (per window)

Each window's entry script must:
1. Wait for async init (fonts, state fetch, etc.)
2. Remove `no-transitions` class
3. Call `getCurrentWindow().show()`

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";

async function init() {
  await document.fonts.ready;
  // ... other async init ...

  document.documentElement.classList.remove("no-transitions");
  await getCurrentWindow().show();
}

init();
```

---

## Step 5: Tauri Capabilities (if multi-window)

Create per-window capability files in `src-tauri/capabilities/`.

Principle: **minimum privilege per window**.

```jsonc
// src-tauri/capabilities/<window-label>.json
{
  "identifier": "<window-label>-capability",
  "description": "<window> window permissions",
  "windows": ["<window-label>"],
  "permissions": [
    "core:default"
    // Add only what this window needs
  ]
}
```

Common permission patterns:

| Window type | Typical permissions |
|-------------|-------------------|
| Main (settings UI) | `core:window:*`, `core:webview:allow-create-webview-window`, `opener:default` |
| Overlay (transparent) | `core:default` only |
| Settings sub-window | `core:window:allow-close`, `core:window:allow-show`, `core:window:allow-start-dragging` |
| Toast/notification | `core:default`, `core:window:allow-show` |
| About dialog | `core:app:default`, `core:window:allow-close`, `opener:default` |

Update `tauri.conf.json` to reference capability files and set windows to `visible: false`
(show-gate requires JS-side `show()` call).

---

## Step 6: Invoke Existing Skills

### 6a. /tauri-test-setup — Setup Checklist only

Invoke the `tauri-test-setup` skill. Follow **only the "Setup Checklist"** section (end of skill):

1. Configure `vitest.config.ts` (already done in Step 3c — verify)
2. Add `@testing-library/jest-dom/vitest` import in `src/test/setup.ts`
3. Write Tauri API mock triple (core, event, window) in test setup or a shared mock file
4. Document L4 manual items (defer — no features exist yet, note placeholder in CLAUDE.md)

Do NOT run Step 1 "Classify features into L1–L4" — no features exist yet at init time.

### 6b. /tauri-webview-debug — Step 0 only

Invoke the `tauri-webview-debug` skill. Follow **only "Step 0: Ensure .mcp.json"**:

- Create `.mcp.json` with `chrome-devtools-cdp` and `playwright-cdp` entries
- Inform the user that a Claude Code restart is required for MCP servers to take effect

Do NOT run Steps 1–4 — the app hasn't been built yet.

---

## Step 7: Generate CLAUDE.md

Create a project `CLAUDE.md` with **only information that cannot be derived from
code or config files**. Tech stack, commands, versions, linter settings, etc. are
all readable from `package.json`, `Cargo.toml`, `biome.json`, `tsconfig.json`, and
other config files — do NOT duplicate them here.

```markdown
# CLAUDE.md

## Overview

<Project name> — <one-line description>.

## Architecture

- <Single-window | Multi-window>: <list windows with labels and roles if multi>
- <Vite multi-page build (`index.html`, `pages/<name>.html`) if multi-window>
- Show-gate pattern: windows start `visible: false`, JS calls `show()` after init

## Conventions

- <shadcn/ui: <preset> style, `<asChild | render>` pattern — only if shadcn chosen>
- <Tauri capabilities: per-window JSON files in `src-tauri/capabilities/` — only if multi-window>

## Tauri

- Always use /tauri-docs before modifying `src-tauri/` or frontend code that calls `@tauri-apps/api`
```

> **Principle**: If Claude can read the answer from a file, it doesn't belong in CLAUDE.md.
> Only project purpose, non-obvious architectural patterns, behavioral rules, and
> skill invocation directives should be documented here.

---

## Step 8: Install Dependencies & Verify

### pnpm build script approval (pnpm v10+)

pnpm v10+ blocks dependency build scripts by default. esbuild (used by Vite) requires
its `postinstall` script to install platform-specific binaries. Add to `package.json`:

```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild"]
}
```

Then install and verify:

```bash
# Install frontend dependencies
pnpm install

# Verify Rust builds
cargo build --manifest-path src-tauri/Cargo.toml

# Verify frontend builds
pnpm build

# Run Vitest (should pass with no tests)
pnpm test
```

If all pass, setup is complete. Inform the user:
- To start dev: `pnpm tauri dev` (or `node scripts/tauri-dev.mjs` for multi-instance)
- For WebView debugging: restart Claude Code for MCP servers, then follow `/tauri-webview-debug`
- For adding tests: follow `/tauri-test-setup`
- For shadcn components: follow `/shadcn`

---

## Multi-Instance Development

When running multiple Tauri instances simultaneously (e.g., git worktrees, parallel projects),
the default ports (Vite 1420, CDP 9222) will conflict. Add a launcher script that auto-detects
free ports and configures all components consistently.

### Setup

Add `scripts/tauri-dev.mjs` to the project:

```javascript
#!/usr/bin/env node
// scripts/tauri-dev.mjs
// Multi-instance dev launcher — finds free ports and starts cargo tauri dev.
// Prevents port conflicts when running multiple Tauri instances (worktrees, projects).
//
// Usage:
//   node scripts/tauri-dev.mjs          (auto-detect free ports)
//   pnpm dev:tauri                      (via package.json script)

import net from "node:net";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const VITE_BASE = 1420;
const CDP_BASE = 9222;
// Why step of 10: leaves room for HMR (+1) and future ports without overlap
const PORT_STEP = 10;
const MAX_ATTEMPTS = 10;

function isPortFree(port) {
  return new Promise((res) => {
    const server = net.createServer();
    server.once("error", () => res(false));
    server.listen(port, "127.0.0.1", () => server.close(() => res(true)));
  });
}

async function findFreePort(base) {
  // Why sequential scan: gives predictable, memorable ports (1420 → 1430 → 1440)
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = base + i * PORT_STEP;
    if (await isPortFree(port)) return port;
  }
  // Fallback: let OS pick
  return new Promise((res) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => res(port));
    });
  });
}

function updateMcpJson(cdpPort) {
  const mcpPath = resolve(".mcp.json");
  if (!existsSync(mcpPath)) return;

  try {
    const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
    const cdpUrl = `http://127.0.0.1:${cdpPort}`;
    let changed = false;

    for (const [key, flag] of [
      ["playwright-cdp", "--cdp-endpoint"],
      ["chrome-devtools-cdp", "--browserUrl"],
    ]) {
      const args = mcp.mcpServers?.[key]?.args;
      if (!args) continue;
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1] !== cdpUrl) {
        args[idx + 1] = cdpUrl;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + "\n");
      console.log(`  .mcp.json updated → CDP ${cdpUrl}`);
      console.log("  Restart Claude Code to pick up the new MCP config\n");
    }
  } catch {
    // .mcp.json parse error — skip
  }
}

async function main() {
  const vitePort = await findFreePort(VITE_BASE);
  const cdpPort = await findFreePort(CDP_BASE);

  console.log(`\n  Vite  → http://localhost:${vitePort}`);
  console.log(`  CDP   → http://127.0.0.1:${cdpPort}\n`);

  updateMcpJson(cdpPort);

  // Why --config: overrides devUrl via JSON Merge Patch (RFC 7396)
  // without modifying tauri.conf.json on disk
  const configOverride = JSON.stringify({
    build: { devUrl: `http://localhost:${vitePort}` },
  });

  const child = spawn("cargo", ["tauri", "dev", "--config", configOverride], {
    env: {
      ...process.env,
      TAURI_DEV_PORT: String(vitePort),
      TAURI_CDP_PORT: String(cdpPort),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

main();
```

Add the npm script to `package.json`:

```json
{
  "scripts": {
    "dev:tauri": "node scripts/tauri-dev.mjs"
  }
}
```

### How It Works

```
node scripts/tauri-dev.mjs
  │
  ├─ Scan ports: 1420 → 1430 → 1440 ... (step 10)
  ├─ Scan ports: 9222 → 9232 → 9242 ... (step 10)
  ├─ Update .mcp.json CDP URLs (if exists and port changed)
  ├─ Set env: TAURI_DEV_PORT, TAURI_CDP_PORT, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  └─ cargo tauri dev --config '{"build":{"devUrl":"http://localhost:<port>"}}'
       │
       ├─ beforeDevCommand (pnpm dev) → Vite reads TAURI_DEV_PORT
       └─ WebView2 opens devUrl (overridden via --config)
```

> **`.mcp.json` note**: The script updates `.mcp.json` automatically when the CDP port
> changes from the current config. However, MCP server configs are fixed at session start —
> **restart Claude Code** after port changes for the MCP tools to connect to the correct port.

---

## Checklist Summary

1. [ ] Gather inputs (name, identifier, stack, shadcn, multi-window)
2. [ ] Scaffold with `create-tauri-app` (merge into existing dir if needed)
3. [ ] Rename all scaffold references (tauri.conf.json, Cargo.toml, main.rs, package.json)
4. [ ] .gitattributes — BEFORE first `git add` (protects scaffold icons from corruption)
5. [ ] tsconfig.json — path alias + strict mode
6. [ ] vite.config.ts — plugins, alias, multi-page (if needed), dev server
7. [ ] vitest.config.ts — jsdom, alias, setup file
8. [ ] biome.json — formatter + linter + Tailwind directives
9. [ ] Cargo.toml — remove `staticlib` from crate-type, clippy lints, release profile
10. [ ] .cargo/config.toml — Windows MSVC + PDB + backtrace + `jobs = 2`
11. [ ] rustfmt.toml
12. [ ] shadcn/ui init (if chosen) — `--base` + `--preset` flags, verify `@/` alias sync
13. [ ] package.json — `pnpm.onlyBuiltDependencies: ["esbuild"]` (pnpm v10+)
14. [ ] Show-gate CSS pattern — HTML class + CSS rules + JS gate
15. [ ] Tauri capabilities — per-window JSON (if multi-window)
16. [ ] /tauri-test-setup — Setup Checklist (vitest setup, mocks)
17. [ ] /tauri-webview-debug — Step 0 (.mcp.json)
18. [ ] CLAUDE.md — overview, architecture, conventions, /tauri-docs directive (no tech stack)
19. [ ] `scripts/tauri-dev.mjs` — multi-instance dev launcher + `dev:tauri` npm script
20. [ ] Install dependencies + verify build
