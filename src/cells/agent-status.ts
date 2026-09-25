import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { connectLiveSessions, type Layout, type LiveSession, type ProjectLabel } from "../live";
import { armPop, popScale } from "./pop";
import { cellGeometry, FADES, MOTION, type CellGeometry } from "./golden";
import type { BoardCell, CellFrame, CellModule } from "./types";

// Every size, timing and opacity comes from ./golden (golden ratio, locked by golden.test.ts);
// only colours live here.
const IDLE = "#22c55e";
const BUSY = "#2563eb";
const WAITING = "#f59e0b";
// Waiting fills its whole hex with a breathing tint behind the icon.
const WAITING_FILL = "#f59e0b";
const WAITING_RING = true;
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

function drawBusy(ctx: CanvasRenderingContext2D, g: CellGeometry, cx: number, cy: number, scale: number, now: number): void {
  const radius = g.ringRadius * scale;
  ctx.save();
  ctx.lineWidth = g.ringWidth * scale;
  ctx.lineCap = "round";
  // Faint track so the moving arc reads as progress around a ring, not a stray stroke.
  ctx.strokeStyle = `rgba(37, 99, 235, ${FADES.busyTrack})`;
  ring(ctx, cx, cy, radius);
  const stretch = (1 - Math.cos(((now % MOTION.stretchMs) / MOTION.stretchMs) * Math.PI * 2)) / 2;
  const length = MOTION.arcMin + (MOTION.arcMax - MOTION.arcMin) * stretch;
  const head = ((now % MOTION.spinMs) / MOTION.spinMs) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = BUSY;
  ring(ctx, cx, cy, radius, head - length, head);
  ctx.restore();
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

function breathOf(now: number): number {
  return (1 - Math.cos(((now % MOTION.pulseMs) / MOTION.pulseMs) * Math.PI * 2)) / 2;
}

// Drawn under the icon: the hex fills with a tint breathing between φ⁻⁴ and φ⁻² opacity.
function drawWaitingFill(ctx: CanvasRenderingContext2D, frame: CellFrame, now: number): void {
  ctx.save();
  ctx.fillStyle = WAITING_FILL;
  ctx.globalAlpha = FADES.waitingFillMin + (FADES.waitingFillMax - FADES.waitingFillMin) * breathOf(now);
  hexPath(ctx, frame.x, frame.y, frame.width, frame.midY - frame.y);
  ctx.fill();
  ctx.restore();
}

// Drawn over the icon: the ring breathes between φ⁻¹ and full opacity, in step with the fill.
function drawWaiting(ctx: CanvasRenderingContext2D, g: CellGeometry, cx: number, cy: number, scale: number, now: number): void {
  if (!WAITING_RING) return;
  ctx.save();
  ctx.strokeStyle = WAITING;
  ctx.globalAlpha = FADES.waitingRingMin + (1 - FADES.waitingRingMin) * breathOf(now);
  ctx.lineWidth = g.ringWidth * scale;
  ring(ctx, cx, cy, g.ringRadius * scale);
  ctx.restore();
}

// Idle keeps a quiet track so every live cell shares the ring and its badge never floats alone.
function drawIdle(ctx: CanvasRenderingContext2D, g: CellGeometry, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.lineWidth = g.ringWidth * scale;
  ctx.strokeStyle = `rgba(34, 197, 94, ${FADES.idleTrack})`;
  ring(ctx, cx, cy, g.ringRadius * scale);
  ctx.restore();
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  g: CellGeometry,
  cx: number,
  cy: number,
  scale: number,
  status: "idle" | "waiting",
): void {
  const x = cx + Math.cos(g.badgeAngle) * g.ringRadius * scale;
  const y = cy + Math.sin(g.badgeAngle) * g.ringRadius * scale;
  const radius = g.badgeRadius * scale;
  ctx.save();
  // A white outline separates the badge from the ring and whatever the icon draws underneath.
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, radius + g.badgeOutline * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = status === "waiting" ? WAITING : IDLE;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  if (status === "waiting") {
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${Math.round(g.badgeGlyph * scale)}px ui-sans-serif, system-ui, sans-serif`;
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
    const g = cellGeometry(frame.width / 2);
    const x = frame.x + frame.width / 2 - g.iconSize / 2;
    const y = frame.midY - g.iconSize / 2;
    const cx = x + g.iconSize / 2;
    const cy = frame.midY;
    const now = performance.now();
    if (agent.session.live && status === "waiting") drawWaitingFill(ctx, frame, now);
    ctx.save();
    if (!agent.session.live) ctx.globalAlpha = FADES.history;
    drawHexIcon(ctx, icon, x, y, g.iconSize, scale, () => frameRequest?.());
    ctx.restore();
    if (!agent.session.live) return;
    if (status === "idle" || !status) drawIdle(ctx, g, cx, cy, scale);
    if (status === "busy") drawBusy(ctx, g, cx, cy, scale, now);
    if (status === "waiting") drawWaiting(ctx, g, cx, cy, scale, now);
    if (status === "busy" || status === "waiting") keepAnimating();
    // Busy needs no badge: the spinner is the indicator, and a badge would sit in its path.
    if (status !== "busy") drawBadge(ctx, g, cx, cy, scale, status === "waiting" ? "waiting" : "idle");
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
