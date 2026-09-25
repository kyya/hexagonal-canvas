// Shared by the end-to-end tests and the cell-storybook skill.
// Writes a throwaway $HOME holding one session per agent in that agent's real on-disk format, plus
// Claude sessions that the storybook registers as live (idle / busy / waiting). Every session lives
// in the same project so the canvas lays them out as one cluster, in `createdAt` order.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PROJECT = "/storybook/hexagonal";

export type LiveStatus = "idle" | "busy" | "waiting";

export type Story = {
  id: string; // agent:nativeId, as the server reports it
  agent: string;
  state: "history" | LiveStatus;
  label: string;
  waitingFor?: string;
};

// Every agent the server has an adapter for. Order here is the order on the sheet.
export const HISTORY_AGENTS = [
  "claude",
  "codex",
  "qoder",
  "codebuddy",
  "workbuddy",
  "gemini",
  "pi",
  "omp",
  "grok",
  "kimi",
  "kiro",
  "dsh",
] as const;

// A week ago, so fixtures stay "recent" whenever the tests run (fog of war starts at 30 days).
const DAY = 86_400_000;
const BASE = Math.floor((Date.now() - 7 * DAY) / DAY) * DAY + 10 * 3_600_000;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function slugOf(cwd: string): string {
  return `-${cwd.replace(/^\/+/, "").replaceAll("/", "-")}`;
}
const slug = slugOf(PROJECT);

export function claudeSessionFile(home: string, id: string, dir = ".claude", cwd = PROJECT): string {
  return join(home, dir, "projects", slugOf(cwd), `${id}.jsonl`);
}

function claudeLike(home: string, dir: string, id: string, at: number, prompt: string, model: string, cwd = PROJECT): void {
  write(
    claudeSessionFile(home, id, dir, cwd),
    jsonl([
      { type: "user", cwd, sessionId: id, timestamp: new Date(at).toISOString(), message: { role: "user", content: prompt } },
      {
        type: "assistant",
        cwd,
        sessionId: id,
        timestamp: new Date(at + 5000).toISOString(),
        message: { id: `msg-${id}`, role: "assistant", model, content: [{ type: "text", text: "好的，已经处理完了。" }] },
      },
    ]),
  );
}

// One writer per agent; each takes the session's index so createdAt (and so the layout) is ordered.
const writers: Record<(typeof HISTORY_AGENTS)[number], (home: string, n: number) => string> = {
  claude(home, n) {
    const id = uuid(n);
    claudeLike(home, ".claude", id, BASE + n * 60_000, "历史 Claude 会话", "claude-opus-5-5");
    return id;
  },
  codex(home, n) {
    const id = uuid(n);
    const at = new Date(BASE + n * 60_000).toISOString();
    write(
      join(home, ".codex", "sessions", "2026", "09", "01", `rollout-2026-09-01T10-00-00-${id}.jsonl`),
      jsonl([
        { timestamp: at, type: "session_meta", payload: { id, cwd: PROJECT, originator: "codex_cli_rs", source: "cli" } },
        { timestamp: at, type: "turn_context", payload: { cwd: PROJECT, model: "gpt-5.5-codex" } },
        { timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "历史 Codex 会话" }] } },
        { timestamp: at, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "完成。" }] } },
      ]),
    );
    return id;
  },
  qoder(home, n) {
    const id = uuid(n);
    claudeLike(home, ".qoder", id, BASE + n * 60_000, "历史 Qoder 会话", "performance");
    return id;
  },
  codebuddy(home, n) {
    return buddy(home, ".codebuddy", n, "历史 CodeBuddy 会话");
  },
  workbuddy(home, n) {
    return buddy(home, ".workbuddy", n, "历史 WorkBuddy 会话");
  },
  gemini(home, n) {
    const id = uuid(n);
    const at = new Date(BASE + n * 60_000).toISOString();
    write(join(home, ".gemini", "projects.json"), JSON.stringify({ projects: { [PROJECT]: "storybook" } }));
    write(
      join(home, ".gemini", "tmp", "storybook", "chats", "session-2026-09-01T10-00-00.jsonl"),
      jsonl([
        { sessionId: id, startTime: at, lastUpdated: at },
        { $set: { messages: [{ type: "user", content: [{ text: "历史 Gemini 会话" }], timestamp: at }, { type: "gemini", content: [{ text: "完成。" }], timestamp: at }] } },
      ]),
    );
    return id;
  },
  pi(home, n) {
    return piLike(home, ".pi", n, "历史 Pi 会话");
  },
  omp(home, n) {
    return piLike(home, ".omp", n, "历史 Oh My Pi 会话");
  },
  grok(home, n) {
    const id = uuid(n);
    const at = BASE + n * 60_000;
    const dir = join(home, ".grok", "sessions", encodeURIComponent(PROJECT), id);
    write(
      join(dir, "updates.jsonl"),
      jsonl([
        { timestamp: at / 1000, method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", content: { text: "历史 Grok 会话" } } } },
        { timestamp: at / 1000 + 5, method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "完成。" } } } },
      ]),
    );
    write(
      join(dir, "summary.json"),
      JSON.stringify({ generated_title: "历史 Grok 会话", info: { cwd: PROJECT }, created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString() }),
    );
    return id;
  },
  kimi(home, n) {
    const id = `session_${uuid(n)}`;
    const at = new Date(BASE + n * 60_000).toISOString();
    const dir = join(home, ".kimi-code", "sessions", "wd_storybook_0", id);
    write(join(dir, "state.json"), JSON.stringify({ title: "历史 Kimi 会话", createdAt: at, updatedAt: at }));
    write(
      join(dir, "agents", "main", "wire.jsonl"),
      jsonl([
        { type: "turn.prompt", input: [{ type: "text", text: "历史 Kimi 会话" }] },
        { type: "context.append_message", message: { role: "assistant", content: [{ type: "text", text: "完成。" }] } },
      ]),
    );
    write(join(home, ".kimi-code", "session_index.jsonl"), jsonl([{ sessionId: id, workDir: PROJECT }]));
    return id;
  },
  kiro(home, n) {
    const id = uuid(n);
    const at = BASE + n * 60_000;
    const dir = join(home, ".kiro", "sessions", "cli");
    write(join(dir, `${id}.json`), JSON.stringify({ cwd: PROJECT, title: "历史 Kiro 会话", created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString() }));
    write(
      join(dir, `${id}.jsonl`),
      jsonl([{ kind: "Prompt", data: { content: [{ kind: "text", data: "历史 Kiro 会话" }], meta: { timestamp: at / 1000 } } }]),
    );
    return id;
  },
  dsh(home, n) {
    const id = `dsh-${n}`;
    const at = BASE + n * 60_000;
    write(
      join(home, ".dsh", "sessions", "storybook", "s1", "session.jsonl"),
      jsonl([
        { type: "session", id, createdAt: at, cwd: PROJECT },
        { type: "user/message", time: at, data: { content: "历史 DeepSeek 会话" } },
      ]),
    );
    return id;
  },
};

