---
name: tauri-test-generator
description: >-
  Use when generating tests for a Tauri v2 app — discovers user journeys from
  code, identifies coverage gaps, and generates test code at the right layer.
  Trigger on: "generate tests", "test generation", "missing tests",
  "coverage gap", "add tests for [feature]" in a project with src-tauri/.
---

# Tauri Test Generator

> **Platform note:** L2 tests are cross-platform, but L3/L4 patterns (CDP, pywinauto, UIA)
> have only been tested on Windows. macOS/Linux equivalents are unverified.

Generate the right tests at the right layer by first understanding user journeys.
Write for **user outcomes**, not code coverage — then map each journey step to
the cheapest layer that verifies it. The L1–L4 layer model is inlined below;
invoke `tauri-test-setup` only for mock recipes and hybrid test infrastructure.

## When to Use

Adding tests to a Tauri app, running a coverage audit, or generating tests after
a feature ships. **Not for:** setting up test infrastructure from scratch — use
`tauri-test-setup`.

## Layer Model

Every journey step maps to one of four test layers. This decides the tool, the
effort, and whether automation is possible at all.

| Layer | Tool | Coverage | Examples |
|---|---|---|---|
| **L1 — Pure Logic** | Rust `#[test]` / Vitest | State machines, calculations, serialization | Data aggregation, debounce, config parsing |
| **L2 — Frontend Rendering** | Vitest + RTL + Tauri mock | React components, stores, conditional UI | Card rendering, toast lifecycle, slider defaults |
| **L3 — WebView Integration** | Playwright / Chrome DevTools MCP (CDP) | Live DOM, screenshots, console errors | Multi-window layout, CSS transition, a11y audit |
| **L4 — OS Integration** | Python pytest + pywinauto (partial) / Manual | Global key hooks, tray, registry, audio | OS hotkeys, tray menu, autostart, device detection |

### Classification Criteria

- **Frontend code calling Tauri `invoke`** → L2 (mock invoke)
- **Code depending on Tauri events (`listen` / `emit`)** → L2 (mock listen)
- **Code using `@tauri-apps/api/window`** → L2 (mock getCurrentWindow)
- **Plain JS + Canvas outside React** (e.g., `overlay.html`) → L3 or L4:
  - Verify canvas rendering only → L3 (CDP screenshot)
  - OS-level input trigger (rdev, etc.) → L4 — CDP `press_key` fires
    WebView-internal events only
- **Direct OS API calls** (registry, audio devices, system tray) → L4
- **Journey spanning OS trigger → WebView UI** → L3+L4 hybrid

## Workflow

Phase 1 Journey Discovery → Phase 2 Coverage Gap Analysis → Phase 3 Prioritize Gaps → Phase 4 Generate Tests → Report.

### Phase 1: Journey Discovery

Discover user journeys by scanning **four sources** in the codebase:

| Source | How to find | What it reveals |
|--------|-------------|-----------------|
| Tauri commands | `grep '#\[tauri::command\]'` in `src-tauri/src/` | Backend capabilities — group related commands into journeys |
| Store actions | Read Zustand store — find methods calling `invoke()` or `emit()` | Frontend-initiated journey steps |
| Entry points | List all HTML files (`index.html`, `pages/*.html`) | Each window = separate test surface |
| Event listeners | `grep 'listen('` in frontend | Backend-to-frontend events = reactive journey steps |

**Grouping commands into journeys:** Commands that share state or fire in
sequence belong to the same journey. Also look for startup journeys, error /
fallback paths, and unused commands (flag the latter as findings).

**Output a journey table** (each step must note the frontend action, the IPC
call if any, and the backend effect):

```markdown
| ID | Journey | Steps (action → IPC → effect) | Entry Point |
|----|---------|-------------------------------|-------------|
| J-01 | Soundpack switch | See list → select → invoke switch_soundpack → persist → play new | main |
```

