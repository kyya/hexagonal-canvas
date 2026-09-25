// Batch 3 of the Civ-style features: per-cell yield numbers, map search, and map pins with notes.
// With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { hexCentre, HEX_RADIUS, RECT_W } from "../harness.ts";
import { eventually, geometry, startScene, VIEWPORT, type Scene } from "./scene.ts";

describe("yields, search and map pins", () => {
  let scene: Scene;

  before(async () => {
    scene = await startScene();
  });

  after(async () => {
    await scene?.close();
  });

  // A teal pixel inside the yield pill, between the number (white) and the pill's left end.
  const yieldPixel = async (id: string) => scene.pixel(id, -geometry.yieldFont * 0.45, geometry.yieldOffset);

  const clusterShot = async (name: string) => {
    const { sessions } = await scene.layout();
    const points = await Promise.all(sessions.map((session) => scene.cellPoint(session.id)));
    const xs = points.map((p) => p.cssX);
    const ys = points.map((p) => p.cssY);
    const pad = RECT_W;
    const x = Math.max(0, Math.min(...xs) - pad);
    const y = Math.max(0, Math.min(...ys) - pad * 1.2);
    await scene.shot(name, {
      x,
      y,
      width: Math.min(VIEWPORT.width - x, Math.max(...xs) - Math.min(...xs) + pad * 2),
      height: Math.min(VIEWPORT.height - y, Math.max(...ys) - Math.min(...ys) + pad * 2.2),
    });
  };

  test("⑥ yields: Y shows each session's message count under its icon, and hides it again", async () => {
    const claude = scene.story("history", "claude");
    const session = (await scene.layout()).sessions.find((item) => item.id === claude.id);
    assert.ok(session && session.messages > 0, "fixture session should have messages");
    assert.equal((await yieldPixel(claude.id)).alpha, 0, "no yield before the toggle");

    await scene.page.keyboard.press("y");
    const toggle = scene.page.locator(".hud-lens-toggle");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    const shown = await eventually("the yield pill to appear", () => yieldPixel(claude.id), (pixel) => pixel.alpha > 200);
    const [r, g, b] = shown.rgb;
    assert.ok(b > r && g > r, `yield pill is teal, got ${shown.rgb}`);
    await clusterShot("f6-yields");

    await toggle.click();
    await eventually("the yield pill to go", () => yieldPixel(claude.id), (pixel) => pixel.alpha === 0);
    assert.equal(await scene.page.evaluate(() => localStorage.getItem("hexagonal-canvas.toggle.yields")), "0");
  });

  test("⑧ search: / opens it, typing dims non-matches and lists hits, Enter flies to the hit", async () => {
    await scene.page.keyboard.press("/");
    const input = scene.page.locator(".hud-search-input");
    await input.waitFor({ state: "visible" });
    await input.fill("kimi");
    const results = scene.page.locator(".hud-search-item");
    await eventually("one kimi hit", () => results.count(), (n) => n === 1);
    assert.match((await results.first().textContent()) ?? "", /历史 Kimi 会话.*kimi · hexagonal/);
    assert.equal((await scene.page.locator(".hud-search-count").textContent())?.trim(), "1 个结果");

    const kimi = scene.story("history", "kimi");
    const codex = scene.story("history", "codex");
    const veil = async (id: string) => (await scene.pixel(id, 0, HEX_RADIUS * 0.75)).alpha;
    await eventually("codex to be dimmed", () => veil(codex.id), (alpha) => alpha > 150);
    assert.equal(await veil(kimi.id), 0, "the hit stays clear");
    await scene.shot("f8-search");

    await input.press("Enter");
    const cell = (await scene.layout()).sessions.find((session) => session.id === kimi.id);
    assert.ok(cell);
    const target = hexCentre(cell.col, cell.row);
    await eventually("the camera to centre the hit", () => scene.camera(), (cam) =>
      Math.hypot(cam.x + VIEWPORT.width / 2 / cam.zoom - target.x, cam.y + VIEWPORT.height / 2 / cam.zoom - target.y) < 2,
    );
    await scene.page.locator("#hex-menu .hex-menu-title", { hasText: "历史 Kimi 会话" }).waitFor();

    // Escape in the box closes it and clears the dimming.
    await input.focus();
    await input.press("Escape");
    await scene.page.locator(".hud-search").waitFor({ state: "hidden" });
    await eventually("the veil to lift", () => veil(codex.id), (alpha) => alpha === 0);
    await scene.page.keyboard.press("Escape");
  });

  test("⑧ map pins: right-click an empty hex to drop a note; it persists, shows in tooltip and search, and can be removed", async () => {
    // An empty hex two columns right of the cluster's rightmost cell.
    const { sessions } = await scene.layout();
    const rightmost = sessions.reduce((best, session) => (session.col > best.col ? session : best));
    const col = rightmost.col + 2;
    const row = rightmost.row;
    const centre = hexCentre(col, row);
    const at = await scene.worldToCss(centre.x, centre.y);
    await scene.page.mouse.click(at.cssX, at.cssY, { button: "right" });
    const form = scene.page.locator("#hex-menu .hex-menu-form");
    await form.waitFor({ state: "visible" });
    assert.equal(await form.locator(".hex-menu-title").textContent(), "在这里插一枚地图钉");
    await form.locator(".hex-menu-input").fill("发布前记得跑 e2e");
    await form.locator(".hex-menu-input").press("Enter");
    await scene.page.locator("#hex-menu").waitFor({ state: "hidden" });

    // The tack's head is drawn in rose red just above the hex centre (its middle has a white dot).
    const head = geometry.iconSize / 2 / 1.618;
    const tack = async () => {
      const point = await scene.worldToCss(centre.x + head * 0.6, centre.y - head / 1.618);
      return scene.pixelAtCss(point.cssX, point.cssY);
    };
    await eventually("the pin to be drawn", tack, (pixel) => pixel.alpha > 200 && pixel.rgb[0] > 200 && pixel.rgb[1] < 80);
    assert.deepEqual(
      await scene.page.evaluate(() => JSON.parse(localStorage.getItem("hexagonal-canvas.pins") ?? "[]")),
      [{ col, row, note: "发布前记得跑 e2e" }],
    );

    // Tooltip shows the note.
    await scene.page.mouse.move(at.cssX + 1, at.cssY + 1);
    await scene.page.locator("#hex-tooltip").getByText("📍 发布前记得跑 e2e").waitFor();
    await scene.shot("f8-pin", {
      x: Math.max(0, at.cssX - 220),
      y: Math.max(0, at.cssY - 140),
      width: 440,
      height: 280,
    });

    // It survives a reload and is found by search.
    await scene.page.reload();
    await eventually("the pin after reload", tack, (pixel) => pixel.alpha > 200);
    await scene.page.keyboard.press("/");
    await scene.page.locator(".hud-search-input").fill("e2e");
    await scene.page.locator(".hud-search-item", { hasText: "📍 发布前记得跑 e2e" }).waitFor();
    await scene.page.locator(".hud-search-input").press("Escape");

    // Right-click the pin to remove it.
    const again = await scene.worldToCss(centre.x, centre.y);
    await scene.page.mouse.click(again.cssX, again.cssY, { button: "right" });
    await form.waitFor({ state: "visible" });
    assert.equal(await form.locator(".hex-menu-input").inputValue(), "发布前记得跑 e2e");
    await form.locator(".hex-menu-delete").click();
    await eventually("the pin to be removed", tack, (pixel) => pixel.alpha < 50);
    assert.equal(await scene.page.evaluate(() => localStorage.getItem("hexagonal-canvas.pins")), "[]");
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
