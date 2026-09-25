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
- **Icons sit on Apple-style keylines.** Agent logos are measured for where their ink sits and
  classified as circle, square (filled tile), landscape or portrait; each is scaled to its keyline
  box so all shapes carry the same visual weight (square = the circle's area, rectangles span the
  diameter with the circle's area) and the ink, not the file padding, is centred
  (`src/cells/keyline.ts`, locked by `keyline.test.ts`). Draw icons through `drawHexIcon`, which
  also gives them their sticker look: a white die-cut border (φ⁻⁴ of the icon radius) and a soft
  shadow cast down-right (`STICKER` in `golden.ts`).
- **Keep the map calm.** Overlays that connect or annotate many cells (relation lines) draw only for
  the focused cell — hovered, or with its menu open (`src/focus.ts`) — never for everything at once.
- **Tilted view keeps these rules.** Tilted (`src/tilt.ts`, `TILT` in `golden.ts`), the canvas is
  foreshortened by `frame.squash`; tints, icons and the waiting badge lie on the (raised) top face
  and tilt with it, with no perspective. Text — numbers, notes, banners — is drawn inside
  `frame.upright(...)` with its anchor foreshortened (`offset * g.squash`) and its size not. Pass
  `frame.squash` to `cellGeometry`, and size text with `safeHalfWidth`, which then keeps it inside
  the foreshortened safe zone. A new overlay that lies on
  the ground goes in `underlay`; one that joins cells uses `frame.lift` to reach their raised tops.
- **State is shown by tint and breath, not rings.** A live session tints its whole hex and breathes
  (idle still, busy shallow and quick, waiting deep and slow); only waiting adds the "!" badge.
- Before and after any change to cell drawing, render the storybook and look at the crops.
