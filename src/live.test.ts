// Locks how stale sessions are piled into coin stacks by the layout (src/live.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isStale, place, type ApiSession } from "./live.ts";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const DAY = 86_400_000;

function session(id: string, cwd: string, daysAgo: number, live = false): ApiSession {
  const at = new Date(NOW - daysAgo * DAY).toISOString();
  return { id, agent: "claude", title: id, cwd, live, status: live ? "idle" : null, waitingFor: null, createdAt: at, updatedAt: at, model: null, messages: 2, resume: null, parentId: null, relation: null };
}

describe("coin stacks in the layout", () => {
  const sessions = [
    session("fresh-1", "/a", 1),
    session("fresh-2", "/a", 3),
    session("old-1", "/a", 40),
    session("old-2", "/a", 400),
    session("old-live", "/a", 90, true),
    session("b-old", "/b", 60),
    session("c-fresh", "/c", 2),
  ];
  const layout = place(sessions, { now: NOW });
  const byId = new Map(layout.sessions.map((item) => [item.id, item]));

  test("stale means history untouched for 30 days; running sessions never are", () => {
    assert.equal(isStale(session("x", "/a", 29), NOW), false);
    assert.equal(isStale(session("x", "/a", 30), NOW), true);
    assert.equal(isStale(session("x", "/a", 300, true), NOW), false);
  });

  test("each project with stale sessions gets one stack, newest first, sharing one hex", () => {
    assert.deepEqual(layout.stacks.map((stack) => [stack.cwd, stack.sessions.map((item) => item.id)]), [
      ["/a", ["old-1", "old-2"]],
      ["/b", ["b-old"]],
    ]);
    const [a] = layout.stacks;
    assert.ok(a);
    for (const id of ["old-1", "old-2"]) {
      const item = byId.get(id);
      assert.deepEqual([item?.col, item?.row, item?.stacked], [a.col, a.row, true]);
    }
    assert.equal(byId.get("old-live")?.stacked, false, "a running session stays on its own hex");
    assert.equal(byId.get("fresh-1")?.stacked, false);
  });

  test("the stack takes one hex at the front of its cluster; no other session shares it", () => {
    const [a] = layout.stacks;
    assert.ok(a);
    const project = layout.sessions.filter((item) => item.cwd === "/a" && !item.stacked);
    assert.ok(project.every((item) => item.row <= a.row), "nothing in the project lies in front of the pile");
    assert.ok(project.every((item) => item.col !== a.col || item.row !== a.row));
    const cells = new Set(layout.sessions.filter((item) => !item.stacked).map((item) => `${item.col},${item.row}`));
    assert.equal(cells.size, layout.sessions.filter((item) => !item.stacked).length, "active sessions each have their own hex");
  });

  test("banner counts still include piled sessions", () => {
    const label = layout.labels.find((item) => item.cwd === "/a");
    assert.equal(label?.total, 5);
  });

  test("without stacking (the replay), every session has its own hex", () => {
    const flat = place(sessions, { now: NOW, stack: false });
    assert.equal(flat.stacks.length, 0);
    assert.ok(flat.sessions.every((item) => !item.stacked));
    assert.equal(new Set(flat.sessions.map((item) => `${item.col},${item.row}`)).size, sessions.length);
  });
});
