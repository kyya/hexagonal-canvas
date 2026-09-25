// Cell storybook: renders every visual state of a hex cell in isolation and lays the crops out on a
// contact sheet, like a component storybook for the canvas.
//
//   node --experimental-strip-types .claude/skills/cell-storybook/scripts/storybook.ts [options]
//
//   --out <dir>        where to write the sheet, crops and manifest (default: storybook-out/)
//   --agents a,b,...   agents for the history row (default: all adapters)
//   --zoom <n>         canvas zoom used for the crops (default: 2.5)
//   --frames <n>       frames captured for animated states (default: 4)
//   --interval <ms>    time between frames (default: 300)
//   --keep             keep the temporary $HOME for inspection
//
// It never touches the real $HOME or a running `pnpm dev`: sessions come from a throwaway fixture
// HOME, live processes are `sleep` children, and the server + Vite run on their own ports.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { place, type ApiSession } from "../../../../src/live.ts";
import { HISTORY_AGENTS, registerLive, writeFixtures, type Story } from "./fixtures.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Hex geometry, kept in step with src/index.ts.
const SIDE = 64;
const HEX_RADIUS = Math.cos(Math.PI / 6) * SIDE;
const HEX_HEIGHT = Math.sin(Math.PI / 6) * SIDE;
const RECT_W = 2 * HEX_RADIUS;
const RECT_H = SIDE + 2 * HEX_HEIGHT;
const ROW_STEP = SIDE + HEX_HEIGHT;

function hexCentre(col: number, row: number): { x: number; y: number } {
  const parity = ((row % 2) + 2) % 2;
  return { x: col * RECT_W + parity * HEX_RADIUS + HEX_RADIUS, y: row * ROW_STEP + SIDE };
}

type Options = { out: string; agents: string[]; zoom: number; frames: number; interval: number; keep: boolean };

