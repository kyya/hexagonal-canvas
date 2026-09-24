import { collectSessions, type AgentSession } from "./agents.ts";
import { historyTurns, scanHistory } from "./history/scanner.ts";
import type { HistorySession } from "./history/types.ts";
import { exchange, readTranscript, type Transcript } from "./transcript.ts";
import { cleanPrompt, isScaffolding } from "./history/util.ts";

// What the canvas receives for one hex. History sessions come from disk; `live` marks the ones
// that also have a running process right now.
export type CanvasSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  live: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  resume: string | null;
};

// Parsing is cached per file, but listing still stats every file, so keep a short floor between scans.
const HISTORY_MS = 5000;
let history: HistorySession[] = [];
let scannedAt = 0;

function currentHistory(): HistorySession[] {
  if (Date.now() - scannedAt >= HISTORY_MS) {
    history = scanHistory();
    scannedAt = Date.now();
  }
  return history;
}

function fromHistory(session: HistorySession, live: AgentSession | undefined): CanvasSession {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    cwd: session.cwd || live?.cwd || "",
    live: !!live,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    resume: session.resume,
  };
}

function fromLive(session: AgentSession): CanvasSession {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    cwd: session.cwd,
    live: true,
    createdAt: session.since,
    updatedAt: null,
    model: null,
    resume: null,
  };
}

export function canvasSessions(): CanvasSession[] {
  const live = new Map(collectSessions().map((session) => [session.id, session]));
  const sessions = currentHistory().map((session) => fromHistory(session, live.get(session.id)));
  const known = new Set(sessions.map((session) => session.id));
  for (const session of live.values()) {
    if (!known.has(session.id)) sessions.push(fromLive(session));
  }
  sessions.sort((a, b) => a.id.localeCompare(b.id));
  return sessions;
}

export function sessionTranscript(id: string): Transcript | null {
  const stored = currentHistory().find((session) => session.id === id);
  if (stored) {
    const turns = historyTurns(stored)
      .map((turn) => (turn.role === "user" ? { ...turn, text: cleanPrompt(turn.text) } : turn))
      .filter((turn) => turn.role === "assistant" || !isScaffolding(turn.text));
    return exchange(turns);
  }
  const running = collectSessions().find((session) => session.id === id);
  return running ? readTranscript(running) : null;
}
