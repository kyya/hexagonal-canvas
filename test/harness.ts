// Shared by the end-to-end tests and the cell-storybook skill: starts a private copy of the app
// (server + Vite on free ports, pointed at a fixture $HOME), provides stand-in processes for live
// sessions, loads Playwright, and knows the canvas hex geometry.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiSession } from "../src/live.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Hex geometry, kept in step with src/index.ts (side 64, pointy-top, odd rows shifted right).
export const SIDE = 64;
export const HEX_RADIUS = Math.cos(Math.PI / 6) * SIDE;
export const HEX_HEIGHT = Math.sin(Math.PI / 6) * SIDE;
export const RECT_W = 2 * HEX_RADIUS;
export const RECT_H = SIDE + 2 * HEX_HEIGHT;
export const ROW_STEP = SIDE + HEX_HEIGHT;
// The canvas renders at twice its CSS size (src/index.ts outputScale).
export const OUTPUT_SCALE = 2;

export function hexCentre(col: number, row: number): { x: number; y: number } {
  const parity = ((row % 2) + 2) % 2;
  return { x: col * RECT_W + parity * HEX_RADIUS + HEX_RADIUS, y: row * ROW_STEP + SIDE };
}

// Playwright is not a project dependency: use a local copy if there is one, else the global install.
export function loadPlaywright(): typeof import("playwright") {
  const require = createRequire(import.meta.url);
  const candidates = ["playwright", "@playwright/test"];
  for (const name of candidates) {
    try {
      return require(name);
    } catch {
      // try the next one
    }
  }
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    for (const name of candidates) {
      try {
        return require(join(globalRoot, name));
      } catch {
        // try the next one
      }
    }
  } catch {
    // npm missing
  }
  throw new Error("Playwright not found. Install it with `npm i -g playwright && npx playwright install chromium`.");
}

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

export type App = {
  base: string;
  logs: string[];
  // A long-running process whose pid can back a live session; stopped with the app.
  standIn(): ChildProcess;
  sessions(): Promise<ApiSession[]>;
  waitForSessions(predicate: (sessions: ApiSession[]) => boolean, what: string, timeoutMs?: number): Promise<ApiSession[]>;
  // Stop and restart only the API server (Vite keeps running), to test a dropped connection.
  stopServer(): Promise<void>;
  startServer(): void;
  stop(): void;
};

export async function startApp(home: string): Promise<App> {
  const children: ChildProcess[] = [];
  const logs: string[] = [];
  const track = (child: ChildProcess) => {
    children.push(child);
    child.stdout?.on("data", (data) => logs.push(String(data)));
    child.stderr?.on("data", (data) => logs.push(String(data)));
    return child;
  };
  const apiPort = await freePort();
  const webPort = await freePort();
  // Only the fixture's own session registries count as live, never the machine's real processes.
  const env = { ...process.env, HOME: home, HEX_API_PORT: String(apiPort), HEX_SCAN_PROCESSES: "0" };
  const spawnIn = (command: string, args: string[]) =>
    track(spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] }));
  const startServer = () => spawnIn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"]);
  let server = startServer();
  spawnIn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(webPort), "--strictPort"]);
  const base = `http://127.0.0.1:${webPort}`;

  const sessions = async (): Promise<ApiSession[]> => {
    const response = await fetch(`${base}/api/sessions`);
    if (!response.ok) throw new Error(`GET /api/sessions → ${response.status}`);
    return ((await response.json()) as { sessions: ApiSession[] }).sessions;
  };

  const waitForSessions: App["waitForSessions"] = async (predicate, what, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const list = await sessions();
        if (predicate(list)) return list;
        last = `${list.length} sessions`;
      } catch (error) {
        last = String(error);
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(`Timed out waiting for ${what} (last: ${last})\n${logs.join("")}`);
  };

  const stop = () => {
    for (const child of children) if (child.exitCode === null) child.kill();
  };
  // Never leave a server, Vite or stand-in behind, even on Ctrl-C or a crash.
  process.once("exit", stop);
  if (process.listenerCount("SIGINT") === 0) process.once("SIGINT", () => process.exit(130));

  return {
    base,
    logs,
    standIn: () => track(spawn("sleep", ["3600"], { stdio: "ignore" })),
    sessions,
    waitForSessions,
    async stopServer() {
      if (server.exitCode !== null) return;
      const exited = new Promise((done) => server.once("exit", done));
      server.kill();
      await exited;
    },
    startServer() {
      server = startServer();
    },
    stop,
  };
}
