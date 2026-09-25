// Coin stacks: each project's stale sessions pile up on one hex at the front of its cluster, like
// coins. With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { coinCount } from "../../src/cells/golden.ts";
import type { Stack } from "../../src/live.ts";
import { writeAged, writeProject, type Story } from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre } from "../harness.ts";
import { eventually, startScene, VIEWPORT, type Scene } from "./scene.ts";

const OTHER = "/work/atlas";

describe("coin stacks", () => {
  let scene: Scene;
  let old: Story[];

  before(async () => {
    scene = await startScene({
      setup: (home) => {
        old = Array.from({ length: 12 }, (_, i) => writeAged(home, 900 + i, 40 + i * 20, `很久以前的会话 ${i + 1}`));
        // Another project: one recent session, and one old one that makes a pile of one.
        const recent = writeProject(home, OTHER, 950, ["atlas 的新会话"]);
        const lone = writeAged(home, 951, 45, "atlas 的老会话", OTHER);
        return [...old, ...recent, lone];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  const stackOf = async (cwd: string): Promise<Stack> => {
    const stack = (await scene.layout()).stacks.find((item) => item.cwd === cwd);
    assert.ok(stack, `${cwd} has a stack`);
    return stack;
  };
  const focusStack = async (stack: Stack) => {
    await scene.page.evaluate(
      ([col, row]) => (window as unknown as { __hexCanvas: { focus(c: number, r: number): void } }).__hexCanvas.focus(col, row),
      [stack.col, stack.row],
    );
    const target = hexCentre(stack.col, stack.row);
    await eventually("the camera on the stack", scene.camera, (cam) => Math.abs(cam.x + VIEWPORT.width / 2 / cam.zoom - target.x) < 2);
  };
  const pileTop = async (stack: Stack) => {
    const point = await scene.page.evaluate(
      ([col, row]) => (window as unknown as { __hexCanvas: { cellCentre(c: number, r: number): { x: number; y: number } } }).__hexCanvas.cellCentre(col, row),
      [stack.col, stack.row],
    );
    return point;
  };

  test("stale sessions pile up on one hex per project, at the front of the cluster", async () => {
    const layout = await scene.layout();
    const main = await stackOf("/storybook/hexagonal");
    assert.equal(main.sessions.length, 12);
    assert.deepEqual(main.sessions.map((session) => session.title), old.map((story) => story.label), "newest first");
    const lone = await stackOf(OTHER);
    assert.deepEqual(lone.sessions.map((session) => session.title), ["atlas 的老会话"]);
    const project = layout.sessions.filter((session) => session.cwd === "/storybook/hexagonal" && !session.stacked);
    assert.ok(project.every((session) => session.row <= main.row), "the pile is at the front of its cluster");
    assert.equal(layout.labels.find((label) => label.cwd === "/storybook/hexagonal")?.total, project.length + 12, "the banner still counts piled sessions");
  });

  test("the pile is drawn as coins that grow with the count, with the count on top", async () => {
    const main = await stackOf("/storybook/hexagonal");
    await focusStack(main);
    await scene.page.mouse.move(2, 2);
    const centre = await pileTop(main);
    // Coins of the 12-session pile rise higher than the single coin of a pile of one: compare where
    // the silver ends above each pile's centre.
    const reach = async (x: number, y: number) => {
      let top = 0;
      for (let dy = 0; dy < HEX_RADIUS; dy++) {
        const { alpha, rgb } = await scene.pixelAtCss(x + HEX_RADIUS * 0.5, y - dy);
        const silver = alpha === 255 && Math.max(...rgb) - Math.min(...rgb) < 16 && rgb[0] < 250;
        if (silver) top = dy;
      }
      return top;
    };
    const tall = await reach(centre.x, centre.y);
    assert.ok(coinCount(12) === 6 && tall > 20, `the 12-coin pile reaches ${tall}px above its centre`);
    await scene.shot("f12-stack", { x: centre.x - 220, y: centre.y - 170, width: 440, height: 300 });
    const lone = await stackOf(OTHER);
    await focusStack(lone);
    await scene.page.mouse.move(2, 2);
    const loneCentre = await pileTop(lone);
    const short = await reach(loneCentre.x, loneCentre.y);
    assert.ok(short < tall, `a pile of one (${short}px) is lower than a pile of 12 (${tall}px)`);
  });

  test("hover summarises the pile; right-click lists its sessions and opens one", async () => {
    const main = await stackOf("/storybook/hexagonal");
    await focusStack(main);
    const centre = await pileTop(main);
    await scene.page.mouse.move(centre.x, centre.y);
    const tooltip = scene.page.locator("#hex-tooltip");
    await tooltip.getByText("12 个过时会话").waitFor();
    assert.match((await tooltip.textContent()) ?? "", /hexagonal · 最近一次 .* · 右键展开/);
    await scene.page.mouse.click(centre.x, centre.y, { button: "right" });
    const items = scene.page.locator(".hex-menu-list-item");
    await eventually("12 listed sessions", () => items.count(), (n) => n === 12);
    assert.match((await items.first().textContent()) ?? "", /很久以前的会话 1.*Claude Code/);
    await items.nth(2).click();
    await scene.page.locator("#hex-menu .hex-menu-details .hex-menu-title").getByText("很久以前的会话 3").waitFor();
    await scene.page.locator("#hex-menu .hex-menu-transcript").getByText("很久以前的会话 3").first().waitFor();
    assert.equal(await items.nth(2).getAttribute("aria-selected"), "true");
    await scene.shot("f12-stack-menu");
    await scene.page.keyboard.press("Escape");
  });

  test("search finds piled sessions and flies to their stack", async () => {
    await scene.page.keyboard.press("/");
    const input = scene.page.locator(".hud-search-input");
    await input.fill("很久以前的会话 7");
    await scene.page.locator(".hud-search-item").first().waitFor();
    await scene.page.keyboard.press("Enter");
    await scene.page.locator(".hex-menu-list-item").first().waitFor();
    const main = await stackOf("/storybook/hexagonal");
    const target = hexCentre(main.col, main.row);
    const cam = await scene.camera();
    assert.ok(Math.abs(cam.x + VIEWPORT.width / 2 / cam.zoom - target.x) < 2, "the camera is on the stack");
    await scene.page.keyboard.press("Escape");
    // Clear the query so the rest of the map is not dimmed.
    await scene.page.keyboard.press("/");
    await input.fill("");
    await scene.page.keyboard.press("Escape");
  });

  test("the replay unpiles: every session appears on its own hex as it was created", async () => {
    const all = (await scene.layout()).sessions.length;
    await scene.page.keyboard.press("r");
    await scene.page.locator(".hud-replay").waitFor({ state: "visible" });
    const slider = scene.page.locator(".hud-replay-slider");
    await slider.fill((await slider.getAttribute("max")) ?? "1");
    const layout = await eventually("the full replay", scene.layout, (value) => value.sessions.length === all);
    assert.equal(layout.stacks.length, 0);
    assert.ok(layout.sessions.every((session) => !session.stacked));
    assert.equal(new Set(layout.sessions.map((session) => `${session.col},${session.row}`)).size, layout.sessions.length);
    assert.equal(layout.sessions.length, all, "every session is back, none piled");
    await scene.page.locator(".hud-replay-close").click();
    await eventually("the stacks to return", scene.layout, (value) => value.stacks.length === 2);
  });

  test("tilted, the pile stands in front of its cluster, unhidden", async () => {
    const main = await stackOf("/storybook/hexagonal");
    await focusStack(main);
    await scene.page.keyboard.press("t");
    await eventually("the tilt", () => scene.page.evaluate(() => (window as unknown as { __hexCanvas: { tilt(): { squash: number } } }).__hexCanvas.tilt().squash), (value) => value < 0.62);
    await scene.page.mouse.move(2, 2);
    await scene.page.waitForTimeout(300);
    const centre = await pileTop(main);
    const { alpha, rgb } = await scene.pixelAtCss(centre.x + HEX_RADIUS * 0.4, centre.y);
    assert.equal(alpha, 255);
    assert.ok(Math.max(...rgb) - Math.min(...rgb) < 16, `silver coins on the tilted pile, got ${rgb}`);
    await scene.shot("f12-stack-tilt", { x: centre.x - 260, y: centre.y - 200, width: 520, height: 320 });
    await scene.page.keyboard.press("t");
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
