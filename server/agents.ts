import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type AgentSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  pid: number | null;
  since: string | null;
  // Only agents that publish it (Claude Code's session registry) set these.
  status?: "busy" | "idle" | "waiting";
  waitingFor?: string;
};

type ProcessRow = {
  pid: number;
  command: string;
};

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function listProcesses(): ProcessRow[] {
  try {
    const output = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
      encoding: "utf8",
      timeout: 2000,
    });
    const rows: ProcessRow[] = [];
    for (const line of output.split("\n")) {
      const match = /^ *(\d+) +(.*)$/.exec(line);
      if (!match) continue;
      rows.push({ pid: Number(match[1]), command: match[2] ?? "" });
    }
    return rows;
  } catch {
    return [];
  }
}

// A process's cwd hardly ever changes, and lsof is the slowest call in a scan: remember it briefly.
const CWD_TTL_MS = 30_000;
const cwdCache = new Map<number, { cwd: string; at: number }>();

function cwdOf(pid: number): string {
  const cached = cwdCache.get(pid);
  if (cached && Date.now() - cached.at < CWD_TTL_MS) return cached.cwd;
  const cwd = lookupCwd(pid);
  cwdCache.set(pid, { cwd, at: Date.now() });
  for (const [key, entry] of cwdCache) {
    if (Date.now() - entry.at >= CWD_TTL_MS) cwdCache.delete(key);
  }
  return cwd;
}

function lookupCwd(pid: number): string {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      timeout: 2000,
    });
    const line = output.split("\n").find((item) => item.startsWith("n"));
    return line?.slice(1) ?? "";
  } catch {
    return "";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function grokSessions(): AgentSession[] {
  const home = join(homedir(), ".grok");
  const active = readJson(join(home, "active_sessions.json"));
  if (!Array.isArray(active)) return [];
  const sessions: AgentSession[] = [];
  for (const item of active) {
    if (!item || typeof item !== "object") continue;
    const record = item as { session_id?: unknown; pid?: unknown; cwd?: unknown; opened_at?: unknown };
    const pid = typeof record.pid === "number" ? record.pid : 0;
    const sessionId = text(record.session_id);
    const cwd = text(record.cwd);
    if (!sessionId || !pidAlive(pid)) continue;
    const summary = readJson(join(home, "sessions", encodeURIComponent(cwd), sessionId, "summary.json"));
    const title =
      (summary && typeof summary === "object"
        ? text((summary as { generated_title?: unknown }).generated_title) ||
          text((summary as { session_summary?: unknown }).session_summary)
        : "") || basename(cwd) || sessionId;
    sessions.push({
      id: `grok:${sessionId}`,
      agent: "grok",
      title,
      cwd,
      pid,
      since: text(record.opened_at) || null,
    });
  }
  return sessions;
}

function codexSessions(processes: ProcessRow[]): AgentSession[] {
  const sessions: AgentSession[] = [];
  const seen = new Set<number>();
  const rows = readJson(join(homedir(), ".codex", "process_manager", "chat_processes.json"));
  if (Array.isArray(rows)) {
    for (const item of rows) {
      if (!item || typeof item !== "object") continue;
      const record = item as {
        osPid?: unknown;
        conversationId?: unknown;
        id?: unknown;
        chatTitle?: unknown;
        cwd?: unknown;
        startedAtMs?: unknown;
      };
      const pid = typeof record.osPid === "number" ? record.osPid : 0;
      if (!pidAlive(pid)) continue;
      seen.add(pid);
      const cwd = text(record.cwd);
      const key = text(record.conversationId) || text(record.id) || String(pid);
      sessions.push({
        id: `codex:${key}`,
        agent: "codex",
        title: text(record.chatTitle) || basename(cwd) || "Codex",
        cwd,
        pid,
        since: typeof record.startedAtMs === "number" ? new Date(record.startedAtMs).toISOString() : null,
      });
    }
  }
  for (const process of processes) {
    if (seen.has(process.pid) || !isCodexCli(process.command) || !pidAlive(process.pid)) continue;
    const cwd = cwdOf(process.pid);
    sessions.push({
      id: `codex:${process.pid}`,
      agent: "codex",
      title: basename(cwd) || "Codex",
      cwd,
      pid: process.pid,
      since: null,
    });
  }
  return sessions;
}

// True when the process itself is `name` (or a node/bun script called `name`), not merely a
// command line that mentions it, e.g. `sh -c "ln -sf …/bin/claude …"`.
function runs(command: string, name: string): boolean {
  const [exe = "", script = ""] = command.trim().split(/\s+/);
  const base = (path: string) => path.split("/").at(-1) ?? "";
  if (base(exe) === name) return true;
  return /^(node|bun|deno)$/.test(base(exe)) && base(script) === name;
}

function isCodexCli(command: string): boolean {
  if (!/(^|\/|\s)codex(\s|$)/.test(command)) return false;
  return !/app-server|code-mode-host|proxy|launch\.mjs|ChatGPT/.test(command);
}

// Claude Code registers each running session as ~/.claude/sessions/<pid>.json, which carries the
// session id, so a live process can be matched with its history file.
function claudeSessions(): AgentSession[] {
  const dir = join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "sessions");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return [];
  }
  const sessions: AgentSession[] = [];
  for (const name of names) {
    const record = readJson(join(dir, name));
    if (!record || typeof record !== "object") continue;
    const row = record as {
      pid?: unknown;
      sessionId?: unknown;
      cwd?: unknown;
      startedAt?: unknown;
      name?: unknown;
      status?: unknown;
      waitingFor?: unknown;
    };
    const pid = typeof row.pid === "number" ? row.pid : 0;
    const sessionId = text(row.sessionId);
    if (!sessionId || !pidAlive(pid)) continue;
    const cwd = text(row.cwd);
    sessions.push({
      id: `claude:${sessionId}`,
      agent: "claude",
      title: text(row.name) || basename(cwd) || "Claude",
      cwd,
      pid,
      since: typeof row.startedAt === "number" ? new Date(row.startedAt).toISOString() : null,
      ...(row.status === "busy" || row.status === "idle" || row.status === "waiting" ? { status: row.status } : {}),
      ...(row.status === "waiting" && text(row.waitingFor) ? { waitingFor: text(row.waitingFor) } : {}),
    });
  }
  return sessions;
}

