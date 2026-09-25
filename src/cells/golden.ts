// Every proportion inside a cell derives from the golden ratio, measured from the hex's apothem
// (the radius of its inscribed circle, half the cell's width):
//
//   apothem : icon radius           =  φ² : 1
//   apothem : badge distance        =  φ  : 1   (badge centre from the icon centre)
//   icon radius : badge radius      =  φ² : 1
//   badge radius : badge outline    =  φ³ : 1
//   badge diameter : glyph size     =  φ  : 1
//
// A session's state is a soft tint filling the hex. The tints breathe with periods that are powers
// of φ seconds, and every opacity is a negative power of φ. Only the waiting state adds a small
// badge, so it can be recognised without relying on colour; the badge sits on the diagonal of a
// golden rectangle (rise : run = φ : 1), top-right of the icon.
export const PHI = (1 + Math.sqrt(5)) / 2;

export type CellGeometry = {
  iconSize: number;
  badgeDistance: number;
  badgeAngle: number;
  badgeRadius: number;
  badgeOutline: number;
  badgeGlyph: number;
};

export function cellGeometry(apothem: number): CellGeometry {
  const iconRadius = apothem / PHI ** 2;
  const badgeRadius = iconRadius / PHI ** 2;
  return {
    iconSize: iconRadius * 2,
    badgeDistance: apothem / PHI,
    badgeAngle: -Math.atan(PHI),
    badgeRadius,
    badgeOutline: badgeRadius / PHI ** 3,
    badgeGlyph: (badgeRadius * 2) / PHI,
  };
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
