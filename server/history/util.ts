import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Turn } from "./types.ts";

// Session logs larger than this are skipped rather than blocking the scan.
const MAX_BYTES = 64_000_000;
const TITLE_CHARS = 80;

export function home(...parts: string[]): string {
  return join(homedir(), ...parts);
}

// Honour an agent's "config dir" environment variable, falling back to its default under $HOME.
export function rootFrom(envName: string, ...fallback: string[]): string {
  const value = process.env[envName]?.trim();
  return value ? value : home(...fallback);
}

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function entries(dir: string): { name: string; path: string; dir: boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      path: join(dir, entry.name),
      dir: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

// Recursive file listing with a depth limit, so a stray symlink loop or huge tree cannot stall a scan.
export function walk(dir: string, match: (name: string, path: string) => boolean, depth = 6): string[] {
  const found: string[] = [];
  const visit = (current: string, level: number) => {
    for (const entry of entries(current)) {
      if (entry.dir) {
        if (level < depth) visit(entry.path, level + 1);
      } else if (match(entry.name, entry.path)) {
        found.push(entry.path);
      }
    }
  };
  visit(dir, 0);
  return found;
}

export function readText(path: string): string {
  try {
    if (statSync(path).size > MAX_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export type Json = Record<string, unknown>;

export function jsonLines(path: string): Json[] {
  const rows: Json[] = [];
  for (const line of readText(path).split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) rows.push(value as Json);
    } catch {
      // A half-written last line is normal while the agent is still running.
    }
  }
  return rows;
}

export function obj(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Accepts ISO strings, epoch seconds and epoch milliseconds.
export function iso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

export function mtimeIso(path: string): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

// Text of a message `content`, which agents store either as a string or as a list of typed parts.
export function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) {
    const record = obj(content);
    return record ? str(record.text) : "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = obj(part);
      if (!record) return "";
      const type = str(record.type);
      if (type && !["text", "input_text", "output_text"].includes(type)) return "";
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Wrappers that agents inject into the user role but that the user never typed.
const INJECTED = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
  /<local-command-stderr>[\s\S]*?<\/local-command-stderr>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-args>\s*<\/command-args>/g,
  /<environment_context>[\s\S]*?<\/environment_context>/g,
  /<user_instructions>[\s\S]*?<\/user_instructions>/g,
  /<permissions instructions>[\s\S]*?<\/permissions instructions>/g,
  /<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/g,
  /<turn_aborted>[\s\S]*?<\/turn_aborted>/g,
  /<\/?user_query>/g,
];

export function cleanPrompt(text: string): string {
  let result = text;
  for (const pattern of INJECTED) result = result.replace(pattern, " ");
  // `/review` style slash commands keep the command name as the visible prompt.
  result = result.replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1");
  result = result.replace(/<command-args>([\s\S]*?)<\/command-args>/g, " $1");
  return result.trim();
}

// Prompts the agent injected into the user role (Wake: is_injected_user_content). They are never
// shown as a title and never counted as the question in the transcript preview.
const INJECTED_PREFIXES = [
  "<recommended_plugins",
  "<environment_context",
  "<user_action",
  "<user_instructions",
  "<permissions",
  "<workspace",
  "<system-",
  "<context ",
  "<session_context",
  "IMPORTANT: Do NOT read",
  "Caveat: The messages below",
  "# Files pasted by the user",
  "# Files mentioned by the user",
  "## Referenced ChatGPT conversation",
  "# AGENTS.md instructions",
  "The following is the Codex agent history",
  "[Request interrupted",
];

export function isScaffolding(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed || trimmed === "Warmup") return true;
  if (INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true;
  if (/[\\/]\.codex[\\/]plugins[\\/]/.test(trimmed)) return true;
  return /[\\/]plugins[\\/]cache[\\/]/.test(trimmed) && trimmed.includes("SKILL.md");
}

export function titleFrom(text: string): string {
  const line = text
    .replace(/<[^<>\n]{1,60}>/g, " ")
    .replaceAll("[image]", " ")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= TITLE_CHARS) return line;
  return `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

export function firstPrompt(turns: Turn[]): string {
  for (const turn of turns) {
    if (turn.role !== "user" || isScaffolding(turn.text)) continue;
    const text = cleanPrompt(turn.text);
    if (titleFrom(text)) return text;
  }
  return "";
}

// Decode "-Users-me-src-app" style project slugs by probing the filesystem: a "-" may be a "/" or a
// literal dash, so walk left to right and keep the longest existing prefix. Falls back to "/"s.
export function decodeSlug(slug: string): string {
  const parts = slug.replace(/^-+/, "").split("-").filter(Boolean);
  if (parts.length === 0) return "";
  let path = "";
  let pending = "";
  for (const part of parts) {
    const candidate = pending ? `${pending}-${part}` : part;
    if (isDir(`${path}/${candidate}`)) {
      path = `${path}/${candidate}`;
      pending = "";
    } else {
      pending = candidate;
    }
  }
  if (!pending) return path;
  // The directory is gone (or never existed here), so there is nothing to probe: assume "/".
  return `/${parts.join("/")}`;
}