function buddy(home: string, dir: string, n: number, prompt: string): string {
  const id = uuid(n);
  const at = BASE + n * 60_000;
  write(
    join(home, dir, "projects", slug, `${id}.jsonl`),
    jsonl([
      { type: "message", role: "user", timestamp: at, cwd: PROJECT, content: [{ type: "input_text", text: prompt }] },
      { type: "message", role: "assistant", timestamp: at + 5000, cwd: PROJECT, content: [{ type: "output_text", text: "完成。" }] },
    ]),
  );
  return id;
}

function piLike(home: string, dir: string, n: number, prompt: string): string {
  const id = uuid(n);
  const at = new Date(BASE + n * 60_000).toISOString();
  write(
    join(home, dir, "agent", "sessions", "--storybook--", `2026-09-01T10-00-00-000Z_${id}.jsonl`),
    jsonl([
      { type: "session", version: 3, id, timestamp: at, cwd: PROJECT },
      { type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text: prompt }] } },
    ]),
  );
  return id;
}

// Live stories come first so they sit at the centre of the cluster.
export const LIVE_STORIES: { state: LiveStatus; label: string; waitingFor?: string }[] = [
  { state: "idle", label: "运行中 · 空闲" },
  { state: "busy", label: "运行中 · 工作中" },
  { state: "waiting", label: "运行中 · 等你处理", waitingFor: "input needed" },
];

export function writeFixtures(home: string, agents: readonly string[]): Story[] {
  const stories: Story[] = [];
  let n = 1;
  for (const live of LIVE_STORIES) {
    const id = uuid(n);
    claudeLike(home, ".claude", id, BASE + n * 60_000, live.label, "claude-opus-5-5");
    stories.push({ id: `claude:${id}`, agent: "claude", state: live.state, label: live.label, waitingFor: live.waitingFor });
    n++;
  }
  for (const agent of agents) {
    const writer = writers[agent as (typeof HISTORY_AGENTS)[number]];
    if (!writer) throw new Error(`No fixture writer for agent "${agent}"`);
    const nativeId = writer(home, 100 + n);
    stories.push({ id: `${agent}:${nativeId}`, agent, state: "history", label: `历史 · ${agent}` });
    n++;
  }
  return stories;
}

// Claude Code's live-session registry: ~/.claude/sessions/<pid>.json with a status field.
export function registerLive(home: string, story: Story, pid: number): void {
  const sessionId = story.id.slice("claude:".length);
  write(
    join(home, ".claude", "sessions", `${pid}.json`),
    JSON.stringify({
      pid,
      sessionId,
      startedAt: BASE,
      kind: "interactive",
      status: story.state,
      ...(story.waitingFor ? { waitingFor: story.waitingFor } : {}),
    }),
  );
}

