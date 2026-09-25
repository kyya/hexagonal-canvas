// End-to-end: fixture sessions on disk → server discovery → SSE → canvas pixels, menu and live
// updates in a real browser. Runs against a private copy of the app (fixture $HOME, free ports), so
// it never touches the real $HOME or a running `pnpm dev`.
//
//   pnpm test:e2e
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { cellGeometry } from "../../src/cells/golden.ts";
import { place, type ApiSession } from "../../src/live.ts";
import {
  addClaudeSession,
  appendClaudeReply,
  HISTORY_AGENTS,
  PROJECT,
  registerLive,
  writeFixtures,
  type Story,
} from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre, loadPlaywright, OUTPUT_SCALE, startApp, type App } from "../harness.ts";

const VIEWPORT = { width: 1600, height: 1100 };
const POP_SETTLE_MS = 1200;
const geometry = cellGeometry(HEX_RADIUS);

type Rgb = [number, number, number];
type Tint = "amber" | "blue" | "green" | "none";

// Classify a tinted-over-white pixel by which channel dominates.
function tintOf([r, g, b]: Rgb): Tint {
  if (r >= 250 && g >= 250 && b >= 250) return "none";
  if (r > g && g > b) return "amber";
  if (b > r && b >= g) return "blue";
  if (g > r && g > b) return "green";
  return "none";
}

async function eventually<T>(what: string, probe: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await probe();
    if (ok(last)) return last;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
}

