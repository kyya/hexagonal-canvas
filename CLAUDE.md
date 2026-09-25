# Hexagonal Canvas

A hex-grid canvas that shows every coding-agent session on this machine (Vite + TypeScript front end
in `src/`, a small Hono server in `server/` that reads each agent's session files).

## Commands

- `pnpm dev` — server + Vite. `pnpm build` — typecheck and build.
- `pnpm test` — unit tests (`src/**/*.test.ts`), including the locked cell design.
- `pnpm test:e2e` — the whole app in Chromium against a fixture `$HOME` (`test/`). Set
  `E2E_SHOTS=<dir>` to save the verification screenshots.
- Visual review of cells: the `cell-storybook` project skill.

## Cell design rules

These are deliberate and locked by `src/cells/golden.test.ts`; change them only on purpose, updating
`src/cells/golden.ts` and the test together.

- **Golden ratio.** Every size, timing and opacity inside a cell derives from φ, measured from the
  hex apothem (`cellGeometry` in `src/cells/golden.ts`). Drawing code takes its numbers from there
  and declares none of its own (`agent-status.ts` is checked for this).
- **Text keeps clear of the edges.** Anything that carries text in a cell — badges with a glyph,
  yield numbers, pin notes, any new label — must lie entirely inside the text safe zone: the hex
  shrunk by apothem / φ³ (≈ 13 px at zoom 1) on every side (`geometry.safeApothem`). Size text boxes
  with `safeHalfWidth(g, top, bottom)`, and truncate, abbreviate or shrink the type rather than let a
  glyph enter the band. Add each new text element to the "text safe zone" unit tests, and make sure
  the band check in `test/e2e/annotate.test.ts` covers it with worst-case content.
- **State is shown by tint and breath, not rings.** A live session tints its whole hex and breathes
  (idle still, busy shallow and quick, waiting deep and slow); only waiting adds the "!" badge.
- Before and after any change to cell drawing, render the storybook and look at the crops.
