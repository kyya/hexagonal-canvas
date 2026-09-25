// Session-file adapters, ported from Wake (https://github.com/iAmCorey/Wake, MIT) — see
// crates/wake-core/src/adapters/*.rs there. Each adapter lists session files cheaply and parses one
// file into a list entry plus its user/assistant turns. Everything here is read-only.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import * as zlib from "node:zlib";
import { basename, dirname, join } from "node:path";
import type { Adapter, Turn } from "./types.ts";
import {
  cleanPrompt,
  entries,
  firstPrompt,
  home,
  isDir,
  isFile,
  isScaffolding,
  iso,
  jsonLines,
  mtimeIso,
  num,
  obj,
  readJson,
  readText,
  rootFrom,
  str,
  textOf,
  titleFrom,
  walk,
  type Json,
} from "./util.ts";

const UNTITLED = "Untitled";

function nonEmptyJsonl(name: string, path: string): boolean {
  if (name.startsWith(".") || !name.endsWith(".jsonl")) return false;
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

function stem(path: string, ext = ".jsonl"): string {
  return basename(path, ext);
}

// `root/*.jsonl` and `root/<project>/*.jsonl`, never deeper (subagent transcripts live deeper).
function projectTree(root: string): string[] {
  const files: string[] = [];
  for (const entry of entries(root)) {
    if (!entry.dir) {
      if (nonEmptyJsonl(entry.name, entry.path)) files.push(entry.path);
      continue;
    }
    for (const child of entries(entry.path)) {
      if (!child.dir && nonEmptyJsonl(child.name, child.path)) files.push(child.path);
    }
  }
  return files;
}

// An env override only wins when it actually holds sessions (Wake: env_dir).
function envRoot(envName: string, suffix: string[], fallback: string[]): string {
  const value = process.env[envName]?.trim();
  if (value) {
    const candidate = join(value, ...suffix);
    if (projectTree(candidate).length > 0) return candidate;
  }
  return home(...fallback);
}

function pickTitle(...candidates: string[]): string {
  for (const candidate of candidates) {
    const cleaned = titleFrom(cleanPrompt(candidate));
    if (cleaned && !isScaffolding(cleaned)) return cleaned;
  }
  return UNTITLED;
}

function span(times: (string | null)[]): { createdAt: string | null; updatedAt: string | null } {
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  for (const time of times) {
    if (!time) continue;
    if (!createdAt) createdAt = time;
    if (!updatedAt || time > updatedAt) updatedAt = time;
  }
  return { createdAt, updatedAt };
}

function later(...times: (string | null)[]): string | null {
  return times.reduce<string | null>((best, time) => (time && (!best || time > best) ? time : best), null);
}

function inDir(cwd: string, command: string): string {
  return cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;
}

function countTurns(turns: Turn[]): number {
  return turns.filter((turn) => turn.text).length;
}

// Claude-style `message.content`: a string, or blocks of which only `text` is prose.
function claudeText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = obj(block);
      if (!record) return "";
      if (record.type === "text") return str(record.text);
      if (record.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Claude Code: ~/.claude/projects/<slug>/<uuid>.jsonl

function claudeRows(file: string): { rows: Json[]; turns: Turn[] } {
  const rows = jsonLines(file);
  const turns: Turn[] = [];
  let lastAssistantId = "";
  for (const row of rows) {
    if (row.isSidechain === true) continue;
    const message = obj(row.message);
    if (row.type === "user") {
      lastAssistantId = "";
      if (row.isMeta === true || row.isCompactSummary === true) continue;
      const text = claudeText(message?.content);
      if (text) turns.push({ role: "user", text });
    } else if (row.type === "assistant") {
      const text = claudeText(message?.content);
      const id = str(message?.id);
      // One API response is written as several rows sharing message.id.
      const previous = turns.at(-1);
      if (id && id === lastAssistantId && previous?.role === "assistant") {
        if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
      } else {
        turns.push({ role: "assistant", text });
      }
      lastAssistantId = id;
    }
  }
  return { rows, turns };
}

const claude: Adapter = {
  agent: "claude",
  files() {
    const root = join(rootFrom("CLAUDE_CONFIG_DIR", ".claude"), "projects");
    return projectTree(root).filter((file) => dirname(file) !== root);
  },
  parse(file) {
    const { rows, turns } = claudeRows(file);
    let cwd = "";
    let model: string | null = null;
    let customTitle = "";
    const times: (string | null)[] = [];
    for (const row of rows) {
      if (row.type === "custom-title" && str(row.customTitle)) customTitle = str(row.customTitle);
      if (row.type !== "user" && row.type !== "assistant" && row.type !== "system") continue;
      if (!cwd) cwd = str(row.cwd);
      times.push(iso(row.timestamp));
      const messageModel = str(obj(row.message)?.model);
      if (row.type === "assistant" && messageModel && messageModel !== "<synthetic>") model = messageModel;
    }
    return {
      nativeId: stem(file),
      title: customTitle || pickTitle(firstPrompt(turns)),
      cwd,
      ...span(times),
      model,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return claudeRows(file).turns;
  },
  resume({ nativeId, cwd }) {
    return inDir(cwd, `claude --resume ${nativeId}`);
  },
};

// ---------------------------------------------------------------------------------------------
// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl (+ archived_sessions, state DB)

function codexHome(): string {
  const env = process.env.CODEX_HOME?.trim();
  if (env && (isDir(join(env, "sessions")) || isDir(join(env, "archived_sessions")))) return env;
  return home(".codex");
}

function codexNativeId(file: string): string {
  let rest = stem(file);
  if (rest.startsWith("rollout-")) rest = rest.slice("rollout-".length);
  if (rest.length > 20 && rest[10] === "T") rest = rest.slice(20);
  return rest;
}

// Codex puts the whole system prompt on line one, so read a generous prefix.
function firstLine(file: string, limit = 256_000): string {
  let fd: number | null = null;
  try {
    const buffer = Buffer.alloc(limit);
    fd = openSync(file, "r");
    const read = readSync(fd, buffer, 0, limit, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Guardian reviews, /review, compaction and memory consolidation share the sessions folder. They
// are recognised from the first line; anything unrecognisable stays visible.
function codexInternal(file: string): boolean {
  let head: Json | null = null;
  try {
    head = obj(JSON.parse(firstLine(file)));
  } catch {
    return false;
  }
  if (!head || head.type !== "session_meta") return false;
  const payload = obj(head.payload);
  const source = payload?.source;
  const sourceObj = obj(source);
  if (sourceObj) return !obj(obj(sourceObj.subagent)?.thread_spawn);
  return ["subagent", "guardian_review", "memory_consolidation"].includes(str(payload?.thread_source));
}

function codexUserText(text: string): string {
  let result = text;
  if (result.startsWith("# Files mentioned by the user") || result.startsWith("# Files pasted by the user")) {
    const marker = ["## My request for Codex:", "## My request:"].find((item) => result.includes(item));
    result = marker ? result.slice(result.indexOf(marker) + marker.length) : "";
  }
  return result.replace(/<image name=[^>]*>[\s\S]*?<\/image>/g, "").trim();
}

function codexRows(file: string): { rows: Json[]; turns: Turn[] } {
  const rows = jsonLines(file);
  const turns: Turn[] = [];
  for (const row of rows) {
    if (row.type !== "response_item") continue;
    const payload = obj(row.payload);
    if (payload?.type !== "message") continue;
    const role = payload.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(payload.content);
    if (!text) continue;
    // A `/review` result is stored as a user_action but reads as the assistant's reply.
    if (role === "user" && text.startsWith("<user_action>") && text.includes("<action>review</action>")) {
      turns.push({ role: "assistant", text });
      continue;
    }
    turns.push({ role, text: role === "user" ? codexUserText(text) : text });
  }
  if (!turns.some((turn) => turn.text)) {
    // Older rollouts only carry event messages.
    for (const row of rows) {
      const payload = obj(row.payload);
      if (row.type !== "event_msg" || !payload) continue;
      if (payload.type === "user_message") turns.push({ role: "user", text: str(payload.message) });
      if (payload.type === "agent_message") turns.push({ role: "assistant", text: str(payload.message) });
    }
  }
  return { rows, turns };
}

type CodexThread = { name: string; title: string };
let codexDb: { stamp: string; threads: Map<string, CodexThread> } | null = null;

// Codex keeps user-given thread names in its state DB. Read it through node:sqlite when the runtime
// has it; the rollout files alone are enough otherwise.
function codexThreads(): Map<string, CodexThread> {
  const path = join(codexHome(), "state_5.sqlite");
  const stamp = `${mtimeIso(path)}|${mtimeIso(`${path}-wal`)}`;
  if (codexDb?.stamp === stamp) return codexDb.threads;
  const threads = new Map<string, CodexThread>();
  try {
    const sqlite = process.getBuiltinModule?.("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (sqlite && isFile(path)) {
      const db = new sqlite.DatabaseSync(path, { readOnly: true });
      try {
        const rows = db.prepare("SELECT rollout_path, title, name, source FROM threads").all() as Json[];
        for (const row of rows) {
          const rollout = str(row.rollout_path).split(/[\\/]/).at(-1) ?? "";
          const source = str(row.source);
          const title = source.startsWith("{") ? "" : str(row.title);
          if (rollout) threads.set(rollout, { name: str(row.name), title });
        }
      } finally {
        db.close();
      }
    }
  } catch {
    // Missing table or a locked DB: fall back to titles from the rollout.
  }
  codexDb = { stamp, threads };
  return threads;
}

const codex: Adapter = {
  agent: "codex",
  files() {
    const root = codexHome();
    const match = (name: string, path: string) => nonEmptyJsonl(name, path) && !codexInternal(path);
    return [...walk(join(root, "sessions"), match, 4), ...walk(join(root, "archived_sessions"), match, 0)];
  },
  parse(file) {
    const { rows, turns } = codexRows(file);
    let cwd = "";
    let model: string | null = null;
    let spawnTitle = "";
    let sawMeta = false;
    const times: (string | null)[] = [];
    for (const row of rows) {
      times.push(iso(row.timestamp));
      const payload = obj(row.payload);
      if (!payload) continue;
      if (row.type === "session_meta" && !sawMeta) {
        sawMeta = true;
        cwd = str(payload.cwd);
        const spawn = obj(obj(obj(payload.source)?.subagent)?.thread_spawn);
        if (spawn) spawnTitle = str(spawn.agent_path).split("/").filter(Boolean).at(-1) || str(spawn.agent_nickname);
      }
      if (row.type === "turn_context") {
        if (!cwd) cwd = str(payload.cwd);
        if (str(payload.model)) model = str(payload.model);
      }
    }
    const thread = codexThreads().get(basename(file));
    const dbTitle = thread?.name || (thread?.title ? pickTitle(thread.title) : "");
    return {
      nativeId: codexNativeId(file),
      title: (dbTitle && dbTitle !== UNTITLED ? dbTitle : "") || spawnTitle || pickTitle(firstPrompt(turns)),
      cwd,
      ...span(times),
      model,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return codexRows(file).turns.map((turn) =>
      turn.role === "user" ? { role: "user", text: cleanPrompt(turn.text) } : turn,
    );
  },
  resume({ nativeId, cwd }) {
    return inDir(cwd, `codex resume ${nativeId}`);
  },
};

// ---------------------------------------------------------------------------------------------
// Qoder CLI: ~/.qoder/projects/<slug>/<uuid>.jsonl — Claude-like rows plus title metadata rows.

function qoderIsHuman(row: Json): boolean {
  if (row.isMeta === true || row.isVisibleInTranscriptOnly === true || row.isCompactSummary === true) return false;
  const origin = obj(row.origin);
  return !origin || !origin.kind || origin.kind === "human";
}

function qoderRows(file: string): { rows: Json[]; turns: Turn[] } {
  const rows = jsonLines(file);
  const turns: Turn[] = [];
  let lastAssistantId = "";
  for (const row of rows) {
    if (row.isSidechain === true) continue;
    const message = obj(row.message);
    if (row.type === "user") {
      lastAssistantId = "";
      if (!qoderIsHuman(row)) continue;
      const text = claudeText(message?.content);
      if (text) turns.push({ role: "user", text });
    } else if (row.type === "assistant") {
      const text = claudeText(message?.content);
      const id = str(message?.id);
      const previous = turns.at(-1);
      if (id && id === lastAssistantId && previous?.role === "assistant") {
        if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
      } else {
        turns.push({ role: "assistant", text });
      }
      lastAssistantId = id;
    }
  }
  return { rows, turns };
}

const qoder: Adapter = {
  agent: "qoder",
  files() {
    return projectTree(envRoot("QODER_CONFIG_DIR", ["projects"], [".qoder", "projects"]));
  },
  parse(file) {
    const { rows, turns } = qoderRows(file);
    let cwd = "";
    let relocated = "";
    let worktree = "";
    let model: string | null = null;
    let customTitle = "";
    let aiTitle = "";
    let lastPrompt = "";
    const times: (string | null)[] = [];
    for (const row of rows) {
      switch (row.type) {
        case "custom-title":
          customTitle = str(row.customTitle) || customTitle;
          continue;
        case "ai-title":
          aiTitle = str(row.aiTitle) || aiTitle;
          continue;
        case "last-prompt":
          lastPrompt = str(row.lastPrompt) || lastPrompt;
          continue;
        case "relocated":
          relocated = str(row.relocatedCwd) || relocated;
          continue;
        case "worktree-state":
          worktree = str(obj(row.worktreeSession)?.worktreePath);
          continue;
        case "runtime-config":
          model = str(row.model) || str(obj(row.model)?.name) || model;
          continue;
      }
      if (row.isSidechain === true) continue;
      if (row.type !== "user" && row.type !== "assistant" && row.type !== "system") continue;
      if (str(row.cwd)) cwd = str(row.cwd);
      times.push(iso(row.timestamp));
      const messageModel = str(obj(row.message)?.model);
      if (row.type === "assistant" && messageModel && messageModel !== "<synthetic>") model = messageModel;
    }
    const { createdAt, updatedAt } = span(times);
    return {
      nativeId: stem(file),
      title: pickTitle(customTitle, aiTitle, lastPrompt, firstPrompt(turns)),
      cwd: worktree || relocated || cwd,
      createdAt,
      updatedAt: later(updatedAt, mtimeIso(file)),
      model,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return qoderRows(file).turns;
  },
  resume({ nativeId, cwd }) {
    return inDir(cwd, `qoder --resume ${nativeId}`);
  },
};

// ---------------------------------------------------------------------------------------------
// CodeBuddy / WorkBuddy: ~/.codebuddy/projects/<slug>/<uuid>.jsonl — Responses-API style rows.

const CONTENT_ROWS = new Set(["message", "reasoning", "function_call", "function_call_result"]);

function isPlaceholderTitle(title: string): boolean {
  return title === "(No content)" || title === "/compact" || /^<image_local_path>[\s\S]*<\/image_local_path>$/.test(title);
}

function buddyTurns(rows: Json[]): Turn[] {
  const turns: Turn[] = [];
  for (const row of rows) {
    if (row.type !== "message" || (row.role !== "user" && row.role !== "assistant")) continue;
    const text = textOf(row.content);
    if (text) turns.push({ role: row.role, text });
  }
  return turns;
}

function buddy(agent: string, envName: string, dir: string, resumeBin: string | null): Adapter {
  return {
    agent,
    files() {
      return projectTree(envRoot(envName, ["projects"], [dir, "projects"]));
    },
    parse(file) {
      const rows = jsonLines(file);
      const turns = buddyTurns(rows);
      let cwd = "";
      let model: string | null = null;
      let customTitle = "";
      let aiTitle = "";
      let topic = "";
      let createdAt: string | null = null;
      let updatedAt: string | null = null;
      for (const row of rows) {
        if (row.type === "custom-title") customTitle = str(row.customTitle) || customTitle;
        else if (row.type === "ai-title" && !isPlaceholderTitle(str(row.aiTitle))) aiTitle = str(row.aiTitle) || aiTitle;
        else if (row.type === "topic" && !isPlaceholderTitle(str(row.topic))) topic = str(row.topic) || topic;
        if (!CONTENT_ROWS.has(str(row.type))) continue;
        if (!cwd) cwd = str(row.cwd);
        const time = iso(row.timestamp);
        if (time && (!createdAt || time < createdAt)) createdAt = time;
        if (time && (!updatedAt || time > updatedAt)) updatedAt = time;
        const provider = obj(row.providerData);
        if (row.role === "assistant" && provider) {
          model = str(provider.requestModelName) || str(provider.model) || model;
        }
      }
      return {
        nativeId: stem(file),
        title: pickTitle(customTitle, aiTitle, topic, firstPrompt(turns)),
        cwd,
        createdAt,
        updatedAt,
        model,
        messages: countTurns(turns),
      };
    },
    turns(file) {
      return buddyTurns(jsonLines(file));
    },
    resume({ nativeId, cwd }) {
      return resumeBin ? inDir(cwd, `${resumeBin} --resume ${nativeId}`) : null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Gemini CLI: ~/.gemini/tmp/<slug>/chats/session-*.jsonl, each `$set` line is a full snapshot.

let geminiProjects: { stamp: string | null; bySlug: Map<string, string> } | null = null;

function geminiCwd(slug: string): string {
  const path = home(".gemini", "projects.json");
  const stamp = mtimeIso(path);
  if (!geminiProjects || geminiProjects.stamp !== stamp) {
    const bySlug = new Map<string, string>();
    const projects = obj(obj(readJson(path))?.projects);
    for (const [cwd, value] of Object.entries(projects ?? {})) {
      if (typeof value === "string") bySlug.set(value, cwd);
    }
    geminiProjects = { stamp, bySlug };
  }
  return geminiProjects.bySlug.get(slug) ?? "";
}

function geminiRows(file: string): { header: Json | null; messages: Json[] } {
  const rows = jsonLines(file);
  let messages: Json[] = [];
  for (const row of rows) {
    const list = obj(row.$set)?.messages;
    if (Array.isArray(list)) messages = list.map(obj).filter((item): item is Json => item !== null);
  }
  return { header: rows[0] ?? null, messages };
}

function geminiTurns(messages: Json[]): Turn[] {
  return messages
    .filter((message) => typeof message.type === "string")
    .map((message) => ({ role: message.type === "user" ? "user" : "assistant", text: textOf(message.content) }));
}

const gemini: Adapter = {
  agent: "gemini",
  files() {
    const root = home(".gemini", "tmp");
    const files: string[] = [];
    for (const project of entries(root)) {
      if (!project.dir) continue;
      for (const chat of entries(join(project.path, "chats"))) {
        if (!chat.dir && chat.name.startsWith("session-") && nonEmptyJsonl(chat.name, chat.path)) files.push(chat.path);
      }
    }
    return files;
  },
  parse(file) {
    const { header, messages } = geminiRows(file);
    const turns = geminiTurns(messages);
    const times = messages.map((message) => iso(message.timestamp));
    const { createdAt, updatedAt } = span(times);
    return {
      nativeId: str(header?.sessionId) || stem(file),
      title: pickTitle(firstPrompt(turns)),
      cwd: geminiCwd(basename(dirname(dirname(file)))),
      createdAt: iso(header?.startTime) ?? createdAt,
      updatedAt: later(iso(header?.lastUpdated), updatedAt),
      model: null,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return geminiTurns(geminiRows(file).messages);
  },
  resume() {
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Pi / Oh My Pi: ~/.pi/agent/sessions/**/<ts>_<uuid>.jsonl

function piTurns(rows: Json[]): Turn[] {
  const turns: Turn[] = [];
  for (const row of rows) {
    if (row.type !== "message") continue;
    const message = obj(row.message);
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const text = textOf(message.content);
    const previous = turns.at(-1);
    // Assistant steps split by tool results read as one reply.
    if (message.role === "assistant" && previous?.role === "assistant") {
      if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
    } else {
      turns.push({ role: message.role, text });
    }
  }
  return turns;
}

function pi(agent: string, dir: string, resumeFlag: string): Adapter {
  return {
    agent,
    files() {
      return walk(home(dir, "agent", "sessions"), nonEmptyJsonl, 4);
    },
    parse(file) {
      const rows = jsonLines(file);
      const turns = piTurns(rows);
      const header = rows.find((row) => row.type === "session");
      let model: string | null = null;
      const times: (string | null)[] = [];
      for (const row of rows) {
        if (row.type !== "message") continue;
        times.push(iso(row.timestamp));
        const message = obj(row.message);
        if (message?.role === "assistant" && str(message.model)) model = str(message.model);
      }
      const { updatedAt } = span(times);
      return {
        nativeId: str(header?.id) || (stem(file).split("_").at(-1) ?? stem(file)),
        title: pickTitle(firstPrompt(turns)),
        cwd: str(header?.cwd),
        createdAt: iso(header?.timestamp),
        updatedAt,
        model,
        messages: countTurns(turns),
      };
    },
    turns(file) {
      return piTurns(jsonLines(file));
    },
    resume({ nativeId, cwd }) {
      return inDir(cwd, `${agent} ${resumeFlag} ${nativeId}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Grok Build: ~/.grok/sessions/<encoded cwd>/<uuid>/updates.jsonl + summary.json

function grokTurns(rows: Json[]): { turns: Turn[]; times: (string | null)[] } {
  const turns: Turn[] = [];
  const times: (string | null)[] = [];
  for (const row of rows) {
    const update = obj(obj(row.params)?.update);
    const kind = str(update?.sessionUpdate);
    const role = kind === "user_message_chunk" ? "user" : kind === "agent_message_chunk" ? "assistant" : null;
    if (!role) continue;
    times.push(iso(row.timestamp));
    const text = typeof obj(update?.content)?.text === "string" ? (obj(update?.content)?.text as string) : "";
    const previous = turns.at(-1);
    // Streaming chunks of one message are concatenated as-is.
    if (previous?.role === role) previous.text += text;
    else turns.push({ role, text });
  }
  return { turns: turns.map((turn) => ({ ...turn, text: turn.text.trim() })), times };
}

function decodeGrokDir(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

const grok: Adapter = {
  agent: "grok",
  files() {
    const files: string[] = [];
    for (const group of entries(home(".grok", "sessions"))) {
      if (!group.dir) continue;
      for (const session of entries(group.path)) {
        const file = join(session.path, "updates.jsonl");
        if (session.dir && isFile(file)) files.push(file);
      }
    }
    return files;
  },
  parse(file) {
    const dir = dirname(file);
    const summary = obj(readJson(join(dir, "summary.json")));
    const { turns, times } = grokTurns(jsonLines(file));
    const groupCwd = readText(join(dirname(dir), ".cwd")).trim() || decodeGrokDir(basename(dirname(dir)));
    return {
      nativeId: basename(dir),
      title: pickTitle(str(summary?.generated_title), str(summary?.session_summary), firstPrompt(turns)),
      cwd: str(obj(summary?.info)?.cwd) || groupCwd,
      createdAt: iso(summary?.created_at) ?? mtimeIso(file),
      updatedAt: later(iso(summary?.updated_at), span(times).updatedAt) ?? mtimeIso(file),
      model: str(summary?.current_model_id) || null,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return grokTurns(jsonLines(file)).turns;
  },
  resume({ nativeId, cwd }) {
    return inDir(cwd, `grok --resume ${nativeId}`);
  },
};

// ---------------------------------------------------------------------------------------------
// Kimi Code: ~/.kimi-code/sessions/wd_*/session_<uuid>/agents/main/wire.jsonl

let kimiIndex: { stamp: string | null; byId: Map<string, string> } | null = null;

function kimiCwd(nativeId: string): string {
  const path = home(".kimi-code", "session_index.jsonl");
  const stamp = mtimeIso(path);
  if (!kimiIndex || kimiIndex.stamp !== stamp) {
    const byId = new Map<string, string>();
    for (const row of jsonLines(path)) {
      if (str(row.sessionId)) byId.set(str(row.sessionId), str(row.workDir));
    }
    kimiIndex = { stamp, byId };
  }
  return kimiIndex.byId.get(nativeId) ?? "";
}

function kimiTurns(rows: Json[]): Turn[] {
  const turns: Turn[] = [];
  for (const row of rows) {
    const type = str(row.type);
    if (type === "turn.prompt" || type === "turn.steer") {
      turns.push({ role: "user", text: textOf(row.input) });
    } else if (type === "context.append_message") {
      const message = obj(row.message);
      if (message?.role === "assistant") turns.push({ role: "assistant", text: textOf(message.content) });
    }
  }
  return turns;
}

const kimi: Adapter = {
  agent: "kimi",
  files() {
    const files: string[] = [];
    for (const workDir of entries(home(".kimi-code", "sessions"))) {
      if (!workDir.dir) continue;
      for (const session of entries(workDir.path)) {
        const file = join(session.path, "agents", "main", "wire.jsonl");
        if (session.dir && isFile(file)) files.push(file);
      }
    }
    return files;
  },
  parse(file) {
    const sessionDir = dirname(dirname(dirname(file)));
    const nativeId = basename(sessionDir);
    const state = obj(readJson(join(sessionDir, "state.json")));
    const stateTitle = str(state?.title);
    const turns = kimiTurns(jsonLines(file));
    return {
      nativeId,
      title: pickTitle(stateTitle === "New Session" ? "" : stateTitle, firstPrompt(turns)),
      cwd: kimiCwd(nativeId),
      createdAt: iso(state?.createdAt) ?? mtimeIso(file),
      updatedAt: iso(state?.updatedAt) ?? mtimeIso(file),
      model: null,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return kimiTurns(jsonLines(file));
  },
  resume({ nativeId, cwd }) {
    return inDir(cwd, `kimi --session ${nativeId}`);
  },
};

// ---------------------------------------------------------------------------------------------
// Kiro CLI: ~/.kiro/sessions/cli/<uuid>.jsonl + <uuid>.json sidecar

function kiroRows(file: string): { turns: Turn[]; times: (string | null)[] } {
  const turns: Turn[] = [];
  const times: (string | null)[] = [];
  for (const row of jsonLines(file)) {
    const role = row.kind === "Prompt" ? "user" : row.kind === "AssistantMessage" ? "assistant" : null;
    if (!role) continue;
    const data = obj(row.data);
    const content = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .map((part) => {
        const record = obj(part);
        return record?.kind === "text" && typeof record.data === "string" ? record.data : "";
      })
      .join("\n")
      .trim();
    turns.push({ role, text });
    times.push(iso(obj(data?.meta)?.timestamp));
  }
  return { turns, times };
}

const kiro: Adapter = {
  agent: "kiro",
  files() {
    return walk(home(".kiro", "sessions", "cli"), nonEmptyJsonl, 3);
  },
  parse(file) {
    const sidecar = obj(readJson(file.replace(/\.jsonl$/, ".json")));
    const { turns, times } = kiroRows(file);
    const modelInfo = obj(obj(obj(sidecar?.session_state)?.rts_model_state)?.model_info);
    return {
      nativeId: stem(file),
      title: pickTitle(str(sidecar?.title), firstPrompt(turns)),
      cwd: str(sidecar?.cwd),
      createdAt: iso(sidecar?.created_at) ?? mtimeIso(file),
      updatedAt: later(iso(sidecar?.updated_at), span(times).updatedAt) ?? mtimeIso(file),
      model: str(modelInfo?.model_id) || str(modelInfo?.model_name) || null,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return kiroRows(file).turns;
  },
  resume() {
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// DeepSeek Harness: ~/.dsh/sessions/<project>/<session>/session.jsonl[.zstd]

function dshText(file: string): string {
  if (!file.endsWith(".zstd")) return readText(file);
  const decompress = (zlib as { zstdDecompressSync?: (input: Buffer) => Buffer }).zstdDecompressSync;
  if (!decompress) return "";
  try {
    return decompress(readFileSync(file)).toString("utf8");
  } catch {
    return "";
  }
}

function dshRows(file: string): Json[] {
  const rows: Json[] = [];
  for (const line of dshText(file).split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = obj(JSON.parse(line));
      if (value) rows.push(value);
    } catch {
      // Tail of a live session may be half-written.
    }
  }
  return rows;
}

function dshTurns(rows: Json[]): Turn[] {
  const turns: Turn[] = [];
  for (const row of rows) {
    if (row.ignorable === true || obj(row.surfaceOp)?.op === "replace") continue;
    const data = obj(row.data);
    if (row.type === "user/message") {
      const source = obj(data?.source);
      if (source?.kind && source.kind !== "user") continue;
      turns.push({ role: "user", text: textOf(data?.content) });
    } else if (row.type === "assistant/message") {
      const text = textOf(obj(data?.message)?.content);
      const previous = turns.at(-1);
      if (previous?.role === "assistant") {
        if (text) previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
      } else {
        turns.push({ role: "assistant", text });
      }
    }
  }
  return turns;
}

const dsh: Adapter = {
  agent: "dsh",
  files() {
    const files: string[] = [];
    for (const project of entries(home(".dsh", "sessions"))) {
      if (!project.dir) continue;
      for (const session of entries(project.path)) {
        if (!session.dir) continue;
        const plain = join(session.path, "session.jsonl");
        const packed = `${plain}.zstd`;
        const plainTime = isFile(plain) ? statSync(plain).mtimeMs : -1;
        const packedTime = isFile(packed) ? statSync(packed).mtimeMs : -1;
        if (plainTime < 0 && packedTime < 0) continue;
        files.push(packedTime >= plainTime ? packed : plain);
      }
    }
    return files;
  },
  parse(file) {
    const rows = dshRows(file);
    const header = rows[0];
    if (!header || header.type !== "session") return null;
    if (header.origin === "subagent" || (num(header.delegationDepth) ?? 0) > 0) return null;
    const turns = dshTurns(rows);
    let title = "";
    let model: string | null = null;
    let updatedAt: string | null = null;
    for (const row of rows) {
      const time = iso(row.time);
      if (time && (!updatedAt || time > updatedAt)) updatedAt = time;
      const data = obj(row.data);
      if (row.type === "session/title" && str(data?.title)) title = str(data?.title);
      if (row.type === "assistant/message") model = str(obj(obj(data?.message)?.source)?.model) || model;
      if (row.type === "request/context" && !model) model = str(data?.model) || null;
    }
    return {
      nativeId: str(header.id) || basename(dirname(file)),
      title: pickTitle(title, firstPrompt(turns)),
      cwd: str(header.cwd),
      createdAt: iso(header.createdAt) ?? mtimeIso(file),
      updatedAt: updatedAt ?? mtimeIso(file),
      model,
      messages: countTurns(turns),
    };
  },
  turns(file) {
    return dshTurns(dshRows(file));
  },
  resume({ cwd }) {
    return inDir(cwd, "npx @deepseek-ai/dsh web");
  },
};

export const adapters: Adapter[] = [
  claude,
  codex,
  qoder,
  buddy("codebuddy", "CODEBUDDY_CONFIG_DIR", ".codebuddy", "codebuddy"),
  buddy("workbuddy", "WORKBUDDY_CONFIG_DIR", ".workbuddy", null),
  gemini,
  pi("pi", ".pi", "--session"),
  pi("omp", ".omp", "--resume"),
  grok,
  kimi,
  kiro,
  dsh,
];

