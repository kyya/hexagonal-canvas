// Draws map pins on the canvas and handles their menu (edit or remove the note).
import { allPins, pinAt, removePin, setPin, subscribePins } from "../pins";
import { pinMatches, searchQuery, subscribeSearch } from "../search";
import { cellGeometry, PHI, phiFade, safeHalfWidth } from "./golden";
import type { BoardCell, CellModule } from "./types";

const PIN_COLOUR = "#e11d48";
// Line box of the note, as a multiple of its font size (ascenders to descenders).
const NOTE_LINE = 1.25;

function cellsFromPins(): BoardCell[] {
  return allPins().map((pin) => ({ id: `pin:${pin.col},${pin.row}`, col: pin.col, row: pin.row }));
}

let cells: BoardCell[] = cellsFromPins();

export const pinsModule: CellModule = {
  kind: "pins",
  start(onChange) {
    subscribePins(() => {
      cells = cellsFromPins();
      onChange();
    });
    subscribeSearch(onChange);
  },
  cells() {
    return cells;
  },
  draw(cell, frame) {
    const pin = pinAt(cell.col, cell.row);
    if (!pin) return;
    const { ctx } = frame;
    const g = cellGeometry(frame.width / 2);
    const cx = frame.x + frame.width / 2;
    // A small map tack above the centre, leaving room for the note inside the text safe zone.
    const head = g.pinHeadRadius;
    const headY = frame.midY + g.pinHeadY;
    const tipY = frame.midY + g.pinTipY;
    ctx.save();
    if (!pinMatches(pin, searchQuery())) ctx.globalAlpha = phiFade(2);
    ctx.fillStyle = PIN_COLOUR;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - head / PHI, headY + head / PHI);
    ctx.lineTo(cx + head / PHI, headY + head / PHI);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, headY, head, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, headY, head / PHI ** 2, 0, Math.PI * 2);
    ctx.fill();
    // The note, truncated to the widest line the text safe zone allows at its height.
    ctx.font = `600 ${g.noteFont}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(17, 24, 39, 0.78)";
    const maxWidth = 2 * safeHalfWidth(g, g.noteOffset - g.noteFont * NOTE_LINE / 2, g.noteOffset + g.noteFont * NOTE_LINE / 2);
    let text = pin.note;
    if (ctx.measureText(text).width > maxWidth) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
      text = `${text}…`;
    }
    ctx.fillText(text, cx, frame.midY + g.noteOffset);
    ctx.restore();
  },
  describe(cell) {
    const pin = pinAt(cell.col, cell.row);
    return pin ? { title: `📍 ${pin.note}`, subtitle: "地图钉 · 右键编辑", command: null } : null;
  },
  menu(cell, menu) {
    const pin = pinAt(cell.col, cell.row);
    menu.showForm({
      title: "地图钉",
      value: pin?.note ?? "",
      placeholder: "写点备注…",
      submitLabel: "保存",
      onSubmit: (note) => setPin(cell.col, cell.row, note),
      onDelete: pin ? () => removePin(cell.col, cell.row) : undefined,
    });
  },
  menuEmpty(col, row, menu) {
    menu.showForm({
      title: "在这里插一枚地图钉",
      value: "",
      placeholder: "写点备注…",
      submitLabel: "插上",
      onSubmit: (note) => setPin(col, row, note),
    });
    return true;
  },
};
