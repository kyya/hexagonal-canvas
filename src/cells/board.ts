import { agentStatus } from "./agent-status";
import { territory } from "./territory";
import type { BoardCell, CellDetails, CellFrame, CellMenu, CellModule, OverlayFrame } from "./types";

// Draw order: territory borders and banners overlay the agent cells.
const modules: CellModule[] = [agentStatus, territory];

export type PlacedCell = {
  module: CellModule;
  cell: BoardCell;
};

export function startCells(onFrame: () => void): void {
  for (const module of modules) module.start(onFrame);
}

export function placedCells(): PlacedCell[] {
  return modules.flatMap((module) => module.cells().map((cell) => ({ module, cell })));
}

export function placedCellAt(col: number, row: number): PlacedCell | null {
  for (const module of modules) {
    const cell = module.cells().find((item) => item.col === col && item.row === row);
    if (cell) return { module, cell };
  }
  return null;
}

export function drawPlacedCell(placed: PlacedCell, frame: CellFrame): void {
  placed.module.draw(placed.cell, frame);
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

export function openPlacedMenu(placed: PlacedCell, menu: CellMenu): void {
  placed.module.menu(placed.cell, menu);
}
