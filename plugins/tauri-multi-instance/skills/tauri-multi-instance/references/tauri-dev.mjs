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
import { resolve, sep } from "node:path";

const VITE_BASE = 1420;
const CDP_BASE = 9222;
// Why step of 10: leaves room for HMR (+1) and future ports without overlap
const PORT_STEP = 10;
const MAX_ATTEMPTS = 10;

// Probe both families: Vite binds "localhost" (::1 or 127.0.0.1 per OS);
// single-family check false-positives and Vite fails EADDRINUSE.
function isPortFree(port) {
  return Promise.all([
    isPortFreeOn(port, "127.0.0.1"),
    isPortFreeOn(port, "::1"),
  ]).then(([v4, v6]) => v4 && v6);
}

function isPortFreeOn(port, host) {
  return new Promise((res) => {
    const server = net.createServer();
    // EADDRNOTAVAIL: family unavailable — Vite can't use it either.
    server.once("error", (err) => res(err.code === "EADDRNOTAVAIL"));
    server.listen(port, host, () => server.close(() => res(true)));
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
    const original = readFileSync(mcpPath, "utf-8");
    const cdpUrl = `http://127.0.0.1:${cdpPort}`;
    // Why regex over JSON.parse/stringify: round-tripping forces the file
    // through `JSON.stringify(..., null, 2)`, which hardcodes 2-space indent
    // and LF line endings — overwriting whatever formatting the user has
    // (tabs, CRLF, etc.) and producing a noisy working-tree diff every run.
    // We only need to swap the URL after each known flag, so a targeted
    // replacement leaves indent, line endings, key order, and trailing
    // whitespace byte-identical.
    const next = original.replace(
      /("(?:--cdp-endpoint|--browserUrl)"\s*,\s*")http:\/\/127\.0\.0\.1:\d+(")/g,
      `$1${cdpUrl}$2`,
    );
    if (next !== original) {
      writeFileSync(mcpPath, next);
      console.log(`  .mcp.json updated → CDP ${cdpUrl}`);
      console.log("  Restart Claude Code to pick up the new MCP config\n");
    }
  } catch {
    // .mcp.json I/O error — skip
  }
}

// Derive ID from `.worktrees/<...>` segments. Empty when run from the main repo.
// Consumers suffix mutex/AppData/window-class names with this under cfg(debug_assertions).
function deriveInstanceId() {
  if (process.env.TAURI_INSTANCE_ID) return process.env.TAURI_INSTANCE_ID;
  const segs = process.cwd().split(sep);
  const idx = segs.indexOf(".worktrees");
  if (idx === -1 || idx === segs.length - 1) return "";
  return segs
    .slice(idx + 1)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function main() {
  const vitePort = await findFreePort(VITE_BASE);
  const cdpPort = await findFreePort(CDP_BASE);
  const instanceId = deriveInstanceId();

  console.log(`\n  Vite  → http://localhost:${vitePort}`);
  console.log(`  CDP   → http://127.0.0.1:${cdpPort}`);
  if (instanceId) {
    console.log(`  Inst  → ${instanceId}  (TAURI_INSTANCE_ID)`);
  }
  console.log("");

  updateMcpJson(cdpPort);

  // Why --config: overrides devUrl via JSON Merge Patch (RFC 7396)
  // without modifying tauri.conf.json on disk
  const configOverride = JSON.stringify({
    build: { devUrl: `http://localhost:${vitePort}` },
  });

  // Why no shell: configOverride is a JSON string with quotes and braces.
  // shell:true would reserialize argv through cmd.exe and risk quoting
  // corruption; direct CreateProcess preserves argv verbatim. cargo is a
  // real .exe from rustup, not a .cmd wrapper, so shell:true is unneeded.
  const child = spawn("cargo", ["tauri", "dev", "--config", configOverride], {
    env: {
      ...process.env,
      TAURI_DEV_PORT: String(vitePort),
      // Pass-through: consumers may set TAURI_DEV_HOST for HMR host override.
      // Launcher does not assign a value but must propagate the contract var.
      TAURI_DEV_HOST: process.env.TAURI_DEV_HOST ?? "",
      TAURI_CDP_PORT: String(cdpPort),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      TAURI_INSTANCE_ID: instanceId,
    },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

main();
