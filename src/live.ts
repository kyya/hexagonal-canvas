export type LiveSession = {
  id: string;
  agent: string;
  title: string;
  cwd: string;
  live: boolean;
  status: "busy" | "waiting" | "idle" | null;
  waitingFor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  resume: string | null;
  col: number;
  row: number;
};

export type ProjectLabel = {
  name: string;
  cwd: string;
  col: number;
  row: number;
};

export type Layout = {
  sessions: LiveSession[];
  labels: ProjectLabel[];
};

type ApiSession = Omit<LiveSession, "col" | "row">;

// Projects are laid out on shelves. A shelf wraps once it is this many columns wide.
const SHELF_COLS = 36;

type Cell = { col: number; row: number };

function neighbors(col: number, row: number): Cell[] {
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

// Breadth-first rings around the origin: the first cells are the centre, then ring 1, ring 2...
function cluster(origin: Cell, count: number): Cell[] {
  const cells: Cell[] = [];
  const seen = new Set<string>([`${origin.col},${origin.row}`]);
  const queue = [origin];
  while (cells.length < count && queue.length > 0) {
    const cell = queue.shift();
    if (!cell) break;
    cells.push(cell);
    for (const next of neighbors(cell.col, cell.row)) {
      const key = `${next.col},${next.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return cells;
}

// Smallest ring radius r whose hexagon (1 + 3r(r+1) cells) holds count cells.
function ringRadius(count: number): number {
  let radius = 0;
  while (1 + 3 * radius * (radius + 1) < count) radius++;
  return radius;
}

function projectName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "";
}

function time(value: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

// Order is chosen for stability: projects and sessions keep their cells while new ones are
// appended, so the canvas does not reshuffle every time a session writes a line.
function place(sessions: ApiSession[]): Layout {
  const groups = new Map<string, ApiSession[]>();
  for (const session of sessions) {
    const key = session.cwd || "";
    const list = groups.get(key) ?? [];
    list.push(session);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id));
  }
  const projects = [...groups.entries()].sort(
    ([aKey, a], [bKey, b]) => time(a[0]?.createdAt ?? null) - time(b[0]?.createdAt ?? null) || aKey.localeCompare(bKey),
  );

  const placed: LiveSession[] = [];
  const labels: ProjectLabel[] = [];
  let shelfCol = 0;
  let shelfRow = 0;
  let shelfRadius = 0;
  for (const [cwd, list] of projects) {
    const radius = ringRadius(list.length);
    if (shelfCol > 0 && shelfCol + 2 * radius + 1 > SHELF_COLS) {
      // Keep shelf rows even so every shelf has the same row parity.
      shelfRow += 2 * Math.ceil((2 * shelfRadius + 4) / 2);
      shelfCol = 0;
      shelfRadius = 0;
    }
    shelfRadius = Math.max(shelfRadius, radius);
    const centre = { col: shelfCol + radius, row: shelfRow };
    cluster(centre, list.length).forEach((cell, index) => {
      const session = list[index];
      if (session) placed.push({ ...session, col: cell.col, row: cell.row });
    });
    labels.push({ name: projectName(cwd) || "Unknown project", cwd, col: centre.col, row: centre.row - radius });
    shelfCol += 2 * radius + 2;
  }
  return { sessions: placed, labels };
}

export function connectLiveSessions(onUpdate: (layout: Layout) => void): void {
  const source = new EventSource("/api/sessions/stream");
  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { sessions?: ApiSession[] };
      onUpdate(place(payload.sessions ?? []));
    } catch {
      onUpdate({ sessions: [], labels: [] });
    }
  };
}
