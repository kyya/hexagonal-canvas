// Locks the golden-ratio design of a cell. If one of these fails, a proportion, timing or fade
// drifted from φ. Change the design on purpose by updating ./golden.ts *and* this file together,
// and re-check the look with the cell-storybook skill.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { BREATH, breathAlpha, cellGeometry, FADES, FOG, insetOf, PHI, phiFade, prismHeight, safeHalfWidth, STICKER, STRATEGIC_ZOOM, TILT, tiltRise, tiltSquash } from "./golden.ts";

// The canvas hex: side 64, so the apothem (inscribed radius, half the cell width) is 64·cos 30°.
const APOTHEM = Math.cos(Math.PI / 6) * 64;
const EPSILON = 1e-9;

function close(actual: number, expected: number, what: string, epsilon = EPSILON): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${what}: expected ${expected}, got ${actual}`);
}

describe("φ", () => {
  test("is the golden ratio", () => {
    close(PHI, 1.618033988749895, "PHI");
    close(PHI * PHI, PHI + 1, "φ² = φ + 1");
  });

  test("phiFade(n) is φ⁻ⁿ", () => {
    close(phiFade(0), 1, "φ⁰");
    close(phiFade(1), 1 / PHI, "φ⁻¹");
    close(phiFade(2), 1 / PHI ** 2, "φ⁻²");
  });
});

describe("cell geometry", () => {
  const g = cellGeometry(APOTHEM);

  test("apothem : icon radius = φ² : 1", () => {
    close(APOTHEM / (g.iconSize / 2), PHI ** 2, "apothem / icon radius");
  });

  test("apothem : safe margin = φ³ : 1", () => {
    close(APOTHEM / (APOTHEM - g.safeApothem), PHI ** 3, "apothem / safe margin");
  });

  test("icon radius : badge radius = φ² : 1", () => {
    close(g.iconSize / 2 / g.badgeRadius, PHI ** 2, "icon radius / badge radius");
  });

  test("badge radius : badge outline = φ³ : 1", () => {
    close(g.badgeRadius / g.badgeOutline, PHI ** 3, "badge radius / outline");
  });

  test("badge diameter : glyph = φ : 1", () => {
    close((g.badgeRadius * 2) / g.badgeGlyph, PHI, "badge diameter / glyph");
  });

  test("badge sits on the golden-rectangle diagonal (rise : run = φ : 1), top-right", () => {
    close(Math.tan(-g.badgeAngle), PHI, "tan(badge angle)");
    assert.ok(g.badgeAngle < 0 && g.badgeAngle > -Math.PI / 2, "badge must be in the top-right quadrant");
  });

  test("icon radius : yield font = φ : 1, yield pill height = font · φ, pill rides the icon's bottom edge", () => {
    close(g.iconSize / 2 / g.yieldFont, PHI, "icon radius / yield font");
    close(g.yieldHeight, g.yieldFont * PHI, "yield pill height");
    close(g.yieldOffset, g.iconSize / 2, "yield offset = icon radius");
  });

  test("scales with the hex", () => {
    const double = cellGeometry(APOTHEM * 2);
    const keys = ["iconSize", "safeApothem", "badgeDistance", "badgeRadius", "badgeOutline", "badgeGlyph", "yieldOffset", "yieldFont", "yieldHeight", "pinHeadRadius", "pinHeadY", "pinTipY", "noteOffset", "noteFont"] as const;
    for (const key of keys) close(double[key], g[key] * 2, `${key} at twice the size`);
    close(double.badgeAngle, g.badgeAngle, "badge angle does not scale");
  });

  // Pixel snapshot at the canvas size (side 64): catches a change that keeps the ratios but moves the base.
  const snapshot = {
    iconSize: 42.341,
    safeApothem: 42.341,
    badgeDistance: 32.3605,
    badgeRadius: 8.086,
    badgeOutline: 1.909,
    badgeGlyph: 9.995,
    yieldOffset: 21.171,
    yieldFont: 13.084,
  };
  for (const [key, value] of Object.entries(snapshot)) {
    test(`${key} ≈ ${value}px`, () => close(g[key as keyof typeof snapshot], value, key, 0.0005));
  }
  test("badge angle ≈ -58.283°", () => close((g.badgeAngle * 180) / Math.PI, -58.283, "badge angle", 0.0005));
});

// Rule: text never crowds a hex edge. Everything that carries text lies inside the hex shrunk by
// apothem / φ³ (≈ 13 px at the canvas size) on every side.
describe("text safe zone", () => {
  const g = cellGeometry(APOTHEM);
  const margin = APOTHEM - g.safeApothem;

  test("insetOf measures distance to the nearest edge", () => {
    close(insetOf(APOTHEM, 0, 0), APOTHEM, "centre");
    close(insetOf(APOTHEM, APOTHEM, 0), 0, "right edge");
    close(insetOf(APOTHEM, 0, 64), APOTHEM - 64 * (Math.sqrt(3) / 2), "bottom vertex lies outside the inscribed circle");
  });

  test("the waiting badge (with its outline) stays a full margin from every edge", () => {
    const x = Math.cos(g.badgeAngle) * g.badgeDistance;
    const y = Math.sin(g.badgeAngle) * g.badgeDistance;
    const clearance = insetOf(APOTHEM, x, y) - g.badgeRadius - g.badgeOutline;
    assert.ok(clearance >= margin - EPSILON, `badge clears the edge by ${clearance}, needs ${margin}`);
    assert.ok(g.badgeDistance > g.iconSize / 2, "badge centre lies outside the icon's radius");
  });

  test("the yield pill fits every compact count (up to four characters) inside the safe zone", () => {
    const top = g.yieldOffset - g.yieldHeight / 2;
    const bottom = g.yieldOffset + g.yieldHeight / 2;
    const maxWidth = 2 * safeHalfWidth(g, top, bottom);
    // Bold digits are at most ~0.62 em wide; the pill adds one font size of padding.
    const widest = 4 * 0.62 * g.yieldFont + g.yieldFont;
    assert.ok(widest <= maxWidth, `a four-character pill is ${widest} wide, the safe zone allows ${maxWidth}`);
    for (const [x, y] of [[-maxWidth / 2, top], [maxWidth / 2, top], [-maxWidth / 2, bottom], [maxWidth / 2, bottom]]) {
      assert.ok(insetOf(APOTHEM, x ?? 0, y ?? 0) >= margin - EPSILON, `pill corner (${x}, ${y}) crowds an edge`);
    }
  });

  test("a pin note gets at least a few characters of width, and its widest line stays in the zone", () => {
    const half = g.noteFont * 0.625;
    const maxWidth = 2 * safeHalfWidth(g, g.noteOffset - half, g.noteOffset + half);
    assert.ok(maxWidth >= 4 * g.noteFont, `note line only ${maxWidth} wide`);
    assert.ok(insetOf(APOTHEM, maxWidth / 2, g.noteOffset + half) >= margin - EPSILON);
    assert.ok(g.pinTipY < g.noteOffset - half, "the tack ends above the note");
    assert.ok(insetOf(APOTHEM, 0, g.pinHeadY - g.pinHeadRadius) >= margin - EPSILON, "the tack head stays in the zone");
  });
});
describe("state breathing", () => {
  // [min power, max power, period power]: opacity φ^-min … φ^-max, one breath per φ^period seconds.
  const expected: Record<keyof typeof BREATH, [number, number, number]> = {
    idle: [5, 5, 1],
    busy: [5, 3, 1],
    waiting: [4, 2, 2],
  };
  for (const [state, [minPower, maxPower, periodPower]] of Object.entries(expected)) {
    const breath = BREATH[state as keyof typeof BREATH];
    test(`${state}: tint φ⁻${minPower} … φ⁻${maxPower}, one breath per φ^${periodPower} s`, () => {
      close(breath.min, PHI ** -minPower, `${state} min`);
      close(breath.max, PHI ** -maxPower, `${state} max`);
      close(breath.periodMs, 1000 * PHI ** periodPower, `${state} period`);
    });
  }

  test("idle is still; busy and waiting breathe", () => {
    assert.equal(BREATH.idle.min, BREATH.idle.max);
    assert.ok(BREATH.busy.max > BREATH.busy.min);
    assert.ok(BREATH.waiting.max > BREATH.waiting.min);
  });

  test("waiting is the loudest state: deepest tint and deepest breath", () => {
    assert.ok(BREATH.waiting.max > BREATH.busy.max && BREATH.busy.max > BREATH.idle.max);
    assert.ok(BREATH.waiting.max - BREATH.waiting.min > BREATH.busy.max - BREATH.busy.min);
  });

  test("tints stay soft: never above φ⁻²", () => {
    for (const [state, breath] of Object.entries(BREATH)) {
      assert.ok(breath.max <= phiFade(2) + EPSILON, `${state} tint peaks at ${breath.max}`);
    }
  });

  test("breathAlpha eases from min to max and back over one period", () => {
    const { min, max, periodMs } = BREATH.waiting;
    close(breathAlpha(BREATH.waiting, 0), min, "start of breath");
    close(breathAlpha(BREATH.waiting, periodMs / 2), max, "middle of breath");
    close(breathAlpha(BREATH.waiting, periodMs), min, "end of breath");
    close(breathAlpha(BREATH.idle, 1234), BREATH.idle.min, "idle never changes");
  });
});

describe("fades", () => {
  test("history = φ⁻²", () => close(FADES.history, phiFade(2), "history"));
  test("fog of war veils at φ⁻¹ after 30 days", () => {
    close(FOG.veil, phiFade(1), "fog veil");
    assert.equal(FOG.afterDays, 30);
  });
});

describe("strategic view", () => {
  test("starts below zoom φ⁻¹", () => close(STRATEGIC_ZOOM, 1 / PHI, "strategic zoom"));
});

describe("tilted view", () => {
  test("the ground is foreshortened to φ⁻¹, so heights stand φ^-½ tall", () => {
    close(TILT.squash, 1 / PHI, "full tilt squash");
    close(tiltRise(TILT.squash), PHI ** -0.5, "rise at full tilt");
    close((Math.acos(TILT.squash) * 180) / Math.PI, 51.827, "camera angle", 0.001);
  });

  test("the camera tilts over φ⁻¹ s", () => close(TILT.glideMs, 1000 / PHI, "tilt glide"));

  test("top-down is flat; the tilt eases out towards the strategic zoom", () => {
    close(tiltSquash(0, 1), 1, "tilt off");
    close(tiltSquash(1, 1), TILT.squash, "tilted at zoom 1");
    close(tiltSquash(1, 2), TILT.squash, "tilted zoomed in");
    close(tiltSquash(1, STRATEGIC_ZOOM), 1, "strategic view is flat");
    close(tiltSquash(1, 0.4), 1, "below the strategic zoom");
    const mid = tiltSquash(1, (STRATEGIC_ZOOM + 1) / 2);
    assert.ok(mid > TILT.squash && mid < 1, `half-way zoom is half tilted, got ${mid}`);
    close(tiltRise(1), 0, "no rise top-down");
  });

  const BASE = APOTHEM / PHI ** 3;
  const TOP = APOTHEM;
  test("prisms rise from apothem / φ³ to the apothem with the message count (log scale)", () => {
    close(prismHeight(APOTHEM, 0, 500), BASE, "plinth");
    close(prismHeight(APOTHEM, 500, 500), TOP, "busiest session");
    close(prismHeight(APOTHEM, 3, 0), BASE, "no messages anywhere");
    const low = prismHeight(APOTHEM, 10, 500);
    const high = prismHeight(APOTHEM, 100, 500);
    assert.ok(low < high && high < TOP, "more messages stand taller");
    // Log scale: a tenth of the busiest session still gets well over half the rise.
    assert.ok(high - BASE > (TOP - BASE) / 2);
  });

  test("the tallest prism never reaches the row behind it", () => {
    const rowStep = 64 * 1.5;
    assert.ok(TOP * tiltRise(TILT.squash) < rowStep * TILT.squash, "a raised top stays below the next row's centre");
  });

  // Text safe zone, tilted: upright text must lie inside the foreshortened safe zone.
  const t = cellGeometry(APOTHEM, TILT.squash);
  const margin = APOTHEM - t.safeApothem;
  const inZone = (x: number, y: number) => insetOf(APOTHEM, x, y, TILT.squash) >= margin - 1e-6;

  test("geometry matches the top-down one: the icon and badge lie on the face", () => {
    const flat = cellGeometry(APOTHEM);
    for (const key of ["iconSize", "safeApothem", "badgeDistance", "badgeAngle", "badgeRadius", "badgeOutline", "badgeGlyph", "yieldFont", "yieldHeight", "noteFont"] as const) close(t[key], flat[key], key);
    // The icon lies on the face: its foreshortened bottom edge is where the upright pill is centred.
    close((t.iconSize / 2) * TILT.squash, t.yieldOffset * TILT.squash, "pill rides the tilted icon's bottom edge");
  });

  test("the yield pill, upright at its foreshortened anchor, fits two characters at full size (longer counts shrink)", () => {
    const offset = t.yieldOffset * TILT.squash;
    const top = offset - t.yieldHeight / 2;
    const bottom = offset + t.yieldHeight / 2;
    const maxWidth = 2 * safeHalfWidth(t, top, bottom);
    const two = 2 * 0.62 * t.yieldFont + t.yieldFont;
    assert.ok(two <= maxWidth, `a two-character pill is ${two} wide, the tilted zone allows ${maxWidth}`);
    // drawYield clamps the pill to maxWidth and shrinks the type: the clamped box must stay inside.
    for (const [x, y] of [[-maxWidth / 2, top], [maxWidth / 2, top], [-maxWidth / 2, bottom], [maxWidth / 2, bottom]]) {
      assert.ok(inZone(x ?? 0, y ?? 0), `pill corner (${x}, ${y}) crowds an edge`);
    }
  });

  test("a pin note keeps a few characters of width, inside the tilted zone", () => {
    const offset = t.noteOffset * TILT.squash;
    const half = t.noteFont * 0.625;
    const maxWidth = 2 * safeHalfWidth(t, offset - half, offset + half);
    assert.ok(maxWidth >= 3 * t.noteFont, `note line only ${maxWidth} wide`);
    assert.ok(inZone(maxWidth / 2, offset + half) && inZone(-maxWidth / 2, offset - half));
  });
});

describe("sticker icons", () => {
  test("the die-cut border is φ⁻⁴ of the icon radius, closing gaps up to φ² borders", () => {
    close(STICKER.border, PHI ** -4, "border");
    close(STICKER.closing, PHI ** 2, "closing");
  });
  test("the shadow: blur = border · φ, offset = border / φ, φ⁻³ black", () => {
    close(STICKER.shadowBlur, STICKER.border * PHI, "blur");
    close(STICKER.shadowOffset, STICKER.border / PHI, "offset");
    close(STICKER.shadowAlpha, PHI ** -3, "alpha");
  });
  test("the border stays inside the waiting badge's clearance", () => {
    const g = cellGeometry(APOTHEM);
    const edge = (g.iconSize / 2) * (1 + STICKER.border);
    assert.ok(edge < g.badgeDistance, "the badge centre lies beyond the sticker's edge");
  });
});

// Guard against bypassing ./golden: the drawing code must take every size, timing and fade from it.
describe("drawing code uses ./golden", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("agent-status.ts declares no numeric constants of its own", () => {
    const source = read("./agent-status.ts");
    const numeric = source.match(/^const [A-Z_]+ = [-\d.(]/gm) ?? [];
    assert.deepEqual(numeric, [], "move sizes, timings and fades into golden.ts instead");
    assert.match(source, /from "\.\/golden"/, "agent-status.ts must import from ./golden");
    assert.match(source, /cellGeometry\(frame\.width \/ 2, frame\.squash\)/, "geometry must derive from the hex apothem (and the tilt)");
  });

  test("the canvas sizes placed icons with cellGeometry", () => {
    const source = read("../index.ts");
    assert.match(source, /const \{ iconSize \} = cellGeometry\(hexRadius\)/);
    assert.doesNotMatch(source, /iconSize = \d/, "icon size must not be hard-coded");
  });
});
