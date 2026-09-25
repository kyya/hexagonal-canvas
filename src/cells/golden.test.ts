// Locks the golden-ratio design of a cell. If one of these fails, a proportion, timing or fade
// drifted from φ. Change the design on purpose by updating ./golden.ts *and* this file together,
// and re-check the look with the cell-storybook skill.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { BREATH, breathAlpha, cellGeometry, FADES, FOG, PHI, phiFade, STRATEGIC_ZOOM } from "./golden.ts";

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

  test("apothem : badge distance = φ : 1", () => {
    close(APOTHEM / g.badgeDistance, PHI, "apothem / badge distance");
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

  test("badge clears the icon's centre area and stays inside the hex", () => {
    const reach = g.badgeDistance + g.badgeRadius + g.badgeOutline;
    assert.ok(reach < APOTHEM, `badge reaches ${reach}, hex apothem is ${APOTHEM}`);
    assert.ok(g.badgeDistance > g.iconSize / 2, "badge centre must lie outside the icon's radius");
  });

  test("apothem : yield offset = φ : 1, icon radius : yield font = φ : 1", () => {
    close(APOTHEM / g.yieldOffset, PHI, "apothem / yield offset");
    close(g.iconSize / 2 / g.yieldFont, PHI, "icon radius / yield font");
  });

  test("scales with the hex", () => {
    const double = cellGeometry(APOTHEM * 2);
    for (const key of ["iconSize", "badgeDistance", "badgeRadius", "badgeOutline", "badgeGlyph", "yieldOffset", "yieldFont"] as const) {
      close(double[key], g[key] * 2, `${key} at twice the size`);
    }
    close(double.badgeAngle, g.badgeAngle, "badge angle does not scale");
  });

  // Pixel snapshot at the canvas size (side 64): catches a change that keeps the ratios but moves the base.
  const snapshot = { iconSize: 42.341, badgeDistance: 34.255, badgeRadius: 8.086, badgeOutline: 1.909, badgeGlyph: 9.995 };
  for (const [key, value] of Object.entries(snapshot)) {
    test(`${key} ≈ ${value}px`, () => close(g[key as keyof typeof snapshot], value, key, 0.0005));
  }
  test("badge angle ≈ -58.283°", () => close((g.badgeAngle * 180) / Math.PI, -58.283, "badge angle", 0.0005));
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

// Guard against bypassing ./golden: the drawing code must take every size, timing and fade from it.
describe("drawing code uses ./golden", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("agent-status.ts declares no numeric constants of its own", () => {
    const source = read("./agent-status.ts");
    const numeric = source.match(/^const [A-Z_]+ = [-\d.(]/gm) ?? [];
    assert.deepEqual(numeric, [], "move sizes, timings and fades into golden.ts instead");
    assert.match(source, /from "\.\/golden"/, "agent-status.ts must import from ./golden");
    assert.match(source, /cellGeometry\(frame\.width \/ 2\)/, "geometry must derive from the hex apothem");
  });

  test("the canvas sizes placed icons with cellGeometry", () => {
    const source = read("../index.ts");
    assert.match(source, /const \{ iconSize \} = cellGeometry\(hexRadius\)/);
    assert.doesNotMatch(source, /iconSize = \d/, "icon size must not be hard-coded");
  });
});
