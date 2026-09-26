// Productising the page: loading / empty / offline states, the help panel, names and branding, HUD
// placement, narrow windows, the breathing frame rate and performance with thousands of sessions.
// With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import { writeMany } from "../fixtures/sessions.ts";
import { startApp, type App } from "../harness.ts";
import { eventually, startScene, VIEWPORT, type Scene } from "./scene.ts";

type Stats = { frames: number; lastMs: number };
const stats = (page: Page) => page.evaluate(() => (window as unknown as { __hexCanvas: { renderStats(): Stats } }).__hexCanvas.renderStats());
const framesOver = async (page: Page, ms: number) => {
  const before = await stats(page);
  await page.waitForTimeout(ms);
  return ((await stats(page)).frames - before.frames) / (ms / 1000);
};

// Visible HUD boxes (top-level controls; the lens box counts as its tab bar and its legend, which
// sit one above the other), for overlap checks on narrow windows.
const hudBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("#hud > :not(.hud-lens), .hud-lens > *")]
      .filter((node) => !node.hidden && getComputedStyle(node).display !== "none" && node.offsetWidth > 0)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { name: node.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }),
  );

// Save a page's screenshot when E2E_SHOTS is set (scene.shot covers the shared scene page).
async function shotOf(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function freshPage(browser: Browser, base: string, viewport = VIEWPORT, helpSeen = true): Promise<Page> {
  const context = await browser.newContext({ viewport });
  if (helpSeen) await context.addInitScript(() => localStorage.setItem("hexagonal-canvas.help-seen", "1"));
  const page = await context.newPage();
  await page.goto(base);
  return page;
}

describe("product polish", () => {
  let scene: Scene;

  before(async () => {
    scene = await startScene();
  });

  after(async () => {
    await scene?.close();
  });

  test("③ no server: a card says the local service is unreachable and how to start it", async () => {
    const context = await scene.browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    await page.route("**/api/**", (route) => route.abort());
    await page.goto(scene.app.base);
    const card = page.locator(".hud-status[data-kind='offline']");
    await card.waitFor({ state: "visible" });
    assert.match((await card.textContent()) ?? "", /连不上本地服务.*pnpm dev/);
    assert.equal(await page.locator(".hud-minimap").isHidden(), true, "no minimap without sessions");
    assert.equal(await page.locator(".hud-replay-open").isHidden(), true, "nothing to replay");
    await shotOf(page, "p3-offline");
    await context.close();
  });

  test("③ a dropped connection shows a reconnecting strip, and the map comes back by itself", async () => {
    const strip = scene.page.locator(".hud-offline");
    assert.equal(await strip.isHidden(), true);
    const errorsBefore = scene.pageErrors.length;
    await scene.app.stopServer();
    await strip.waitFor({ state: "visible" });
    assert.match((await strip.textContent()) ?? "", /断开.*重连/);
    assert.ok((await scene.layout()).sessions.length > 0, "the last map stays on screen");
    await scene.shot("p3-reconnecting");
    scene.app.startServer();
    await strip.waitFor({ state: "hidden", timeout: 20_000 });
    await eventually("sessions after reconnecting", scene.layout, (layout) => layout.sessions.length === scene.stories.length);
    // Requests that failed while the server was deliberately down are expected; anything else is not.
    const outage = scene.pageErrors.splice(errorsBefore);
    for (const message of outage) assert.match(message, /Failed to load resource|502|Bad Gateway/, `unexpected error during the outage: ${message}`);
  });

  test("③ no sessions: a card lists the supported agents", async () => {
    const home = mkdtempSync(join(tmpdir(), "hex-empty-"));
    let app: App | null = null;
    try {
      app = await startApp(home);
      await app.waitForSessions(() => true, "the API");
      const page = await freshPage(scene.browser, app.base);
      const card = page.locator(".hud-status[data-kind='empty']");
      await card.waitFor({ state: "visible" });
      const text = (await card.textContent()) ?? "";
      for (const name of ["Claude Code", "Codex", "Gemini CLI", "Kimi Code", "DeepSeek"]) assert.ok(text.includes(name), `lists ${name}`);
      assert.equal(await page.locator(".hud-minimap").isHidden(), true);
      await shotOf(page, "p3-empty");
      await page.context().close();
    } finally {
      app?.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("⑥ help: opens once by itself on the first visit, ? toggles it, Esc closes it", async () => {
    const page = await freshPage(scene.browser, scene.app.base, VIEWPORT, false);
    const panel = page.locator(".hud-help");
    await panel.waitFor({ state: "visible" });
    const text = (await panel.textContent()) ?? "";
    for (const key of ["右键会话", "WASD", "倾斜视角", "回放"]) assert.ok(text.replace(/\s/g, "").includes(key.replace(/\s/g, "")), `help mentions ${key}`);
    await shotOf(page, "p6-help");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await page.keyboard.press("?");
    await panel.waitFor({ state: "visible" });
    await page.keyboard.press("?");
    await panel.waitFor({ state: "hidden" });
    // Seen: a reload does not open it again, the ? button still does.
    await page.reload();
    await eventually("the map after reload", () => page.evaluate(() => (window as unknown as { __hexCanvas: { layout(): { sessions: unknown[] } } }).__hexCanvas.layout().sessions.length), (n) => n > 0);
    await page.waitForTimeout(500);
    assert.equal(await panel.isHidden(), true, "help stays closed once seen");
    await page.locator(".hud-help-open").click();
    await panel.waitFor({ state: "visible" });
    await page.context().close();
  });

  test("⑦ branding: Chinese page language, favicon, title and agent names", async () => {
    assert.equal(await scene.page.getAttribute("html", "lang"), "zh-CN");
    assert.match(await scene.page.title(), /本机 agent 会话地图/);
    const icon = await scene.page.getAttribute("link[rel='icon']", "href");
    assert.ok(icon);
    const response = await fetch(new URL(icon, scene.app.base));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /svg/);
    assert.equal(await scene.page.locator(".hud-lens-tabs button", { hasText: "工具" }).count(), 1, "the agent lens is called 工具");
    const waiting = await scene.cellPoint(scene.story("waiting").id);
    await scene.page.mouse.move(waiting.cssX, waiting.cssY);
    await scene.page.locator("#hex-tooltip").getByText(/Claude Code · /).waitFor();
    await scene.page.mouse.move(2, 2);
  });

  test("⑧ the menu opens beside the cell, leaving the cell and its banner visible, with project actions", async () => {
    const waiting = scene.story("waiting");
    const point = await scene.cellPoint(waiting.id);
    await scene.page.mouse.click(point.cssX, point.cssY, { button: "right" });
    const menu = scene.page.locator("#hex-menu");
    await menu.waitFor({ state: "visible" });
    const box = await menu.boundingBox();
    assert.ok(box);
    const halfWidth = 55.4;
    const clearOfCell = box.x >= point.cssX + halfWidth - 1 || box.x + box.width <= point.cssX - halfWidth + 1;
    assert.ok(clearOfCell, `menu ${JSON.stringify(box)} should not cover the cell at ${point.cssX}`);
    const banners = await scene.page.evaluate(() => (window as unknown as { __hexCanvas: { banners(): { x: number; y: number; width: number; height: number }[] } }).__hexCanvas.banners());
    const cam = await scene.camera();
    for (const banner of banners) {
      const left = (banner.x - cam.x) * cam.zoom;
      const bottom = (banner.y + banner.height - cam.y) * cam.zoom;
      const right = left + banner.width * cam.zoom;
      const overlaps = left < box.x + box.width && right > box.x && bottom > box.y && (banner.y - cam.y) * cam.zoom < box.y + box.height;
      assert.ok(!overlaps, "the menu leaves project banners uncovered");
    }
    const editor = menu.locator(".hex-menu-links a");
    assert.match((await editor.getAttribute("href")) ?? "", /^vscode:\/\/file\/storybook\/hexagonal/);
    await menu.locator(".hex-menu-links button", { hasText: "复制项目路径" }).waitFor();
    await scene.shot("p8-menu");
    await scene.page.keyboard.press("Escape");
  });

  for (const viewport of [{ width: 390, height: 844 }, { width: 700, height: 900 }]) {
    test(`⑨ at ${viewport.width}px nothing in the HUD overlaps and the lens tabs stay on one line`, async () => {
      const page = await freshPage(scene.browser, scene.app.base, viewport);
      await eventually("the map", () => page.evaluate(() => (window as unknown as { __hexCanvas: { layout(): { sessions: unknown[] } } }).__hexCanvas.layout().sessions.length), (n) => n > 0);
      await page.waitForTimeout(500);
      const boxes = (await hudBoxes(page)).filter((item) => !item.name.includes("hud-status") && !item.name.includes("hud-offline"));
      assert.ok(boxes.length >= 4, `found HUD controls: ${boxes.map((b) => b.name).join(", ")}`);
      for (const box of boxes) {
        assert.ok(box.left >= 0 && box.right <= viewport.width + 0.5, `${box.name} fits horizontally (${box.left}–${box.right})`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (!a || !b) continue;
          const overlap = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
        }
      }
      const heights = await page.locator(".hud-lens-tabs button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
      assert.ok(Math.max(...heights) < 32, `lens tabs wrap onto two lines (${heights})`);
      await shotOf(page, `p9-${viewport.width}`);
      await page.context().close();
    });
  }

  test("⑩ breathing redraws at about 18 fps, stops while hidden, and holds still for reduced motion", async () => {
    await scene.page.mouse.move(2, 2);
    const breathing = await framesOver(scene.page, 2000);
    assert.ok(breathing > 8 && breathing < 25, `breathing frame rate ${breathing}/s`);
    await scene.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await scene.page.waitForTimeout(200);
    assert.ok((await framesOver(scene.page, 1000)) <= 1, "no frames while the tab is hidden");
    await scene.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok((await framesOver(scene.page, 1000)) > 8, "breathing resumes when shown");
    await scene.page.emulateMedia({ reducedMotion: "reduce" });
    await scene.page.waitForTimeout(300);
    assert.ok((await framesOver(scene.page, 1000)) <= 1, "reduced motion: tints hold still");
    await scene.page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await scene.tint(scene.story("waiting").id), "amber", "state tints still show");
  });

  test("⑪ 2000 sessions: frames stay fast and hovering finds the right cell", async () => {
    const home = mkdtempSync(join(tmpdir(), "hex-many-"));
    let app: App | null = null;
    try {
      writeMany(home, 5000, 2000);
      app = await startApp(home);
      await app.waitForSessions((list) => list.length >= 2000, "2000 sessions", 60_000);
      const page = await freshPage(scene.browser, app.base);
      await eventually("2000 cells", () => page.evaluate(() => (window as unknown as { __hexCanvas: { layout(): { sessions: unknown[] } } }).__hexCanvas.layout().sessions.length), (n) => n >= 2000, 30_000);
      await page.waitForTimeout(1000);
      const renderTimes = async () => {
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(300 + (i % 10) * 60, 300 + (i % 5) * 40);
          times.push((await stats(page)).lastMs);
        }
        return times.sort((a, b) => a - b)[10] ?? Infinity;
      };
      const overview = await renderTimes();
      assert.ok(overview < 60, `median frame with every session on screen: ${overview} ms`);
      // Hover at zoom 1 picks the cell under the pointer (an indexed lookup).
      const target = await page.evaluate(() => {
        const hex = (window as unknown as { __hexCanvas: { layout(): { sessions: { id: string; title: string; col: number; row: number }[] }; focus(col: number, row: number, options?: object): void } }).__hexCanvas;
        const session = hex.layout().sessions[1234];
        if (!session) throw new Error("no session 1234");
        hex.focus(session.col, session.row, { zoom: 1 });
        return session.title;
      });
      await page.waitForTimeout(1200);
      const close = await renderTimes();
      assert.ok(close < 25, `median frame at zoom 1: ${close} ms`);
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      await page.locator("#hex-tooltip").getByText(target, { exact: true }).waitFor();
      await page.context().close();
    } finally {
      app?.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});

