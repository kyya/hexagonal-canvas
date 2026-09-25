import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { subscribeLayout, type Layout, type LiveSession } from "../live";
import { armPop, popScale } from "./pop";
import { fogged, lens, lensTint, subscribeLens } from "../lens";
import { searchQuery, sessionMatches, subscribeSearch } from "../search";
import { isOn, subscribeToggles } from "../toggles";
import { BREATH, breathAlpha, cellGeometry, FADES, FOG, PHI, phiFade, STRATEGIC_ZOOM, type CellGeometry } from "./golden";
import { projectHue } from "./palette";
import type { BoardCell, CellDetails, CellFrame, CellModule } from "./types";

// Every size, timing and opacity comes from ./golden (golden ratio, locked by golden.test.ts);
// only colours live here. A live session's state is a soft tint filling its hex, breathing.
const TINT = { idle: "#22c55e", busy: "#2563eb", waiting: "#f59e0b" } as const;
const BADGE = "#f59e0b";
const FOG_COLOUR = "#f3f4f6";
const SEARCH_VEIL = "#ffffff";
const YIELD_BACKGROUND = "rgba(8, 145, 178, 0.9)";
const BASE_TITLE = document.title;

type AgentCell = BoardCell & { session: LiveSession };

const seen = new Set<string>();
let cells: AgentCell[] = [];
let byPosition = new Map<string, AgentCell>();
let primed = false;

let maxMessages = 0;

function remember(layout: Layout): void {
  maxMessages = Math.max(0, ...layout.sessions.map((session) => session.messages));
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

function fillHex(ctx: CanvasRenderingContext2D, frame: CellFrame, colour: string, alpha: number): void {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.globalAlpha = alpha;
  hexPath(ctx, frame.x, frame.y, frame.width, frame.midY - frame.y);
  ctx.fill();
  ctx.restore();
}

// Status lens background. Live cells take their state's colour: breathing up close, flat at φ⁻¹ in
// the strategic view. History cells stay clear, except in the strategic view where they take a
// pale wash of their project's colour so clusters still read.
function drawStatusBackground(ctx: CanvasRenderingContext2D, frame: CellFrame, session: LiveSession, strategic: boolean, now: number): void {
  const state = session.live ? (session.status ?? "idle") : null;
  if (state) {
    fillHex(ctx, frame, TINT[state], strategic ? phiFade(1) : breathAlpha(BREATH[state], now));
    const { min, max } = BREATH[state];
    if (max > min && !strategic) keepAnimating();
  } else if (strategic) {
    fillHex(ctx, frame, `hsl(${projectHue(session.cwd)}, 45%, 60%)`, phiFade(3));
  }
}

// Civ-style yield under the icon: the session's message count, in a small pill.
function drawYield(ctx: CanvasRenderingContext2D, g: CellGeometry, frame: CellFrame, messages: number): void {
  const text = String(messages);
  const cx = frame.x + frame.width / 2;
  const cy = frame.midY + g.yieldOffset;
  ctx.save();
  ctx.font = `700 ${g.yieldFont}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + g.yieldFont;
  const height = g.yieldFont * PHI;
  ctx.fillStyle = YIELD_BACKGROUND;
  ctx.beginPath();
  ctx.roundRect(cx - width / 2, cy - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
}

// Waiting also gets a solid "!" badge (not breathing), so it reads without relying on colour.
function drawWaitingBadge(ctx: CanvasRenderingContext2D, g: CellGeometry, cx: number, cy: number, scale: number): void {
  const x = cx + Math.cos(g.badgeAngle) * g.badgeDistance * scale;
  const y = cy + Math.sin(g.badgeAngle) * g.badgeDistance * scale;
  const radius = g.badgeRadius * scale;
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, radius + g.badgeOutline * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BADGE;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${Math.round(g.badgeGlyph * scale)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", x, y + 0.5 * scale);
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
    subscribeLens(() => onChange());
    subscribeSearch(() => onChange());
    subscribeToggles(() => onChange());
    subscribeLayout((layout) => {
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
    const { session } = agent;
    const { ctx } = frame;
    const strategic = frame.zoom < STRATEGIC_ZOOM;
    const activeLens = lens();
    const icon = agentHexIcon(session.agent);
    const ready = icon ? iconReady(icon, () => frameRequest?.()) : false;
    const scale = popScale(`live:${session.id}`, ready || strategic);
    if (scale === 0) return;

    if (activeLens === "status") {
      drawStatusBackground(ctx, frame, session, strategic, performance.now());
    } else {
      const tint = lensTint(activeLens, session, maxMessages);
      if (tint) fillHex(ctx, frame, tint.colour, strategic ? Math.max(tint.alpha, phiFade(2)) : tint.alpha);
    }

    const g = cellGeometry(frame.width / 2);
    // The strategic view is flat colour: no icons, like Civ's 2D map.
    if (!strategic && icon && ready) {
      const x = frame.x + frame.width / 2 - g.iconSize / 2;
      const y = frame.midY - g.iconSize / 2;
      ctx.save();
      if (!session.live) ctx.globalAlpha = FADES.history;
      drawHexIcon(ctx, icon, x, y, g.iconSize, scale, () => frameRequest?.());
      ctx.restore();
    }
    if (activeLens === "status" && fogged(session)) fillHex(ctx, frame, FOG_COLOUR, FOG.veil);
    if (session.live && session.status === "waiting") drawWaitingBadge(ctx, g, frame.x + frame.width / 2, frame.midY, scale);
    if (!strategic && isOn("yields") && session.messages > 0) drawYield(ctx, g, frame, session.messages);
    // Search: everything that does not match fades back under a white veil.
    if (searchQuery() && !sessionMatches(session)) fillHex(ctx, frame, SEARCH_VEIL, phiFade(1) + phiFade(3));
  },
  describe(cell) {
    const agent = find(cell);
    return agent ? details(agent.session) : null;
  },
  menu(cell, menu) {
    const agent = find(cell);
    if (!agent) return;
    menu.showDetails(details(agent.session));
    menu.showTranscript(agent.session.id, agent.session.live);
  },
};

function details(session: LiveSession): CellDetails {
  const state = session.status ? STATUS_TEXT[session.status] : session.live ? "运行中" : "";
  const waitingFor = session.status === "waiting" && session.waitingFor ? `：${session.waitingFor}` : "";
  const status = session.live ? `${state}${waitingFor}` : ago(session.updatedAt);
  return {
    title: session.title,
    subtitle: [session.agent, session.model, status, session.cwd].filter(Boolean).join(" · "),
    command: session.resume,
  };
}

let frameRequest: (() => void) | null = null;
