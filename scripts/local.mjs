#!/usr/bin/env node
// Runs Post Sync on this computer and makes it reachable at PUBLIC_BASE_URL through a Cloudflare Tunnel:
//   npm run local
// Ctrl+C waits for posts that are publishing, then stops the server and the tunnel. See docs/LOCAL.md.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(envFile)) fail("No .env file yet. Copy .env.example to .env and fill it in (see docs/LOCAL.md).");
process.loadEnvFile(envFile);

const publicUrl = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
const token = (process.env.CLOUDFLARE_TUNNEL_TOKEN ?? "").trim();
const port = Number(process.env.PORT || 3000);
if (!/^https:\/\//.test(publicUrl)) fail("Set PUBLIC_BASE_URL in .env to your tunnel's address, e.g. https://social.example.com");
if (!token) fail("Set CLOUDFLARE_TUNNEL_TOKEN in .env (Cloudflare > Zero Trust > Networks > Tunnels; see docs/LOCAL.md).");

if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error) {
  fail(
    "cloudflared isn't installed.\n" +
      "  macOS:   brew install cloudflared\n" +
      "  Windows: winget install --id Cloudflare.cloudflared\n" +
      "  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
  );
}

// Own process groups (macOS/Linux): Ctrl+C reaches only this script, which stops things in the right order.
const detached = process.platform !== "win32";
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsx)) fail("Dependencies are missing. Run `npm install` once, then try again.");

const server = spawn(process.execPath, [tsx, "--conditions=post-sync-source", "apps/dashboard/src/index.ts"], {
  cwd: root,
  stdio: "inherit",
  detached,
  // The tunnel connects from this computer: believe its X-Forwarded-For so the login lockout sees real visitors.
  env: { ...process.env, INIT_CWD: root, PORT: String(port), TRUST_PROXY: process.env.TRUST_PROXY || "loopback" },
});

let tunnel = null;
let stopping = false;

function stop() {
  if (stopping) {
    // Second Ctrl+C: stop everything now.
    server.kill("SIGINT");
    tunnel?.kill("SIGTERM");
    return;
  }
  stopping = true;
  console.log("\nStopping: waiting for posts that are publishing to finish (press Ctrl+C again to stop now)…");
  // The tunnel stays up meanwhile: Instagram and Threads download media from it while they publish.
  // (On Windows the console already sent Ctrl+C to the server itself.)
  if (detached) server.kill("SIGINT");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) return true;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

server.on("exit", (code) => {
  if (tunnel && tunnel.exitCode === null) tunnel.kill("SIGTERM");
  if (!stopping) console.error("\nThe server stopped unexpectedly (see the messages above).");
  process.exit(code ?? 0);
});

if (!(await waitFor(`http://127.0.0.1:${port}/healthz`, 60))) {
  if (server.exitCode === null) server.kill("SIGTERM");
  fail("The server didn't start (see the messages above).");
}

// The token goes in the environment, not the command line, so it doesn't show up in process lists.
tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "run"], {
  stdio: ["ignore", "ignore", "pipe"],
  detached,
  env: { ...process.env, TUNNEL_TOKEN: token },
});
let tunnelLog = "";
tunnel.stderr.on("data", (chunk) => (tunnelLog = (tunnelLog + chunk).slice(-4000)));
tunnel.on("exit", () => {
  if (!stopping) console.error(`\nThe tunnel stopped:\n${tunnelLog}\nPress Ctrl+C to stop the server too.`);
});

if (await waitFor(`${publicUrl}/healthz`, 45)) {
  console.log(`\n  Post Sync is ready: ${publicUrl}`);
  console.log(`  (Videos over 100 MB: upload them at http://localhost:${port} instead; Cloudflare limits uploads.)`);
  console.log("  When you're done: wait until Posts shows everything as published, then press Ctrl+C.\n");
} else {
  console.error(
    `\nThe server runs at http://localhost:${port}, but ${publicUrl} doesn't reach it yet.\n` +
      "Check the tunnel's public hostname in Cloudflare points to http://localhost:" + port + ".\n" + tunnelLog,
  );
}
