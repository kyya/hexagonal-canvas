// Small persisted on/off switches for canvas overlays and views (yield numbers, the tilted camera).
export type ToggleId = "yields" | "tilt";

const listeners = new Set<() => void>();
const state = new Map<ToggleId, boolean>();

function storageKey(id: ToggleId): string {
  return `hexagonal-canvas.toggle.${id}`;
}

export function isOn(id: ToggleId): boolean {
  if (!state.has(id)) {
    let stored = false;
    try {
      stored = localStorage.getItem(storageKey(id)) === "1";
    } catch {
      // Private mode: start off.
    }
    state.set(id, stored);
  }
  return state.get(id) ?? false;
}

export function setToggle(id: ToggleId, on: boolean): void {
  state.set(id, on);
  try {
    localStorage.setItem(storageKey(id), on ? "1" : "0");
  } catch {
    // Not remembered, still applied.
  }
  for (const listener of listeners) listener();
}

export function subscribeToggles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
