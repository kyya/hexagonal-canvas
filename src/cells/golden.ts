// Every proportion inside a cell derives from the golden ratio, measured from the hex's apothem
// (the radius of its inscribed circle, half the cell's width):
//
//   apothem : status ring : icon radius   =  φ² : φ : 1
//   icon radius : badge radius            =  φ² : 1
//   badge radius : ring stroke            =  φ² : 1
//   ring stroke : badge outline           =  φ  : 1
//
// The badge sits where the ring meets the diagonal of a golden rectangle (rise : run = φ : 1),
// timings are multiples of φ seconds and fades are negative powers of φ.
export const PHI = (1 + Math.sqrt(5)) / 2;

export type CellGeometry = {
  iconSize: number;
  ringRadius: number;
  ringWidth: number;
  badgeRadius: number;
  badgeOutline: number;
  badgeAngle: number;
  // Font size of the glyph inside the badge ("!"): the golden section of the badge's diameter.
  badgeGlyph: number;
};

export function cellGeometry(apothem: number): CellGeometry {
  const ringRadius = apothem / PHI;
  const iconRadius = ringRadius / PHI;
  const badgeRadius = iconRadius / PHI ** 2;
  const ringWidth = badgeRadius / PHI ** 2;
  return {
    iconSize: iconRadius * 2,
    ringRadius,
    ringWidth,
    badgeRadius,
    badgeOutline: ringWidth / PHI,
    badgeAngle: -Math.atan(PHI),
    badgeGlyph: (badgeRadius * 2) / PHI,
  };
}

// φ^-n: 0.618, 0.382, 0.236, 0.146 …
export function phiFade(n: number): number {
  return PHI ** -n;
}

// Animation timing: multiples of φ seconds.
export const MOTION = {
  // Busy spinner: one turn per φ s; the arc stretches between 2π/φ³ and 2π/φ every φ² s.
  spinMs: 1000 * PHI,
  stretchMs: 1000 * PHI ** 2,
  arcMin: (Math.PI * 2) / PHI ** 3,
  arcMax: (Math.PI * 2) / PHI,
  // Waiting: fill and ring breathe once per φ s.
  pulseMs: 1000 * PHI,
} as const;

// Opacities: negative powers of φ.
export const FADES = {
  // History sessions are faded so running ones stand out.
  history: phiFade(2),
  busyTrack: phiFade(4),
  idleTrack: phiFade(3),
  // Waiting fill breathes between these, the ring between waitingRingMin and 1.
  waitingFillMin: phiFade(4),
  waitingFillMax: phiFade(2),
  waitingRingMin: phiFade(1),
} as const;
