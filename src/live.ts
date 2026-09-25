// Explicit extension: the tests load this module in Node, which does not resolve bare paths.
import { FOG } from "./cells/golden.ts";
import { replayState, subscribeReplay } from "./replay.ts";

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
  messages: number;
  resume: string | null;
  parentId: string | null;
  relation: "fork" | "spawn" | null;
  col: number;
  row: number;
  // Stale history (untouched for FOG.afterDays) is piled into its project's coin stack: the
  // session keeps the stack's hex as its position but is drawn as part of the pile.
  stacked: boolean;
};

// A project's pile of stale sessions, like a stack of coins on one hex (newest first).
export type Stack = {
  id: string;
  cwd: string;
  col: number;
  row: number;
  sessions: LiveSession[];
};

export type ProjectLabel = {
  name: string;
  cwd: string;
  // Where the banner hangs: the hex just above the cluster's top ring.
  col: number;
  row: number;
  // The cluster's centre hex and ring radius, for focusing the whole project.
  centre: { col: number; row: number };
  radius: number;
  total: number;
  live: number;
  waiting: number;
};

export type Layout = {
  sessions: LiveSession[];
  labels: ProjectLabel[];
  stacks: Stack[];
};

export type ApiSession = Omit<LiveSession, "col" | "row" | "stacked">;

const DAY_MS = 86_400_000;

// History nobody has touched for FOG.afterDays days (the fog of war) goes onto the coin stack.
export function isStale(session: ApiSession, now = Date.now()): boolean {
  if (session.live) return false;
  const touched = Date.parse(session.updatedAt ?? session.createdAt ?? "");
  return !Number.isFinite(touched) || now - touched >= FOG.afterDays * DAY_MS;
}

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
// appended, so the canvas does not reshuffle every time a session writes a line. With `stack`, each
// project's stale sessions share one hex at the front of its cluster.
export function place(sessions: ApiSession[], options: { stack?: boolean; now?: number } = {}): Layout {
  const stack = options.stack ?? true;
  const now = options.now ?? Date.now();
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
  const stacks: Stack[] = [];
  let shelfCol = 0;
  let shelfRow = 0;
  let shelfRadius = 0;
  for (const [cwd, list] of projects) {
    const stale = stack ? list.filter((session) => isStale(session, now)) : [];
    const active = stale.length > 0 ? list.filter((session) => !stale.includes(session)) : list;
    const cellCount = active.length + (stale.length > 0 ? 1 : 0);
    const radius = ringRadius(cellCount);
    if (shelfCol > 0 && shelfCol + 2 * radius + 1 > SHELF_COLS) {
      // Keep shelf rows even so every shelf has the same row parity.
      shelfRow += 2 * Math.ceil((2 * shelfRadius + 4) / 2);
      shelfCol = 0;
      shelfRadius = 0;
    }
    shelfRadius = Math.max(shelfRadius, radius);
    const centre = { col: shelfCol + radius, row: shelfRow };
    const cells = cluster(centre, cellCount);
    // The pile takes the cluster's front cell (lowest row, nearest the middle), so in the tilted
    // view nothing stands in front of it; active sessions fill the rest in ring order.
    const pile =
      stale.length > 0
        ? cells.reduce((best, cell) =>
            cell.row > best.row || (cell.row === best.row && Math.abs(cell.col - centre.col) < Math.abs(best.col - centre.col)) ? cell : best,
          )
        : null;
    const free = pile ? cells.filter((cell) => cell !== pile) : cells;
    active.forEach((session, index) => {
      const cell = free[index];
      if (cell) placed.push({ ...session, col: cell.col, row: cell.row, stacked: false });
    });
    if (stale.length > 0 && pile) {
      const members = stale
        .map((session) => ({ ...session, col: pile.col, row: pile.row, stacked: true }))
        .sort((a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt));
      placed.push(...members);
      stacks.push({ id: `stack:${cwd}`, cwd, col: pile.col, row: pile.row, sessions: members });
    }
    labels.push({
      name: projectName(cwd) || "Unknown project",
      cwd,
      col: centre.col,
      row: centre.row - radius,
      centre,
      radius,
      total: list.length,
      live: list.filter((session) => session.live).length,
      waiting: list.filter((session) => session.status === "waiting").length,
    });
    shelfCol += 2 * radius + 2;
  }
  return { sessions: placed, labels, stacks };
}

