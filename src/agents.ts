// Display names of the coding agents the server reads (server/history/adapters.ts), for the UI:
// tooltips, menus, legends, search results and the empty state.
export const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  qoder: "Qoder",
  codebuddy: "CodeBuddy",
  workbuddy: "WorkBuddy",
  gemini: "Gemini CLI",
  pi: "Pi",
  omp: "Oh My Pi",
  grok: "Grok",
  kimi: "Kimi Code",
  kiro: "Kiro",
  dsh: "DeepSeek",
};

export function agentName(agent: string): string {
  return AGENT_NAMES[agent] ?? agent;
}
