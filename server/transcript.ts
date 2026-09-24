import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "./agents.ts";

export type Transcript = {
  question: string;
  answer: string;
};

const EMPTY: Transcript = { question: "", answer: "" };
const MAX_CHARS = 700;

function clip(text: string): string {
  const normalized = text.replace(/<\/?user_query>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= MAX_CHARS) return normalized;
  return `${normalized.slice(0, MAX_CHARS).trimEnd()}…`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as { text?: unknown; type?: unknown };
      if (record.type === "text" || typeof record.text === "string") {
        return typeof record.text === "string" ? record.text : "";
      }
      return "";
    })
    .join("\n")
    .trim();
}

function linesOf(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.size > 12_000_000) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    });
}

export function exchange(turns: { role: "user" | "assistant"; text: string }[]): Transcript {
  let answerIndex = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === "assistant" && turns[i]?.text) {
      answerIndex = i;
      break;
    }
  }
  const start = answerIndex === -1 ? turns.length - 1 : answerIndex - 1;
  let question = "";
  for (let i = start; i >= 0; i--) {
    if (turns[i]?.role === "user" && turns[i]?.text) {
      question = turns[i]?.text ?? "";
      break;
    }
  }
  return {
    question: clip(question),
    answer: clip(answerIndex === -1 ? "" : (turns[answerIndex]?.text ?? "")),
  };
}

function grokTranscript(session: AgentSession): Transcript {
  const sessionId = session.id.slice("grok:".length);
  const root = join(homedir(), ".grok", "sessions");
  const direct = join(root, encodeURIComponent(session.cwd), sessionId, "chat_history.jsonl");
  let file = existsSync(direct) ? direct : "";
  if (!file && existsSync(root)) {
    for (const dir of readdirSync(root)) {
      const candidate = join(root, dir, sessionId, "chat_history.jsonl");
      if (existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return EMPTY;
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const item of linesOf(file)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; content?: unknown };
    if (record.type !== "user" && record.type !== "assistant") continue;
    const text = textOf(record.content);
    if (!text) continue;
    turns.push({ role: record.type, text });
  }
  return exchange(turns);
}

function claudeTranscript(session: AgentSession): Transcript {
  if (!session.cwd) return EMPTY;
  const slug = `-${session.cwd.replace(/^\/+/, "").replaceAll("/", "-")}`;
  const dir = join(homedir(), ".claude", "projects", slug);
  if (!existsSync(dir)) return EMPTY;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const file = files[0];
  if (!file) return EMPTY;
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const item of linesOf(file)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; message?: { role?: unknown; content?: unknown } };
    if (record.type !== "user" && record.type !== "assistant") continue;
    const text = textOf(record.message?.content);
    if (!text) continue;
    turns.push({ role: record.type, text });
  }
  return exchange(turns);
}

function findCodexFile(id: string, dir: string): string {
  if (!existsSync(dir)) return "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findCodexFile(id, path);
      if (found) return found;
    } else if (entry.name.includes(id) && entry.name.endsWith(".jsonl")) {
      return path;
    }
  }
  return "";
}

function codexTranscript(session: AgentSession): Transcript {
  const rawId = session.id.slice("codex:".length);
  const file = findCodexFile(rawId, join(homedir(), ".codex", "sessions"));
  if (!file) return EMPTY;
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const item of linesOf(file)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; payload?: { role?: unknown; content?: unknown } };
    if (record.type !== "response_item") continue;
    const role = record.payload?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(record.payload?.content);
    if (!text) continue;
    turns.push({ role, text });
  }
  return exchange(turns);
}

export function readTranscript(session: AgentSession): Transcript {
  try {
    if (session.agent === "grok") return grokTranscript(session);
    if (session.agent === "claude") return claudeTranscript(session);
    if (session.agent === "codex") return codexTranscript(session);
  } catch {
    return EMPTY;
  }
  return EMPTY;
}