// One EventSource for the page; every module that cares about sessions subscribes to the layout.
const EMPTY: Layout = { sessions: [], labels: [], stacks: [] };
const listeners = new Set<(layout: Layout) => void>();
let raw: ApiSession[] = [];
let latest: Layout = EMPTY;
let source: EventSource | null = null;

// During a replay, keep every cell where the full layout puts it but show only sessions that
// existed at the replay time, all as history, with banner counts to match.
function compute(): Layout {
  const replay = replayState();
  if (!replay.active) return place(raw);
  // A replay shows every session where it first appeared, so nothing is piled up.
  const full = place(raw, { stack: false });
  const sessions = full.sessions
    .filter((session) => time(session.createdAt) <= replay.time)
    .map((session) => ({ ...session, live: false, status: null, waitingFor: null }));
  const counts = new Map<string, number>();
  for (const session of sessions) counts.set(session.cwd || "", (counts.get(session.cwd || "") ?? 0) + 1);
  const labels = full.labels
    .filter((label) => counts.has(label.cwd))
    .map((label) => ({ ...label, total: counts.get(label.cwd) ?? 0, live: 0, waiting: 0 }));
  return { sessions, labels, stacks: [] };
}

function emit(): void {
  latest = compute();
  for (const listener of listeners) listener(latest);
}

// Connection to the local server, for the HUD's loading, empty and "connection lost" states.
// `received` turns true with the first snapshot and stays true, so a later drop reads as lost
// rather than as loading.
export type Connection = { state: "connecting" | "open" | "lost"; received: boolean };
let connection: Connection = { state: "connecting", received: false };
const connectionListeners = new Set<(value: Connection) => void>();
// EventSource retries by itself after a dropped stream, but gives up for good on some errors
// (e.g. an HTTP error response); then reconnect ourselves after this delay.
const RECONNECT_MS = 2000;
// The server sends a heartbeat every 5 s (server/index.ts). Silence for this long means the server
// is gone even if the connection looks open (a proxy can keep it open): drop it and reconnect.
const SILENCE_MS = 12_000;
let lastHeard = 0;
let watchdog = 0;

function setConnection(next: Connection): void {
  if (next.state === connection.state && next.received === connection.received) return;
  connection = next;
  for (const listener of connectionListeners) listener(connection);
}

export function currentConnection(): Connection {
  return connection;
}

export function subscribeConnection(listener: (value: Connection) => void): () => void {
  connectionListeners.add(listener);
  listener(connection);
  return () => {
    connectionListeners.delete(listener);
  };
}

function open(): void {
  const current = new EventSource("/api/sessions/stream");
  source = current;
  lastHeard = Date.now();
  current.addEventListener("ping", () => {
    lastHeard = Date.now();
    if (connection.received) setConnection({ state: "open", received: true });
  });
  current.onmessage = (event) => {
    lastHeard = Date.now();
    try {
      const payload = JSON.parse(event.data) as { sessions?: ApiSession[] };
      raw = payload.sessions ?? [];
    } catch {
      raw = [];
    }
    setConnection({ state: "open", received: true });
    emit();
  };
  current.onerror = () => {
    setConnection({ state: "lost", received: connection.received });
    if (current.readyState === EventSource.CLOSED && source === current) {
      source = null;
      window.setTimeout(open, RECONNECT_MS);
    }
  };
  window.clearInterval(watchdog);
  watchdog = window.setInterval(() => {
    if (source !== current || Date.now() - lastHeard < SILENCE_MS) return;
    current.close();
    source = null;
    setConnection({ state: "lost", received: connection.received });
    window.clearInterval(watchdog);
    open();
  }, SILENCE_MS / 4);
}

function connect(): void {
  subscribeReplay(emit);
  open();
}

let connected = false;

export function subscribeLayout(listener: (layout: Layout) => void): () => void {
  listeners.add(listener);
  if (!connected) {
    connected = true;
    connect();
  } else listener(latest);
  return () => {
    listeners.delete(listener);
  };
}

export function currentLayout(): Layout {
  return latest;
}

// Every session's creation time, oldest first: the replay's "turns".
export function sessionTimes(): number[] {
  return raw
    .map((session) => time(session.createdAt))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
}
