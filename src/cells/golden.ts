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
  rippleSpread: number;
  badgeRadius: number;
  badgeOutline: number;
  badgeAngle: number;
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
    // The waiting ripple travels the golden section of the gap between ring and hex edge.
    rippleSpread: (apothem - ringRadius) / PHI,
    badgeRadius,
    badgeOutline: ringWidth / PHI,
    badgeAngle: -Math.atan(PHI),
  };
}

// φ^-n: 0.618, 0.382, 0.236, 0.146 …
export function phiFade(n: number): number {
  return PHI ** -n;
}
