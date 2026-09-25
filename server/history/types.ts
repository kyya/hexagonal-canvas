export type Turn = { role: "user" | "assistant"; text: string };

// One conversation found on disk. `file` stays on the server; the rest is sent to the canvas.
export type HistorySession = {
  id: string;
  agent: string;
  nativeId: string;
  title: string;
  cwd: string;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  messages: number;
  resume: string | null;
  file: string;
};

// What an adapter extracts from a single session file. The scanner fills in id, agent and file.
export type ParsedSession = Omit<HistorySession, "id" | "agent" | "file" | "resume"> & {
  // Adapters return null for files that are not user conversations (subagents, background jobs...).
  skip?: false;
};

// Ported from Wake's AgentAdapter: enumeration must stay cheap (readdir + stat only), and the full
// parse only runs for files whose mtime or size changed since the previous scan.
export type Adapter = {
  agent: string;
  files(): string[];
  parse(file: string): ParsedSession | null;
  turns(file: string): Turn[];
  resume(session: { nativeId: string; cwd: string }): string | null;
};