**Identifying L3+L4 hybrid journeys:** Some journeys cross the OS/WebView boundary
within a single flow. Mark these as `L3+L4` in the Layer column when you see:

| Signal | Example |
|--------|---------|
| OS trigger → WebView UI manipulation | Tray menu → settings toggle |
| WebView UI → OS side-effect verification | Switch click → registry change |
| WebView element not in UIA tree | Radix Switch, Shadow DOM, Canvas controls |

### Phase 2: Coverage Gap Analysis

For each journey step, check if an **existing test** already covers it.

1. Read all test files: `*.test.ts(x)`, `*.spec.ts`, Rust `#[cfg(test)]` modules
2. Map each test → the journey step it verifies
3. Mark uncovered steps as gaps

**Output a coverage matrix:**

```markdown
| Journey | Step | Existing Test | Layer | Status |
|---------|------|---------------|-------|--------|
| J-01 | UI renders 3 cards | qa-phase1beta.test.tsx QA#5 | L2 | Covered |
| J-01 | Persist to settings.json | (none) | L1 | Gap |
| J-01 | New sound plays on keypress | (cannot automate) | L4 | Manual |
```

### Phase 3: Prioritize Gaps

Score each gap to decide what to write first:

| Factor | High | Low |
|--------|------|-----|
| **User impact** | Core journey (daily use) | Edge case (rare trigger) |
| **Failure cost** | Data loss, crash, silent corruption | Cosmetic, recoverable |
| **Ease of test** | Mock infra exists, pattern available | Needs new infra or OS setup |

**Rule:** High impact + easy → write now. High impact + hard → document as manual QA. Low impact → skip unless specifically requested.

### Phase 4: Generate Tests

For each prioritized gap:

1. **Assign the layer** using the Classification Criteria from the Layer Model section above.
2. **Find existing patterns** before writing code: locate a test file at the
   **same layer** testing a **similar feature**, copy its structure (imports,
   mock setup, beforeEach, assertion style, naming), and adapt for the new step.
   Inconsistent test patterns make maintenance harder than missing tests.
3. **L3+L4 hybrid gaps** — invoke `/tauri-test-setup` for the hybrid recipe
   (connect-after timing, text-based locators, Radix `data-state` checks, and
   OS-assertion placement outside the CDP context).
4. **L4 OS automation gaps** — invoke `/tauri-os-automation` for the
   Automatable-vs-Manual table and Windows gotchas (tray UIA, key hooks,
   polling, menu clicks).

**Test naming:** Match the project. If existing tests use Korean behavior
descriptions, follow that; if English, follow that.

## Output

1. **Journey Coverage Report** (conversation) — all journeys, steps, gaps, priorities
2. **Test code** (files) — tests for prioritized gaps, following project conventions

## Surprising Findings

Flag anything unexpected during analysis — often more valuable than the tests themselves:

- **Unused commands** — Tauri commands with no frontend caller
- **Missing test infrastructure** — e.g., no pattern for mocking `AppHandle` in Rust
- **Hardcoded data that should be dynamic** — e.g., preset lists duplicated front/back
- **Structural gaps** — features where an entire test layer is impossible due to missing infra

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| Jump to writing tests without journey discovery | Tests cover implementation, miss user outcomes | Always run Phase 1 first |
| Write E2E for something testable at L2 | Slow, flaky, hard to maintain | Pick the **cheapest** layer |
| Generate tests that duplicate existing ones | Wasted effort, maintenance burden | Phase 2 gap analysis catches this |
| Hardcode expected values in E2E | Tauri persists state — stale values break tests | Use relative assertions (before → change → verify delta) |
| Invent new mock patterns | Inconsistent tests are worse than no tests | Reuse existing patterns from the project |

**L4 / L3+L4 hybrid mistakes** live with their infrastructure — invoke
`/tauri-os-automation` for L4 OS gotchas (tray UIA, key hooks, polling stability)
or `/tauri-test-setup` for L3+L4 hybrid gotchas (CDP connect-after, `data-testid` rebuild).
