// The canvas's camera and menu, as other modules see them. src/index.ts owns the implementation
// and installs it at startup; HUD pieces (the waiting button, minimap, search…) only talk to this.
export type Camera = { x: number; y: number; zoom: number };

export type View = {
  camera(): Camera;
  // Glide the camera so the hex is centred; optionally open its menu once it arrives.
  focus(col: number, row: number, options?: { openMenu?: boolean; zoom?: number }): void;
  // Jump the camera so the world point is centred, without animation.
  centreOn(x: number, y: number): void;
  hexCentre(col: number, row: number): { x: number; y: number };
  // The ground rectangle the screen shows (taller than the screen in world units when tilted).
  viewBounds(): { x: number; y: number; width: number; height: number };
  requestRender(): void;
  // Called after every canvas render (camera moves, zoom, animation), e.g. to redraw the minimap.
  onRender(listener: () => void): void;
};

let current: View | null = null;

export function installView(view: View): void {
  current = view;
}

export function view(): View {
  if (!current) throw new Error("view used before src/index.ts installed it");
  return current;
}