function parseArgs(argv: string[]): Options {
  const options: Options = {
    out: join(ROOT, "storybook-out"),
    agents: [...HISTORY_AGENTS],
    zoom: 2.5,
    frames: 4,
    interval: 300,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--out") options.out = resolve(next());
    else if (arg === "--agents") options.agents = next().split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--zoom") options.zoom = Number(next());
    else if (arg === "--frames") options.frames = Math.max(1, Number(next()));
    else if (arg === "--interval") options.interval = Number(next());
    else if (arg === "--keep") options.keep = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

// Playwright is not a project dependency: use a local copy if there is one, else the global install.
function loadPlaywright(): typeof import("playwright") {
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

function freePort(): Promise<number> {
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

const children: ChildProcess[] = [];

function start(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
}

function stopAll(): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

async function waitForSessions(url: string, expected: number): Promise<ApiSession[]> {
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const payload = (await response.json()) as { sessions: ApiSession[] };
        last = `${payload.sessions.length} sessions`;
        if (payload.sessions.length >= expected) return payload.sessions;
      }
    } catch (error) {
      last = String(error);
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`Server never reported ${expected} sessions (last: ${last})`);
}

type Crop = { story: Story; col: number; row: number; frames: string[]; missing: boolean };

function sheetHtml(crops: Crop[], options: Options): string {
  const figure = (src: string, caption: string) =>
    `<figure><img src="data:image/png;base64,${src}"/><figcaption>${caption}</figcaption></figure>`;
  const live = crops.filter((crop) => crop.story.state !== "history");
  const history = crops.filter((crop) => crop.story.state === "history");
  const liveRows = live
    .map((crop) => {
      const animated = crop.story.state === "busy" || crop.story.state === "waiting";
      const frames = animated ? crop.frames : crop.frames.slice(0, 1);
      const extra = crop.story.waitingFor ? ` <small>waitingFor: ${crop.story.waitingFor}</small>` : "";
      return `<section><h2>${crop.story.label}${extra}</h2><div class="row">${frames
        .map((src, i) => figure(src, animated ? `第 ${i + 1} 帧 · +${i * options.interval}ms` : "静态"))
        .join("")}</div></section>`;
    })
    .join("");
  const historyGrid = history
    .map((crop) => figure(crop.frames[0] ?? "", crop.missing ? `${crop.story.agent} ⚠ 未出现在画布上` : crop.story.agent))
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:24px;font:14px system-ui,sans-serif;background:#f6f6f6;color:#222}
    h1{font-size:18px;margin:0 0 4px}p.meta{margin:0 0 12px;color:#888;font-size:12px}
    h2{font-size:15px;margin:18px 0 8px}small{color:#999;font-weight:400;font-size:12px}
    .row,.grid{display:flex;gap:12px;flex-wrap:wrap}
    figure{margin:0;background:#fff;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden}
    img{display:block;width:200px;margin:0 auto}figcaption{font-size:11px;color:#888;text-align:center;padding:4px 6px}
  </style></head><body>
    <h1>Hex cell storybook</h1>
    <p class="meta">zoom ${options.zoom}× · ${options.frames} 帧 / ${options.interval}ms · ${new Date().toISOString()}</p>
    ${liveRows}
    <section><h2>历史会话 · 各家 agent</h2><div class="grid">${historyGrid}</div></section>
  </body></html>`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const home = mkdtempSync(join(tmpdir(), "hex-storybook-"));
  const stories = writeFixtures(home, options.agents);

  // Live sessions need a real, running pid; a long `sleep` stands in for the agent process.
  for (const story of stories.filter((item) => item.state !== "history")) {
    const sleeper = start("sleep", ["3600"], process.env);
    if (!sleeper.pid) throw new Error("could not start a stand-in process");
    registerLive(home, story, sleeper.pid);
  }

  const apiPort = await freePort();
  const webPort = await freePort();
  const env = { ...process.env, HOME: home, HEX_API_PORT: String(apiPort) };
  const logs: string[] = [];
  const server = start(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], env);
  const vite = start(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(webPort), "--strictPort"], env);
  for (const child of [server, vite]) {
    child.stdout?.on("data", (data) => logs.push(String(data)));
    child.stderr?.on("data", (data) => logs.push(String(data)));
  }

  try {
    const base = `http://127.0.0.1:${webPort}`;
    const sessions = await waitForSessions(`${base}/api/sessions`, stories.length);
    const layout = place(sessions);
    const byId = new Map(layout.sessions.map((session) => [session.id, session]));

    // One viewport that holds the whole cluster at the target zoom; every cell is cropped from it.
    const centres = layout.sessions.map((session) => hexCentre(session.col, session.row));
    const margin = RECT_W;
    const minX = Math.min(...centres.map((c) => c.x)) - margin;
    const maxX = Math.max(...centres.map((c) => c.x)) + margin;
    const minY = Math.min(...centres.map((c) => c.y)) - margin;
    const maxY = Math.max(...centres.map((c) => c.y)) + margin;
    const width = Math.ceil((maxX - minX) * options.zoom);
    const height = Math.ceil((maxY - minY) * options.zoom);
    const camera = { x: minX, y: minY, zoom: options.zoom };

    const { chromium } = loadPlaywright();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.addInitScript((value: string) => {
      localStorage.setItem("hexagonal-canvas.camera", value);
    }, JSON.stringify(camera));
    const page = await context.newPage();
    await page.goto(base);
    // Icons load asynchronously and live cells pop in; give both time to settle.
    await page.waitForTimeout(3000);

    const shots: Buffer[] = [];
    for (let i = 0; i < options.frames; i++) {
      shots.push(await page.screenshot());
      if (i < options.frames - 1) await page.waitForTimeout(options.interval);
    }

    // Cut each cell out of every frame as a hexagon with transparent corners: the corners of a hex's
    // bounding box belong to its neighbours, whose rings and icons would otherwise leak into the crop.
    // Cropping from shared frames keeps all cells on the same animation clock.
    const cellW = Math.round(RECT_W * options.zoom);
    const cellH = Math.round(RECT_H * options.zoom);
    const cropPage = await browser.newPage({ viewport: { width: cellW, height: cellH } });
    const crops: Crop[] = stories.map((story) => {
      const session = byId.get(story.id);
      return { story, col: session?.col ?? 0, row: session?.row ?? 0, frames: [], missing: !session };
    });
    for (const shot of shots) {
      await cropPage.setContent(`<html><body style="margin:0;background:transparent">
        <div id="hex" style="position:absolute;left:0;top:0;width:${cellW}px;height:${cellH}px;overflow:hidden;
          clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)">
          <img id="frame" style="position:absolute" src="data:image/png;base64,${shot.toString("base64")}">
        </div></body></html>`);
      await cropPage.waitForFunction(() => (document.getElementById("frame") as HTMLImageElement | null)?.complete);
      for (const crop of crops) {
        if (crop.missing) continue;
        const centre = hexCentre(crop.col, crop.row);
        const left = Math.round((centre.x - HEX_RADIUS - camera.x) * options.zoom);
        const top = Math.round((centre.y - RECT_H / 2 - camera.y) * options.zoom);
        await cropPage.evaluate(
          ([x, y]) => {
            const image = document.getElementById("frame") as HTMLImageElement;
            image.style.left = `${-x}px`;
            image.style.top = `${-y}px`;
          },
          [left, top],
        );
        const png = await cropPage.screenshot({ clip: { x: 0, y: 0, width: cellW, height: cellH }, omitBackground: true });
        crop.frames.push(png.toString("base64"));
      }
    }

    mkdirSync(options.out, { recursive: true });
    const manifest = crops.map((crop) => {
      const name = `${crop.story.state}-${crop.story.agent}`;
      // Only animated states need every frame; static ones keep the first.
      if (crop.story.state !== "busy" && crop.story.state !== "waiting") crop.frames = crop.frames.slice(0, 1);
      crop.frames.forEach((frame, i) => writeFileSync(join(options.out, `${name}-${i + 1}.png`), Buffer.from(frame, "base64")));
      return {
        id: crop.story.id,
        agent: crop.story.agent,
        state: crop.story.state,
        label: crop.story.label,
        cell: { col: crop.col, row: crop.row },
        missing: crop.missing,
        files: crop.frames.map((_, i) => `${name}-${i + 1}.png`),
      };
    });
    writeFileSync(join(options.out, "manifest.json"), JSON.stringify(manifest, null, 2));

    const sheet = await browser.newPage({ viewport: { width: 1100, height: 600 } });
    await sheet.setContent(sheetHtml(crops, options));
    await sheet.screenshot({ path: join(options.out, "sheet.png"), fullPage: true });
    await browser.close();

    const missing = crops.filter((crop) => crop.missing).map((crop) => crop.story.id);
    console.log(`sheet: ${join(options.out, "sheet.png")}`);
    console.log(`cells: ${crops.length - missing.length}/${crops.length}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
  } catch (error) {
    console.error(logs.join(""));
    throw error;
  } finally {
    stopAll();
    if (options.keep) console.log(`fixture HOME kept at ${home}`);
    else rmSync(home, { recursive: true, force: true });
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  stopAll();
  process.exit(1);
});
