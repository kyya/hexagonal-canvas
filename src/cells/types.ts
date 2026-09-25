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
  zoom: number;
};

// Draws on top of every cell, in world coordinates. `origin` maps a hex to its top-left corner.
export type OverlayFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  side: number;
  zoom: number;
  origin(col: number, row: number): { x: number; y: number };
};

export type CellDetails = {
  title: string;
  subtitle: string;
  command: string | null;
};

export type CellMenu = {
  showDetails(details: CellDetails): void;
  // `live` sessions keep refreshing while the menu is open.
  showTranscript(sessionId: string, live?: boolean): void;
};

// A kind of hex content. Agent status is one kind; progress and quota can be added the same way.
export type CellModule = {
  kind: string;
  start(onChange: () => void): void;
  cells(): BoardCell[];
  draw(cell: BoardCell, frame: CellFrame): void;
  overlay?(frame: OverlayFrame): void;
  // A plain click on the canvas, in world coordinates; return true if the module handled it.
  click?(x: number, y: number): boolean;
  // Short description for the hover tooltip.
  describe?(cell: BoardCell): CellDetails | null;
  menu(cell: BoardCell, menu: CellMenu): void;
};
