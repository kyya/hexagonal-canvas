// Minimap (bottom-left): every session as a dot in its state or project colour, the viewport as a
// frame; click or drag on it to move the camera there.
import { fogged } from "../lens";
import { subscribeLayout, type Layout } from "../live";
import { projectHue } from "../cells/palette";
import { view } from "../view";

// Golden rectangle, in CSS pixels.
const WIDTH = 208;
const HEIGHT = Math.round(WIDTH / 1.618033988749895);
const PAD = 10;
const STATE_COLOURS = { idle: "#22c55e", busy: "#2563eb", waiting: "#f59e0b" } as const;
// The map always covers at least this much of the world (about 18 hexes across), so a handful of
// sessions show as small dots with room around them and the viewport frame stays meaningful.
const MIN_SPAN_X = 2000;
const MIN_SPAN_Y = MIN_SPAN_X / 1.618033988749895;
// Dots never grow past this radius (CSS pixels).
const MAX_DOT = 5;

export function startMinimap(root: HTMLElement): void {
  const box = document.createElement("div");
  box.className = "hud-minimap";
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * 2;
  canvas.height = HEIGHT * 2;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  canvas.setAttribute("aria-label", "小地图");
  box.append(canvas);
  root.append(box);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let layout: Layout = { sessions: [], labels: [] };
  // World → minimap transform, refreshed when the layout changes.
  let fit = { minX: 0, minY: 0, scale: 1, offsetX: 0, offsetY: 0 };
  let lastKey = "";

  const refit = () => {
    const centres = layout.sessions.map((session) => view().hexCentre(session.col, session.row));
    if (centres.length === 0) return;
    const margin = 120;
    let minX = Math.min(...centres.map((c) => c.x)) - margin;
    let maxX = Math.max(...centres.map((c) => c.x)) + margin;
    let minY = Math.min(...centres.map((c) => c.y)) - margin;
    let maxY = Math.max(...centres.map((c) => c.y)) + margin;
    const growX = Math.max(0, MIN_SPAN_X - (maxX - minX)) / 2;
    const growY = Math.max(0, MIN_SPAN_Y - (maxY - minY)) / 2;
    minX -= growX;
    maxX += growX;
    minY -= growY;
    maxY += growY;
    const scale = Math.min((WIDTH - PAD * 2) / (maxX - minX), (HEIGHT - PAD * 2) / (maxY - minY));
    fit = { minX, minY, scale, offsetX: (WIDTH - (maxX - minX) * scale) / 2, offsetY: (HEIGHT - (maxY - minY) * scale) / 2 };
  };

  const toMap = (x: number, y: number) => ({ x: fit.offsetX + (x - fit.minX) * fit.scale, y: fit.offsetY + (y - fit.minY) * fit.scale });
  const toWorld = (x: number, y: number) => ({ x: fit.minX + (x - fit.offsetX) / fit.scale, y: fit.minY + (y - fit.offsetY) / fit.scale });

  const draw = () => {
    const bounds = view().viewBounds();
    const key = `${bounds.x.toFixed(1)},${bounds.y.toFixed(1)},${bounds.width.toFixed(1)},${bounds.height.toFixed(1)},${layout.sessions.length}`;
    if (key === lastKey) return;
    lastKey = key;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const radius = Math.min(MAX_DOT, Math.max(1.6, 55 * fit.scale));
    for (const session of layout.sessions) {
      const centre = view().hexCentre(session.col, session.row);
      const point = toMap(centre.x, centre.y);
      const state = session.live ? (session.status ?? "idle") : null;
      ctx.fillStyle = state ? STATE_COLOURS[state] : fogged(session) ? "#e5e7eb" : `hsl(${projectHue(session.cwd)}, 45%, 70%)`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    const topLeft = toMap(bounds.x, bounds.y);
    const bottomRight = toMap(bounds.x + bounds.width, bounds.y + bounds.height);
    ctx.strokeStyle = "rgba(17, 24, 39, 0.7)";
    ctx.lineWidth = 1.2;
    // Keep the frame on the map even when the view is wider than everything on it.
    const left = Math.max(1, topLeft.x);
    const top = Math.max(1, topLeft.y);
    const right = Math.min(WIDTH - 1, bottomRight.x);
    const bottom = Math.min(HEIGHT - 1, bottomRight.y);
    if (right > left && bottom > top) ctx.strokeRect(left, top, right - left, bottom - top);
  };

  subscribeLayout((next) => {
    layout = next;
    // Nothing to map yet (the status card explains why).
    box.hidden = next.sessions.length === 0;
    refit();
    lastKey = "";
    draw();
  });
  view().onRender(draw);

  let dragging = false;
  const jump = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    view().centreOn(world.x, world.y);
  };
  canvas.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    jump(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (dragging) jump(event);
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });
}
