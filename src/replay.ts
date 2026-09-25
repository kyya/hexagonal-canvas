// Timeline replay (Civ's end-game replay map): while active, the canvas only shows sessions that
// existed at `time`, and playing sweeps `time` from the first session to now.
export type ReplayState = { active: boolean; playing: boolean; time: number };

let state: ReplayState = { active: false, playing: false, time: 0 };
const listeners = new Set<() => void>();

export function replayState(): ReplayState {
  return state;
}

export function setReplay(next: Partial<ReplayState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeReplay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
