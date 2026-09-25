// Coin stacks: each project's stale sessions (untouched for FOG.afterDays) pile up on one hex at the
// front of its cluster, like a stack of coins, instead of filling the map with faded cells. The pile
// grows with the count (coinCount), the top coin carries the number, the tooltip summarises it and
// right-click lists every session in it.
import { agentName } from "../agents";
import { subscribeLayout, type Layout, type Stack } from "../live";
import { searchQuery, sessionMatches, subscribeSearch } from "../search";
import { ago, compactCount, details } from "./agent-status";
import { cellGeometry, coinCount, FOG, phiFade, prismHeight, STACK, STRATEGIC_ZOOM } from "./golden";
import type { BoardCell, CellFrame, CellModule } from "./types";

// Silver hex coins: a pale face; the lit (lower-left) and shaded (lower-right) rims alternate two
// tones from coin to coin so each one reads on its own.
const FACE = "#f3f4f6";
const RIMS = [
  ["#e5e7eb", "#d1d5db"],
  ["#d9dde3", "#c4c9d1"],
] as const;
const EDGE = "rgba(0, 0, 0, 0.22)";
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

// One hexagonal coin lying on (cx, base), `thick` tall, pointy-top like the grid: its two front
// faces (the rim that shows), then its face. `plate` is the coin's apothem. In the tilted view the
// canvas is foreshortened, so the coins lie flat by themselves.
function drawCoin(ctx: CanvasRenderingContext2D, cx: number, base: number, plate: number, thick: number, rim: string, shade: string): void {
  const r = plate / Math.cos(Math.PI / 6);
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
  side(cx - plate, base + r / 2, cx, base + r, rim);
  side(cx, base + r, cx + plate, base + r / 2, shade);
  ctx.fillStyle = FACE;
  hexPath(ctx, cx, base - thick, plate);
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
  const plate = apothem * STACK.plate;
  // Coin thickness is a screen height: in the tilted view the canvas is foreshortened, so undo it.
  const thick = (apothem * STACK.thickness) / frame.squash;
  const coins = coinCount(count);
  // The pile is centred in the hex: the bottom coin rests half the pile's height below the centre.
  const floor = cy + (coins * thick) / 2;
  ctx.lineWidth = 1 / (2 * frame.zoom);
  ctx.strokeStyle = EDGE;
  let x = cx;
  for (let k = 0; k < coins; k++) {
    // A fixed, hand-stacked wobble (golden-angle steps), the same on every frame.
    x = cx + Math.sin(k * 2.39996) * apothem * STACK.wobble;
    const [rim, shade] = RIMS[k % 2] ?? RIMS[0];
    drawCoin(ctx, x, floor - k * thick, plate, thick, rim, shade);
  }
  // The count, upright on the top coin, inside the text safe zone.
  const top = floor - coins * thick;
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
