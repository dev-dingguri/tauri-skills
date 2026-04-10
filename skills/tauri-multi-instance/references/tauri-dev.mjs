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
    },
    stdio: "inherit",
  });

  child.on("exit", (code) => process.exit(code ?? 1));
}

main();
