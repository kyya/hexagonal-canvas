# <p align="center">Hexagonal Canvas</p>

<p align="center">本机 agent 会话地图 — every coding-agent session on this machine, on one hex map.</p>

![Hexagonal](./assets/hexagonal.png)

## Development

Requires Node.js `^20.19.0 || >=22.12.0` and pnpm 12.

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm test
pnpm test:e2e
```

`pnpm test:e2e` runs the whole app against a throwaway fixture `$HOME` (one session per agent, plus
live sessions backed by stand-in processes) and drives it in Chromium: session discovery, the state
tints and badge read back from canvas pixels, the right-click menu and transcript, and live updates
(a status change, a process exiting, a new session file, a new reply). It needs Playwright with
Chromium (`npm i -g playwright && npx playwright install chromium`) and never touches your real
`$HOME` or a running `pnpm dev`.

`pnpm test` locks the golden-ratio design of a cell (`src/cells/golden.ts`): proportions, timings and
breathing all derive from φ, and the test fails if one drifts or if drawing code hard-codes its own sizes.

## Agent sessions

`pnpm dev` also starts a small local server (`server/`) that finds every coding-agent session on
this machine and puts one on each hex, grouped by project. A running session tints its hex and
breathes: still pale green when idle, shallow quick blue breaths while working, deep slow amber
breaths when it is waiting on you. Agent icons look like stickers — a white die-cut border and a soft shadow. Past sessions are faded. Right-click a hex for its title, model, a copyable resume
command and the whole conversation.

### Getting started

Open the page and a short help panel explains the map (press `?` or the ? button any time). If
no session is found yet, a card lists the supported agents; if the local server is not running, a
card says how to start it (`pnpm dev`), and a strip at the top shows while a dropped connection
reconnects. Right-click a session for its details; the menu opens beside the cell and can copy the
project path or open it in VS Code.

### Finding your way

- **Next waiting**: when sessions wait on you, a button in the bottom-right corner counts them. Press
  `N` or click it to glide to the next one with its menu open; the caret lists them all.
- **Territory**: each project's cluster has a border in the project's colour and a banner showing
  its name, session count, running (green) and waiting (amber) counts. Click a banner to fly there.
- **Tooltip**: rest the pointer on a cell for its title, agent, model and state.

### Views

- **Lenses** (top-left, keys `1`–`5`): recolour the map by state (default), recency, agent, model or
  message count, with a legend for each. The choice is remembered.
- **Strategic view**: zoom out past φ⁻¹ and cells become flat colour blocks without icons, like
  Civ's 2D map; the **minimap** (bottom-left) shows everything and moves the camera on click or drag.
- **Fog of war**: history sessions untouched for 30 days are veiled in grey (state lens).
- **Tilted view** (`T` or the 倾斜 chip): tilt the camera like Civ's default view. The ground is
  foreshortened to φ⁻¹ (about 52°), every session stands as a hex prism that rises with its message
  count, icons and the waiting badge lie on the tops and tilt with them, and text stays upright to read. Zooming out towards the strategic view levels the
  map again. The choice is remembered.

### Notes and search

- **Yields** (`Y` or the 数字 chip): each cell shows its message count in a small pill under the icon.
- **Search** (`/` or `⌘K`): dims everything that does not match title, project, agent, model or pin
  note, lists the hits, and `Enter` flies to the selected one.
- **Map pins**: right-click an empty hex to drop a note; right-click the pin to edit or remove it.
  Pins live in this browser's storage and show up in the tooltip and search.

### History

- **Relations**: hover a session (or open its menu) to see its family — a straight line to the
  session it came from, solid with an arrow for a spawned sub-agent (Codex `thread_spawn`, Grok
  sub-agents), dashed for a Codex fork. The menu and tooltip say "分叉自 / 派生自" the parent.
- **Replay** (`R` or 回放): the map rewinds to the first session and grows back one session at a
  time, like Civ's end-game replay. Play, scrub, or × to return to live.

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
