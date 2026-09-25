// Batch 1 of the Civ-style features: the "next waiting" button, project territory (borders and
// banners) and the hover tooltip. With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { projectHue } from "../../src/cells/palette.ts";
import { HISTORY_AGENTS, PROJECT, writeProject } from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre } from "../harness.ts";
import { eventually, startScene, VIEWPORT, type Scene } from "./scene.ts";

const ATLAS = "/storybook/atlas";
const BEACON = "/storybook/beacon";

type Banner = { cwd: string; x: number; y: number; width: number; height: number };

describe("navigation and territory", () => {
  let scene: Scene;

  const banners = () =>
    scene.page.evaluate(() => (window as unknown as { __hexCanvas: { banners(): Banner[] } }).__hexCanvas.banners());

  // World point at the centre of the viewport.
  const viewCentre = async () => {
    const cam = await scene.camera();
    return { x: cam.x + VIEWPORT.width / 2 / cam.zoom, y: cam.y + VIEWPORT.height / 2 / cam.zoom };
  };

  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 2;

  before(async () => {
    scene = await startScene({
      setup: (home) => [
        ...writeProject(home, ATLAS, 700, ["atlas: 迁移数据库", "atlas: 修复登录", "atlas: 写周报", "atlas: 升级依赖"]),
        ...writeProject(home, BEACON, 800, ["beacon: 调研竞品", "beacon: 画原型"]),
      ],
      live: (stories) => {
        const atlas = stories.find((story) => story.label === "atlas: 修复登录");
        assert.ok(atlas);
        return [{ story: atlas, state: "waiting", waitingFor: "dialog open" }];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  test("① next waiting: the button counts, N cycles across projects and opens the menu", async () => {
    const hud = scene.page.locator(".hud-waiting");
    await hud.waitFor({ state: "visible" });
    assert.equal((await hud.locator(".hud-waiting-label").textContent())?.trim(), "2 个等你处理");

    // Ordered by project path: atlas before hexagonal.
    const atlasWaiting = scene.stories.find((story) => story.label === "atlas: 修复登录");
    assert.ok(atlasWaiting);
    const expectations = [atlasWaiting, scene.story("waiting")];
    for (const expected of expectations) {
      await scene.page.keyboard.press("n");
      const cell = (await scene.layout()).sessions.find((session) => session.id === expected.id);
      assert.ok(cell);
      const target = hexCentre(cell.col, cell.row);
      await eventually("the camera to centre the waiting cell", viewCentre, (centre) => near(centre, target));
      const menu = scene.page.locator("#hex-menu");
      await menu.waitFor({ state: "visible" });
      assert.equal(await menu.locator(".hex-menu-title").textContent(), cell.title);
    }

    // The caret lists every waiting session; clicking one jumps there.
    await scene.page.keyboard.press("Escape");
    await hud.locator(".hud-waiting-toggle").click();
    const items = hud.locator(".hud-waiting-item");
    assert.equal(await items.count(), 2);
    assert.match((await items.nth(0).textContent()) ?? "", /atlas: 修复登录.*atlas · dialog open/);
    await scene.shot("f1-next-waiting");
    await items.nth(0).click();
    await scene.page.locator("#hex-menu").waitFor({ state: "visible" });
    await scene.page.keyboard.press("Escape");
  });

  test("② territory: each project has a border in its colour, only on its outer edges", async () => {
    const layout = await scene.layout();
    const mine = new Set(layout.sessions.filter((s) => s.cwd === PROJECT).map((s) => `${s.col},${s.row}`));
    // Edge midpoints lie on the inscribed circle, at 0°, ±60°, ±120°, 180° for a pointy-top hex.
    const edges = [
      { angle: -60, delta: (odd: boolean) => (odd ? [1, -1] : [0, -1]) },
      { angle: 0, delta: () => [1, 0] },
      { angle: 60, delta: (odd: boolean) => (odd ? [1, 1] : [0, 1]) },
      { angle: 120, delta: (odd: boolean) => (odd ? [0, 1] : [-1, 1]) },
      { angle: 180, delta: () => [-1, 0] },
      { angle: -120, delta: (odd: boolean) => (odd ? [0, -1] : [-1, -1]) },
    ];
    let outer: { x: number; y: number } | null = null;
    let inner: { x: number; y: number } | null = null;
    for (const session of layout.sessions.filter((s) => s.cwd === PROJECT)) {
      const odd = ((session.row % 2) + 2) % 2 === 1;
      const centre = hexCentre(session.col, session.row);
      for (const edge of edges) {
        const [dc, dr] = edge.delta(odd);
        const across = `${session.col + (dc ?? 0)},${session.row + (dr ?? 0)}`;
        const rad = (edge.angle * Math.PI) / 180;
        const point = { x: centre.x + Math.cos(rad) * HEX_RADIUS, y: centre.y + Math.sin(rad) * HEX_RADIUS };
        if (!mine.has(across)) outer ??= point;
        else inner ??= point;
      }
    }
    assert.ok(outer && inner, "cluster should have both outer and inner edges");
    const saturation = ([r, g, b]: number[]) => Math.max(r ?? 0, g ?? 0, b ?? 0) - Math.min(r ?? 0, g ?? 0, b ?? 0);
    const outerCss = await scene.worldToCss(outer.x, outer.y);
    const outerPixel = await scene.pixelAtCss(outerCss.cssX, outerCss.cssY);
    assert.ok(saturation(outerPixel.rgb) > 30, `outer edge should carry the project colour, got ${outerPixel.rgb}`);
    const innerCss = await scene.worldToCss(inner.x, inner.y);
    const innerPixel = await scene.pixelAtCss(innerCss.cssX, innerCss.cssY);
    assert.ok(saturation(innerPixel.rgb) < 30, `inner edge must stay plain, got ${innerPixel.rgb}`);
    assert.notEqual(projectHue(PROJECT), projectHue(ATLAS), "projects get different colours");
  });

  test("② territory: banners count sessions, running and waiting; clicking one focuses the project", async () => {
    const { labels } = await scene.layout();
    const byCwd = new Map(labels.map((label) => [label.cwd, label]));
    const main = byCwd.get(PROJECT);
    const atlas = byCwd.get(ATLAS);
    const beacon = byCwd.get(BEACON);
    assert.ok(main && atlas && beacon);
    // Main project: one history session per agent plus the idle / busy / waiting Claude sessions.
    assert.deepEqual([main.total, main.live, main.waiting], [HISTORY_AGENTS.length + 3, 3, 1]);
    assert.deepEqual([atlas.total, atlas.live, atlas.waiting], [4, 1, 1]);
    assert.deepEqual([beacon.total, beacon.live, beacon.waiting], [2, 0, 0]);

    const drawn = await banners();
    assert.equal(drawn.length, 3);
    const beaconBanner = drawn.find((banner) => banner.cwd === BEACON);
    assert.ok(beaconBanner);
    // The banner is an opaque white pill.
    const pill = await scene.worldToCss(beaconBanner.x + beaconBanner.width - 4, beaconBanner.y + beaconBanner.height / 2);
    assert.ok((await scene.pixelAtCss(pill.cssX, pill.cssY)).alpha > 240, "banner should be opaque");
    await scene.shot("f2-territory");

    const centre = await scene.worldToCss(beaconBanner.x + beaconBanner.width / 2, beaconBanner.y + beaconBanner.height / 2);
    await scene.page.mouse.click(centre.cssX, centre.cssY);
    const target = hexCentre(beacon.centre.col, beacon.centre.row);
    await eventually("the camera to centre the beacon project", viewCentre, (point) => near(point, target));
  });

  test("⑤ tooltip: resting on a cell shows its title and state; leaving hides it", async () => {
    // The previous test flew to another project, out of view of this one; bring the camera back.
    const main = (await scene.layout()).labels.find((label) => label.cwd === PROJECT);
    assert.ok(main);
    await scene.page.evaluate(
      ([col, row]) => (window as unknown as { __hexCanvas: { focus(c: number, r: number): void } }).__hexCanvas.focus(col, row),
      [main.centre.col, main.centre.row],
    );
    await eventually("the camera to return to the main project", viewCentre, (point) => near(point, hexCentre(main.centre.col, main.centre.row)));
    const history = scene.story("history", "codex");
    const { cssX, cssY } = await scene.cellPoint(history.id);
    await scene.page.mouse.move(cssX, cssY);
    const tooltip = scene.page.locator("#hex-tooltip");
    await tooltip.waitFor({ state: "visible" });
    assert.equal(await tooltip.locator(".hex-tooltip-title").textContent(), "历史 Codex 会话");
    assert.match((await tooltip.locator(".hex-tooltip-subtitle").textContent()) ?? "", /^codex · gpt-5\.5-codex · /);
    const waiting = await scene.cellPoint(scene.story("waiting").id);
    await scene.page.mouse.move(waiting.cssX, waiting.cssY);
    await eventually("the tooltip to follow to the waiting cell", () => tooltip.locator(".hex-tooltip-subtitle").textContent(), (text) => /等你处理：input needed/.test(text ?? ""));
    await scene.shot("f5-tooltip");
    await scene.page.mouse.move(2, 2);
    await tooltip.waitFor({ state: "hidden" });
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
