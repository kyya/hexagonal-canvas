import { canvasSessions } from "./sessions.ts";

// One scan loop for the whole server. Every open tab subscribes to the same snapshot instead of
// running ps, lsof and the history scan once per second on its own.
const TICK_MS = 1000;

type Listener = (payload: string) => void;

const listeners = new Set<Listener>();
let payload = "";
let computedAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function compute(): string {
  payload = JSON.stringify({ sessions: canvasSessions() });
  computedAt = Date.now();
  return payload;
}

function tick(): void {
  timer = null;
  const previous = payload;
  let next = previous;
  try {
    next = compute();
  } catch (error) {
    console.error("session scan failed", error);
  }
  if (next !== previous) {
    for (const listener of listeners) listener(next);
  }
  // Nobody watching: stop scanning until the next subscriber arrives.
  if (listeners.size > 0) timer = setTimeout(tick, TICK_MS);
}

export function snapshot(): string {
  return payload && Date.now() - computedAt < TICK_MS ? payload : compute();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!timer) timer = setTimeout(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
  };
}
