export type BoardCell = {
  id: string;
  col: number;
  row: number;
};

// In the tilted view the canvas is foreshortened vertically by `squash` (1 when top-down), and x, y,
// midY describe the top face of the cell's prism. Tints fill that face as before; anything that
// should stand upright (icons, badges, text) is drawn inside `upright`.
export type CellFrame = {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  midY: number;
  zoom: number;
  squash: number;
  // Draw with (cx, cy) as the anchor: offsets from it are screen offsets, not foreshortened.
  upright(cx: number, cy: number, draw: () => void): void;
};

// Draws on top of every cell, in world coordinates. `origin` maps a hex to its top-left corner.
export type OverlayFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  side: number;
  zoom: number;
  origin(col: number, row: number): { x: number; y: number };
  squash: number;
  // How far the top of the cell's prism is raised, in (foreshortened) world units; 0 when flat.
  lift(col: number, row: number): number;
  upright(cx: number, cy: number, draw: () => void): void;
};

export type CellDetails = {
  title: string;
  subtitle: string;
  command: string | null;
};

export type CellForm = {
  title: string;
  value: string;
  placeholder: string;
  submitLabel: string;
  onSubmit(value: string): void;
  onDelete?: () => void;
};

export type CellMenu = {
  showForm(form: CellForm): void;
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
  // Drawn on the ground before any cell, so raised prisms stand in front of it (tilted view).
  underlay?(frame: OverlayFrame): void;
  // Prism height of a cell in the tilted view (world units); flat when absent.
  height?(cell: BoardCell, apothem: number): number;
  // A plain click on the canvas, in world coordinates; return true if the module handled it.
  click?(x: number, y: number): boolean;
  // Short description for the hover tooltip.
  describe?(cell: BoardCell): CellDetails | null;
  menu(cell: BoardCell, menu: CellMenu): void;
  // Right-click on a hex no module occupies; return true if the module opened a menu there.
  menuEmpty?(col: number, row: number, menu: CellMenu): boolean;
};
