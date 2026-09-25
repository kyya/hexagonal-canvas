import { statSync } from "node:fs";
import { adapters } from "./adapters.ts";
import type { Adapter, HistorySession, Turn } from "./types.ts";

type Entry = { mtimeMs: number; size: number; session: HistorySession | null };

// Keyed by file path. A file is only parsed again when its mtime or size changes.
const cache = new Map<string, Entry>();

function scanAdapter(adapter: Adapter, alive: Set<string>): HistorySession[] {
  const sessions: HistorySession[] = [];
  let files: string[] = [];
  try {
    files = adapter.files();
  } catch {
    // An unreadable data directory takes out one agent, never the whole scan.
    return sessions;
  }
  for (const file of files) {
    alive.add(file);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue;
    }
    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
      let session: HistorySession | null = null;
      try {
        const parsed = adapter.parse(file);
        if (parsed) {
          session = {
            ...parsed,
            id: `${adapter.agent}:${parsed.nativeId}`,
            agent: adapter.agent,
            file,
            resume: adapter.resume(parsed),
            updatedAt: parsed.updatedAt ?? stat.mtime.toISOString(),
          };
        }
      } catch {
        session = null;
      }
      entry = { mtimeMs: stat.mtimeMs, size: stat.size, session };
      cache.set(file, entry);
    }
    if (entry.session) sessions.push(entry.session);
  }
  return sessions;
}

// Several files can claim the same session (Codex archives, resumed copies): the newest wins.
function dedupe(sessions: HistorySession[]): HistorySession[] {
  const byId = new Map<string, HistorySession>();
  for (const session of sessions) {
    const current = byId.get(session.id);
    if (!current || (session.updatedAt ?? "") > (current.updatedAt ?? "")) byId.set(session.id, session);
  }
  return [...byId.values()];
}

export function scanHistory(): HistorySession[] {
  const alive = new Set<string>();
  const sessions = adapters.flatMap((adapter) => scanAdapter(adapter, alive));
  for (const file of cache.keys()) {
    if (!alive.has(file)) cache.delete(file);
  }
  return dedupe(sessions);
}

export function historyTurns(session: HistorySession): Turn[] {
  const adapter = adapters.find((item) => item.agent === session.agent);
  if (!adapter) return [];
  try {
    return adapter.turns(session.file);
  } catch {
    return [];
  }
}
