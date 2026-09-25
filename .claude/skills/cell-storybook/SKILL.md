---
name: cell-storybook
description: Render storybook-style contact sheets of single hex cells on the Hexagonal Canvas — every visual state (history/faded, live idle / busy / waiting as breathing hex tints) with animation frames, plus one faded cell per agent icon. Use this whenever the user wants to see, screenshot, compare or review how a hex/格子 looks, asks for 单个格子截图 / 各种状态截图 / storybook / 组件图 / 视觉回归, or after any change to cell drawing (src/cells/*, src/icons.ts, status tints, icon sizes, breathing) so the result can be checked before and after — even if they only say "拍出来我看看" or "截个图看看效果".
---

# Cell storybook

Produces a contact sheet of hex cells in isolation, like a component storybook, so visual changes to
the canvas can be judged cell by cell instead of squinting at a full-canvas screenshot.

## Run it

From the repo root:

```bash
node --experimental-strip-types --no-warnings .claude/skills/cell-storybook/scripts/storybook.ts --out storybook-out
```

About 10 seconds. It prints the sheet path and `cells: N/N`. Output in `--out` (default `storybook-out/`,
git-ignored):

- `sheet.png` — the contact sheet: live states (idle / busy / waiting, animated ones as a frame strip),
  then a grid with one faded history cell per agent.
- `<state>-<agent>-<frame>.png` — each crop on its own (animated states keep every frame, static ones
  only frame 1), for side-by-side or before/after comparisons.

Every crop is cut out as a hexagon with transparent corners. A cell's rectangular bounding box
overlaps its six neighbours, so a plain rectangle would show slices of their tints and icons and make
a clean cell look broken. When you build your own comparison page from the crops, keep them as they
are (don't re-crop to a rectangle) and put them on a light background so the hex silhouette reads.
- `manifest.json` — which session, cell (col,row) and files belong to each story.

Live states (idle / busy / waiting) are always rendered with the Claude icon: Claude Code is the only
agent that publishes a status the fixture can fake. Other agents appear in the history grid only, so
when the user asks about a specific agent's live look, say that up front.

Options: `--agents claude,codex` (limit the history row), `--zoom 3` (bigger crops),
`--frames 6 --interval 200` (finer animation strip), `--keep` (keep the fixture HOME to inspect it).

It is safe to run next to `pnpm dev`: it never reads the real `$HOME` — sessions come from a throwaway
fixture HOME written in each agent's real file format, live processes are `sleep` children registered
in the fixture's `~/.claude/sessions`, and it starts its own server + Vite on free ports
(`HEX_API_PORT`). Everything it starts is stopped when it exits.

## Show the result

Send `sheet.png` to the user (SendUserFile with `display: "render"` when available), then describe what
you see state by state. The point of the sheet is to look closely, so actually read the image and call
out problems you notice, for example:

- states that are too faint or too similar to tell apart at normal zoom, or a breath too shallow to
  notice across the frame strip;
- a tint running past the hex edge, or anything drawn over the icon;
- **an empty hex in the history grid means that agent has no icon mapping** in `src/icons.ts`
  (`AGENT_SLUG`), even though its sessions are discovered;
- a story listed as missing in the script output means the server did not report that session —
  usually an adapter in `server/history/adapters.ts` no longer parses the fixture.

## Before / after a visual change

Cell proportions, timings and fades derive from the golden ratio in `src/cells/golden.ts` and are
locked by `src/cells/golden.test.ts` (`pnpm test`). A visual change that alters them is a design
change: update both files together, and run `pnpm test` alongside the storybook.

Run it once before editing (`--out storybook-out/before`), make the change, run again
(`--out storybook-out/after`), and show both sheets, or pair the individual crops, so the user sees the
difference rather than a description of it.

## Extending it

- New visual state: add it to `LIVE_STORIES` in `test/fixtures/sessions.ts` (live states are Claude sessions
  whose registry `status` drives the look) and handle its caption in `sheetHtml` in
  `scripts/storybook.ts` if it animates.
- New agent: add a writer to `writers` in `test/fixtures/sessions.ts` producing the smallest file that agent's
  adapter accepts, and add the agent to `HISTORY_AGENTS`.
- The fixtures and the app launcher live in `test/` and are shared with the end-to-end tests
  (`pnpm test:e2e`). Hex geometry in `test/harness.ts` mirrors `src/index.ts` (side 64); if the hex
  size changes there, change it in the harness too or the crops will be off-centre.

## Requirements

Playwright with Chromium. The script uses a project-local `playwright` if present, otherwise the
global install (`npm root -g`). If neither exists it says so; install with
`npm i -g playwright && npx playwright install chromium`.