// A new Claude session appearing mid-test (the canvas should add a cell for it).
export function addClaudeSession(home: string, n: number, prompt: string): string {
  const id = uuid(n);
  claudeLike(home, ".claude", id, BASE + n * 60_000, prompt, "claude-opus-5-5");
  return `claude:${id}`;
}

// The agent writing another reply into an existing Claude session.
export function appendClaudeReply(home: string, storyId: string, text: string): void {
  const id = storyId.slice("claude:".length);
  appendFileSync(
    claudeSessionFile(home, id),
    JSON.stringify({
      type: "assistant",
      cwd: PROJECT,
      sessionId: id,
      timestamp: new Date().toISOString(),
      message: { id: `msg-${Date.now()}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }] },
    }) + "\n",
  );
}

// Claude sessions in another project, so the canvas has several clusters (borders, banners, jumps).
export function writeProject(home: string, cwd: string, firstN: number, prompts: string[]): Story[] {
  return prompts.map((prompt, index) => {
    const n = firstN + index;
    const id = uuid(n);
    claudeLike(home, ".claude", id, BASE + n * 60_000, prompt, "claude-opus-5-5", cwd);
    return { id: `claude:${id}`, agent: "claude", state: "history" as const, label: prompt };
  });
}

// Register a live Claude session for any story (e.g. one from writeProject) in the given state.
export function registerLiveAs(home: string, story: Story, pid: number, state: LiveStatus, waitingFor?: string): Story {
  const live = { ...story, state, waitingFor };
  registerLive(home, live, pid);
  return live;
}

// A Claude session last touched `daysAgo` days ago (fog of war covers old ones).
export function writeAged(home: string, n: number, daysAgo: number, prompt: string): Story {
  const id = uuid(n);
  claudeLike(home, ".claude", id, Date.now() - daysAgo * DAY, prompt, "claude-opus-5-5");
  return { id: `claude:${id}`, agent: "claude", state: "history", label: prompt };
}

function codexThread(home: string, id: string, at: number, prompt: string, meta: Record<string, unknown>): void {
  const time = new Date(at).toISOString();
  write(
    join(home, ".codex", "sessions", "2026", "09", "02", `rollout-2026-09-02T10-00-00-${id}.jsonl`),
    jsonl([
      { timestamp: time, type: "session_meta", payload: { id, cwd: PROJECT, originator: "codex_cli_rs", source: "cli", ...meta } },
      { timestamp: time, type: "turn_context", payload: { cwd: PROJECT, model: "gpt-5.5-codex" } },
      { timestamp: time, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } },
    ]),
  );
}

// A Codex thread with a spawned sub-agent and a fork of it, created one after another.
export function writeCodexFamily(home: string, firstN: number): { parent: Story; spawn: Story; fork: Story } {
  const [parentId, spawnId, forkId] = [uuid(firstN), uuid(firstN + 1), uuid(firstN + 2)];
  codexThread(home, parentId, BASE + firstN * 60_000, "Codex 主线程：重构支付", {});
  codexThread(home, spawnId, BASE + (firstN + 1) * 60_000, "子任务", {
    source: { subagent: { thread_spawn: { parent_thread_id: parentId, agent_path: "/root/payments_tests", agent_nickname: "tests" } } },
  });
  codexThread(home, forkId, BASE + (firstN + 2) * 60_000, "Codex 分叉：换个方案", { forked_from_id: parentId });
  const story = (id: string, label: string): Story => ({ id: `codex:${id}`, agent: "codex", state: "history", label });
  return { parent: story(parentId, "Codex 主线程：重构支付"), spawn: story(spawnId, "payments_tests"), fork: story(forkId, "Codex 分叉：换个方案") };
}

// A Grok session with a sub-agent registered under it (subagents/<x>/meta.json).
export function writeGrokFamily(home: string, firstN: number): { parent: Story; child: Story } {
  const group = join(home, ".grok", "sessions", encodeURIComponent(PROJECT));
  const make = (id: string, n: number, title: string) => {
    const at = BASE + n * 60_000;
    write(
      join(group, id, "updates.jsonl"),
      jsonl([{ timestamp: at / 1000, method: "session/update", params: { update: { sessionUpdate: "user_message_chunk", content: { text: title } } } }]),
    );
    write(
      join(group, id, "summary.json"),
      JSON.stringify({ generated_title: title, info: { cwd: PROJECT }, created_at: new Date(at).toISOString(), updated_at: new Date(at).toISOString() }),
    );
  };
  const parentId = uuid(firstN);
  const childId = uuid(firstN + 1);
  make(parentId, firstN, "Grok 编排任务");
  make(childId, firstN + 1, "Grok 子代理：查文档");
  write(join(group, parentId, "subagents", "docs", "meta.json"), JSON.stringify({ parent_session_id: parentId, child_session_id: childId, subagent_id: "docs" }));
  const story = (id: string, label: string): Story => ({ id: `grok:${id}`, agent: "grok", state: "history", label });
  return { parent: story(parentId, "Grok 编排任务"), child: story(childId, "Grok 子代理：查文档") };
}
