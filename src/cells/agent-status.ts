import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { connectLiveSessions, type Layout, type LiveSession, type ProjectLabel } from "../live";
import { armPop, popScale } from "./pop";
import { BREATH, breathAlpha, cellGeometry, FADES } from "./golden";
import type { BoardCell, CellFrame, CellModule } from "./types";

// Every size, timing and opacity comes from ./golden (golden ratio, locked by golden.test.ts);
// only colours live here. A live session's state is a soft tint filling its hex, breathing.
const TINT = { idle: "#22c55e", busy: "#2563eb", waiting: "#f59e0b" } as const;
const BASE_TITLE = document.title;

type AgentCell = BoardCell & { session: LiveSession };

const seen = new Set<string>();
let cells: AgentCell[] = [];
let byPosition = new Map<string, AgentCell>();
let labels: ProjectLabel[] = [];
let primed = false;

function remember(layout: Layout): void {
  const ids = new Set(layout.sessions.map((session) => session.id));
  for (const session of layout.sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    // The first snapshot can hold thousands of history sessions; only pop what appears later.
    if (primed || session.live) armPop(`live:${session.id}`);
  }
  for (const id of seen) {
    if (!ids.has(id)) seen.delete(id);
  }
  primed = true;
  cells = layout.sessions.map((session) => ({
    id: `agent-status:${session.id}`,
    col: session.col,
    row: session.row,
    session,
  }));
  byPosition = new Map(cells.map((cell) => [`${cell.col},${cell.row}`, cell]));
  labels = layout.labels;
  const waiting = layout.sessions.filter((session) => session.status === "waiting").length;
  document.title = waiting > 0 ? `(${waiting}) 等你处理 · ${BASE_TITLE}` : BASE_TITLE;
}

// Busy and waiting cells animate; keep one animation frame queued while any of them is drawn.
let animationFrame = 0;
function keepAnimating(): void {
  if (animationFrame !== 0) return;
  animationFrame = requestAnimationFrame(() => {
    animationFrame = 0;
    frameRequest?.();
  });
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, side: number): void {
  const rise = side / 2;
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width, y + rise);
  ctx.lineTo(x + width, y + rise + side);
  ctx.lineTo(x + width / 2, y + 2 * rise + side);
  ctx.lineTo(x, y + rise + side);
  ctx.lineTo(x, y + rise);
  ctx.closePath();
}

// Drawn under the icon: the whole hex takes the state's colour at its breathing opacity.
function drawStateTint(ctx: CanvasRenderingContext2D, frame: CellFrame, state: keyof typeof TINT, now: number): void {
  ctx.save();
  ctx.fillStyle = TINT[state];
  ctx.globalAlpha = breathAlpha(BREATH[state], now);
  hexPath(ctx, frame.x, frame.y, frame.width, frame.midY - frame.y);
  ctx.fill();
  ctx.restore();
}

const STATUS_TEXT = { busy: "工作中", waiting: "等你处理", idle: "空闲" } as const;

function find(cell: BoardCell): AgentCell | null {
  return byPosition.get(`${cell.col},${cell.row}`) ?? null;
}

function ago(value: string | null): string {
  const time = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return new Date(time).toLocaleDateString();
}

export const agentStatus: CellModule = {
  kind: "agent-status",
  start(onChange) {
    frameRequest = onChange;
    connectLiveSessions((layout) => {
      remember(layout);
      onChange();
    });
  },
  cells() {
    return cells;
  },
  draw(cell, frame) {
    const agent = find(cell);
    if (!agent) return;
    const icon = agentHexIcon(agent.session.agent);
    if (!icon) return;
    const ready = iconReady(icon, () => frameRequest?.());
    const scale = popScale(`live:${agent.session.id}`, ready);
    if (!ready || scale === 0) return;
    const { ctx } = frame;
    const { status } = agent.session;
    const g = cellGeometry(frame.width / 2);
    const x = frame.x + frame.width / 2 - g.iconSize / 2;
    const y = frame.midY - g.iconSize / 2;
    const state = agent.session.live ? (status ?? "idle") : null;
    if (state) {
      drawStateTint(ctx, frame, state, performance.now());
      const { min, max } = BREATH[state];
      if (max > min) keepAnimating();
    }
    ctx.save();
    if (!agent.session.live) ctx.globalAlpha = FADES.history;
    drawHexIcon(ctx, icon, x, y, g.iconSize, scale, () => frameRequest?.());
    ctx.restore();
  },
  overlay(frame) {
    const { ctx } = frame;
    ctx.save();
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    for (const label of labels) {
      const { x, y } = frame.origin(label.col, label.row);
      ctx.fillText(label.name, x + frame.width / 2, y - 6);
    }
    ctx.restore();
  },
  menu(cell, menu) {
    const agent = find(cell);
    if (!agent) return;
    const { session } = agent;
    const state = session.status ? STATUS_TEXT[session.status] : session.live ? "运行中" : "";
    const waitingFor = session.status === "waiting" && session.waitingFor ? `：${session.waitingFor}` : "";
    const status = session.live ? `${state}${waitingFor}` : ago(session.updatedAt);
    menu.showDetails({
      title: session.title,
      subtitle: [session.agent, session.model, status, session.cwd].filter(Boolean).join(" · "),
      command: session.resume,
    });
    menu.showTranscript(session.id, session.live);
  },
};

let frameRequest: (() => void) | null = null;
