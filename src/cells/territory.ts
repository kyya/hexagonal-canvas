// Civ-style territory: each project's cluster gets a border in the project's colour, and a banner
// above it with the project name and how many sessions it has, how many run and how many wait on
// you. Clicking a banner glides the camera to the project.
import { subscribeLayout, type Layout, type LiveSession, type ProjectLabel } from "../live";
import { view } from "../view";
import { PHI, phiFade } from "./golden";
import { projectHue } from "./palette";
import type { CellModule, OverlayFrame } from "./types";

// Banner type size in screen pixels; below zoom 1 it stays this size on screen instead of shrinking.
const BANNER_FONT = 13;
const BANNER_HEIGHT = BANNER_FONT * PHI + 2;
const BORDER_WIDTH = 2.5;
const LIVE_DOT = "#22c55e";
const WAITING = "#f59e0b";

type Banner = { label: ProjectLabel; x: number; y: number; width: number; height: number };

let layout: Layout = { sessions: [], labels: [] };
let projectOf = new Map<string, string>();
let banners: Banner[] = [];

function key(col: number, row: number): string {
  return `${col},${row}`;
}

// Neighbour across each edge, in the order the edges are walked below (NE, E, SE, SW, W, NW).
function neighbour(col: number, row: number, edge: number): [number, number] {
  const odd = ((row % 2) + 2) % 2 === 1;
  const deltas = odd
    ? [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 0], [0, -1]]
    : [[0, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const [dCol, dRow] = deltas[edge] ?? [0, 0];
  return [col + dCol, row + dRow];
}

function drawBorders(frame: OverlayFrame, sessions: LiveSession[]): void {
  const { ctx, width, side } = frame;
  const rise = side / 2;
  ctx.save();
  ctx.lineWidth = Math.max(BORDER_WIDTH, (BORDER_WIDTH * 0.6) / frame.zoom);
  ctx.lineCap = "round";
  for (const session of sessions) {
    const project = session.cwd || "";
    const { x, y } = frame.origin(session.col, session.row);
    const corners: [number, number][] = [
      [x + width / 2, y],
      [x + width, y + rise],
      [x + width, y + rise + side],
      [x + width / 2, y + 2 * rise + side],
      [x, y + rise + side],
      [x, y + rise],
    ];
    ctx.strokeStyle = `hsla(${projectHue(project)}, 58%, 46%, ${phiFade(1)})`;
    ctx.beginPath();
    for (let edge = 0; edge < 6; edge++) {
      const [col, row] = neighbour(session.col, session.row, edge);
      if (projectOf.get(key(col, row)) === project) continue;
      const [ax, ay] = corners[edge] ?? [0, 0];
      const [bx, by] = corners[(edge + 1) % 6] ?? [0, 0];
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBanners(frame: OverlayFrame): void {
  const { ctx } = frame;
  // World units per screen pixel, capped so banners grow with zoom-in but never shrink below 1:1.
  const unit = 1 / Math.min(frame.zoom, 1);
  const font = BANNER_FONT * unit;
  const height = BANNER_HEIGHT * unit;
  const pad = (font / PHI) * 1;
  const gap = font / PHI ** 2;
  const dot = font / PHI ** 2;
  banners = [];
  ctx.save();
  ctx.textBaseline = "middle";
  for (const label of layout.labels) {
    const hue = projectHue(label.cwd);
    ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
    const nameWidth = ctx.measureText(label.name).width;
    ctx.font = `500 ${font}px ui-sans-serif, system-ui, sans-serif`;
    const total = String(label.total);
    const totalWidth = ctx.measureText(total).width;
    const liveText = label.live > 0 ? String(label.live) : "";
    const waitingText = label.waiting > 0 ? String(label.waiting) : "";
    const countWidth = (text: string) => (text ? dot * 2 + gap + ctx.measureText(text).width : 0);
    const liveWidth = countWidth(liveText);
    const waitingWidth = countWidth(waitingText);
    const width = pad + nameWidth + gap * 2 + totalWidth + (liveWidth ? gap * 2 + liveWidth : 0) + (waitingWidth ? gap * 2 + waitingWidth : 0) + pad;
    const { x: hexX, y: hexY } = frame.origin(label.col, label.row);
    const x = hexX + frame.width / 2 - width / 2;
    const y = hexY - height - gap * 2;
    banners.push({ label, x, y, width, height });

    ctx.fillStyle = "#fff";
    ctx.strokeStyle = `hsla(${hue}, 58%, 46%, ${phiFade(1)})`;
    ctx.lineWidth = unit;
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
    ctx.stroke();

    const mid = y + height / 2;
    let cursor = x + pad;
    ctx.textAlign = "left";
    ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = `hsl(${hue}, 45%, 30%)`;
    ctx.fillText(label.name, cursor, mid);
    cursor += nameWidth + gap * 2;
    ctx.font = `500 ${font}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillText(total, cursor, mid);
    cursor += totalWidth;
    // Running and waiting counts: a dot in the state's colour, then the number.
    for (const [text, colour] of [[liveText, LIVE_DOT], [waitingText, WAITING]] as const) {
      if (!text) continue;
      cursor += gap * 2;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(cursor + dot, mid, dot, 0, Math.PI * 2);
      ctx.fill();
      cursor += dot * 2 + gap;
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillText(text, cursor, mid);
      cursor += ctx.measureText(text).width;
    }
  }
  ctx.restore();
}

export const territory: CellModule = {
  kind: "territory",
  start(onChange) {
    subscribeLayout((next) => {
      layout = next;
      projectOf = new Map(next.sessions.map((session) => [key(session.col, session.row), session.cwd || ""]));
      onChange();
    });
  },
  cells() {
    return [];
  },
  draw() {},
  overlay(frame) {
    drawBorders(frame, layout.sessions);
    drawBanners(frame);
  },
  click(x, y) {
    const hit = banners.find((banner) => x >= banner.x && x <= banner.x + banner.width && y >= banner.y && y <= banner.y + banner.height);
    if (!hit) return false;
    view().focus(hit.label.centre.col, hit.label.centre.row);
    return true;
  },
  menu() {},
};

// Test hook: banner rectangles in world coordinates, as last drawn.
export function bannerRects(): { cwd: string; x: number; y: number; width: number; height: number }[] {
  return banners.map((banner) => ({ cwd: banner.label.cwd, x: banner.x, y: banner.y, width: banner.width, height: banner.height }));
}
