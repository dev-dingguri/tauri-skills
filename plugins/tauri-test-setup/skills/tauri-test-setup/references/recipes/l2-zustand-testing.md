# L2 Recipe — Zustand Store Testing

Zustand actions that internally call Tauri `invoke` can be tested by
**directly setting store state** instead of replaying actions. This
bypasses the network of mocks and makes conditional-rendering
assertions trivial.

## Why Direct `setState` Over Action Replay

- Actions often chain `invoke` → `set` → `emit`; replaying them
  requires mocking every intermediate step.
- Tests care about "what does the component render when the store is
  in state X", not "does the action reach state X correctly". The
  latter belongs to an action-level unit test.
- Zustand's `useStore.setState({...})` merges, so you only need to
  specify the fields the component under test actually reads.

## Baseline State in `beforeEach`

Reset to a known baseline before every test. Tests needing a variation
call `setState` again with an override.

```typescript
import { beforeEach } from "vitest";
import { useStore } from "@/stores/store";

beforeEach(() => {
  useStore.setState({
    active: true,
    volume: 0.8,
    firstRun: false,
    // ... other default fields the component(s) under test read
  });
});
```

## Per-Test Override

```typescript
it("shows welcome toast on first run", () => {
  useStore.setState({ firstRun: true });

  render(<WelcomeToast />);

  expect(screen.getByText("Welcome message")).toBeInTheDocument();
});
```

## When to Replay the Action Instead

Direct `setState` is the right default, but **replay the action** when
verifying the action itself — e.g., "saving the volume persists it
via `invoke('set_volume', ...)`". In that case:

1. Spy on `mockInvoke` (from `l2-vitest-mock.md`).
2. Call the action: `await useStore.getState().setVolume(0.3)`.
3. Assert both the store state AND the `invoke` call:
   `expect(mockInvoke).toHaveBeenCalledWith("set_volume", { value: 0.3 })`.

## Cross-Test State Leakage

Zustand stores are **module-level singletons**. Without a reset in
`beforeEach`, state from one test leaks into the next and produces
flaky failures that depend on test order.

If the store has many fields, keep a single `DEFAULT_STATE` constant
and pass it to every `setState` reset:

```typescript
const DEFAULT_STATE = {
  active: true,
  volume: 0.8,
  firstRun: false,
  // ...
};

beforeEach(() => {
  useStore.setState(DEFAULT_STATE, true); // 2nd arg `true` = replace, not merge
});
```

The `true` second arg matters when a previous test added fields the
default doesn't know about — merge would leave them behind.

## Related

- `l2-vitest-mock.md` — how to mock `invoke` when action-replay tests
  need to assert the Tauri call.
- `l2-act-fake-timers.md` — required when store updates fire inside a
  timer (debounce, auto-save, toast auto-dismiss).
