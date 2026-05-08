# L2 Recipe — Tauri API Mock Triple (Vitest + RTL)

Every Tauri v2 frontend test touching `@tauri-apps/api/*` must mock
three modules: `core` (for `invoke`), `event` (for `emit` / `listen`),
and `window` (for `getCurrentWindow`). Missing any one causes a hard
crash in `useEffect` paths that rely on it.

## The Mock Triple

```typescript
// src/test/setup.ts (or per-test file)
import { vi } from "vitest";

// --- 1. @tauri-apps/api/core ---
// Why extract mockInvoke to a module-level variable: allows each test to
// override invoke() return values via mockInvoke.mockImplementation(...)
// without re-declaring the mock. Inlining the fn inside vi.mock() locks
// the implementation at factory time.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// --- 2. @tauri-apps/api/event ---
// Why mockResolvedValue(() => {}): listen() returns Promise<UnlistenFn>.
// Components typically await it and store the result; returning undefined
// here causes `unlisten.then()` TypeError on unmount.
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// --- 3. @tauri-apps/api/window ---
// Why all methods return vi.fn() (not undefined): components chain calls
// like `getCurrentWindow().hide()`. Returning undefined breaks the chain.
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    hide: vi.fn(),
    destroy: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    setFocus: vi.fn(),
  })),
}));

export { mockInvoke };
```

## Per-Command Mock Data

Define invoke responses in `beforeEach` so every test starts from a
known baseline. Use a `switch` instead of `mockResolvedValueOnce` — the
latter is order-dependent and brittle when components fire multiple
`invoke` calls on mount.

```typescript
import { beforeEach } from "vitest";
import { mockInvoke } from "@/test/setup";

beforeEach(() => {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_settings":
        return Promise.resolve({ active: true, volume: 0.8 });
      case "get_stats":
        return Promise.resolve({ elapsed: 3720, count: 1250 });
      default:
        // Why Promise.resolve(undefined) not reject: components that fire
        // fire-and-forget invokes (logging, analytics) should not throw
        // just because the test didn't mock them.
        return Promise.resolve(undefined);
    }
  });
});
```

## Per-Test Override

Override one command without rewriting the switch:

```typescript
it("shows error when get_settings fails", async () => {
  mockInvoke.mockImplementationOnce((cmd: string) => {
    if (cmd === "get_settings") {
      return Promise.reject(new Error("store corrupt"));
    }
    return Promise.resolve(undefined);
  });

  render(<SettingsPanel />);
  expect(await screen.findByText(/store corrupt/i)).toBeInTheDocument();
});
```

`mockImplementationOnce` applies to the next call only — subsequent
`invoke` calls fall through to the `beforeEach` default.

## Related

- `l2-zustand-testing.md` — state injection when the component reads
  from a Zustand store instead of calling `invoke` directly.
- `l2-act-fake-timers.md` — how to handle timer-driven state updates
  triggered by `invoke` responses.
