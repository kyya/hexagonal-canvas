// Civ-style lenses: the same map, recoloured to answer a different question. The status lens is the
// everyday view (live-state tints + fog of war); the others tint every session, history included.
import { FOG, PHI, phiFade } from "./cells/golden";
import { projectHue } from "./cells/palette";
import type { LiveSession } from "./live";

export type LensId = "status" | "recency" | "agent" | "model" | "messages";

export const LENSES: { id: LensId; label: string; key: string }[] = [
  { id: "status", label: "状态", key: "1" },
  { id: "recency", label: "新旧", key: "2" },
  { id: "agent", label: "Agent", key: "3" },
  { id: "model", label: "模型", key: "4" },
  { id: "messages", label: "消息量", key: "5" },
];

const STORAGE_KEY = "hexagonal-canvas.lens";
const DAY_MS = 86_400_000;
// Recency lens: a session's heat halves every week.
const RECENCY_HALF_LIFE_DAYS = 7;

// Brand colours for the agent lens.
export const AGENT_COLOURS: Record<string, string> = {
  claude: "#d97757",
  codex: "#10a37f",
  qoder: "#2adb5c",
  codebuddy: "#6c5ce7",
  workbuddy: "#8e7cf0",
  gemini: "#4285f4",
  pi: "#6b7280",
  omp: "#9ca3af",
  grok: "#111827",
  kimi: "#1783ff",
  kiro: "#9046ff",
  dsh: "#4d6bfe",
};

export type LensTint = { colour: string; alpha: number };

let current: LensId = load();
const listeners = new Set<(lens: LensId) => void>();

function load(): LensId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return LENSES.some((lens) => lens.id === stored) ? (stored as LensId) : "status";
  } catch {
    return "status";
  }
}

export function lens(): LensId {
  return current;
}

export function setLens(next: LensId): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode: the lens just won't be remembered.
  }
  for (const listener of listeners) listener(next);
}

export function subscribeLens(listener: (lens: LensId) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ageDays(session: LiveSession, now = Date.now()): number {
  const time = Date.parse(session.updatedAt ?? session.createdAt ?? "");
  return Number.isFinite(time) ? Math.max(0, (now - time) / DAY_MS) : Number.POSITIVE_INFINITY;
}

// History sessions untouched for FOG.afterDays sit under the fog of war (status lens only).
export function fogged(session: LiveSession, now = Date.now()): boolean {
  return !session.live && ageDays(session, now) >= FOG.afterDays;
}

export function modelHue(model: string): number {
  return projectHue(`model:${model}`);
}

// Soft for weak signal, stronger for strong signal: φ⁻⁴ … φ⁻¹.
function ramp(intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return phiFade(4) + (phiFade(1) - phiFade(4)) * clamped;
}

// The tint a non-status lens gives a session; `maxMessages` scales the messages lens.
export function lensTint(id: Exclude<LensId, "status">, session: LiveSession, maxMessages: number, now = Date.now()): LensTint | null {
  switch (id) {
    case "recency": {
      const heat = 2 ** (-ageDays(session, now) / RECENCY_HALF_LIFE_DAYS);
      return { colour: "#7c3aed", alpha: ramp(heat) };
    }
    case "agent":
      return { colour: AGENT_COLOURS[session.agent] ?? "#6b7280", alpha: ramp(1 / PHI) };
    case "model":
      return session.model ? { colour: `hsl(${modelHue(session.model)}, 60%, 50%)`, alpha: ramp(1 / PHI) } : null;
    case "messages": {
      if (maxMessages <= 0) return null;
      return { colour: "#0891b2", alpha: ramp(Math.log1p(session.messages) / Math.log1p(maxMessages)) };
    }
  }
}
