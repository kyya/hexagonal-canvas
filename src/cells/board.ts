import { agentStatus } from "./agent-status";
import { pinsModule } from "./pins";
import { relations } from "./relations";
import { territory } from "./territory";
import type { BoardCell, CellDetails, CellFrame, CellMenu, CellModule, OverlayFrame } from "./types";

// Draw order: territory borders and banners overlay the agent cells.
const modules: CellModule[] = [agentStatus, pinsModule, relations, territory];

export type PlacedCell = {
  module: CellModule;
  cell: BoardCell;
};

export function startCells(onFrame: () => void): void {
  for (const module of modules) module.start(onFrame);
}

// Every placed cell, and an index by position, rebuilt only when a module hands out a new cell list
// (modules replace their arrays on change), so hovering and drawing thousands of sessions stays O(1)
// per lookup instead of scanning every cell.
type Placement = { sources: BoardCell[][]; list: PlacedCell[]; byPosition: Map<string, PlacedCell> };
let placement: Placement | null = null;

function currentPlacement(): Placement {
  const sources = modules.map((module) => module.cells());
  if (placement && sources.every((cells, index) => cells === placement?.sources[index])) return placement;
  const list: PlacedCell[] = [];
  const byPosition = new Map<string, PlacedCell>();
  sources.forEach((cells, index) => {
    const module = modules[index];
    if (!module) return;
    for (const cell of cells) {
      const placed = { module, cell };
      list.push(placed);
      // Earlier modules win a shared hex, as before.
      const key = `${cell.col},${cell.row}`;
      if (!byPosition.has(key)) byPosition.set(key, placed);
    }
  });
  placement = { sources, list, byPosition };
  return placement;
}

// Shared between callers: copy before sorting or otherwise changing it.
export function placedCells(): readonly PlacedCell[] {
  return currentPlacement().list;
}

export function placedCellAt(col: number, row: number): PlacedCell | null {
  return currentPlacement().byPosition.get(`${col},${row}`) ?? null;
}

export function drawPlacedCell(placed: PlacedCell, frame: CellFrame): void {
  placed.module.draw(placed.cell, frame);
}

export function drawUnderlays(frame: OverlayFrame): void {
  for (const module of modules) module.underlay?.(frame);
}

export function cellHeight(placed: PlacedCell, apothem: number): number {
  return placed.module.height?.(placed.cell, apothem) ?? 0;
}

export function drawOverlays(frame: OverlayFrame): void {
  for (const module of modules) module.overlay?.(frame);
}

export function clickAt(x: number, y: number): boolean {
  return modules.some((module) => module.click?.(x, y) ?? false);
}

export function describePlaced(placed: PlacedCell): CellDetails | null {
  return placed.module.describe?.(placed.cell) ?? null;
}

export function openEmptyMenu(col: number, row: number, menu: CellMenu): boolean {
  return modules.some((module) => module.menuEmpty?.(col, row, menu) ?? false);
}

export function openPlacedMenu(placed: PlacedCell, menu: CellMenu): void {
  placed.module.menu(placed.cell, menu);
}
