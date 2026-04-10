# Show-Gate Three-Piece Set

Every Tauri window must prevent unfinished rendering from flashing on show.
This pattern is a single unit — HTML class, CSS rules, and JS gate — and all
three must be present. Missing any one piece defeats the protection.

## 1. HTML — class on `<html>`

Set `lang` to the project's primary language.

```html
<html lang="en" class="no-transitions">
```

## 2. CSS — in the main stylesheet

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

## 3. JS — per-window entry script

Each window's entry script must:

1. Await async init (fonts, state fetch, etc.)
2. Remove the `no-transitions` class
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

## Tauri Config Requirement

Each window in `tauri.conf.json` must be declared `visible: false`. The JS
gate is what actually shows the window — removing the class without also
calling `show()` does nothing.
