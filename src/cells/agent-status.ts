import { agentHexIcon, drawHexIcon, iconReady } from "../icons";
import { connectLiveSessions, type LiveSession } from "../live";
import { armPop, popScale } from "./pop";
import type { BoardCell, CellModule } from "./types";

const ICON_SIZE = 48;

type AgentCell = BoardCell & {
  sessionId: string;
  agent: string;
  title: string;
  cwd: string;
};

const seen = new Set<string>();
let cells: AgentCell[] = [];

function remember(sessions: LiveSession[]): void {
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    armPop(`live:${session.id}`);
  }
  for (const id of seen) {
    if (!sessions.some((session) => session.id === id)) seen.delete(id);
  }
  cells = sessions.map((session) => ({
    id: `agent-status:${session.id}`,
    col: session.col,
    row: session.row,
    sessionId: session.id,
    agent: session.agent,
    title: session.title,
    cwd: session.cwd,
  }));
}

function find(cell: BoardCell): AgentCell | null {
  return cells.find((item) => item.id === cell.id) ?? null;
}

export const agentStatus: CellModule = {
  kind: "agent-status",
  start(onChange) {
    frameRequest = onChange;
    connectLiveSessions((sessions) => {
      remember(sessions);
      onChange();
    });
  },
  cells() {
    return cells;
  },
  draw(cell, frame) {
    const agent = find(cell);
    if (!agent) return;
    const icon = agentHexIcon(agent.agent);
    if (!icon) return;
    const ready = iconReady(icon, () => frameRequest?.());
    const scale = popScale(`live:${agent.sessionId}`, ready);
    if (!ready || scale === 0) return;
    drawHexIcon(
      frame.ctx,
      icon,
      frame.x + frame.width / 2 - ICON_SIZE / 2,
      frame.midY - ICON_SIZE / 2,
      ICON_SIZE,
      scale,
      () => frameRequest?.(),
    );
  },
  menu(cell, menu) {
    const agent = find(cell);
    if (!agent) return;
    menu.showTranscript(agent.sessionId);
  },
};

let frameRequest: (() => void) | null = null;
