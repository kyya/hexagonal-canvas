// A running app + browser for the end-to-end tests, with helpers to find cells on the canvas and
// read what the viewer sees there. Every test file builds its own scene on a fresh fixture $HOME.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { cellGeometry } from "../../src/cells/golden.ts";
import { place, type Layout } from "../../src/live.ts";
import type { Camera } from "../../src/view.ts";
import { HISTORY_AGENTS, registerLive, writeFixtures, type Story } from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre, loadPlaywright, OUTPUT_SCALE, startApp, type App } from "../harness.ts";

export const VIEWPORT = { width: 1600, height: 1000 };
export const geometry = cellGeometry(HEX_RADIUS);
// Live cells pop in with an elastic overshoot (src/cells/pop.ts, 900 ms); let it settle before probing.
const POP_SETTLE_MS = 1200;

export type Rgb = [number, number, number];
export type Tint = "amber" | "blue" | "green" | "none";

// Classify a pixel (already composited over white) by which channel dominates.
export function tintOf([r, g, b]: Rgb): Tint {
  if (r >= 250 && g >= 250 && b >= 250) return "none";
  if (r > g && g > b) return "amber";
  if (b > r && b >= g) return "blue";
  if (g > r && g > b) return "green";
  return "none";
}

export async function eventually<T>(what: string, probe: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | string | undefined;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      last = value;
      if (ok(value)) return value;
    } catch (error) {
      // Not there yet (e.g. the page has not received its first snapshot): keep polling.
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
}

