// Map pins: notes you drop on empty hexes (Civ's map tacks). Kept in this browser's localStorage.
export type Pin = { col: number; row: number; note: string };

const STORAGE_KEY = "hexagonal-canvas.pins";
const listeners = new Set<() => void>();
let pins: Pin[] = load();

function load(): Pin[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Pin =>
        !!item && Number.isInteger(item.col) && Number.isInteger(item.row) && typeof item.note === "string",
    );
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Private mode: pins last for this page only.
  }
  for (const listener of listeners) listener();
}

export function allPins(): Pin[] {
  return pins;
}

export function pinAt(col: number, row: number): Pin | null {
  return pins.find((pin) => pin.col === col && pin.row === row) ?? null;
}

export function setPin(col: number, row: number, note: string): void {
  const text = note.trim();
  pins = pins.filter((pin) => pin.col !== col || pin.row !== row);
  if (text) pins.push({ col, row, note: text });
  save();
}

export function removePin(col: number, row: number): void {
  setPin(col, row, "");
}

export function subscribePins(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
