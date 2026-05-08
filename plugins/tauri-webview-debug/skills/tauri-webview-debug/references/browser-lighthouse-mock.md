# Browser-Direct Lighthouse with `invoke()` Mock

For a **full Lighthouse audit** — accurate Performance metrics (FCP, LCP,
TTFB), full Best Practices, full Accessibility — CDP-over-WebView2 isn't
enough. Local file loading gives zero network latency, so timing metrics are
meaningless, and Tauri-specific APIs break in a regular browser.

Workaround: open Vite's dev server directly in Chrome and inject `invoke()`
mocks via a Vite alias so production builds stay clean.

## Why `invoke()` Fails in a Browser

`window.__TAURI__` only exists inside the Tauri WebView. A plain browser
call to `invoke()` throws — the IPC bridge isn't there:

```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('get_user_data'); // window.__TAURI__ is undefined
```

## Vite Alias Mock Injection

Gate the mock on an env var so it only activates in browser-test mode.
`resolve.alias` resolves at build time, so mock code is never bundled into
production — the conditional runs only when the config loads:

```typescript
// vite.config.ts
const isBrowserTest = process.env.BROWSER_TEST === 'true';

export default defineConfig({
  resolve: {
    alias: isBrowserTest ? {
      '@tauri-apps/api/core': './src/mocks/tauri-core.ts'
    } : {}
  }
});
```

```typescript
// src/mocks/tauri-core.ts
const mockData: Record<string, unknown> = {
  get_user_data: { name: 'Test User', id: 1 },
  // Add dummy data for each invoke command in the project
};

export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  console.warn(`[Mock] invoke('${cmd}') — returning dummy data`);
  return (mockData[cmd] ?? null) as T;
}
```

## Run It

```bash
BROWSER_TEST=true npx vite dev
# Open the printed URL in Chrome and run Lighthouse
```

Dev server port comes from `vite.config.ts` — if the project reads
`TAURI_DEV_PORT` (the multi-instance contract), set that too; otherwise the
Vite default applies.
