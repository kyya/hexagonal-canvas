// The tilted camera (Civ's default view): the ground is foreshortened, sessions stand as hex prisms
// that rise with their message count, icons lie on (and tilt with) their tops while badges and text
// stay upright, and picking hits the prism in
// front. With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { cellGeometry, PHI, STRATEGIC_ZOOM } from "../../src/cells/golden.ts";
import { writeChatty, type Story } from "../fixtures/sessions.ts";
import { HEX_RADIUS, hexCentre, RECT_W } from "../harness.ts";
import { eventually, startScene, VIEWPORT, type Scene } from "./scene.ts";

type Canvas = {
  tilt(): { squash: number; rise: number };
  lift(col: number, row: number): number;
  project(x: number, y: number): { x: number; y: number };
};

describe("tilted view", () => {
  let scene: Scene;
  let chatty: Story;

  before(async () => {
    scene = await startScene({
      setup: (home) => {
        chatty = writeChatty(home, 960, 400, "聊了很久的会话");
        return [chatty];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  const hex = () => (window as unknown as { __hexCanvas: Canvas }).__hexCanvas;
  const tilt = () => scene.page.evaluate(`(${hex})().tilt()`) as Promise<{ squash: number; rise: number }>;
  const cellOf = async (id: string) => {
    const cell = (await scene.layout()).sessions.find((session) => session.id === id);
    assert.ok(cell, `${id} has no cell`);
    return cell;
  };
  const liftOf = async (id: string) => {
    const cell = await cellOf(id);
    return scene.page.evaluate(`(${hex})().lift(${cell.col}, ${cell.row})`) as Promise<number>;
  };
  const tilted = () => eventually("the camera to tilt", tilt, (value) => Math.abs(value.squash - 1 / PHI) < 1e-6);
  const flat = () => eventually("the camera to level", tilt, (value) => value.squash === 1);

  test("T tilts the camera to φ⁻¹ about the screen centre; the 倾斜 chip shows it", async () => {
    await scene.page.mouse.move(2, 2);
    assert.equal((await tilt()).squash, 1, "the map starts top-down");
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const cam = await scene.camera();
    const pivot = { x: cam.x + centre.x / cam.zoom, y: cam.y + centre.y / cam.zoom };
    await scene.page.keyboard.press("t");
    const { rise } = await tilted();
    assert.ok(Math.abs(rise - PHI ** -0.5) < 1e-6, `heights stand φ^-½ tall, got ${rise}`);
    assert.equal(await scene.page.locator(".hud-lens-toggle", { hasText: "倾斜" }).getAttribute("aria-pressed"), "true");
    // The world point at the screen centre stays there; points above and below move towards it.
    const still = await scene.worldToCss(pivot.x, pivot.y);
    assert.ok(Math.hypot(still.cssX - centre.x, still.cssY - centre.y) < 0.5, "the tilt pivots about the screen centre");
    const below = await scene.worldToCss(pivot.x, pivot.y + 100);
    assert.ok(Math.abs(below.cssY - centre.y - 100 / PHI) < 0.5, "ground 100 px below is foreshortened to 100/φ");
    await scene.page.waitForTimeout(300);
    await scene.shot("f11-tilt");
  });

  test("sessions stand as prisms, taller with more messages, with shaded front faces", async () => {
    const layout = await scene.layout();
    const lifts = await Promise.all(layout.sessions.map(async (session) => ({ session, lift: await liftOf(session.id) })));
    assert.ok(lifts.every((item) => item.lift > 0), "every session stands on a plinth");
    const chattyLift = await liftOf(chatty.id);
    const quiet = lifts.reduce((low, item) => (item.lift < low.lift ? item : low));
    assert.ok(chattyLift > quiet.lift * 2, `the chattiest session stands tallest (${chattyLift} vs ${quiet.lift})`);
    assert.equal(Math.max(...lifts.map((item) => item.lift)), chattyLift);

    // Front faces show where nothing stands in front: find a session with both front neighbours empty.
    const occupied = new Set(layout.sessions.map((session) => `${session.col},${session.row}`));
    const front = (col: number, row: number) => {
      const odd = ((row % 2) + 2) % 2 === 1;
      return odd ? [[col, row + 1], [col + 1, row + 1]] : [[col - 1, row + 1], [col, row + 1]];
    };
    const open = lifts
      .filter(({ session }) => front(session.col, session.row).every(([c, r]) => !occupied.has(`${c},${r}`)))
      .sort((a, b) => b.lift - a.lift)[0];
    assert.ok(open, "some session has an open front");
    const { x: cx, y: cy } = hexCentre(open.session.col, open.session.row);
    // On the lower-right edge 10 px right of the bottom vertex, half-way up the face.
    const edgeY = cy + 64 - 10 * (32 / HEX_RADIUS);
    const shade = await scene.worldToCss(cx + 10, edgeY - open.lift / 2);
    const lit = await scene.worldToCss(cx - 10, edgeY - open.lift / 2);
    const shadePixel = await scene.pixelAtCss(shade.cssX, shade.cssY);
    const litPixel = await scene.pixelAtCss(lit.cssX, lit.cssY);
    assert.equal(shadePixel.alpha, 255, "the front face is solid");
    assert.ok(shadePixel.rgb.every((c) => c > 215 && c < 245), `shaded face is light grey, got ${shadePixel.rgb}`);
    assert.ok(litPixel.rgb[0] > shadePixel.rgb[0], `the lower-left face is lit brighter (${litPixel.rgb} vs ${shadePixel.rgb})`);
    const clip = { x: Math.max(0, shade.cssX - RECT_W * 2.5), y: Math.max(0, shade.cssY - RECT_W * 2.2), width: RECT_W * 5, height: RECT_W * 3 };
    await scene.shot("f11-tilt-prisms", clip);
  });

  test("tints fill the raised top, the badge stands upright, and the icon tilts with the face", async () => {
    const waiting = scene.story("waiting");
    await eventually("the waiting tint on the raised top", () => scene.tint(waiting.id), (value) => value === "amber");
    const { squash } = await tilt();
    const g = cellGeometry(HEX_RADIUS, squash);
    const top = await scene.cellPoint(waiting.id);
    const badge = await scene.pixelAtCss(top.cssX + Math.cos(g.badgeAngle) * g.badgeDistance + g.badgeRadius * 0.6, top.cssY + Math.sin(g.badgeAngle) * g.badgeDistance);
    assert.equal(badge.alpha, 255, "the badge is solid");
    assert.ok(badge.rgb[0] > 200 && badge.rgb[2] < 80, `the badge is amber, got ${badge.rgb}`);

    // The icon lies on the top face: the Claude glyph (as tall as it is wide top-down) is
    // foreshortened to φ⁻¹ of its width. A live session's icon is drawn at full strength.
    const claude = scene.story("idle");
    const centre = await scene.cellPoint(claude.id);
    const box = await scene.page.evaluate(
      ([x, y, r]) => {
        const ctx = document.querySelector<HTMLCanvasElement>("#app")?.getContext("2d");
        if (!ctx) return null;
        const data = ctx.getImageData(x - r, y - r, r * 2, r * 2).data;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let j = 0; j < r * 2; j++) {
          for (let i = 0; i < r * 2; i++) {
            const k = (j * r * 2 + i) * 4;
            // Claude's clay orange: red clearly above blue.
            if ((data[k + 3] ?? 0) > 20 && (data[k] ?? 0) - (data[k + 2] ?? 0) > 60) {
              minX = Math.min(minX, i); maxX = Math.max(maxX, i); minY = Math.min(minY, j); maxY = Math.max(maxY, j);
            }
          }
        }
        return { width: maxX - minX, height: maxY - minY };
      },
      [centre.x, centre.y, Math.round(g.iconSize * 1.2)],
    );
    assert.ok(box && box.width > 20, `found the icon ink, got ${JSON.stringify(box)}`);
    const aspect = box.height / box.width;
    assert.ok(Math.abs(aspect - 1 / PHI) < 0.08, `icon ink should be foreshortened to φ⁻¹, got ${aspect}`);
  });

  test("pointing at a raised top picks that prism, not the ground behind it", async () => {
    const cell = await cellOf(chatty.id);
    const lift = await liftOf(chatty.id);
    const { x: cx, y: cy } = hexCentre(cell.col, cell.row);
    // Just inside the top vertex of the raised top face: on the ground, that is another hex.
    const groundY = cy - 64 + 8 - lift;
    const point = await scene.worldToCss(cx, groundY);
    assert.ok(lift > 30, `the chatty prism is tall enough for this check (${lift})`);
    await scene.page.mouse.click(point.cssX, point.cssY, { button: "right" });
    const title = scene.page.locator("#hex-menu .hex-menu-title");
    await title.waitFor();
    assert.equal(await title.textContent(), "聊了很久的会话");
    await scene.page.keyboard.press("Escape");
  });

  test("zooming out to the strategic view levels the map; zooming back in tilts it again", async () => {
    const box = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    await scene.page.mouse.move(box.x, box.y);
    for (let i = 0; i < 6; i++) await scene.page.mouse.wheel(0, 200);
    await eventually("the strategic zoom", scene.camera, (cam) => cam.zoom < STRATEGIC_ZOOM);
    await flat();
    await scene.shot("f11-tilt-strategic");
    for (let i = 0; i < 6; i++) await scene.page.mouse.wheel(0, -200);
    await eventually("zoom back to 1", scene.camera, (cam) => cam.zoom > 0.99);
    await tilted();
  });

  test("the choice is remembered across reloads; T again returns to top-down", async () => {
    await scene.page.reload();
    await eventually("the tilt to be restored", tilt, (value) => Math.abs(value.squash - 1 / PHI) < 1e-6);
    await eventually("sessions after reload", scene.layout, (layout) => layout.sessions.length > 0);
    await scene.page.keyboard.press("t");
    await flat();
    assert.equal(await liftOf(chatty.id), 0, "top-down cells are flat");
    assert.equal(await scene.page.locator(".hud-lens-toggle", { hasText: "倾斜" }).getAttribute("aria-pressed"), "false");
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
