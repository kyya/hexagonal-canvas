import { collectSessions, type AgentSession } from "./agents.ts";
import { historyTurns, scanHistory } from "./history/scanner.ts";
import type { HistorySession, Turn } from "./history/types.ts";
import { readTranscript } from "./transcript.ts";
import { cleanPrompt, isScaffolding } from "./history/util.ts";

// What the canvas receives for one hex. History sessions come from disk; `live` marks the ones
// that also have a running process right now.
export type CanvasSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  live: boolean;
  // busy: working on a turn; waiting: blocked on the user (permission, question, dialog);
  // idle: running but quiet. Null for sessions without a process.
  status: "busy" | "waiting" | "idle" | null;
  waitingFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  resume: string | null;
};

// Parsing is cached per file, but listing still stats every file, so keep a short floor between scans.
const HISTORY_MS = 5000;
// Agents that do not publish a status count as busy while their log was written this recently.
const ACTIVE_MS = 15_000;
let history: HistorySession[] = [];
let scannedAt = 0;

function currentHistory(): HistorySession[] {
  if (Date.now() - scannedAt >= HISTORY_MS) {
    history = scanHistory();
    scannedAt = Date.now();
  }
  return history;
}

function statusOf(live: AgentSession | undefined, updatedAt: string | null): CanvasSession["status"] {
  if (!live) return null;
  if (live.status) return live.status;
  const written = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isFinite(written) && Date.now() - written < ACTIVE_MS ? "busy" : "idle";
}

function fromHistory(session: HistorySession, live: AgentSession | undefined): CanvasSession {
  return {
    id: session.id,
    agent: session.agent,
    title: session.title,
    cwd: session.cwd || live?.cwd || "",
    live: !!live,
    status: statusOf(live, session.updatedAt),
    waitingFor: live?.waitingFor ?? null,
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
    status: statusOf(session, null),
    waitingFor: session.waitingFor ?? null,
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

// The panel shows the whole conversation, but a months-long session can hold thousands of turns:
// send the most recent ones and clip very long messages (pasted logs, huge diffs).
const MAX_TURNS = 400;
const MAX_TURN_CHARS = 8000;

export type TranscriptPayload = { turns: Turn[]; truncated: boolean };

function clipTurn(turn: Turn): Turn {
  if (turn.text.length <= MAX_TURN_CHARS) return turn;
  return { ...turn, text: `${turn.text.slice(0, MAX_TURN_CHARS).trimEnd()}\n\n…（已截断）` };
}

export function sessionTranscript(id: string): TranscriptPayload | null {
  const stored = currentHistory().find((session) => session.id === id);
  if (stored) {
    const turns = historyTurns(stored)
      .map((turn) => (turn.role === "user" ? { ...turn, text: cleanPrompt(turn.text) } : turn))
      // Tool-only assistant steps have no prose; injected prompts are not the user's words.
      .filter((turn) => turn.text && (turn.role === "assistant" || !isScaffolding(turn.text)));
    return {
      turns: turns.slice(-MAX_TURNS).map(clipTurn),
      truncated: turns.length > MAX_TURNS,
    };
  }
  const running = collectSessions().find((session) => session.id === id);
  if (!running) return null;
  // A running process without a readable log still gets the last exchange the live reader finds.
  const { question, answer } = readTranscript(running);
  const turns: Turn[] = [];
  if (question) turns.push({ role: "user", text: question });
  if (answer) turns.push({ role: "assistant", text: answer });
  return { turns, truncated: false };
}
