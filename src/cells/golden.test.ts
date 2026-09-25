// Locks the golden-ratio design of a cell. If one of these fails, a proportion, timing or fade
// drifted from φ. Change the design on purpose by updating ./golden.ts *and* this file together,
// and re-check the look with the cell-storybook skill.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { cellGeometry, FADES, MOTION, PHI, phiFade } from "./golden.ts";

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

describe("cell geometry ratios", () => {
  const g = cellGeometry(APOTHEM);
  const iconRadius = g.iconSize / 2;

  test("apothem : ring : icon radius = φ² : φ : 1", () => {
    close(APOTHEM / g.ringRadius, PHI, "apothem / ring");
    close(g.ringRadius / iconRadius, PHI, "ring / icon radius");
    close(APOTHEM / iconRadius, PHI ** 2, "apothem / icon radius");
  });

  test("icon radius : badge radius = φ² : 1", () => {
    close(iconRadius / g.badgeRadius, PHI ** 2, "icon radius / badge radius");
  });

  test("badge radius : ring stroke = φ² : 1", () => {
    close(g.badgeRadius / g.ringWidth, PHI ** 2, "badge radius / ring stroke");
  });

  test("ring stroke : badge outline = φ : 1", () => {
    close(g.ringWidth / g.badgeOutline, PHI, "ring stroke / badge outline");
  });

  test("badge sits on the golden-rectangle diagonal (rise : run = φ : 1), top-right", () => {
    close(Math.tan(-g.badgeAngle), PHI, "tan(badge angle)");
    assert.ok(g.badgeAngle < 0 && g.badgeAngle > -Math.PI / 2, "badge must be in the top-right quadrant");
  });

  test("badge glyph is the golden section of the badge diameter", () => {
    close((g.badgeRadius * 2) / g.badgeGlyph, PHI, "badge diameter / glyph");
  });

  test("everything scales with the hex", () => {
    const double = cellGeometry(APOTHEM * 2);
    for (const key of ["iconSize", "ringRadius", "ringWidth", "badgeRadius", "badgeOutline", "badgeGlyph"] as const) {
      close(double[key], g[key] * 2, `${key} at twice the size`);
    }
    close(double.badgeAngle, g.badgeAngle, "badge angle does not scale");
  });

  test("ring, badge and its outline stay inside the hex", () => {
    const badgeReach = g.ringRadius + g.badgeRadius + g.badgeOutline;
    assert.ok(badgeReach < APOTHEM, `badge reaches ${badgeReach}, hex apothem is ${APOTHEM}`);
    assert.ok(g.ringRadius + g.ringWidth / 2 < APOTHEM, "ring must stay inside the hex");
    assert.ok(iconRadius + g.ringWidth / 2 < g.ringRadius, "ring must clear the icon");
  });
});

describe("cell geometry at the canvas size (side 64)", () => {
  // Pixel snapshot: catches any change, even one that keeps the ratios but moves the base.
  const g = cellGeometry(APOTHEM);
  const expected = {
    iconSize: 42.341,
    ringRadius: 34.255,
    ringWidth: 3.089,
    badgeRadius: 8.086,
    badgeOutline: 1.909,
    badgeGlyph: 9.995,
  };
  for (const [key, value] of Object.entries(expected)) {
    test(`${key} ≈ ${value}px`, () => close(g[key as keyof typeof expected], value, key, 0.0005));
  }
  test("badge angle ≈ -58.283°", () => close((g.badgeAngle * 180) / Math.PI, -58.283, "badge angle", 0.0005));
});

describe("motion", () => {
  test("spinner turns once per φ seconds and stretches every φ² seconds", () => {
    close(MOTION.spinMs, 1000 * PHI, "spinMs");
    close(MOTION.stretchMs, 1000 * PHI ** 2, "stretchMs");
  });

  test("spinner arc stretches between 2π/φ³ and 2π/φ", () => {
    close(MOTION.arcMin, (2 * Math.PI) / PHI ** 3, "arcMin");
    close(MOTION.arcMax, (2 * Math.PI) / PHI, "arcMax");
  });

  test("waiting breathes once per φ seconds", () => {
    close(MOTION.pulseMs, 1000 * PHI, "pulseMs");
  });
});

describe("fades", () => {
  const expected: Record<keyof typeof FADES, number> = {
    history: 2,
    busyTrack: 4,
    idleTrack: 3,
    waitingFillMin: 4,
    waitingFillMax: 2,
    waitingRingMin: 1,
  };
  for (const [key, power] of Object.entries(expected)) {
    test(`${key} = φ⁻${power}`, () => close(FADES[key as keyof typeof FADES], PHI ** -power, key));
  }
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
