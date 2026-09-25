// Map search: a query dims every session and pin that does not match, and lists the hits.
import type { LiveSession } from "./live";
import type { Pin } from "./pins";

export type SearchHit =
  | { kind: "session"; session: LiveSession }
  | { kind: "pin"; pin: Pin };

let query = "";
const listeners = new Set<() => void>();

export function searchQuery(): string {
  return query;
}

export function setSearchQuery(next: string): void {
  const normalised = next.trim().toLowerCase();
  if (normalised === query) return;
  query = normalised;
  for (const listener of listeners) listener();
}

export function subscribeSearch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sessionMatches(session: LiveSession, text = query): boolean {
  if (!text) return true;
  return [session.title, session.cwd, session.agent, session.model ?? ""].some((field) => field.toLowerCase().includes(text));
}

export function pinMatches(pin: Pin, text = query): boolean {
  return !text || pin.note.toLowerCase().includes(text);
}
