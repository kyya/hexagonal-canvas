// Coin stacks: each project's stale sessions (untouched for FOG.afterDays) pile up on one hex at the
// front of its cluster, as a neat stack of cell-sized hex tiles, instead of filling the map with
// faded cells. The stack grows with the count (coinCount), the top tile carries the number, the
// tooltip summarises it and right-click lists every session in it.
import { agentName } from "../agents";
import { subscribeLayout, type Layout, type Stack } from "../live";
import { searchQuery, sessionMatches, subscribeSearch } from "../search";
import { ago, compactCount, details } from "./agent-status";
import { cellGeometry, coinCount, FOG, phiFade, prismHeight, STACK, STRATEGIC_ZOOM } from "./golden";
import type { BoardCell, CellFrame, CellModule } from "./types";

// Pale grey tiles: a light top; the lit (lower-left) and shaded (lower-right) sides alternate two
// tones from tile to tile so the layers read, like the prisms of the tilted view.
const FACE = "#f9fafb";
const SIDES = [
  ["#eef0f3", "#dfe2e7"],
  ["#e4e7eb", "#d3d7dd"],
] as const;
const EDGE = "rgba(0, 0, 0, 0.18)";
const COUNT = "rgba(75, 85, 99, 0.95)";
const FLAT = "#d1d5db";

type StackCell = BoardCell & { stack: Stack };

let cells: StackCell[] = [];
let byPosition = new Map<string, StackCell>();

function remember(layout: Layout): void {
  cells = layout.stacks.map((stack) => ({ id: stack.id, col: stack.col, row: stack.row, stack }));
  byPosition = new Map(cells.map((cell) => [`${cell.col},${cell.row}`, cell]));
}

function find(cell: BoardCell): StackCell | null {
  return byPosition.get(`${cell.col},${cell.row}`) ?? null;
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
}

// A hex (for the strategic view's flat block).
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, apothem: number): void {
  const r = apothem / Math.cos(Math.PI / 6);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + apothem, cy - r / 2);
  ctx.lineTo(cx + apothem, cy + r / 2);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - apothem, cy + r / 2);
  ctx.lineTo(cx - apothem, cy - r / 2);
  ctx.closePath();
}

// One tile the size of the cell standing on (cx, base), `thick` tall: its two front faces, then its
// top. `apothem` is the cell's. In the tilted view the canvas is foreshortened, so the tiles lie
// flat by themselves.
function drawTile(ctx: CanvasRenderingContext2D, cx: number, base: number, apothem: number, thick: number, lit: string, shade: string): void {
  const r = apothem / Math.cos(Math.PI / 6);
  const side = (ax: number, ay: number, bx: number, by: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(ax, ay - thick);
    ctx.lineTo(bx, by - thick);
    ctx.lineTo(bx, by);
    ctx.lineTo(ax, ay);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  side(cx - apothem, base + r / 2, cx, base + r, lit);
  side(cx, base + r, cx + apothem, base + r / 2, shade);
  ctx.fillStyle = FACE;
  hexPath(ctx, cx, base - thick, apothem);
  ctx.fill();
  ctx.stroke();
}

function drawStack(stack: Stack, frame: CellFrame): void {
  const { ctx } = frame;
  const apothem = frame.width / 2;
  const cx = frame.x + apothem;
  const cy = frame.midY;
  const count = stack.sessions.length;
  const dimmed = !!searchQuery() && !stack.sessions.some((session) => sessionMatches(session));
  ctx.save();
  if (dimmed) ctx.globalAlpha = phiFade(2);
  // The strategic view is flat colour: the pile becomes a grey block.
  if (frame.zoom < STRATEGIC_ZOOM) {
    ctx.fillStyle = FLAT;
    hexPath(ctx, cx, cy, apothem);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Tile thickness is a screen height: in the tilted view the canvas is foreshortened, so undo it.
  const thick = (apothem * STACK.thickness) / frame.squash;
  const tiles = coinCount(count);
  ctx.lineWidth = 1 / (2 * frame.zoom);
  ctx.strokeStyle = EDGE;
  // The bottom tile sits exactly on the cell; the rest rise from it, perfectly aligned.
  for (let k = 0; k < tiles; k++) {
    const [lit, shade] = SIDES[k % 2] ?? SIDES[0];
    drawTile(ctx, cx, cy - k * thick, apothem, thick, lit, shade);
  }
  const x = cx;
  // The count, upright on the top tile, inside the text safe zone.
  const top = cy - tiles * thick;
  const g = cellGeometry(apothem, frame.squash);
  frame.upright(x, top, () => {
    ctx.fillStyle = COUNT;
    ctx.font = `700 ${g.yieldFont}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(compactCount(count), x, top + 0.5);
  });
  ctx.restore();
}

export const stacks: CellModule = {
  kind: "stacks",
  start(onChange) {
    subscribeSearch(onChange);
    subscribeLayout((layout) => {
      remember(layout);
      onChange();
    });
  },
  cells() {
    return cells;
  },
  draw(cell, frame) {
    const found = find(cell);
    if (found) drawStack(found.stack, frame);
  },
  // Tilted, the pile stands on the same plinth as a session without messages.
  height(_cell, apothem) {
    return prismHeight(apothem, 0, 0);
  },
  describe(cell) {
    const found = find(cell);
    if (!found) return null;
    const { sessions, cwd } = found.stack;
    const latest = sessions[0];
    return {
      title: `${sessions.length} 个过时会话`,
      subtitle: [projectName(cwd), latest ? `最近一次 ${ago(latest.updatedAt ?? latest.createdAt)}` : "", "右键展开"].filter(Boolean).join(" · "),
      command: null,
    };
  },
  menu(cell, menu) {
    const found = find(cell);
    if (!found) return;
    const { sessions, cwd } = found.stack;
    menu.showList({
      title: `${sessions.length} 个过时会话`,
      subtitle: `${projectName(cwd)} · 超过 ${FOG.afterDays} 天没有动过，叠成一摞`,
      items: sessions.map((session) => ({
        title: session.title,
        meta: [agentName(session.agent), ago(session.updatedAt ?? session.createdAt)].filter(Boolean).join(" · "),
        onSelect() {
          menu.showDetails(details(session));
          menu.showTranscript(session.id, false);
        },
      })),
    });
  },
};
