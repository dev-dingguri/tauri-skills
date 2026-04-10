# L2 Recipe — `act()` + Fake Timers

Any React state update triggered by `setTimeout` / `setInterval` —
toast auto-dismiss, debounced input, animation cleanup — must advance
time inside `act()`. Missing `act()` logs the "not wrapped in act(...)"
warning and usually causes assertions to run before the state update
flushes.

## The Pattern

```typescript
import { render, screen, act } from "@testing-library/react";
import { afterEach, it, vi } from "vitest";
import { Toast } from "@/components/Toast";

afterEach(() => {
  // Why restore real timers after every test: fake timers persist
  // across the test module, so a forgotten test can silently freeze
  // timers for unrelated later tests (flaky failures, hung assertions).
  vi.useRealTimers();
});

it("auto-dismisses after 5 seconds", () => {
  vi.useFakeTimers();
  render(<Toast message="saved" />);

  // Why act(): the setTimeout callback inside <Toast> calls setState,
  // which triggers a React re-render. Outside act(), React complains
  // and the assertion below may run against a stale DOM.
  act(() => {
    vi.advanceTimersByTime(5000);
  });

  expect(screen.queryByText("saved")).not.toBeInTheDocument();
});
```

## Fake Timer + Async Code

`vi.useFakeTimers()` stubs `Promise` callbacks too by default in
Vitest v1+. That breaks components that `await invoke(...)` inside a
timer. Opt out for modules that still need real microtasks:

```typescript
vi.useFakeTimers({
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
});
```

This fakes only the four timer functions and leaves `Promise` /
`queueMicrotask` alone.

## Async State Updates

When a timer callback triggers `await` chains, use the async form of
`act` and `vi.advanceTimersByTimeAsync`:

```typescript
it("fetches stats every 30s", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
  render(<StatsPanel />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(await screen.findByText(/1,250 events/)).toBeInTheDocument();
});
```

`advanceTimersByTimeAsync` flushes queued microtasks between timer
fires — critical when the component chains multiple `await` calls.

## Gotcha: Forgetting to Restore Timers

If a test **sets** fake timers but never restores them, the next test
in the same file inherits them. Symptoms: `waitFor(...)` times out
because `setTimeout` in the assertion harness is also stubbed; or a
component mount hangs because `useEffect` cleanup runs on a stalled
timer. Always restore in `afterEach`.

## When You DON'T Need `act()`

- Synchronous user events via `@testing-library/user-event` already
  wrap their dispatches in `act()` internally.
- `render()` itself wraps the initial mount.
- `fireEvent` + synchronous handlers do not need an explicit wrapper.

You need `act()` explicitly **only** when:
1. You advance fake timers that trigger `setState`.
2. You call a store action from outside a component (e.g.,
   `useStore.getState().doThing()`) whose side effects update React
   state elsewhere in the tree.

## Related

- `l2-vitest-mock.md` — the `listen` mock returns a no-op `unlisten`;
  without it, a timer that cleans up a listener throws on unmount.
- `l2-zustand-testing.md` — store updates inside timer callbacks.
