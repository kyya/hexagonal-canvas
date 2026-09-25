// Batch 2 of the Civ-style features: lenses, the strategic view with its minimap, and the fog of
// war. With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { STRATEGIC_ZOOM } from "../../src/cells/golden.ts";
import { writeAged, type Story } from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre } from "../harness.ts";
import { eventually, startScene, tintOf, VIEWPORT, type Scene } from "./scene.ts";

const hexOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

// Which of the reference colours the composited pixel is closest to in hue direction.
function closest(rgb: [number, number, number], references: Record<string, string>): string {
  const toward = (target: [number, number, number]) => {
    // Remove the white base: a tint over white moves each channel from 255 toward the colour.
    const delta = rgb.map((channel) => 255 - channel);
    const reference = target.map((channel) => 255 - channel);
    const norm = (v: number[]) => Math.hypot(...v) || 1;
    return delta.reduce((sum, value, i) => sum + value * (reference[i] ?? 0), 0) / (norm(delta) * norm(reference));
  };
  return Object.entries(references).sort(([, a], [, b]) => toward(hexOf(b)) - toward(hexOf(a)))[0]?.[0] ?? "";
}

describe("lenses, strategic view and stale sessions", () => {
  let scene: Scene;
  let ancient: Story;
  let older: Story;
  let recent: Story;

  before(async () => {
    scene = await startScene({
      setup: (home) => {
        ancient = writeAged(home, 900, 90, "三个月前的老会话");
        older = writeAged(home, 902, 20, "二十天前的会话");
        recent = writeAged(home, 901, 2, "前天的会话");
        return [ancient, older, recent];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  const lensTab = (label: string) => scene.page.locator(".hud-lens-tabs button", { hasText: label });

  test("③ lenses: switching recolours every session and updates the legend", async () => {
    assert.equal(await lensTab("状态").getAttribute("aria-selected"), "true");

    await lensTab("工具").click();
    const codex = scene.story("history", "codex");
    const claude = scene.story("history", "claude");
    const at = async (id: string) => (await scene.pixel(id, 0, HEX_RADIUS * 0.75)).rgb;
    const references = { claude: "#d97757", codex: "#10a37f", gemini: "#4285f4" };
    await eventually("codex to take its brand colour", async () => closest(await at(codex.id), references), (value) => value === "codex");
    assert.equal(closest(await at(claude.id), references), "claude");
    assert.equal(closest(await at(scene.story("history", "gemini").id), references), "gemini");
    const legend = scene.page.locator(".hud-legend");
    for (const name of ["Claude Code", "Codex", "Gemini CLI", "Kimi Code"]) assert.ok(((await legend.textContent()) ?? "").includes(name), `legend lists ${name}`);
    await scene.shot("f3-lens-agent");

    // Recency: the two-day-old session glows stronger than the twenty-day-old one.
    await scene.page.keyboard.press("2");
    assert.equal(await lensTab("新旧").getAttribute("aria-selected"), "true");
    const strength = async (id: string) => {
      const { alpha } = await scene.pixel(id, 0, HEX_RADIUS * 0.75);
      return alpha;
    };
    await eventually("recent to glow over older", async () => (await strength(recent.id)) - (await strength(older.id)), (gap) => gap > 40);
    await scene.shot("f3-lens-recency");

    // Messages lens: legend reports the maximum.
    await scene.page.keyboard.press("5");
    assert.match((await legend.textContent()) ?? "", /\d+ 条/);

    // Back to status: live tints return, and the choice is remembered.
    await scene.page.keyboard.press("1");
    await eventually("the waiting tint to return", () => scene.tint(scene.story("waiting").id), (value) => value === "amber");
    assert.equal(await scene.page.evaluate(() => localStorage.getItem("hexagonal-canvas.lens")), "status");
  });

  test("④ strategic view: below zoom φ⁻¹ cells turn into flat colour without icons", async () => {
    const claude = scene.story("history", "claude");

    // Zoom out with the wheel until the strategic view kicks in.
    await scene.page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await eventually(
      "the camera to zoom out past φ⁻¹",
      async () => {
        await scene.page.mouse.wheel(0, 400);
        return (await scene.camera()).zoom;
      },
      (zoom) => zoom < STRATEGIC_ZOOM,
    );
    // A live cell is a flat block: its centre (where the icon was) has the same colour as its edge.
    const busy = scene.story("busy");
    const centre = await scene.pixel(busy.id);
    const edge = await scene.pixel(busy.id, 0, HEX_RADIUS * 0.75);
    assert.equal(tintOf(centre.rgb), "blue", `busy centre should be flat blue, got ${centre.rgb}`);
    assert.ok(Math.abs(centre.alpha - edge.alpha) < 8, `flat fill expected, centre ${centre.alpha} vs edge ${edge.alpha}`);
    // History cells take a pale wash of their project colour instead of disappearing.
    assert.ok((await scene.pixel(claude.id)).alpha > 0, "history cell should keep a wash in the strategic view");
    await scene.shot("f4-strategic");
  });

  test("④ minimap: shows every session and moves the camera when clicked", async () => {
    const minimap = scene.page.locator(".hud-minimap canvas");
    await minimap.waitFor({ state: "visible" });
    const box = await minimap.boundingBox();
    assert.ok(box);
    // Some dots are drawn.
    const drawn = await minimap.evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray();
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count++;
      return count;
    });
    assert.ok(drawn > 200, `minimap should draw sessions, got ${drawn} pixels`);

    const before = await scene.camera();
    await scene.page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.5);
    const after = await eventually("the camera to move", () => scene.camera(), (cam) => Math.abs(cam.x - before.x) > 20);
    assert.ok(after.x < before.x, "clicking the left of the minimap moves the camera left");
    await scene.shot("f4-minimap", { x: 0, y: VIEWPORT.height - 160, width: 260, height: 160 });
  });

  test("⑨ stale sessions leave the map for their project's coin stack; recent history stays", async () => {
    const layout = await scene.layout();
    const byId = new Map(layout.sessions.map((session) => [session.id, session]));
    assert.equal(byId.get(ancient.id)?.stacked, true, "the ninety-day-old session is piled");
    assert.equal(byId.get(recent.id)?.stacked, false, "recent history keeps its hex");
    assert.equal(byId.get(older.id)?.stacked, false, "twenty days is not stale yet");
    const stack = layout.stacks.find((item) => item.sessions.some((session) => session.id === ancient.id));
    assert.ok(stack, "the ancient session is in a stack");
    const cell = byId.get(ancient.id);
    assert.ok(cell);
    await scene.page.evaluate(
      ([col, row]) => (window as unknown as { __hexCanvas: { focus(c: number, r: number): void } }).__hexCanvas.focus(col, row),
      [cell.col, cell.row],
    );
    const target = hexCentre(cell.col, cell.row);
    await eventually("the camera to reach the stack", () => scene.camera(), (cam) =>
      Math.abs(cam.x + VIEWPORT.width / 2 / cam.zoom - target.x) < 2 && cam.zoom >= 1,
    );
    // The pile's top coin is solid silver at the hex centre.
    const coin = await scene.pixel(ancient.id, HEX_RADIUS * 0.3, 0);
    assert.equal(coin.alpha, 255, "a coin covers the stack's hex");
    const spread = Math.max(...coin.rgb) - Math.min(...coin.rgb);
    assert.ok(spread < 16, `coins are silver grey, got ${coin.rgb}`);
    const point = await scene.cellPoint(ancient.id);
    await scene.page.mouse.move(point.cssX, point.cssY);
    await scene.page.locator("#hex-tooltip").getByText("1 个过时会话").waitFor();
    await scene.shot("f9-stack", { x: Math.max(0, point.cssX - 220), y: Math.max(0, point.cssY - 160), width: 440, height: 300 });
    await scene.page.mouse.move(2, 2);
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
