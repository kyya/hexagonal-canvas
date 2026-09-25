// End-to-end: fixture sessions on disk → server discovery → SSE → canvas pixels, menu and live
// updates in a real browser. Runs against a private copy of the app (fixture $HOME, free ports), so
// it never touches the real $HOME or a running `pnpm dev`.
//
//   pnpm test:e2e
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ApiSession } from "../../src/live.ts";
import { addClaudeSession, appendClaudeReply, PROJECT, registerLive } from "../fixtures/sessions.ts";
import { OUTPUT_SCALE } from "../harness.ts";
import { eventually, geometry, startScene, type Scene } from "./scene.ts";

describe("canvas end to end", () => {
  let scene: Scene;
  const story: Scene["story"] = (state, agent) => scene.story(state, agent);

  before(async () => {
    scene = await startScene();
  });

  after(async () => {
    await scene?.close();
  });

  test("the server discovers every agent's sessions with the right state", async () => {
    const sessions = new Map((await scene.app.sessions()).map((session) => [session.id, session]));
    for (const item of scene.stories) {
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
    assert.equal(await scene.tint(story("idle").id), "green");
    assert.equal(await scene.tint(story("waiting").id), "amber");
    // Busy breathes shallow; any frame is still blue.
    assert.equal(await scene.tint(story("busy").id), "blue");
    for (const agent of ["claude", "codex", "gemini"]) {
      assert.equal(await scene.tint(story("history", agent).id), "none", `history ${agent}`);
    }
  });

  test("only the waiting cell carries the solid badge", async () => {
    const waiting = await scene.badge(story("waiting").id);
    const [r, g, b] = waiting.rgb;
    assert.ok(waiting.alpha > 240, `waiting badge should be opaque, got alpha ${waiting.alpha}`);
    assert.ok(r > 220 && g > 120 && g < 200 && b < 80, `waiting badge should be solid amber, got ${waiting.rgb}`);
    for (const state of ["idle", "busy"] as const) {
      const other = await scene.badge(story(state).id);
      // Only the soft state tint may be there (well under φ⁻² opacity), never a solid mark.
      assert.ok(other.alpha < 128, `${state} must not have a badge, got alpha ${other.alpha} (${other.rgb})`);
    }
  });

  test("the tab title counts sessions waiting on you", async () => {
    assert.match(await scene.page.title(), /^\(1\) 等你处理 · /);
  });

  test("right-click opens details, resume command and the conversation", async () => {
    const { cssX, cssY } = await scene.cellPoint(story("waiting").id);
    await scene.page.mouse.click(cssX, cssY, { button: "right" });
    const menu = scene.page.locator("#hex-menu");
    await menu.waitFor({ state: "visible" });
    assert.equal(await menu.locator(".hex-menu-title").textContent(), "运行中 · 等你处理");
    assert.match((await menu.locator(".hex-menu-subtitle").textContent()) ?? "", /等你处理：input needed/);
    assert.match((await menu.locator(".hex-menu-command").textContent()) ?? "", /claude --resume 00000000-/);
    const transcript = menu.locator(".hex-menu-transcript");
    await transcript.getByText("好的，已经处理完了。").waitFor();
    assert.match((await transcript.textContent()) ?? "", /运行中 · 等你处理/);
  });

  test("an open conversation picks up new replies while the session runs", async () => {
    appendClaudeReply(scene.home, story("waiting").id, "端到端追加的一条回复");
    await scene.page.locator(".hex-menu-transcript").getByText("端到端追加的一条回复").waitFor({ timeout: 20_000 });
    await scene.page.keyboard.press("Escape");
    await scene.page.locator("#hex-menu").waitFor({ state: "hidden" });
  });

  test("a status change reaches the canvas and the tab title", async () => {
    const busy = story("busy");
    registerLive(scene.home, { ...busy, state: "waiting", waitingFor: "dialog open" }, scene.pids.get(busy.id) ?? 0);
    await eventually("the busy cell to turn amber", () => scene.tint(busy.id), (value) => value === "amber");
    await eventually("the title to count two", () => scene.page.title(), (title) => title.startsWith("(2) "));
  });

  test("a session whose process exits falls back to history", async () => {
    const idle = story("idle");
    process.kill(scene.pids.get(idle.id) ?? 0);
    await scene.app.waitForSessions((list) => list.find((session) => session.id === idle.id)?.live === false, "idle to end");
    await eventually("the idle tint to clear", () => scene.tint(idle.id), (value) => value === "none");
  });

  test("a new session file adds a cell", async () => {
    const id = addClaudeSession(scene.home, 500, "端到端新会话");
    await scene.app.waitForSessions((list) => list.some((session) => session.id === id), "the new session");
    // A faded Claude icon has terracotta pixels (red well above blue) around the cell centre.
    const { x, y } = await scene.cellPoint(id);
    const size = Math.round(geometry.iconSize * OUTPUT_SCALE);
    await eventually(
      "the new cell's icon",
      () =>
        scene.page.evaluate(
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
    assert.deepEqual(scene.pageErrors, []);
  });
});
