// Every proportion inside a cell derives from the golden ratio, measured from the hex's apothem
// (the radius of its inscribed circle, half the cell's width):
//
//   apothem : icon radius           =  φ² : 1
//   apothem : safe margin           =  φ³ : 1   (text keep-out band along every edge)
//   icon radius : badge radius      =  φ² : 1
//   badge radius : badge outline    =  φ³ : 1
//   badge diameter : glyph size     =  φ  : 1
//   icon radius : yield font        =  φ  : 1
//
// Text safe zone: anything that carries text (the waiting badge, yield numbers, pin notes) must
// lie entirely inside the hex shrunk by the safe margin, so no glyph crowds an edge. The badge sits
// on the diagonal of a golden rectangle (rise : run = φ : 1), top-right, as far out as the safe zone
// allows; the yield number rides the icon's bottom edge like an app-icon badge.
//
// A session's state is a soft tint filling the hex. The tints breathe with periods that are powers
// of φ seconds, and every opacity is a negative power of φ. Only the waiting state adds the badge,
// so it can be recognised without relying on colour.
export const PHI = (1 + Math.sqrt(5)) / 2;

export type CellGeometry = {
  iconSize: number;
  // Apothem of the text safe zone: the hex shrunk by apothem / φ³ on every side.
  safeApothem: number;
  badgeDistance: number;
  badgeAngle: number;
  badgeRadius: number;
  badgeOutline: number;
  badgeGlyph: number;
  // Yield number: centre below the icon centre, font size, pill height.
  yieldOffset: number;
  yieldFont: number;
  yieldHeight: number;
  // Map pin: tack head radius and centre (above the cell centre), tip, and the note line below.
  pinHeadRadius: number;
  pinHeadY: number;
  pinTipY: number;
  noteOffset: number;
  noteFont: number;
};

export function cellGeometry(apothem: number): CellGeometry {
  const iconRadius = apothem / PHI ** 2;
  const safeApothem = apothem - apothem / PHI ** 3;
  const badgeRadius = iconRadius / PHI ** 2;
  const badgeOutline = badgeRadius / PHI ** 3;
  const badgeAngle = -Math.atan(PHI);
  const yieldFont = iconRadius / PHI;
  const pinHeadRadius = iconRadius / PHI ** 2;
  const pinHeadY = -iconRadius / PHI;
  return {
    iconSize: iconRadius * 2,
    safeApothem,
    // Push the badge out along its diagonal until its outline touches the safe zone.
    badgeDistance: badgeDistanceWithin(safeApothem, badgeAngle, badgeRadius + badgeOutline),
    badgeAngle,
    badgeRadius,
    badgeOutline,
    badgeGlyph: (badgeRadius * 2) / PHI,
    yieldOffset: iconRadius,
    yieldFont,
    yieldHeight: yieldFont * PHI,
    pinHeadRadius,
    pinHeadY,
    pinTipY: pinHeadY + pinHeadRadius * PHI ** 2,
    noteOffset: iconRadius,
    noteFont: yieldFont,
  };
}

// Pointy-top hex edges have outward normals at 0°, ±60°, ±120° and 180°. A point is inside a hex
// of apothem `a` when its projection on every normal is at most `a`.
const EDGE_NORMALS = [0, 60, 120, 180, 240, 300].map((deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const);

// Largest distance along `angle` at which a disc of `radius` still fits inside the hex of apothem `a`.
function badgeDistanceWithin(a: number, angle: number, radius: number): number {
  const reach = Math.max(...EDGE_NORMALS.map(([nx, ny]) => Math.cos(angle) * nx + Math.sin(angle) * ny));
  return (a - radius) / reach;
}

// How far a point (relative to the cell centre) is inside the hex of apothem `a` (negative = outside).
export function insetOf(a: number, x: number, y: number): number {
  return a - Math.max(...EDGE_NORMALS.map(([nx, ny]) => x * nx + y * ny));
}

// Half the widest text box, centred horizontally, that fits inside the safe zone while spanning
// vertical offsets `top` … `bottom` (relative to the cell centre).
export function safeHalfWidth(g: Pick<CellGeometry, "safeApothem">, top: number, bottom: number): number {
  const farthest = Math.max(Math.abs(top), Math.abs(bottom));
  // Vertical edges bound |x| by the apothem; slanted edges by 0.5|x| + (√3/2)|y| ≤ apothem.
  return Math.max(0, Math.min(g.safeApothem, 2 * (g.safeApothem - (Math.sqrt(3) / 2) * farthest)));
}

// φ^-n: 0.618, 0.382, 0.236, 0.146, 0.090 …
export function phiFade(n: number): number {
  return PHI ** -n;
}

export type Breath = {
  // Opacity of the hex tint at the bottom and top of a breath; equal values mean no breathing.
  min: number;
  max: number;
  // One full breath, in milliseconds.
  periodMs: number;
};

// Each state has its own colour, depth and rhythm, so they can be told apart at a glance:
// idle is still, busy breathes shallow and quick, waiting breathes deep and slow.
export const BREATH = {
  idle: { min: phiFade(5), max: phiFade(5), periodMs: 1000 * PHI },
  busy: { min: phiFade(5), max: phiFade(3), periodMs: 1000 * PHI },
  waiting: { min: phiFade(4), max: phiFade(2), periodMs: 1000 * PHI ** 2 },
} as const satisfies Record<string, Breath>;

// Opacities: negative powers of φ.
export const FADES = {
  // History sessions are faded so running ones stand out.
  history: phiFade(2),
} as const;

// Tint opacity of a breath at time `now`: a cosine ease from min up to max and back.
export function breathAlpha(breath: Breath, now: number): number {
  const phase = (now % breath.periodMs) / breath.periodMs;
  return breath.min + (breath.max - breath.min) * ((1 - Math.cos(phase * Math.PI * 2)) / 2);
}

// Fog of war: history sessions untouched this long are veiled at φ⁻¹, like unexplored land.
export const FOG = {
  afterDays: 30,
  veil: phiFade(1),
} as const;

// Strategic view (Civ's 2D map): below zoom φ⁻¹, cells become flat colour and icons are dropped.
export const STRATEGIC_ZOOM = 1 / PHI;
