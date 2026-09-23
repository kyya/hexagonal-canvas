export type BoardCell = {
  id: string;
  col: number;
  row: number;
};

export type CellFrame = {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  midY: number;
};

export type CellMenu = {
  showTranscript(sessionId: string): void;
};

// A kind of hex content. Agent status is one kind; progress and quota can be added the same way.
export type CellModule = {
  kind: string;
  start(onChange: () => void): void;
  cells(): BoardCell[];
  draw(cell: BoardCell, frame: CellFrame): void;
  menu(cell: BoardCell, menu: CellMenu): void;
};
