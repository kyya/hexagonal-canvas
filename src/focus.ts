// The hex the user is attending to: the one whose menu is open, else the one under the pointer.
// Overlays that would clutter the map (relation lines) draw only for the focused cell.
export type FocusedHex = { col: number; row: number } | null;

let hovered: FocusedHex = null;
let opened: FocusedHex = null;
const listeners = new Set<() => void>();

export function focusedHex(): FocusedHex {
  return opened ?? hovered;
}

function same(a: FocusedHex, b: FocusedHex): boolean {
  return a?.col === b?.col && a?.row === b?.row;
}

export function setHovered(hex: FocusedHex): void {
  if (same(hex, hovered)) return;
  const before = focusedHex();
  hovered = hex;
  if (!same(before, focusedHex())) for (const listener of listeners) listener();
}

export function setOpened(hex: FocusedHex): void {
  if (same(hex, opened)) return;
  const before = focusedHex();
  opened = hex;
  if (!same(before, focusedHex())) for (const listener of listeners) listener();
}

export function subscribeFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
