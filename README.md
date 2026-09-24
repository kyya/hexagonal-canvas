# <p align="center">Hexagonal Canvas</p>

![Hexagonal](./assets/hexagonal.png)

Created with CodeSandbox
[DEMO](https://z660b.csb.app/)

## Development

Requires Node.js `^20.19.0 || >=22.12.0` and pnpm 12.

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

## Agent sessions

`pnpm dev` also starts a small local server (`server/`) that finds every coding-agent session on
this machine and puts one on each hex, grouped by project. Running sessions are drawn in full colour
with a green dot; past ones are faded. Right-click a hex for its title, model, a copyable resume
command and the latest question and answer.

Sessions are read-only from each agent's own files, following the adapters of
[Wake](https://github.com/iAmCorey/Wake) (MIT):

| Agent | Data source |
|---|---|
| Claude Code | `~/.claude/projects/*/*.jsonl` (`CLAUDE_CONFIG_DIR`) |
| Codex CLI | `~/.codex/sessions/**`, `archived_sessions`, `state_5.sqlite` (`CODEX_HOME`) |
| Qoder CLI | `~/.qoder/projects/*/*.jsonl` (`QODER_CONFIG_DIR`) |
| CodeBuddy / WorkBuddy | `~/.codebuddy/projects`, `~/.workbuddy/projects` |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.jsonl` |
| Pi / Oh My Pi | `~/.pi/agent/sessions`, `~/.omp/agent/sessions` |
| Grok Build | `~/.grok/sessions/*/*/updates.jsonl` |
| Kimi Code | `~/.kimi-code/sessions/*/*/agents/main/wire.jsonl` |
| Kiro CLI | `~/.kiro/sessions/cli/*.jsonl` |
| DeepSeek Harness | `~/.dsh/sessions/*/*/session.jsonl[.zstd]` |

Files are only re-parsed when their size or mtime changes. The server binds to `127.0.0.1` only.