describe("canvas end to end", () => {
  let home = "";
  let app: App;
  let browser: Browser;
  let page: Page;
  let stories: Story[] = [];
  const pids = new Map<string, number>();
  const pageErrors: string[] = [];
  let camera = { x: 0, y: 0, zoom: 1 };

  const story = (state: Story["state"], agent = "claude") => {
    const found = stories.find((item) => item.state === state && item.agent === agent);
    assert.ok(found, `no ${state} story for ${agent}`);
    return found;
  };

  // Where a session's cell is on the canvas, in canvas pixels, from the same layout the page uses.
  async function cellPoint(id: string, dx = 0, dy = 0): Promise<{ x: number; y: number; cssX: number; cssY: number }> {
    const cell = place(await app.sessions()).sessions.find((session) => session.id === id);
    assert.ok(cell, `${id} has no cell`);
    const centre = hexCentre(cell.col, cell.row);
    const cssX = (centre.x + dx - camera.x) * camera.zoom;
    const cssY = (centre.y + dy - camera.y) * camera.zoom;
    return { x: Math.round(cssX * OUTPUT_SCALE), y: Math.round(cssY * OUTPUT_SCALE), cssX, cssY };
  }

  // The canvas is transparent and the page behind it is white, and getImageData returns
  // un-premultiplied colour: a faint tint reads back as its full colour at low alpha. Composite over
  // white to get what the viewer sees, and keep alpha to tell solid marks from tints.
  async function pixel(id: string, dx = 0, dy = 0): Promise<{ rgb: Rgb; alpha: number }> {
    const { x, y } = await cellPoint(id, dx, dy);
    const [r, g, b, a] = await page.evaluate(
      ([px, py]) => {
        const data = document.querySelector<HTMLCanvasElement>("#app")?.getContext("2d")?.getImageData(px, py, 1, 1).data;
        return [data?.[0] ?? 0, data?.[1] ?? 0, data?.[2] ?? 0, data?.[3] ?? 0];
      },
      [x, y],
    );
    const over = (channel: number) => Math.round((channel * a) / 255 + 255 * (1 - a / 255));
    return { rgb: [over(r), over(g), over(b)], alpha: a };
  }

  // A point inside the hex but outside the icon, where only the state tint is drawn.
  const tint = async (id: string) => tintOf((await pixel(id, 0, HEX_RADIUS * 0.75)).rgb);
  // Inside the badge disc, beside the "!" glyph.
  const badge = async (id: string) =>
    pixel(
      id,
      Math.cos(geometry.badgeAngle) * geometry.badgeDistance + geometry.badgeRadius * 0.6,
      Math.sin(geometry.badgeAngle) * geometry.badgeDistance,
    );

  before(async () => {
    home = mkdtempSync(join(tmpdir(), "hex-e2e-"));
    stories = writeFixtures(home, HISTORY_AGENTS);
    app = await startApp(home);
    for (const item of stories.filter((entry) => entry.state !== "history")) {
      const pid = app.standIn().pid;
      assert.ok(pid);
      pids.set(item.id, pid);
      registerLive(home, item, pid);
    }
    await app.waitForSessions((list) => list.length >= stories.length, "every fixture session");

    // Centre the camera on the cluster so every cell (and one more ring for new sessions) is visible.
    const layout = place(await app.sessions());
    const centres = layout.sessions.map((session) => hexCentre(session.col, session.row));
    const midX = (Math.min(...centres.map((c) => c.x)) + Math.max(...centres.map((c) => c.x))) / 2;
    const midY = (Math.min(...centres.map((c) => c.y)) + Math.max(...centres.map((c) => c.y))) / 2;
    camera = { x: midX - VIEWPORT.width / 2, y: midY - VIEWPORT.height / 2, zoom: 1 };

    browser = await loadPlaywright().chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript((value: string) => localStorage.setItem("hexagonal-canvas.camera", value), JSON.stringify(camera));
    page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await page.goto(app.base);
    await eventually("the waiting cell to be tinted", () => tint(story("waiting").id), (value) => value === "amber");
    // Live cells pop in with an elastic overshoot (src/cells/pop.ts, 900 ms) that briefly scales the
    // icon to ~1.37×; let it settle so pixel probes see the resting layout.
    await page.waitForTimeout(POP_SETTLE_MS);
  });

  after(async () => {
    await browser?.close();
    app?.stop();
    if (home) rmSync(home, { recursive: true, force: true });
  });

  test("the server discovers every agent's sessions with the right state", async () => {
    const sessions = new Map((await app.sessions()).map((session) => [session.id, session]));
    for (const item of stories) {
      const session = sessions.get(item.id) as ApiSession | undefined;
      assert.ok(session, `${item.id} was not discovered`);
      assert.equal(session.agent, item.agent);
      assert.equal(session.cwd, PROJECT, `${item.id} cwd`);
      if (item.state === "history") {
        assert.equal(session.live, false, `${item.id} should be history`);
        assert.equal(session.status, null);
      } else {
        assert.equal(session.live, true, `${item.id} should be live`);
        assert.equal(session.status, item.state, `${item.id} status`);
        assert.match(session.resume ?? "", /claude --resume /);
      }
    }
    assert.equal(sessions.get(story("waiting").id)?.waitingFor, "input needed");
  });

  test("each live state tints its hex; history stays untinted", async () => {
    assert.equal(await tint(story("idle").id), "green");
    assert.equal(await tint(story("waiting").id), "amber");
    // Busy breathes shallow; any frame is still blue.
    assert.equal(await tint(story("busy").id), "blue");
    for (const agent of ["claude", "codex", "gemini"]) {
      assert.equal(await tint(story("history", agent).id), "none", `history ${agent}`);
    }
  });

  test("only the waiting cell carries the solid badge", async () => {
    const waiting = await badge(story("waiting").id);
    const [r, g, b] = waiting.rgb;
    assert.ok(waiting.alpha > 240, `waiting badge should be opaque, got alpha ${waiting.alpha}`);
    assert.ok(r > 220 && g > 120 && g < 200 && b < 80, `waiting badge should be solid amber, got ${waiting.rgb}`);
    for (const state of ["idle", "busy"] as const) {
      const other = await badge(story(state).id);
      // Only the soft state tint may be there (well under φ⁻² opacity), never a solid mark.
      assert.ok(other.alpha < 128, `${state} must not have a badge, got alpha ${other.alpha} (${other.rgb})`);
    }
  });

  test("the tab title counts sessions waiting on you", async () => {
    assert.match(await page.title(), /^\(1\) 等你处理 · /);
  });

  test("right-click opens details, resume command and the conversation", async () => {
    const { cssX, cssY } = await cellPoint(story("waiting").id);
    await page.mouse.click(cssX, cssY, { button: "right" });
    const menu = page.locator("#hex-menu");
    await menu.waitFor({ state: "visible" });
    assert.equal(await menu.locator(".hex-menu-title").textContent(), "运行中 · 等你处理");
    assert.match((await menu.locator(".hex-menu-subtitle").textContent()) ?? "", /等你处理：input needed/);
    assert.match((await menu.locator(".hex-menu-command").textContent()) ?? "", /claude --resume 00000000-/);
    const transcript = menu.locator(".hex-menu-transcript");
    await transcript.getByText("好的，已经处理完了。").waitFor();
    assert.match((await transcript.textContent()) ?? "", /运行中 · 等你处理/);
  });

  test("an open conversation picks up new replies while the session runs", async () => {
    appendClaudeReply(home, story("waiting").id, "端到端追加的一条回复");
    await page.locator(".hex-menu-transcript").getByText("端到端追加的一条回复").waitFor({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await page.locator("#hex-menu").waitFor({ state: "hidden" });
  });

  test("a status change reaches the canvas and the tab title", async () => {
    const busy = story("busy");
    registerLive(home, { ...busy, state: "waiting", waitingFor: "dialog open" }, pids.get(busy.id) ?? 0);
    await eventually("the busy cell to turn amber", () => tint(busy.id), (value) => value === "amber");
    await eventually("the title to count two", () => page.title(), (title) => title.startsWith("(2) "));
  });

  test("a session whose process exits falls back to history", async () => {
    const idle = story("idle");
    process.kill(pids.get(idle.id) ?? 0);
    await app.waitForSessions((list) => list.find((session) => session.id === idle.id)?.live === false, "idle to end");
    await eventually("the idle tint to clear", () => tint(idle.id), (value) => value === "none");
  });

  test("a new session file adds a cell", async () => {
    const id = addClaudeSession(home, 500, "端到端新会话");
    await app.waitForSessions((list) => list.some((session) => session.id === id), "the new session");
    // A faded Claude icon has terracotta pixels (red well above blue) around the cell centre.
    const { x, y } = await cellPoint(id);
    const size = Math.round(geometry.iconSize * OUTPUT_SCALE);
    await eventually(
      "the new cell's icon",
      () =>
        page.evaluate(
          ([px, py, span]) => {
            const data = document.querySelector<HTMLCanvasElement>("#app")?.getContext("2d")?.getImageData(px - span / 2, py - span / 2, span, span).data;
            if (!data) return 0;
            let hits = 0;
            for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) - (data[i + 2] ?? 0) > 30) hits++;
            return hits;
          },
          [x, y, size],
        ),
      (hits) => hits > 20,
    );
  });

  test("the page logged no errors", () => {
    assert.deepEqual(pageErrors, []);
  });
});
