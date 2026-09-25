// Batch 4 of the Civ-style features: relation lines between sessions (spawned sub-agents, forks)
// and the timeline replay. With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { writeCodexFamily, writeGrokFamily, type Story } from "../fixtures/sessions.ts";
import { HEX_RADIUS, RECT_W } from "../harness.ts";
import { eventually, startScene, VIEWPORT, type Scene } from "./scene.ts";

type Point = { x: number; y: number };
type Curve = { childId: string; parentId: string; kind: "fork" | "spawn"; from: Point; control: Point; to: Point };

describe("relations and replay", () => {
  let scene: Scene;
  let codex: { parent: Story; spawn: Story; fork: Story };
  let grok: { parent: Story; child: Story };

  before(async () => {
    scene = await startScene({
      setup: (home) => {
        codex = writeCodexFamily(home, 600);
        grok = writeGrokFamily(home, 610);
        return [codex.parent, codex.spawn, codex.fork, grok.parent, grok.child];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  const curves = () => scene.page.evaluate(() => (window as unknown as { __hexCanvas: { relations(): Curve[] } }).__hexCanvas.relations());

  const clusterClip = async () => {
    const { sessions } = await scene.layout();
    const points = await Promise.all(sessions.map((session) => scene.cellPoint(session.id)));
    const xs = points.map((p) => p.cssX);
    const ys = points.map((p) => p.cssY);
    const x = Math.max(0, Math.min(...xs) - RECT_W);
    const y = Math.max(0, Math.min(...ys) - RECT_W * 1.2);
    return {
      x,
      y,
      width: Math.min(VIEWPORT.width - x, Math.max(...xs) - Math.min(...xs) + RECT_W * 2),
      height: Math.min(VIEWPORT.height - y, Math.max(...ys) - Math.min(...ys) + RECT_W * 2.2),
    };
  };

  test("⑦ relations: the server reports where each session came from", async () => {
    const byId = new Map((await scene.app.sessions()).map((session) => [session.id, session]));
    assert.deepEqual([byId.get(codex.spawn.id)?.parentId, byId.get(codex.spawn.id)?.relation], [codex.parent.id, "spawn"]);
    assert.deepEqual([byId.get(codex.fork.id)?.parentId, byId.get(codex.fork.id)?.relation], [codex.parent.id, "fork"]);
    assert.deepEqual([byId.get(grok.child.id)?.parentId, byId.get(grok.child.id)?.relation], [grok.parent.id, "spawn"]);
    assert.equal(byId.get(codex.parent.id)?.parentId, null);
  });

  test("⑦ relations: no lines until you focus a session; then only its family, straight", async () => {
    await scene.page.mouse.move(2, 2);
    assert.deepEqual(await curves(), [], "the map starts without relation lines");

    // Hover the spawned child: its whole family (parent, spawn, fork) is drawn, nothing else.
    const spawn = await scene.cellPoint(codex.spawn.id);
    await scene.page.mouse.move(spawn.cssX, spawn.cssY);
    const drawn = await eventually("the codex family", curves, (list) => list.length === 2);
    assert.deepEqual(
      Object.fromEntries(drawn.map((curve) => [curve.childId, curve.kind])),
      { [codex.spawn.id]: "spawn", [codex.fork.id]: "fork" },
    );
    for (const curve of drawn) {
      // Straight: the midpoint of from→to is on the line.
      assert.ok(Math.abs(curve.control.x - (curve.from.x + curve.to.x) / 2) < 1e-6 && Math.abs(curve.control.y - (curve.from.y + curve.to.y) / 2) < 1e-6);
      let best = 0;
      for (const [dx, dy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
        const css = await scene.worldToCss(curve.control.x + (dx ?? 0), curve.control.y + (dy ?? 0));
        const { rgb } = await scene.pixelAtCss(css.cssX, css.cssY);
        best = Math.max(best, 255 - Math.min(...rgb));
      }
      assert.ok(best > 60, `${curve.kind} line to ${curve.childId} should be visible, darkness ${best}`);
      const start = await scene.worldToCss(curve.from.x, curve.from.y);
      const parentCentre = await scene.cellPoint(curve.parentId);
      assert.ok(Math.hypot(start.cssX - parentCentre.cssX, start.cssY - parentCentre.cssY) > 20, "line starts outside the parent icon");
    }
    await scene.shot("f7-relations", await clusterClip());

    // Another family replaces it.
    const grokChild = await scene.cellPoint(grok.child.id);
    await scene.page.mouse.move(grokChild.cssX, grokChild.cssY);
    const grokLines = await eventually("the grok family", curves, (list) => list.length === 1);
    assert.equal(grokLines[0]?.parentId, grok.parent.id);

    // A session without relations shows none; leaving the canvas clears them.
    const lone = await scene.cellPoint(scene.story("history", "gemini").id);
    await scene.page.mouse.move(lone.cssX, lone.cssY);
    await eventually("no lines on an unrelated session", curves, (list) => list.length === 0);

    // With a menu open, its family stays drawn wherever the pointer goes.
    const fork = await scene.cellPoint(codex.fork.id);
    await scene.page.mouse.click(fork.cssX, fork.cssY, { button: "right" });
    await scene.page.mouse.move(2, 2);
    await eventually("the open menu's family", curves, (list) => list.length === 2);
    await scene.page.keyboard.press("Escape");
    await eventually("lines to clear with the menu", curves, (list) => list.length === 0);
  });

  test("⑦ relations: the menu says where a session came from", async () => {
    const { cssX, cssY } = await scene.cellPoint(codex.fork.id);
    await scene.page.mouse.click(cssX, cssY, { button: "right" });
    const subtitle = scene.page.locator("#hex-menu .hex-menu-subtitle");
    await subtitle.waitFor();
    assert.match((await subtitle.textContent()) ?? "", /分叉自「Codex 主线程：重构支付」/);
    await scene.page.keyboard.press("Escape");
    const spawn = await scene.cellPoint(codex.spawn.id);
    await scene.page.mouse.move(spawn.cssX, spawn.cssY);
    await scene.page.locator("#hex-tooltip").getByText(/派生自「Codex 主线程：重构支付」/).waitFor();
    await scene.page.mouse.move(2, 2);
  });

  test("⑩ replay: R opens the timeline at the beginning; play grows the map back to now; × returns to live", async () => {
    const all = (await scene.layout()).sessions.length;
    await scene.page.keyboard.press("r");
    const bar = scene.page.locator(".hud-replay");
    await bar.waitFor({ state: "visible" });
    // At the start only the first session exists, and nothing is live.
    const atStart = await eventually("the map to rewind", scene.layout, (layout) => layout.sessions.length < all);
    assert.equal(atStart.sessions.length, 1);
    assert.ok(atStart.sessions.every((session) => !session.live));
    assert.equal(await scene.page.locator(".hud-waiting").isHidden(), true, "nothing waits during a replay");
    const firstDate = await bar.locator(".hud-replay-date").textContent();

    // Each step is one session ("turn"): scrub to the middle for a map mid-growth.
    const half = Math.floor(all / 2);
    assert.equal(await bar.locator(".hud-replay-slider").getAttribute("max"), String(all));
    await bar.locator(".hud-replay-slider").fill(String(half));
    await eventually("the map half grown", scene.layout, (layout) => layout.sessions.length === half);
    assert.match((await bar.locator(".hud-replay-date").textContent()) ?? "", new RegExp(` · ${half}/${all}$`));
    // Newly revealed cells pop in (900 ms); let them settle for the screenshot.
    await scene.page.waitForTimeout(1200);
    await scene.shot("f10-replay");

    // Play sweeps to now (φ⁴ ≈ 6.9 s) and the date moves on.
    await bar.locator(".hud-replay-play").click();
    await eventually("the date to advance", () => bar.locator(".hud-replay-date").textContent(), (text) => text !== firstDate);
    await eventually("the replay to reach now", scene.layout, (layout) => layout.sessions.length === all, 15_000);
    await eventually("playback to stop at the end", () => bar.locator(".hud-replay-play").getAttribute("aria-label"), (label) => label === "播放");

    // Exit: live states are back.
    await bar.locator(".hud-replay-close").click();
    await bar.waitFor({ state: "hidden" });
    await eventually("the waiting tint to return", () => scene.tint(scene.story("waiting").id), (value) => value === "amber");
    assert.ok((await scene.pixel(scene.story("waiting").id, 0, HEX_RADIUS * 0.75)).alpha > 0);
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
