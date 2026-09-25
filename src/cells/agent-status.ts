import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { connectLiveSessions, type Layout, type LiveSession, type ProjectLabel } from "../live";
import { armPop, popScale } from "./pop";
import type { BoardCell, CellModule } from "./types";

const ICON_SIZE = 48;
// History sessions are drawn faded so the running ones stand out.
const HISTORY_ALPHA = 0.38;
// Status geometry, all relative to the icon centre so the pieces never drift apart: one ring just
// outside the icon, and the status badge sitting on that ring at the top-right (-45°).
const RING_RADIUS = ICON_SIZE / 2 + 10;
const RING_WIDTH = 3;
const BADGE_ANGLE = -Math.PI / 4;
const BADGE_RADIUS = 7;
const BADGE_OUTLINE = 2;
const IDLE = "#22c55e";
const BUSY = "#2563eb";
const WAITING = "#f59e0b";
// Busy spinner: the arc turns once per SPIN_MS and its length breathes over STRETCH_MS.
const SPIN_MS = 1400;
const STRETCH_MS = 1800;
const ARC_MIN = Math.PI * 0.2;
const ARC_MAX = Math.PI * 1.1;
// Waiting: the ring breathes and a ripple spreads outward once per PULSE_MS.
const PULSE_MS = 1600;
const RIPPLE_SPREAD = 9;
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

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, from = 0, to = Math.PI * 2): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, from, to);
  ctx.stroke();
}

function drawBusy(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, now: number): void {
  const radius = RING_RADIUS * scale;
  ctx.save();
  ctx.lineWidth = RING_WIDTH * scale;
  ctx.lineCap = "round";
  // Faint track so the moving arc reads as progress around a ring, not a stray stroke.
  ctx.strokeStyle = "rgba(37, 99, 235, 0.12)";
  ring(ctx, cx, cy, radius);
  const stretch = (1 - Math.cos(((now % STRETCH_MS) / STRETCH_MS) * Math.PI * 2)) / 2;
  const length = ARC_MIN + (ARC_MAX - ARC_MIN) * stretch;
  const head = ((now % SPIN_MS) / SPIN_MS) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = BUSY;
  ring(ctx, cx, cy, radius, head - length, head);
  ctx.restore();
}

function drawWaiting(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, now: number): void {
  const t = (now % PULSE_MS) / PULSE_MS;
  const breath = (1 - Math.cos(t * Math.PI * 2)) / 2;
  const radius = RING_RADIUS * scale;
  ctx.save();
  ctx.strokeStyle = WAITING;
  // Ripple: leaves the ring and fades as it spreads.
  ctx.globalAlpha = 0.45 * (1 - t);
  ctx.lineWidth = RING_WIDTH * scale * (1 - t * 0.5);
  ring(ctx, cx, cy, radius + RIPPLE_SPREAD * scale * t);
  ctx.globalAlpha = 0.55 + 0.45 * breath;
  ctx.lineWidth = RING_WIDTH * scale;
  ring(ctx, cx, cy, radius);
  ctx.restore();
}

// Idle keeps a quiet track so every live cell shares the ring and its badge never floats alone.
function drawIdle(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.lineWidth = RING_WIDTH * scale;
  ctx.strokeStyle = "rgba(34, 197, 94, 0.22)";
  ring(ctx, cx, cy, RING_RADIUS * scale);
  ctx.restore();
}

function drawBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, status: "idle" | "waiting"): void {
  const x = cx + Math.cos(BADGE_ANGLE) * RING_RADIUS * scale;
  const y = cy + Math.sin(BADGE_ANGLE) * RING_RADIUS * scale;
  const radius = BADGE_RADIUS * scale;
  ctx.save();
  // A white outline separates the badge from the ring and whatever the icon draws underneath.
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, radius + BADGE_OUTLINE * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = status === "waiting" ? WAITING : IDLE;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  if (status === "waiting") {
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(11 * scale)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", x, y + 0.5 * scale);
  }
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
    const x = frame.x + frame.width / 2 - ICON_SIZE / 2;
    const y = frame.midY - ICON_SIZE / 2;
    const cx = x + ICON_SIZE / 2;
    const cy = frame.midY;
    const now = performance.now();
    ctx.save();
    if (!agent.session.live) ctx.globalAlpha = HISTORY_ALPHA;
    drawHexIcon(ctx, icon, x, y, ICON_SIZE, scale, () => frameRequest?.());
    ctx.restore();
    if (!agent.session.live) return;
    if (status === "idle" || !status) drawIdle(ctx, cx, cy, scale);
    if (status === "busy") drawBusy(ctx, cx, cy, scale, now);
    if (status === "waiting") drawWaiting(ctx, cx, cy, scale, now);
    if (status === "busy" || status === "waiting") keepAnimating();
    // Busy needs no badge: the spinner is the indicator, and a badge would sit in its path.
    if (status !== "busy") drawBadge(ctx, cx, cy, scale, status === "waiting" ? "waiting" : "idle");
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
