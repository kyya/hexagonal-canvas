import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { connectLiveSessions, type Layout, type LiveSession, type ProjectLabel } from "../live";
import { armPop, popScale } from "./pop";
import type { BoardCell, CellModule } from "./types";

const ICON_SIZE = 48;
// History sessions are drawn faded so the running ones stand out.
const HISTORY_ALPHA = 0.38;
const IDLE_DOT = "#22c55e";
const BUSY_ARC = "rgba(37, 99, 235, 0.85)";
const WAITING = "#f59e0b";
const SPIN_MS = 1100;
const PULSE_MS = 1400;
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

function drawBusy(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number): void {
  const start = ((now % SPIN_MS) / SPIN_MS) * Math.PI * 2;
  ctx.save();
  ctx.strokeStyle = BUSY_ARC;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, ICON_SIZE / 2 + 7, start, start + Math.PI * 0.6);
  ctx.stroke();
  ctx.restore();
}

function drawWaitingHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number): void {
  const pulse = (Math.sin(((now % PULSE_MS) / PULSE_MS) * Math.PI * 2) + 1) / 2;
  ctx.save();
  ctx.fillStyle = WAITING;
  ctx.globalAlpha = 0.12 + pulse * 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy, ICON_SIZE / 2 + 8 + pulse * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, status: string): void {
  if (status === "waiting") {
    const radius = 8 * scale;
    ctx.fillStyle = WAITING;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(12 * scale)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", x, y + 0.5);
    return;
  }
  ctx.fillStyle = status === "busy" ? BUSY_ARC : IDLE_DOT;
  ctx.beginPath();
  ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
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
    const x = frame.x + frame.width / 2 - ICON_SIZE / 2;
    const y = frame.midY - ICON_SIZE / 2;
    const cx = x + ICON_SIZE / 2;
    const now = performance.now();
    if (status === "waiting") drawWaitingHalo(ctx, cx, frame.midY, now);
    ctx.save();
    if (!agent.session.live) ctx.globalAlpha = HISTORY_ALPHA;
    drawHexIcon(ctx, icon, x, y, ICON_SIZE, scale, () => frameRequest?.());
    ctx.restore();
    if (status === "busy") drawBusy(ctx, cx, frame.midY, now);
    if (status === "busy" || status === "waiting") keepAnimating();
    if (agent.session.live) drawBadge(ctx, x + ICON_SIZE - 2, y + 4, scale, status ?? "idle");
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
