export type LiveSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  col: number;
  row: number;
};

type ApiSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
};

const AGENT_ORDER = ["claude", "codex", "grok", "kimi", "qoder"];

function neighbors(col: number, row: number): { col: number; row: number }[] {
  const parity = ((row % 2) + 2) % 2;
  const deltas =
    parity === 0
      ? [
          [1, 0],
          [-1, 0],
          [0, -1],
          [-1, -1],
          [0, 1],
          [-1, 1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [1, -1],
          [0, -1],
          [1, 1],
          [0, 1],
        ];
  return deltas.map(([dCol, dRow]) => ({ col: col + dCol, row: row + dRow }));
}

function cluster(origin: { col: number; row: number }, count: number, used: Set<string>): { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  const seen = new Set<string>();
  const queue = [origin];
  seen.add(`${origin.col},${origin.row}`);
  while (cells.length < count && queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    const key = `${cell.col},${cell.row}`;
    if (!used.has(key)) cells.push(cell);
    for (const next of neighbors(cell.col, cell.row)) {
      const nextKey = `${next.col},${next.row}`;
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }
  return cells;
}

function place(sessions: ApiSession[]): LiveSession[] {
  const groups = new Map<string, ApiSession[]>();
  for (const session of sessions) {
    const list = groups.get(session.agent) ?? [];
    list.push(session);
    groups.set(session.agent, list);
  }
  const agents = [...groups.keys()].sort((a, b) => {
    const aIndex = AGENT_ORDER.indexOf(a);
    const bIndex = AGENT_ORDER.indexOf(b);
    return (aIndex === -1 ? AGENT_ORDER.length : aIndex) - (bIndex === -1 ? AGENT_ORDER.length : bIndex);
  });

  const used = new Set<string>();
  const placed: LiveSession[] = [];
  let anchorCol = 0;
  for (const agent of agents) {
    const list = (groups.get(agent) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    const cells = cluster({ col: anchorCol, row: 0 }, list.length, used);
    list.forEach((session, index) => {
      const cell = cells[index];
      if (!cell) return;
      used.add(`${cell.col},${cell.row}`);
      placed.push({ ...session, col: cell.col, row: cell.row });
    });
    anchorCol = Math.max(anchorCol, ...cells.map((cell) => cell.col)) + 2;
  }
  return placed;
}

export function sessionAt(sessions: LiveSession[], col: number, row: number): LiveSession | null {
  return sessions.find((session) => session.col === col && session.row === row) ?? null;
}

export function connectLiveSessions(onUpdate: (sessions: LiveSession[]) => void): void {
  const source = new EventSource("/api/sessions/stream");
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { sessions?: ApiSession[] };
      onUpdate(place(payload.sessions ?? []));
    } catch {
      onUpdate([]);
    }
  };
}