function commandSessions(
  agent: AgentSession["agent"],
  processes: ProcessRow[],
  match: (command: string) => boolean,
  known = new Set<number>(),
): AgentSession[] {
  const sessions: AgentSession[] = [];
  for (const process of processes) {
    if (known.has(process.pid) || !match(process.command) || !pidAlive(process.pid)) continue;
    const cwd = cwdOf(process.pid);
    sessions.push({
      id: `${agent}:${process.pid}`,
      agent,
      title: basename(cwd) || agent,
      cwd,
      pid: process.pid,
      since: null,
    });
  }
  return sessions;
}

export function collectSessions(): AgentSession[] {
  const processes = listProcesses();
  const registered = claudeSessions();
  const registeredPids = new Set(registered.flatMap((session) => (session.pid ? [session.pid] : [])));
  const sessions = [
    ...grokSessions(),
    ...codexSessions(processes),
    ...registered,
    ...commandSessions(
      "claude",
      processes,
      (command) => !command.includes("Claude.app") && runs(command, "claude"),
      registeredPids,
    ),
    ...commandSessions("kimi", processes, (command) => runs(command, "kimi")),
    ...commandSessions("qoder", processes, (command) => {
      if (command.includes("Helper") || command.includes("crashpad")) return false;
      return /(^|\/)qoder(\s|$)/.test(command);
    }),
  ];
  sessions.sort((a, b) => a.id.localeCompare(b.id));
  return sessions;
}
