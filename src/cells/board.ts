import { agentStatus } from "./agent-status";
import type { BoardCell, CellFrame, CellMenu, CellModule } from "./types";

const modules: CellModule[] = [agentStatus];

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

export function openPlacedMenu(placed: PlacedCell, menu: CellMenu): void {
  placed.module.menu(placed.cell, menu);
}
