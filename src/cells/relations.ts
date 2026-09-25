// Civ's roads and rivers: a line from each session to the session it came from — solid with an
// arrow for a spawned sub-agent, dashed for a fork. Drawing every family at once turns the map into
// a tangle, so only the focused session's family is drawn (hover a cell or open its menu), with
// straight lines that stop short of the icons they join.
import { focusedHex, subscribeFocus } from "../focus";
import { subscribeLayout, type Layout, type LiveSession } from "../live";
import { cellGeometry, PHI, phiFade } from "./golden";
import type { CellModule, OverlayFrame } from "./types";

const LINE = "71, 85, 105";

let layout: Layout = { sessions: [], labels: [], stacks: [] };

export type RelationCurve = { childId: string; parentId: string; kind: "fork" | "spawn"; from: Point; control: Point; to: Point };
type Point = { x: number; y: number };

let curves: RelationCurve[] = [];

// Every session linked to the focused one through parent links: up to the root, then all of the
// root's descendants.
function focusedFamily(): Set<string> {
  const hex = focusedHex();
  if (!hex) return new Set();
  const focused = layout.sessions.find((session) => session.col === hex.col && session.row === hex.row);
  if (!focused) return new Set();
  const byId = new Map(layout.sessions.map((session) => [session.id, session]));
  let root: LiveSession = focused;
  const seen = new Set<string>([root.id]);
  while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
    root = byId.get(root.parentId) ?? root;
    seen.add(root.id);
  }
  const family = new Set<string>([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const session of layout.sessions) {
      if (session.parentId && family.has(session.parentId) && !family.has(session.id)) {
        family.add(session.id);
        grew = true;
      }
    }
  }
  return family.size > 1 ? family : new Set();
}

function computeCurves(frame: OverlayFrame): RelationCurve[] {
  const family = focusedFamily();
  if (family.size === 0) return [];
  const byId = new Map(layout.sessions.map((session) => [session.id, session]));
  // Tilted, lines join the centres of the raised top faces.
  const centre = (col: number, row: number) => {
    const { x, y } = frame.origin(col, row);
    return { x: x + frame.width / 2, y: y + frame.side - frame.lift(col, row) };
  };
  // Stop at the golden ring around the icon so the line never covers it.
  const clearance = (cellGeometry(frame.width / 2).iconSize / 2) * PHI ** 0.5;
  const result: RelationCurve[] = [];
  for (const child of layout.sessions) {
    if (!family.has(child.id) || !child.parentId || !child.relation) continue;
    const parent = byId.get(child.parentId);
    if (!parent) continue;
    const a = centre(parent.col, parent.row);
    const b = centre(child.col, child.row);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const from = { x: a.x + ux * clearance, y: a.y + uy * clearance };
    const to = { x: b.x - ux * clearance, y: b.y - uy * clearance };
    // Straight: the control point sits on the line.
    result.push({ childId: child.id, parentId: parent.id, kind: child.relation, from, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to });
  }
  return result;
}

export const relations: CellModule = {
  kind: "relations",
  start(onChange) {
    subscribeFocus(onChange);
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
      ctx.lineTo(curve.to.x, curve.to.y);
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