export type Scene = {
  home: string;
  app: App;
  browser: Browser;
  page: Page;
  stories: Story[];
  pids: Map<string, number>;
  pageErrors: string[];
  story(state: Story["state"], agent?: string): Story;
  camera(): Promise<Camera>;
  layout(): Promise<Layout>;
  cellPoint(id: string, dx?: number, dy?: number): Promise<{ x: number; y: number; cssX: number; cssY: number }>;
  worldToCss(x: number, y: number): Promise<{ cssX: number; cssY: number }>;
  pixel(id: string, dx?: number, dy?: number): Promise<{ rgb: Rgb; alpha: number }>;
  pixelAtCss(cssX: number, cssY: number): Promise<{ rgb: Rgb; alpha: number }>;
  tint(id: string): Promise<Tint>;
  badge(id: string): Promise<{ rgb: Rgb; alpha: number }>;
  // Save a screenshot when E2E_SHOTS is set (the verification images for each feature).
  shot(name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void>;
  close(): Promise<void>;
};

export type SceneOptions = {
  // Extra fixtures written before the app starts (other projects, relations…).
  setup?: (home: string) => Story[];
  // Stories to register as live, beyond the default idle / busy / waiting Claude sessions.
  live?: (stories: Story[]) => { story: Story; state: "idle" | "busy" | "waiting"; waitingFor?: string }[];
};

export async function startScene(options: SceneOptions = {}): Promise<Scene> {
  const home = mkdtempSync(join(tmpdir(), "hex-e2e-"));
  let app: App | null = null;
  let browser: Browser | null = null;
  try {
    return await buildScene(home, options, (started) => (app = started), (launched) => (browser = launched));
  } catch (error) {
    // A half-started scene would keep the test process alive: tear down whatever did start.
    await (browser as Browser | null)?.close();
    (app as App | null)?.stop();
    rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

async function buildScene(
  home: string,
  options: SceneOptions,
  onApp: (app: App) => void,
  onBrowser: (browser: Browser) => void,
): Promise<Scene> {
  const stories = writeFixtures(home, HISTORY_AGENTS);
  stories.push(...(options.setup?.(home) ?? []));
  const app = await startApp(home);
  onApp(app);
  const pids = new Map<string, number>();
  const register = (story: Story) => {
    const pid = app.standIn().pid;
    assert.ok(pid, "stand-in process did not start");
    pids.set(story.id, pid);
    registerLive(home, story, pid);
  };
  for (const item of stories.filter((entry) => entry.state !== "history")) register(item);
  for (const extra of options.live?.(stories) ?? []) {
    const live = { ...extra.story, state: extra.state, waitingFor: extra.waitingFor };
    const index = stories.findIndex((item) => item.id === live.id);
    if (index >= 0) stories[index] = live;
    register(live);
  }
  await app.waitForSessions((list) => list.length >= stories.length, "every fixture session");

  // Centre the camera on everything so every cell is on screen.
  const layout = place(await app.sessions());
  const centres = layout.sessions.map((session) => hexCentre(session.col, session.row));
  const midX = (Math.min(...centres.map((c) => c.x)) + Math.max(...centres.map((c) => c.x))) / 2;
  const midY = (Math.min(...centres.map((c) => c.y)) + Math.max(...centres.map((c) => c.y))) / 2;
  const camera = { x: midX - VIEWPORT.width / 2, y: midY - VIEWPORT.height / 2, zoom: 1 };

  const browser = await loadPlaywright().chromium.launch();
  onBrowser(browser);
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript((value: string) => {
    // The first-visit help panel would cover the map: mark it seen (tests that want it clear this).
    if (!sessionStorage.getItem("e2e-help-kept")) localStorage.setItem("hexagonal-canvas.help-seen", "1");
    if (!sessionStorage.getItem("e2e-camera-set")) {
      localStorage.setItem("hexagonal-canvas.camera", value);
      sessionStorage.setItem("e2e-camera-set", "1");
    }
  }, JSON.stringify(camera));
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(app.base);

  const scene: Scene = {
    home,
    app,
    browser,
    page,
    stories,
    pids,
    pageErrors,
    story(state, agent = "claude") {
      const found = stories.find((item) => item.state === state && item.agent === agent);
      assert.ok(found, `no ${state} story for ${agent}`);
      return found;
    },
    camera: () => page.evaluate(() => (window as unknown as { __hexCanvas: { camera(): Camera } }).__hexCanvas.camera()),
    layout: () => page.evaluate(() => (window as unknown as { __hexCanvas: { layout(): Layout } }).__hexCanvas.layout()),
    // Ground point → CSS pixels, through the page's own projection (which knows about the tilt).
    async worldToCss(x, y) {
      const point = await page.evaluate(([px, py]) => (window as unknown as { __hexCanvas: { project(x: number, y: number): { x: number; y: number } } }).__hexCanvas.project(px, py), [x, y]);
      return { cssX: point.x, cssY: point.y };
    },
    // A point on the cell's top face (raised when tilted); offsets are ground offsets from its centre.
    async cellPoint(id, dx = 0, dy = 0) {
      const cell = (await scene.layout()).sessions.find((session) => session.id === id);
      assert.ok(cell, `${id} has no cell`);
      const centre = hexCentre(cell.col, cell.row);
      const lift = await page.evaluate(([col, row]) => (window as unknown as { __hexCanvas: { lift(col: number, row: number): number } }).__hexCanvas.lift(col, row), [cell.col, cell.row]);
      const { cssX, cssY } = await scene.worldToCss(centre.x + dx, centre.y + dy - lift);
      return { x: Math.round(cssX * OUTPUT_SCALE), y: Math.round(cssY * OUTPUT_SCALE), cssX, cssY };
    },
    // The canvas is transparent over a white page and getImageData returns un-premultiplied colour:
    // composite over white to get what the viewer sees, and keep alpha to tell solid marks from tints.
    async pixelAtCss(cssX, cssY) {
      const [r, g, b, a] = await page.evaluate(
        ([px, py]) => {
          const data = document.querySelector<HTMLCanvasElement>("#app")?.getContext("2d")?.getImageData(px, py, 1, 1).data;
          return [data?.[0] ?? 0, data?.[1] ?? 0, data?.[2] ?? 0, data?.[3] ?? 0];
        },
        [Math.round(cssX * OUTPUT_SCALE), Math.round(cssY * OUTPUT_SCALE)],
      );
      const over = (channel: number) => Math.round((channel * a) / 255 + 255 * (1 - a / 255));
      return { rgb: [over(r), over(g), over(b)], alpha: a };
    },
    async pixel(id, dx = 0, dy = 0) {
      const { cssX, cssY } = await scene.cellPoint(id, dx, dy);
      return scene.pixelAtCss(cssX, cssY);
    },
    // A point inside the hex but outside the icon, where only the state tint is drawn.
    tint: async (id) => tintOf((await scene.pixel(id, 0, HEX_RADIUS * 0.75)).rgb),
    // Inside the badge disc, beside the "!" glyph.
    badge: (id) =>
      scene.pixel(
        id,
        Math.cos(geometry.badgeAngle) * geometry.badgeDistance + geometry.badgeRadius * 0.6,
        Math.sin(geometry.badgeAngle) * geometry.badgeDistance,
      ),
    async shot(name, clip) {
      const dir = process.env.E2E_SHOTS;
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${name}.png`), ...(clip ? { clip } : {}) });
    },
    async close() {
      await browser.close();
      app.stop();
      rmSync(home, { recursive: true, force: true });
    },
  };

  await eventually("the waiting cell to be tinted", () => scene.tint(scene.story("waiting").id), (value) => value === "amber");
  await page.waitForTimeout(POP_SETTLE_MS);
  return scene;
}
