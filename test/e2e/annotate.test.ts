// Batch 3 of the Civ-style features: per-cell yield numbers, map search, and map pins with notes.
// With E2E_SHOTS set, each test saves its verification screenshot.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { hexCentre, HEX_RADIUS, OUTPUT_SCALE, RECT_W } from "../harness.ts";
import { writeChatty, type Story } from "../fixtures/sessions.ts";
import { eventually, geometry, startScene, VIEWPORT, type Scene } from "./scene.ts";

describe("yields, search and map pins", () => {
  let scene: Scene;

  let chatty: Story;

  before(async () => {
    scene = await startScene({
      setup: (home) => {
        chatty = writeChatty(home, 950, 1234, "聊了很久的会话");
        return [chatty];
      },
    });
  });

  after(async () => {
    await scene?.close();
  });

  // A teal pixel inside the yield pill: left of the number (white), below the icon it overlaps.
  const yieldPixel = async (id: string) =>
    scene.pixel(id, -geometry.yieldFont * 0.45, geometry.yieldOffset + geometry.yieldHeight * 0.3);

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
    const toggle = scene.page.locator(".hud-lens-toggle", { hasText: "数字" });
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
    assert.match((await results.first().textContent()) ?? "", /历史 Kimi 会话.*Kimi Code · hexagonal/);
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

    // The tack's head is drawn in rose red above the hex centre (its middle has a white dot).
    const tack = async () => {
      const point = await scene.worldToCss(centre.x + geometry.pinHeadRadius * 0.6, centre.y + geometry.pinHeadY);
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

  test("text safe zone: yield pills and pin notes never enter the band along the hex edges", async () => {
    // Worst cases: every yield pill on, and a pin whose note is far wider than a cell.
    await scene.page.evaluate(() => localStorage.setItem("hexagonal-canvas.toggle.yields", "1"));
    const { sessions } = await scene.layout();
    const rightmost = sessions.reduce((best, session) => (session.col > best.col ? session : best));
    const pin = { col: rightmost.col + 2, row: rightmost.row };
    await scene.page.evaluate(
      (value) => localStorage.setItem("hexagonal-canvas.pins", JSON.stringify([value])),
      // Full blocks ink their whole glyph box, so any overflow shows up in the band.
      { ...pin, note: "████████████████████████" },
    );
    await scene.page.reload();
    const claude = scene.story("history", "claude");
    await eventually("yields to be drawn", () => yieldPixel(claude.id), (pixel) => pixel.alpha > 200);

    // Hexes without a state tint: history sessions of several agents, and the pin.
    const centres: { label: string; x: number; y: number }[] = [];
    for (const agent of ["claude", "codex", "kimi", "gemini", "dsh"]) {
      const cell = sessions.find((session) => session.id === scene.story("history", agent).id);
      assert.ok(cell);
      centres.push({ label: agent, ...hexCentre(cell.col, cell.row) });
    }
    // 1234 messages: the widest yield number the fixtures produce (shown as "1.2k").
    const chattyCell = sessions.find((session) => session.id === chatty.id);
    assert.ok(chattyCell && chattyCell.messages === 1234, "chatty fixture should report 1234 messages");
    centres.push({ label: "1234 messages", ...hexCentre(chattyCell.col, chattyCell.row) });
    centres.push({ label: "pin", ...hexCentre(pin.col, pin.row) });

    const margin = HEX_RADIUS - geometry.safeApothem;
    const cam = await scene.camera();
    // Dense rings through the band, from just inside the edge stroke to just outside the safe line.
    const points: { label: string; depth: number; x: number; y: number }[] = [];
    for (const centre of centres) {
      for (const depth of [0.3, 0.55, 0.8, 0.95]) {
        const apothem = HEX_RADIUS - margin * depth;
        const radius = apothem / Math.cos(Math.PI / 6);
        const corners = [-90, -30, 30, 90, 150, 210].map((deg) => ({
          x: centre.x + radius * Math.cos((deg * Math.PI) / 180),
          y: centre.y + radius * Math.sin((deg * Math.PI) / 180),
        }));
        for (let edge = 0; edge < 6; edge++) {
          const a = corners[edge];
          const b = corners[(edge + 1) % 6];
          if (!a || !b) continue;
          for (let step = 1; step < 48; step++) {
            const t = step / 48;
            const wx = a.x + (b.x - a.x) * t;
            const wy = a.y + (b.y - a.y) * t;
            points.push({ label: centre.label, depth, x: Math.round((wx - cam.x) * cam.zoom * OUTPUT_SCALE), y: Math.round((wy - cam.y) * cam.zoom * OUTPUT_SCALE) });
          }
        }
      }
    }
    const offenders = await scene.page.evaluate((list) => {
      const ctx = document.querySelector<HTMLCanvasElement>("#app")?.getContext("2d");
      if (!ctx) return ["no canvas"];
      const found: string[] = [];
      for (const point of list) {
        const alpha = ctx.getImageData(point.x, point.y, 1, 1).data[3] ?? 0;
        if (alpha >= 24) found.push(`${point.label} at ${Math.round(point.depth * 100)}% of the margin (alpha ${alpha})`);
      }
      return found;
    }, points);
    const checked = points.length;
    assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} band pixels are drawn on`);
    assert.ok(checked > 700, `sampled ${checked} band points`);
    await scene.shot("safe-zone", await (async () => {
      const at = await scene.worldToCss(centres[0]?.x ?? 0, centres[0]?.y ?? 0);
      return { x: Math.max(0, at.cssX - 380), y: Math.max(0, at.cssY - 260), width: 900, height: 520 };
    })());
  });

  test("no page errors", () => {
    assert.deepEqual(scene.pageErrors, []);
  });
});
