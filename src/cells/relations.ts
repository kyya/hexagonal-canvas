// Civ's roads and rivers: a line from each session to the session it came from — solid with an
// arrow for a spawned sub-agent, dashed for a fork. Lines stop short of the icons they join.
import { subscribeLayout, type Layout } from "../live";
import { cellGeometry, PHI, phiFade } from "./golden";
import type { CellModule, OverlayFrame } from "./types";

const LINE = "71, 85, 105";

let layout: Layout = { sessions: [], labels: [] };

export type RelationCurve = { childId: string; parentId: string; kind: "fork" | "spawn"; from: Point; control: Point; to: Point };
type Point = { x: number; y: number };

let curves: RelationCurve[] = [];

function computeCurves(frame: OverlayFrame): RelationCurve[] {
  const byId = new Map(layout.sessions.map((session) => [session.id, session]));
  const centre = (col: number, row: number) => {
    const { x, y } = frame.origin(col, row);
    return { x: x + frame.width / 2, y: y + frame.side };
  };
  // Stop at the golden ring around the icon so the line never covers it.
  const clearance = cellGeometry(frame.width / 2).iconSize / 2 * PHI ** 0.5;
  const result: RelationCurve[] = [];
  for (const child of layout.sessions) {
    if (!child.parentId || !child.relation) continue;
    const parent = byId.get(child.parentId);
    if (!parent) continue;
    const a = centre(parent.col, parent.row);
    const b = centre(child.col, child.row);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    // Bow the line sideways by length/φ³ so parallel relations stay apart.
    const bow = length / PHI ** 3;
    const control = { x: (a.x + b.x) / 2 - uy * bow, y: (a.y + b.y) / 2 + ux * bow };
    const from = { x: a.x + ux * clearance, y: a.y + uy * clearance };
    const to = { x: b.x - ux * clearance, y: b.y - uy * clearance };
    result.push({ childId: child.id, parentId: parent.id, kind: child.relation, from, control, to });
  }
  return result;
}

export const relations: CellModule = {
  kind: "relations",
  start(onChange) {
    subscribeLayout((next) => {
      layout = next;
      onChange();
    });
  },
  cells() {
    return [];
  },
  draw() {},
  overlay(frame) {
    curves = computeCurves(frame);
    const { ctx } = frame;
    const width = Math.max(2, 1.2 / frame.zoom);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const curve of curves) {
      ctx.strokeStyle = `rgba(${LINE}, ${phiFade(1)})`;
      ctx.lineWidth = width;
      ctx.setLineDash(curve.kind === "fork" ? [width * 3, width * 2.5] : []);
      ctx.beginPath();
      ctx.moveTo(curve.from.x, curve.from.y);
      ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.to.x, curve.to.y);
      ctx.stroke();
      // Arrowhead at the child, along the curve's final tangent.
      const angle = Math.atan2(curve.to.y - curve.control.y, curve.to.x - curve.control.x);
      const size = width * 3.5;
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${LINE}, ${phiFade(1)})`;
      ctx.beginPath();
      ctx.moveTo(curve.to.x, curve.to.y);
      ctx.lineTo(curve.to.x - Math.cos(angle - 0.45) * size, curve.to.y - Math.sin(angle - 0.45) * size);
      ctx.lineTo(curve.to.x - Math.cos(angle + 0.45) * size, curve.to.y - Math.sin(angle + 0.45) * size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
  menu() {},
};

// Test hook: the curves as last drawn, in world coordinates.
export function relationCurves(): RelationCurve[] {
  return curves;
}
