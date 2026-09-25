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
  // Vertical foreshortening of the ground: 1 in the top-down view, φ⁻¹ fully tilted (see TILT).
  squash: number;
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

// Positions are offsets from the cell centre on the ground. In the tilted view the hex is
// foreshortened by `squash`: the icon and the waiting badge lie on it and tilt with it, so their
// ground geometry holds as is. Upright text (yield numbers, pin notes) is anchored at a
// foreshortened offset and sized with safeHalfWidth, which reads `squash` from the geometry.
export function cellGeometry(apothem: number, squash = 1): CellGeometry {
  const iconRadius = apothem / PHI ** 2;
  const safeApothem = apothem - apothem / PHI ** 3;
  const badgeRadius = iconRadius / PHI ** 2;
  const badgeOutline = badgeRadius / PHI ** 3;
  const badgeAngle = -Math.atan(PHI);
  const yieldFont = iconRadius / PHI;
  const pinHeadRadius = iconRadius / PHI ** 2;
  const pinHeadY = -iconRadius / PHI;
  return {
    squash,
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

// How far a point (relative to the cell centre) is inside the hex of apothem `a` (negative = outside),
// measured on the ground: with `squash` < 1, (x, y) is a screen offset in the tilted view.
export function insetOf(a: number, x: number, y: number, squash = 1): number {
  return a - Math.max(...EDGE_NORMALS.map(([nx, ny]) => x * nx + (y / squash) * ny));
}

// Half the widest text box, centred horizontally, that fits inside the safe zone while spanning
// vertical offsets `top` … `bottom` (screen offsets from the cell centre).
export function safeHalfWidth(g: Pick<CellGeometry, "safeApothem"> & { squash?: number }, top: number, bottom: number): number {
  const farthest = Math.max(Math.abs(top), Math.abs(bottom)) / (g.squash ?? 1);
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

// Tilted view (Civ's default camera, key T): the ground is foreshortened to φ⁻¹ of its height
// (cos θ = φ⁻¹, θ ≈ 51.8°), so a height h stands h · sin θ = h · φ^-½ tall on screen. Sessions rise
// as hex prisms; icons lie on their top faces, tilted with the ground, while text stands upright. The camera tilts over φ⁻¹ s, and the tilt
// eases out as you zoom towards the strategic view, which is always flat.
export const TILT = {
  squash: 1 / PHI,
  glideMs: 1000 / PHI,
} as const;

// Foreshortening for a tilt `amount` (0 top-down … 1 tilted) at camera `zoom`.
export function tiltSquash(amount: number, zoom: number): number {
  const fade = Math.min(1, Math.max(0, (zoom - STRATEGIC_ZOOM) / (1 - STRATEGIC_ZOOM)));
  return 1 - Math.min(1, Math.max(0, amount)) * fade * (1 - TILT.squash);
}

// On-screen height of a unit of prism height, for a foreshortening `squash`.
export function tiltRise(squash: number): number {
  return Math.sqrt(Math.max(0, 1 - squash * squash));
}

// Prism height of a session: a plinth of apothem / φ³, rising towards the apothem with its message
// count (log scale, relative to the busiest session), so long conversations stand out like hills.
export function prismHeight(apothem: number, messages: number, maxMessages: number): number {
  const base = apothem / PHI ** 3;
  const top = apothem;
  const share = maxMessages > 0 ? Math.log1p(Math.max(0, messages)) / Math.log1p(maxMessages) : 0;
  return base + (top - base) * Math.min(1, share);
}

// Sticker look for agent icons: a white die-cut border hugging the logo's silhouette (concavities
// narrower than a few borders are closed, like a real cut line), resting on the cell with a soft
// shadow cast down and to the right, away from the upper-left light that shades the prisms.
// Sizes are fractions of the icon radius; the shadow is φ⁻³ black.
export const STICKER = {
  border: phiFade(4),
  // Concavities up to this many borders wide are closed by the cut line.
  closing: PHI ** 2,
  shadowBlur: phiFade(4) * PHI,
  shadowOffset: phiFade(4) / PHI,
  shadowAlpha: phiFade(3),
} as const;

// Breathing is slow (periods of φ and φ² seconds), so it is redrawn at about 18 frames a second
// (one frame per φ⁶ ms ≈ 56 ms) instead of every display frame, and not at all while the tab is
// hidden or the viewer prefers reduced motion (tints then hold the middle of their breath).
export const BREATH_FRAME_MS = 1000 / PHI ** 6;

export function stillBreath(breath: Breath): number {
  return (breath.min + breath.max) / 2;
}

// Coin stacks: each project's stale sessions (untouched for FOG.afterDays) pile up on one hex as a
// neat stack of hex tiles the size of the cell, each apothem / φ⁵ thick, exactly on top of one
// another: the bottom tile is the cell itself and the stack rises from it. It shows
// 1 + log_φ(count) tiles, one more each time the count grows by φ: one session is one tile, 18
// sessions (≈ φ⁶) are seven tiles, the most a stack shows.
export const STACK = {
  thickness: phiFade(5),
  maxCoins: 7,
} as const;

export function coinCount(sessions: number): number {
  if (sessions <= 0) return 0;
  return Math.min(STACK.maxCoins, 1 + Math.round(Math.log(sessions) / Math.log(PHI)));
}
