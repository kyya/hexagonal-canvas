// Draws map pins on the canvas and handles their menu (edit or remove the note).
import { allPins, pinAt, removePin, setPin, subscribePins } from "../pins";
import { pinMatches, searchQuery, subscribeSearch } from "../search";
import { cellGeometry, PHI, phiFade } from "./golden";
import type { BoardCell, CellModule } from "./types";

const PIN_COLOUR = "#e11d48";

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
    // A map tack: round head on a point, sized to the golden icon radius.
    const head = g.iconSize / 2 / PHI;
    const tipY = frame.midY + head * PHI;
    const headY = frame.midY - head / PHI;
    ctx.save();
    if (!pinMatches(pin, searchQuery())) ctx.globalAlpha = phiFade(2);
    ctx.fillStyle = PIN_COLOUR;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - head * 0.62, headY + head * 0.5);
    ctx.lineTo(cx + head * 0.62, headY + head * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, headY, head, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, headY, head / PHI ** 2, 0, Math.PI * 2);
    ctx.fill();
    // The note, truncated, under the tack.
    ctx.font = `600 ${g.yieldFont}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(17, 24, 39, 0.78)";
    const maxWidth = frame.width * (1 / PHI + 0.2);
    let text = pin.note;
    while (text.length > 1 && ctx.measureText(text).width > maxWidth) text = text.slice(0, -1);
    if (text !== pin.note) text = `${text.slice(0, -1)}…`;
    ctx.fillText(text, cx, frame.midY + g.yieldOffset);
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
